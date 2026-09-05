"use server";

import { revalidatePath } from "next/cache";
import { removeAllUserStorage } from "@/lib/profile/storage-buckets";
import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { cancelStripeCustomerBilling } from "@/lib/stripe/cancel-customer";
import { PLAN_LIMITS } from "@/lib/plans";
import { computeAdminBadgeCounts, type AdminBadgeCounts } from "@/lib/admin/badges";
import { requireAdmin } from "@/lib/admin/require-admin";
import { VIDEO_MODELS } from "@/lib/generations/providers/video-models";
import { IMAGE_MODELS } from "@/lib/generations/providers/image-models";
import {
  MAX_IDENTITY_THRESHOLD,
  MIN_IDENTITY_THRESHOLD,
} from "@/lib/generations/identity-gate";

// Called imperatively (not from a <form>) by AdminCommandBar, which polls
// this on an interval to keep the nav's red-dot badges live without the
// admin having to refresh the page. requireAdmin() re-checks the session on
// every poll rather than trusting a stale client-side "yes I'm an admin" --
// this runs every ~10s for as long as any admin page is open, so it has to
// hold up to being called that often, not just once per page load.
export async function getAdminBadgeCounts(): Promise<AdminBadgeCounts> {
  const { supabase } = await requireAdmin();
  return computeAdminBadgeCounts(supabase);
}

// These actions are all wired to native <form action={...}> elements with no
// client-side result handling. On failure they redirect back to wherever the
// form was submitted from with ?error=<message> — the admin pages read that
// and show it via <AdminErrorBanner>, instead of the failure only landing in
// a server log nobody's watching.
//
// setUserStatus renders on both /admin/users and /admin/users/[id], so its
// forms include a hidden redirect_to field saying which one to bounce back
// to; every other action here only appears on one page, so its redirect
// target is just hardcoded.

export async function setUserStatus(formData: FormData) {
  const { supabase, admin, userId: actingUserId } = await requireAdmin();
  const userId = formData.get("user_id") as string;
  const status = formData.get("status") as string;
  const rawRedirect = (formData.get("redirect_to") as string) || "/admin/users";
  // Only ever redirect back into the admin area — never an arbitrary or
  // off-site path from form input.
  const redirectTo = rawRedirect.startsWith("/admin/") ? rawRedirect : "/admin/users";

  if (status !== "active" && status !== "suspended") {
    redirect(`${redirectTo}?error=${encodeURIComponent("Invalid status.")}`);
  }

  // An admin suspending their own account would lock them out with no one
  // else able to undo it if they're the only admin — block it outright
  // rather than trust everyone to remember not to.
  if (userId === actingUserId && status === "suspended") {
    redirect(`${redirectTo}?error=${encodeURIComponent("You can't suspend your own account.")}`);
  }

  // Two layers must agree: the auth-layer ban (Supabase rejects login and
  // token refresh, so a suspended user can't just mint a fresh session) and
  // profiles.status (middleware + generation gate block the sessions that
  // already exist). Ordered ban-first ON PURPOSE: the previous version wrote
  // the profile flag first and a ban failure then redirected out, leaving a
  // user marked suspended who could still sign straight back in — the two
  // layers silently disagreeing, with the admin screen showing "suspended".
  // Failing after the ban instead leaves the safer skew (can't log in, flag
  // not yet set), and even that is compensated below: if the profile write
  // fails, the ban is rolled back so both layers end up telling the same
  // story, and the error banner says what actually happened.
  const { error: banError } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: status === "suspended" ? "876000h" : "none",
  });
  if (banError) {
    // Nothing was changed yet — plain failure, both layers untouched.
    redirect(`${redirectTo}?error=${encodeURIComponent(banError.message)}`);
  }

  const { error } = await admin.from("profiles").update({ status }).eq("id", userId);
  if (error) {
    // Roll the ban back so the auth layer matches the profile flag again.
    // Best-effort: if even the rollback fails, say so explicitly rather
    // than reporting only half the truth.
    const { error: rollbackError } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: status === "suspended" ? "none" : "876000h",
    });
    redirect(
      `${redirectTo}?error=${encodeURIComponent(
        rollbackError
          ? `Couldn't update the profile status (${error.message}) AND couldn't roll back the login ban (${rollbackError.message}) — the account's login ban does not match its listed status. Retry to reconcile.`
          : `Couldn't update the profile status (${error.message}) — the login ban was rolled back, nothing changed.`,
      )}`,
    );
  }

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
}

// Permanently deletes a user and everything they own. Uses the admin
// (service-role) client's auth.admin.deleteUser, which removes the auth.users
// row; every table that references it — profiles and, through profiles,
// character_profiles / generations / projects / feedback / generation_reports,
// plus brand_rules / notes / credit_purchases / generation_jobs / push_tokens /
// reference_image_generations — is ON DELETE CASCADE, so the whole account is
// cleaned up in one call. page_views keeps its rows with user_id nulled, so
// traffic analytics aren't retroactively dented by a deletion.
//
// Irreversible, so it's guarded: admins can't delete themselves, and the UI
// (DeleteUserButton) requires a confirm before this ever runs.
export async function deleteUser(formData: FormData) {
  const { userId: actingUserId } = await requireAdmin();
  const userId = formData.get("user_id") as string;

  if (userId === actingUserId) {
    redirect(
      `/admin/users/${userId}?error=${encodeURIComponent("You can't delete your own account.")}`,
    );
  }

  const admin = createAdminClient();

  // Cancel their Stripe billing FIRST, while the profile row still holds the
  // ids — the auth deletion below cascades profiles away, and with it the
  // only record of which subscription/customer to stop. Skipping this left
  // deleted paying users still being charged every month. Deliberately NOT
  // best-effort: if Stripe errors, the deletion aborts loudly, because an
  // account that's gone while its subscription keeps billing is the one
  // outcome this must never produce. (redirect() throws, so the error is
  // carried out of the try/catch rather than redirecting inside it.)
  const { data: billingProfile } = await admin
    .from("profiles")
    .select("stripe_customer_id, stripe_subscription_id, plan_source, plan_status")
    .eq("id", userId)
    .single();

  // Play-billed twin of the Stripe rule (2026-08-31): their subscription
  // lives at Google, we cannot cancel it from here, and deleting the account
  // anyway silently produces "account gone, Google still billing". The user
  // (or support, via Google) has to cancel it Play-side first.
  if (
    billingProfile?.plan_source === "play" &&
    (billingProfile.plan_status === "active" || billingProfile.plan_status === "past_due")
  ) {
    redirect(
      `/admin/users/${userId}?error=${encodeURIComponent(
        "This account's subscription is billed through Google Play and can't be cancelled from here — the account was NOT deleted. Have them cancel in the Play Store (or revoke it in the Play Console), then delete.",
      )}`,
    );
  }

  let stripeCancelError: string | null = null;
  try {
    await cancelStripeCustomerBilling({
      stripeCustomerId: billingProfile?.stripe_customer_id ?? null,
      stripeSubscriptionId: billingProfile?.stripe_subscription_id ?? null,
    });
  } catch (err) {
    console.error("deleteUser: Stripe cancellation failed — aborting deletion", err);
    stripeCancelError = err instanceof Error ? err.message : "Stripe error";
  }
  if (stripeCancelError) {
    redirect(
      `/admin/users/${userId}?error=${encodeURIComponent(
        `Couldn't cancel their Stripe billing (${stripeCancelError}) — the account was NOT deleted. Sort it out in the Stripe dashboard, then try again.`,
      )}`,
    );
  }

  // Auth delete BEFORE the storage purge — the same fail-loudly-first
  // ordering the self-serve path earned (round-two audit): the purge is
  // irreversible and needs only the userId prefix, never the DB rows, so
  // running it first meant a transient deleteUser failure left a LIVE
  // account whose Stripe billing was already cancelled and whose every file
  // was already gone — with an error banner naming none of that. The
  // flipped worst case (account gone, files briefly orphaned) is what the
  // sweep's own best-effort contract already accepts.
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    redirect(
      `/admin/users/${userId}?error=${encodeURIComponent(
        `Couldn't delete the account (${error.message}). Their Stripe billing WAS already cancelled — retry the deletion, or restore their plan manually if they should stay.`,
      )}`,
    );
  }

  // Storage sweep after the account is really gone. Every file lives under
  // a `${userId}/...` prefix in the user buckets; DB rows cascaded with the
  // auth user. THE SAME sweep as account self-deletion, by construction —
  // this used to be a hand-copied loop that had already drifted.
  await removeAllUserStorage(admin, userId);

  revalidatePath("/admin/users");
  redirect("/admin/users?message=" + encodeURIComponent("User deleted."));
}

export async function toggleFeatureFlag(formData: FormData) {
  const { supabase } = await requireAdmin();
  const key = formData.get("key") as string;
  const enabled = formData.get("enabled") === "true";

  const { error } = await supabase
    .from("feature_flags")
    .update({ enabled: !enabled, updated_at: new Date().toISOString() })
    .eq("key", key);

  if (error) {
    redirect(`/admin/flags?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin/flags");
}

// Per-key validation for the settings this table actually holds. The generic
// form on /admin/settings posts any key in the table, and "any non-empty
// string" let a typo'd model id or a word where a number belongs sit in
// config until something downstream read it and misbehaved (a bad
// max_retry_attempts silently parses to NaN in the pipeline's Number()).
// Known keys get real checks; unknown keys (future settings added in the DB
// before this list learns about them) still save, just length-capped, so the
// page never blocks an operator from a new knob.
function validateAppSetting(key: string, value: string): string | null {
  switch (key) {
    case "video_model":
      return VIDEO_MODELS.some((m) => m.id === value)
        ? null
        : `Unknown video model — expected one of: ${VIDEO_MODELS.map((m) => m.id).join(", ")}.`;
    case "image_model":
      return IMAGE_MODELS.some((m) => m.id === value)
        ? null
        : `Unknown image model — expected one of: ${IMAGE_MODELS.map((m) => m.id).join(", ")}.`;
    case "max_retry_attempts": {
      const n = Number(value);
      return Number.isInteger(n) && n >= 1 && n <= 10
        ? null
        : "max_retry_attempts must be a whole number from 1 to 10.";
    }
    case "identity_gate_threshold": {
      // Validated here as well as in resolveIdentityThreshold, because the
      // two failures are different. resolveIdentityThreshold falls back to
      // the default SILENTLY, which is right at render time — a malformed
      // setting must never take the product down. But silence is wrong at
      // the moment someone types it: an operator who sets "seventy" and
      // sees it saved would believe the gate was at 70 while it ran at the
      // default, and the only symptom is a bill.
      //
      // The ceiling is MAX_IDENTITY_THRESHOLD (95), not 100: the scorer is a
      // vision model reading a render against a photograph and essentially
      // never returns 100, so 100 would re-render and then refund every
      // generation ever made.
      const n = Number(value);
      return Number.isInteger(n) &&
        n >= MIN_IDENTITY_THRESHOLD &&
        n <= MAX_IDENTITY_THRESHOLD
        ? null
        : `identity_gate_threshold must be a whole number from ${MIN_IDENTITY_THRESHOLD} to ${MAX_IDENTITY_THRESHOLD} (0 turns the gate off).`;
    }
    case "support_email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254
        ? null
        : "support_email must be a valid email address.";
    case "admin_users_last_viewed_at":
      return Number.isFinite(new Date(value).getTime())
        ? null
        : "admin_users_last_viewed_at must be a valid timestamp.";
    default:
      return value.length <= 500 ? null : "Value is too long (500 characters max).";
  }
}

export async function updateAppSetting(formData: FormData) {
  const { supabase } = await requireAdmin();
  const key = formData.get("key") as string;
  const value = (formData.get("value") as string)?.trim();

  if (!value) {
    redirect(`/admin/settings?error=${encodeURIComponent("Value can't be empty.")}`);
  }

  const invalid = validateAppSetting(key, value);
  if (invalid) {
    redirect(`/admin/settings?error=${encodeURIComponent(invalid)}`);
  }

  const { error } = await supabase
    .from("app_settings")
    .update({ value, updated_at: new Date().toISOString() })
    .eq("key", key);

  if (error) {
    redirect(`/admin/settings?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin/settings");
}

export async function setUserRole(formData: FormData) {
  const { supabase, admin, userId: actingUserId } = await requireAdmin();
  const userId = formData.get("user_id") as string;
  const role = formData.get("role") as string;
  const redirectTo = `/admin/users/${userId}`;

  if (role !== "user" && role !== "admin") {
    redirect(`${redirectTo}?error=${encodeURIComponent("Invalid role.")}`);
  }

  // Demoting yourself out of admin, with no one else in the room to undo
  // it, is the kind of mistake that's only obvious after it's locked you
  // out — block it rather than rely on remembering not to.
  if (userId === actingUserId && role !== "admin") {
    redirect(`${redirectTo}?error=${encodeURIComponent("You can't remove your own admin role.")}`);
  }

  const { error } = await admin.from("profiles").update({ role }).eq("id", userId);
  if (error) {
    redirect(`${redirectTo}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/users");
}

export async function setVideoModel(formData: FormData) {
  const { supabase } = await requireAdmin();
  const modelId = formData.get("model_id") as string;

  const { error } = await supabase
    .from("app_settings")
    .update({ value: modelId, updated_at: new Date().toISOString() })
    .eq("key", "video_model");

  if (error) {
    redirect(`/admin/providers?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin/providers");
}

export async function setImageModel(formData: FormData) {
  const { supabase } = await requireAdmin();
  const modelId = formData.get("model_id") as string;

  const { error } = await supabase
    .from("app_settings")
    .update({ value: modelId, updated_at: new Date().toISOString() })
    .eq("key", "image_model");

  if (error) {
    redirect(`/admin/providers?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin/providers");
}

// Curated ElevenLabs voices for character dialogue. Admin-entered rather
// than hardcoded in app code — see the voice_presets migration for why
// (ElevenLabs' legacy named default voices are being retired end of 2026).
// Wigly picks a voice by ear on ElevenLabs/fal.ai first, then enters its
// permanent voice_id here.
export async function addVoicePreset(formData: FormData) {
  const { supabase } = await requireAdmin();
  const label = (formData.get("label") as string)?.trim();
  const description = (formData.get("description") as string)?.trim() || null;
  const elevenlabsVoiceId = (formData.get("elevenlabs_voice_id") as string)?.trim();

  if (!label || !elevenlabsVoiceId) {
    redirect(
      `/admin/voices?error=${encodeURIComponent("Label and ElevenLabs voice ID are both required.")}`,
    );
  }

  const { error } = await supabase.from("voice_presets").insert({
    label,
    description,
    elevenlabs_voice_id: elevenlabsVoiceId,
  });

  if (error) {
    redirect(`/admin/voices?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin/voices");
}

export async function deleteVoicePreset(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = formData.get("id") as string;

  const { error } = await supabase.from("voice_presets").delete().eq("id", id);
  if (error) {
    redirect(`/admin/voices?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin/voices");
  revalidatePath("/app/character");
}

// Toggles a user-submitted "report a problem" between open and resolved —
// see generation_reports and /admin/reports. Reopening is deliberately
// allowed (not just a one-way "resolve" button): marking something resolved
// too early and needing to walk it back shouldn't require going through the
// database directly.
export async function setGenerationReportStatus(formData: FormData) {
  const { supabase } = await requireAdmin();
  const reportId = formData.get("report_id") as string;
  const status = formData.get("status") as string;

  if (status !== "open" && status !== "resolved") {
    redirect(`/admin/reports?error=${encodeURIComponent("Invalid status.")}`);
  }

  const { error } = await supabase
    .from("generation_reports")
    .update({ status, resolved_at: status === "resolved" ? new Date().toISOString() : null })
    .eq("id", reportId);

  if (error) {
    redirect(`/admin/reports?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin/reports");
}

// Same open/resolved toggle as setGenerationReportStatus above, for the
// general feedback queue instead — see the feedback table and /admin/feedback.
export async function setFeedbackStatus(formData: FormData) {
  const { supabase } = await requireAdmin();
  const feedbackId = formData.get("feedback_id") as string;
  const status = formData.get("status") as string;

  if (status !== "open" && status !== "resolved") {
    redirect(`/admin/feedback?error=${encodeURIComponent("Invalid status.")}`);
  }

  const { error } = await supabase
    .from("feedback")
    .update({ status, resolved_at: status === "resolved" ? new Date().toISOString() : null })
    .eq("id", feedbackId);

  if (error) {
    redirect(`/admin/feedback?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin/feedback");
}

// Feature / unfeature a generation on the public "Made with Picacho"
// gallery (/gallery). Toggles generations.featured_at (now() / NULL) — the
// timestamp is also the gallery's sort key. Wired to the small form on the
// admin user page's "Recent generations" card.
//
// V1 CONTENT-RIGHTS RULE: only generations OWNED BY AN ADMIN account may
// be featured. Customer content is never publishable without a consent
// mechanism, which is deliberately out of scope for v1 — so this action
// checks the ROW OWNER's profile role (not the caller's; requireAdmin
// already covers the caller) via the service client and refuses anything
// else. /gallery re-checks the same rule at read time, so even a
// featured_at set by some other route on a customer row never renders.
export async function setGenerationFeatured(formData: FormData) {
  const { admin } = await requireAdmin();
  const generationId = formData.get("generation_id") as string;
  const featured = formData.get("featured") === "true";
  const rawRedirect = (formData.get("redirect_to") as string) || "/admin/users";
  // Only ever redirect back into the admin area — never an arbitrary or
  // off-site path from form input (same rule as setUserStatus).
  const redirectTo = rawRedirect.startsWith("/admin/") ? rawRedirect : "/admin/users";

  if (!generationId) {
    redirect(`${redirectTo}?error=${encodeURIComponent("Missing generation id.")}`);
  }

  // Service client on purpose: the row belongs to whoever owns it, not to
  // the acting admin, and the decision below needs the owner's role.
  const { data: row, error: rowError } = await admin
    .from("generations")
    .select("id, user_id, status")
    .eq("id", generationId)
    .maybeSingle();
  if (rowError || !row) {
    redirect(
      `${redirectTo}?error=${encodeURIComponent(rowError?.message ?? "Generation not found.")}`,
    );
  }

  if (featured) {
    // Unfeaturing is always allowed (taking something off the public site
    // must never be blockable); featuring has to clear both gates.
    if (row.status !== "succeeded") {
      redirect(
        `${redirectTo}?error=${encodeURIComponent("Only succeeded generations can be featured.")}`,
      );
    }
    const { data: owner } = await admin
      .from("profiles")
      .select("role")
      .eq("id", row.user_id)
      .maybeSingle();
    if (owner?.role !== "admin") {
      redirect(
        `${redirectTo}?error=${encodeURIComponent(
          "Only admin-owned generations can be featured — customer content needs a consent mechanism the gallery doesn't have yet.",
        )}`,
      );
    }
  }

  const { error } = await admin
    .from("generations")
    .update({ featured_at: featured ? new Date().toISOString() : null })
    .eq("id", generationId);
  if (error) {
    redirect(`${redirectTo}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/admin/users/${row.user_id}`);
  revalidatePath("/gallery");
}

export async function setUserPlan(formData: FormData) {
  const { supabase, admin } = await requireAdmin();
  const userId = formData.get("user_id") as string;
  const plan = formData.get("plan") as string;
  const redirectTo = `/admin/users/${userId}`;

  if (!Object.keys(PLAN_LIMITS).includes(plan)) {
    redirect(`${redirectTo}?error=${encodeURIComponent("Invalid plan.")}`);
  }

  // A Play-billed account can't be comped over (round-two audit): writing
  // plan_status=null here left plan_source='play' with a null status — the
  // ONE combination the Play guards in deleteUser and deleteAccount don't
  // match, so the comped account could later be deleted while Google kept
  // charging it. Same rule, same instruction as the deletion guard.
  const { data: current } = await admin
    .from("profiles")
    .select("plan_source, plan_status")
    .eq("id", userId)
    .maybeSingle();
  if (
    current?.plan_source === "play" &&
    (current.plan_status === "active" || current.plan_status === "past_due")
  ) {
    redirect(
      `${redirectTo}?error=${encodeURIComponent(
        "This account is billed through Google Play — comping over it would hide a live Google subscription. Have them cancel in the Play Store first, then set the plan.",
      )}`,
    );
  }

  // plan_status is reset to NULL alongside the comp. The allowance gate
  // (checkGenerationAllowance in generations/core.ts) only honours a plan's
  // monthly credits while plan_status is NULL or "active" — a deliberate
  // grant is exactly what NULL means there. Without this reset, comping a
  // plan onto an account whose Stripe subscription had lapsed (past_due /
  // canceled) handed them a plan whose credits stayed paused: the admin
  // screen said Growth, the composer said "your payment failed". plan_source
  // is cleared too — a comp is not a billing source, and a stale 'play'
  // marker with a null status is exactly the guard-defeating state above.
  const { error } = await admin
    .from("profiles")
    .update({ plan, plan_status: null, plan_source: null })
    .eq("id", userId);
  if (error) {
    redirect(`${redirectTo}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/users");
}

// "Give this user a token" — bonus generation credits for the current month,
// on top of whatever their plan normally allows (see checkGenerationAllowance
// in generations/actions.ts, which adds this to the plan limit). Sets the
// absolute value rather than incrementing, same as setUserPlan above — the
// field always shows the true current amount so there's no mental math to
// "add 3 more" on top of a number you'd otherwise have to look up first.
export async function setBonusCredits(formData: FormData) {
  const { supabase, admin } = await requireAdmin();
  const userId = formData.get("user_id") as string;
  const redirectTo = `/admin/users/${userId}`;
  const raw = formData.get("bonus_credits") as string;
  const bonusCredits = Number.parseInt(raw, 10);

  if (!Number.isFinite(bonusCredits) || bonusCredits < 0) {
    redirect(`${redirectTo}?error=${encodeURIComponent("Bonus credits must be 0 or more.")}`);
  }
  // Upper bound (round-two audit): the old floor-only validation let a
  // fat-fingered paste write any value up to integer overflow onto a money
  // counter. Nobody has ever been granted more than double digits.
  if (bonusCredits > 10_000) {
    redirect(`${redirectTo}?error=${encodeURIComponent("That's more than 10,000 bonus credits — if you really mean it, do it in two steps.")}`);
  }

  // Compare-and-set against the value the page rendered: bonus_credits has
  // a SECOND writer (the referral trigger increments it in the database),
  // and the absolute write here silently erased any increment that landed
  // between page render and save (round-two audit). A mismatch now asks the
  // admin to look again instead of destroying a user's earned credit.
  const expectedRaw = formData.get("expected_bonus_credits") as string | null;
  const expected = expectedRaw === null ? null : Number.parseInt(expectedRaw, 10);
  let write = admin.from("profiles").update({ bonus_credits: bonusCredits }).eq("id", userId);
  if (expected !== null && Number.isFinite(expected)) {
    write = write.eq("bonus_credits", expected);
  }
  const { data: updated, error } = await write.select("id");
  if (error) {
    redirect(`${redirectTo}?error=${encodeURIComponent(error.message)}`);
  }
  if (!updated?.length) {
    redirect(
      `${redirectTo}?error=${encodeURIComponent(
        "Their bonus credits changed while this page was open (a referral may have landed) — the value was NOT saved. Check the new number and try again.",
      )}`,
    );
  }
  // The only audit trail this grant has — make it greppable.
  const { data: adminUser } = await supabase.auth.getUser();
  console.log("admin: bonus credits set", {
    userId,
    to: bonusCredits,
    from: expected,
    by: adminUser?.user?.id ?? "unknown",
  });

  revalidatePath(`/admin/users/${userId}`);
}

// Grants API access to an account that isn't on Elite.
//
// Elite includes the API by plan, so this is only ever the exception: a pilot
// customer, a partner, someone mid-migration. Kept as a separate flag rather
// than a plan bump so it can be given and taken back without touching what
// they pay or what else they can do.
export async function setApiAccess(formData: FormData) {
  const { supabase, admin } = await requireAdmin();
  const userId = formData.get("user_id") as string;
  const enabled = formData.get("api_access") === "true";

  const { error } = await admin
    .from("profiles")
    .update({ api_access: enabled })
    .eq("id", userId);
  if (error) {
    redirect(`/admin/users/${userId}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/admin/users/${userId}`);
}

// Manual controls for the provider circuit breaker (see
// lib/generations/model-health.ts).
//
// The breaker recovers on its own — cooldown, then one trial request, and a
// success clears it. But automatic-only recovery leaves no way to act on a
// false trip: if a model is taken out by three failures that turn out to be a
// bad batch of inputs, the only options were to wait out a backoff that
// doubles to six hours, or edit the database by hand. Neither is acceptable
// when the model in question might be the one every free trial depends on.
//
// The reverse control matters too: taking a model out deliberately, before it
// has failed three times, when you already know it's broken or expensive.
export async function restoreModel(formData: FormData): Promise<void> {
  await requireAdmin();
  const modelId = (formData.get("model_id") as string) ?? "";
  if (!modelId) redirect("/admin/providers?error=Missing+model");

  // Validate against the actual catalogues instead of trusting the form
  // value: model_health rows are keyed by model_id, and an arbitrary string
  // here would upsert/update junk rows in the health table (and the same
  // string round-trips into admin UI). The forms only ever post catalogue
  // ids, so anything else is a hand-crafted request.
  const known =
    VIDEO_MODELS.some((m) => m.id === modelId) || IMAGE_MODELS.some((m) => m.id === modelId);
  if (!known) redirect("/admin/providers?error=Unknown+model");

  const admin = createAdminClient();
  await admin
    .from("model_health")
    .update({
      tripped_at: null,
      retry_after: null,
      consecutive_failures: 0,
      failing_user_ids: [],
      // trip_count is deliberately NOT reset. It drives the backoff ladder, so
      // clearing it would let a genuinely dead model be retried every ten
      // minutes forever by anyone who keeps pressing this button.
      updated_at: new Date().toISOString(),
    })
    .eq("model_id", modelId);

  revalidatePath("/admin/providers");
  redirect("/admin/providers");
}

export async function suspendModel(formData: FormData): Promise<void> {
  await requireAdmin();
  const modelId = (formData.get("model_id") as string) ?? "";
  const rawKind = (formData.get("kind") as string) || "video";
  if (!modelId) redirect("/admin/providers?error=Missing+model");

  // kind comes from a closed set and model_id must exist in the catalogue
  // FOR that kind — the old blind `as "video" | "image"` cast let a crafted
  // request upsert a health row with any string in either column, and
  // suspendModel writes rows (unlike restore, which only updates existing
  // ones), so junk here would live in model_health indefinitely.
  if (rawKind !== "video" && rawKind !== "image") {
    redirect("/admin/providers?error=Unknown+model");
  }
  const kind = rawKind as "video" | "image";
  const catalogue = kind === "video" ? VIDEO_MODELS : IMAGE_MODELS;
  if (!catalogue.some((m) => m.id === modelId)) {
    redirect("/admin/providers?error=Unknown+model");
  }

  const admin = createAdminClient();
  await admin.from("model_health").upsert({
    model_id: modelId,
    kind,
    tripped_at: new Date().toISOString(),
    // No retry_after: a deliberate suspension stays until it's lifted by hand,
    // rather than quietly letting itself back in after a cooldown.
    retry_after: null,
    consecutive_failures: 0,
    last_error: "Suspended manually from the admin area.",
    updated_at: new Date().toISOString(),
  });

  revalidatePath("/admin/providers");
  redirect("/admin/providers");
}

// Community moderation (operator: "I need a moderation area for it") — the
// hide/unhide toggle from /admin/moderation. Rides the "Admins moderate
// posts" RLS policy with the admin's own session, same as the in-feed
// control; hiding is the moderation verb on purpose (reversible, keeps the
// sharer's row intact) — deletion stays the owner's own act.
export async function setCommunityPostModeration(formData: FormData) {
  const { supabase } = await requireAdmin();
  const postId = formData.get("post_id") as string;
  const hide = formData.get("hide") === "1";

  const { error } = await supabase
    .from("community_posts")
    .update({ hidden_at: hide ? new Date().toISOString() : null })
    .eq("id", postId);

  if (error) {
    redirect(`/admin/moderation?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin/moderation");
  revalidatePath("/app/community");
}
