"use server";

import { revalidatePath } from "next/cache";
import { removeAllUserStorage } from "@/lib/profile/storage-buckets";
import { erasePromoRedemptionEmail } from "@/lib/profile/promo-redemptions";
import { removeUserRateHits } from "@/lib/rate-hits";
import { deleteUserFaces } from "@/lib/faces/run";
import { forgetSocialAccountsOnDelete } from "@/lib/social/forget";
import { deleteUserVoices } from "@/lib/voices/forget";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { cancelStripeCustomerBilling } from "@/lib/stripe/cancel-customer";
import { PLAN_LIMITS } from "@/lib/plans";
import { computeAdminBadgeCounts, MODERATION_CLEARED_KEY, type AdminBadgeCounts } from "@/lib/admin/badges";
import { requireAdmin } from "@/lib/admin/require-admin";
import { logAdminAction } from "@/lib/admin/audit";
import {
  opAddNote,
  opAdjustCredits,
  opCheckRender,
  opRefundRender,
  opSetFeedbackStatus,
  opSetReportStatus,
  opSetUserStatus,
  opStopRender,
} from "@/lib/admin/ops";
import { VIDEO_MODELS } from "@/lib/generations/providers/video-models";
import { IMAGE_MODELS } from "@/lib/generations/providers/image-models";
import {
  MAX_IDENTITY_THRESHOLD,
  MIN_IDENTITY_THRESHOLD,
} from "@/lib/generations/identity-gate";
import { SEEDANCE_LANE_KEY } from "@/lib/generations/providers/lane-setting";
import { validatePressTourSetting } from "@/lib/press-tour/enabled";
import { validateFilmLaneSetting } from "@/lib/press-tour/film-lane";

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
  const { admin, userId: actingUserId } = await requireAdmin();
  const userId = formData.get("user_id") as string;
  const status = formData.get("status") as string;
  const rawRedirect = (formData.get("redirect_to") as string) || "/admin/users";
  // Only ever redirect back into the admin area — never an arbitrary or
  // off-site path from form input.
  const redirectTo = rawRedirect.startsWith("/admin/") ? rawRedirect : "/admin/users";

  // The two layers — the auth-layer ban (Supabase rejects login and token
  // refresh, so a suspended user can't mint a fresh session) and
  // profiles.status (middleware + the generation gate block the sessions
  // that already exist) — must agree. opSetUserStatus (lib/admin/ops.ts)
  // bans FIRST, then writes the flag, and rolls the ban back if the flag
  // fails: the old flag-first order left accounts marked suspended that
  // could sign straight back in. It also refuses to suspend yourself —
  // with no other admin, nobody could undo it. The phone admin app runs the
  // same function.
  const result = await opSetUserStatus(admin, actingUserId, { userId, status });
  if (!result.ok) redirect(`${redirectTo}?error=${encodeURIComponent(result.error)}`);

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
// traffic analytics aren't retroactively dented by a deletion; so does
// promo_redemptions, a rep's commission record, once the buyer's email on
// it has been erased.
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

  // The email on their promo sales, erased while those rows still carry
  // this id: the auth delete below nulls it (lib/profile/promo-redemptions.ts).
  // Ahead of Stripe, so a failure here stops the deletion with nothing
  // changed yet.
  const promoEmailError = await erasePromoRedemptionEmail(admin, userId);
  if (promoEmailError) {
    console.error("deleteUser: promo sale email not erased — aborting deletion", promoEmailError);
    redirect(
      `/admin/users/${userId}?error=${encodeURIComponent(
        "Couldn't erase their email from the promo sales — the account was NOT deleted, and nothing was changed. Try again; details are in the server log.",
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

  // A verified face lives at BytePlus, not in our database, so the cascade
  // below never reaches it — and until 2026-09-19 only the self-serve path
  // withdrew it, so an account deleted from here left its face behind with
  // no row left to find it by. The same call, in the same place: after the
  // Stripe stop (a deletion that stops there keeps the face), before the auth
  // delete, while the rows that name it still exist. Deleted there, or queued
  // in the one table that outlives the account for the daily prune to finish
  // (lib/faces/run.ts). Best-effort by design — it never blocks the deletion.
  await deleteUserFaces(admin, userId);
  // Their connected social accounts (Press Tour posting): the same call as
  // the self-serve path, in the same place, for the same reason — queued
  // posts cancelled, keys revoked at the network while the rows still exist,
  // a failed revoke owed for the posts clock. Bounded; never blocks.
  await forgetSocialAccountsOnDelete(admin, userId);
  // Their generated and cloned voices, deleted at ElevenLabs while the rows
  // that name them still exist (lib/voices/forget.ts). Best-effort; never blocks.
  await deleteUserVoices(admin, userId);

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
    // Everything above has already happened. The banner collapses this to a
    // fixed line saying so (admin-error-banner.tsx); the cause is logged here
    // — e.g. a newer table referencing the account without ON DELETE CASCADE
    // ("Database error deleting user").
    console.error("deleteUser: auth delete failed after Stripe was cancelled", error);
    redirect(
      `/admin/users/${userId}?error=${encodeURIComponent(
        `Couldn't delete the account (${error.message}). Their Stripe billing WAS already cancelled, and a verified face, if they had one, was withdrawn — retry the deletion, or restore their plan manually if they should stay.`,
      )}`,
    );
  }

  // Storage sweep after the account is really gone. Every file lives under
  // a `${userId}/...` prefix in the user buckets; DB rows cascaded with the
  // auth user. THE SAME sweep as account self-deletion, by construction —
  // this used to be a hand-copied loop that had already drifted.
  await removeAllUserStorage(admin, userId);
  // The limiter's rows have no foreign key to cascade with (rate-hits.ts).
  await removeUserRateHits(admin, userId);

  // Ids only: the account is gone, so the log keeps no address for it.
  await logAdminAction(admin, actingUserId, {
    action: "user.delete",
    targetType: "user",
    targetId: userId,
    subjectUserId: userId,
    before: billingProfile?.plan_status ? `plan ${billingProfile.plan_status}` : "account",
    after: "deleted",
  });

  revalidatePath("/admin/users");
  redirect("/admin/users?message=" + encodeURIComponent("User deleted."));
}

export async function toggleFeatureFlag(formData: FormData) {
  const { supabase, admin, userId: actingUserId } = await requireAdmin();
  const key = formData.get("key") as string;
  const enabled = formData.get("enabled") === "true";

  const { error } = await supabase
    .from("feature_flags")
    .update({ enabled: !enabled, updated_at: new Date().toISOString() })
    .eq("key", key);

  if (error) {
    console.error("toggleFeatureFlag: flag update failed", error);
    redirect(`/admin/flags?error=${encodeURIComponent(error.message)}`);
  }

  await logAdminAction(admin, actingUserId, {
    action: "flag.toggle",
    targetType: "flag",
    targetId: key,
    before: enabled ? "on" : "off",
    after: enabled ? "off" : "on",
  });

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
  // Press Tour's settings (applied/2026-09-26/press-tour-01-flags.sql) and its film lane
  // (press-tour-03b-film.sql): each reader fails closed on a malformed value,
  // so a typo here would silently switch something off while the page said
  // it saved. Both answer null for any key that isn't theirs.
  const press = validatePressTourSetting(key, value) ?? validateFilmLaneSetting(key, value);
  if (press) return press;
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
  const { supabase, admin, userId: actingUserId } = await requireAdmin();
  const key = formData.get("key") as string;
  const value = (formData.get("value") as string)?.trim();

  if (!value) {
    redirect(`/admin/settings?error=${encodeURIComponent("Value can't be empty.")}`);
  }

  const invalid = validateAppSetting(key, value);
  if (invalid) {
    redirect(`/admin/settings?error=${encodeURIComponent(invalid)}`);
  }
  // A default must be on the customer menu (Admin → Models), or customers who pick nothing are refused.
  if (key === "video_model" || key === "image_model") {
    const { offered } = await import("@/lib/models/controls");
    if (!(await offered(key === "video_model" ? "video" : "picture", value))) {
      redirect(`/admin/settings?error=${encodeURIComponent("That model is off the menu on Admin → Models. Put it back on before making it the default.")}`);
    }
  }

  const { data: previous } = await supabase.from("app_settings").select("value").eq("key", key).maybeSingle();
  const { error } = await supabase
    .from("app_settings")
    .update({ value, updated_at: new Date().toISOString() })
    .eq("key", key);

  if (error) {
    console.error("updateAppSetting: setting update failed", error);
    redirect(`/admin/settings?error=${encodeURIComponent(error.message)}`);
  }

  await logAdminAction(admin, actingUserId, {
    action: "setting.update",
    targetType: "setting",
    targetId: key,
    before: previous?.value ?? null,
    after: value,
  });

  revalidatePath("/admin/settings");
}

export async function setUserRole(formData: FormData) {
  const { admin, userId: actingUserId } = await requireAdmin();
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

  const { data: previous } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
  const { error } = await admin.from("profiles").update({ role }).eq("id", userId);
  if (error) {
    console.error("setUserRole: role update failed", error);
    redirect(`${redirectTo}?error=${encodeURIComponent(error.message)}`);
  }

  await logAdminAction(admin, actingUserId, {
    action: "user.role",
    targetType: "user",
    targetId: userId,
    subjectUserId: userId,
    before: previous?.role ?? null,
    after: role,
  });

  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/users");
}

// Which provider runs Seedance (2026-09-06). Upsert rather than update: this
// key has no migration behind it, so the first click has to create the row —
// and through the SERVICE client, because app_settings carries an admin UPDATE
// policy but no INSERT policy at all, so a user-scoped insert would be refused
// by RLS on that very first click and on no click after it.
//
// requireAdmin has already established the caller is an admin; the service
// client is the write mechanism, not the authorisation.
export async function setSeedanceProvider(formData: FormData) {
  const { admin, userId: actingUserId } = await requireAdmin();
  const raw = formData.get("provider");
  // Never trust the form for a value that decides where money is spent.
  const provider = raw === "byteplus" ? "byteplus" : "fal";
  const { data: previous } = await admin.from("app_settings").select("value").eq("key", SEEDANCE_LANE_KEY).maybeSingle();

  const { error } = await admin.from("app_settings").upsert(
    {
      key: SEEDANCE_LANE_KEY,
      value: provider,
      description: "Which provider runs Seedance renders. Needs BYTEPLUS_SEEDANCE_LANE=on to reach BytePlus.",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );

  if (error) {
    console.error("setSeedanceProvider: provider upsert failed", error);
    redirect(`/admin/providers?error=${encodeURIComponent(error.message)}`);
  }

  await logAdminAction(admin, actingUserId, {
    action: "model.seedance_lane",
    targetType: "model",
    targetId: SEEDANCE_LANE_KEY,
    before: previous?.value ?? null,
    after: provider,
  });

  revalidatePath("/admin/providers");
  revalidatePath("/admin/system");
}

// Curated ElevenLabs voices for character dialogue. Admin-entered rather
// than hardcoded in app code — see the voice_presets migration for why
// (ElevenLabs' legacy named default voices are being retired end of 2026).
// Wigly picks a voice by ear on ElevenLabs/fal.ai first, then enters its
// permanent voice_id here.
export async function addVoicePreset(formData: FormData) {
  const { supabase, admin, userId: actingUserId } = await requireAdmin();
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
    console.error("addVoicePreset: insert failed", error);
    redirect(`/admin/voices?error=${encodeURIComponent(error.message)}`);
  }

  await logAdminAction(admin, actingUserId, {
    action: "voice.add",
    targetType: "voice",
    targetId: elevenlabsVoiceId,
    after: label,
  });

  revalidatePath("/admin/voices");
}

// Aly's default voice (2026-09-26): the first preset in the list is what she
// speaks with for everyone who hasn't picked one in Settings. "Make default"
// puts this one first (sort_order below every other) — the only order the
// list has, so character pickers list it first too.
export async function makeDefaultVoicePreset(formData: FormData) {
  const { supabase, admin, userId: actingUserId } = await requireAdmin();
  const id = formData.get("id") as string;
  const { data: all, error: readError } = await supabase.from("voice_presets").select("id, sort_order").is("owner_id", null);
  if (readError) {
    console.error("makeDefaultVoicePreset: read failed", readError);
    redirect(`/admin/voices?error=${encodeURIComponent(readError.message)}`);
  }
  if (!all?.some((v) => v.id === id)) {
    redirect(`/admin/voices?error=${encodeURIComponent("That voice isn't in the list any more.")}`);
  }
  const lowest = Math.min(...all!.map((v) => Number(v.sort_order) || 0));
  const { error } = await supabase.from("voice_presets").update({ sort_order: lowest - 1 }).eq("id", id);
  if (error) {
    console.error("makeDefaultVoicePreset: update failed", error);
    redirect(`/admin/voices?error=${encodeURIComponent(error.message)}`);
  }
  await logAdminAction(admin, actingUserId, { action: "voice.default", targetType: "voice", targetId: id });
  revalidatePath("/admin/voices");
  revalidatePath("/app/settings");
}

export async function deleteVoicePreset(formData: FormData) {
  const { supabase, admin, userId: actingUserId } = await requireAdmin();
  const id = formData.get("id") as string;

  // A preset with characters on it is not deletable (2026-09-23). The
  // constraint used to be ON DELETE SET NULL, so one click here silently
  // un-voiced every character using this voice — and a character with no
  // voice renders with the engine's own invented one. The database now
  // refuses (character_profiles_voice_id_fkey, ON DELETE RESTRICT); this
  // check exists so the refusal arrives as a sentence with a number in it
  // rather than as a raw Postgres constraint message.
  const { count, error: inUseError } = await supabase
    .from("character_profiles")
    .select("id", { count: "exact", head: true })
    .eq("voice_id", id);
  // Fixed strings, not a sentence with the count in it: the banner treats
  // ?error as a CODE and only renders messages it recognises verbatim
  // (admin-error-banner.tsx), so a dynamic tail would collapse to the
  // generic line and tell the admin nothing.
  if (inUseError) {
    console.error("deleteVoicePreset: couldn't check who uses this voice", inUseError);
    redirect(
      `/admin/voices?error=${encodeURIComponent(
        "Couldn't check whether characters are using this voice — nothing was deleted. Details are in the server log.",
      )}`,
    );
  }
  if ((count ?? 0) > 0) {
    redirect(
      `/admin/voices?error=${encodeURIComponent(
        "Characters are still using this voice — reassign them to another voice first.",
      )}`,
    );
  }

  const { error } = await supabase.from("voice_presets").delete().eq("id", id);
  if (error) {
    console.error("deleteVoicePreset: delete failed", error);
    redirect(`/admin/voices?error=${encodeURIComponent(error.message)}`);
  }
  await logAdminAction(admin, actingUserId, { action: "voice.delete", targetType: "voice", targetId: id });

  revalidatePath("/admin/voices");
  revalidatePath("/app/character");
}

// Toggles a user-submitted "report a problem" between open and resolved —
// see generation_reports and /admin/reports. Reopening is deliberately
// allowed (not just a one-way "resolve" button): marking something resolved
// too early and needing to walk it back shouldn't require going through the
// database directly.
export async function setGenerationReportStatus(formData: FormData) {
  const { admin, userId: actingUserId } = await requireAdmin();
  const result = await opSetReportStatus(admin, actingUserId, {
    reportId: formData.get("report_id") as string,
    status: formData.get("status") as string,
  });
  if (!result.ok) redirect(`/admin/reports?error=${encodeURIComponent(result.error)}`);

  revalidatePath("/admin/reports");
  revalidatePath("/admin");
}

// Same open/resolved toggle as setGenerationReportStatus above, for the
// general feedback queue instead — see the feedback table and /admin/feedback.
export async function setFeedbackStatus(formData: FormData) {
  const { admin, userId: actingUserId } = await requireAdmin();
  const result = await opSetFeedbackStatus(admin, actingUserId, {
    feedbackId: formData.get("feedback_id") as string,
    status: formData.get("status") as string,
  });
  if (!result.ok) redirect(`/admin/feedback?error=${encodeURIComponent(result.error)}`);

  revalidatePath("/admin/feedback");
  revalidatePath("/admin");
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
  const { admin, userId: actingUserId } = await requireAdmin();
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
  if (rowError) {
    console.error("setGenerationFeatured: generation lookup failed", rowError);
    redirect(`${redirectTo}?error=${encodeURIComponent(rowError.message)}`);
  }
  if (!row) {
    redirect(`${redirectTo}?error=${encodeURIComponent("Generation not found.")}`);
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
    console.error("setGenerationFeatured: featured_at update failed", error);
    redirect(`${redirectTo}?error=${encodeURIComponent(error.message)}`);
  }

  await logAdminAction(admin, actingUserId, {
    action: featured ? "render.feature" : "render.unfeature",
    targetType: "render",
    targetId: generationId,
    subjectUserId: row.user_id,
  });

  revalidatePath(`/admin/users/${row.user_id}`);
  revalidatePath("/gallery");
}

export async function setUserPlan(formData: FormData) {
  const { admin, userId: actingUserId } = await requireAdmin();
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
    .select("plan, plan_source, plan_status")
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
    console.error("setUserPlan: plan update failed", error);
    redirect(`${redirectTo}?error=${encodeURIComponent(error.message)}`);
  }

  await logAdminAction(admin, actingUserId, {
    action: "user.plan",
    targetType: "user",
    targetId: userId,
    subjectUserId: userId,
    before: current ? `${current.plan ?? "none"}${current.plan_status ? ` (${current.plan_status})` : ""}` : null,
    after: `${plan} (comp)`,
  });

  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/users");
}

// Picacho Light for someone else (operator, 2026-09-28: "Add an option on
// Admin for me to see the users pick between Picacho light and Studio and
// dark version and the ability to change it for them"). Writes the same two
// profile columns the person's own welcome step and Settings write
// (supabase/pending/picacho-light.sql). "unset" clears one: no version =
// they are asked again on their next visit; no look = each device keeps
// its own. A new version applies on their next page; a new look reaches each
// of their devices once, over that device's own pick (lookToApply).
export async function setUserAppChoices(formData: FormData) {
  const { admin, userId: actingUserId } = await requireAdmin();
  const userId = formData.get("user_id") as string;
  const redirectTo = `/admin/users/${userId}`;
  const mode = formData.get("app_mode") as string;
  const look = formData.get("app_look") as string;

  if (!["light", "advanced", "unset"].includes(mode) || !["light", "dark", "system", "unset"].includes(look)) {
    redirect(`${redirectTo}?error=${encodeURIComponent("Pick a version and a look from the lists.")}`);
  }

  const { error } = await admin
    .from("profiles")
    .update({ app_mode: mode === "unset" ? null : mode, app_look: look === "unset" ? null : look })
    .eq("id", userId);
  if (error) {
    console.error("setUserAppChoices: update failed", error);
    redirect(
      `${redirectTo}?error=${encodeURIComponent(
        /app_mode|app_look/.test(error.message)
          ? "Picacho Light's columns aren't in the database yet: run supabase/pending/picacho-light.sql first."
          : error.message,
      )}`,
    );
  }

  await logAdminAction(admin, actingUserId, {
    action: "user.app_choices",
    targetType: "user",
    targetId: userId,
    subjectUserId: userId,
    after: `version ${mode}, look ${look}`,
  });

  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/users");
}

// "Give this user a token" — the bonus balance: credits spent once the plan's
// monthly ones run out, before bought ones, and gone once spent (a depleting
// balance since 2026-09-23; checkGenerationAllowance in generations/core.ts).
// Sets the absolute value rather than incrementing, same as setUserPlan
// above — the field starts on the true current amount, and the page's label
// names the balance it replaces, so giving 3 back is that number plus 3.
export async function setBonusCredits(formData: FormData) {
  const { admin, userId: actingUserId } = await requireAdmin();
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
  // other writers — renders spend it (spend_bonus_credits) and refunds put
  // it back (add_bonus_credits) — and the absolute write here silently
  // erased any change that landed between page render and save (round-two
  // audit, when the other writer was the referral trigger; referrals have
  // paid bought credits since). A mismatch asks the admin to look again
  // instead of undoing a spend or a refund.
  const expectedRaw = formData.get("expected_bonus_credits") as string | null;
  const expected = expectedRaw === null ? null : Number.parseInt(expectedRaw, 10);
  let write = admin.from("profiles").update({ bonus_credits: bonusCredits }).eq("id", userId);
  if (expected !== null && Number.isFinite(expected)) {
    write = write.eq("bonus_credits", expected);
  }
  const { data: updated, error } = await write.select("id");
  if (error) {
    console.error("setBonusCredits: bonus credits update failed", error);
    redirect(`${redirectTo}?error=${encodeURIComponent(error.message)}`);
  }
  if (!updated?.length) {
    redirect(
      `${redirectTo}?error=${encodeURIComponent(
        "Their bonus credits changed while this page was open (a render spent some, or a refund put some back) — the value was NOT saved. Check the new number and try again.",
      )}`,
    );
  }
  await logAdminAction(admin, actingUserId, {
    action: "credits.set",
    targetType: "user",
    targetId: userId,
    subjectUserId: userId,
    before: expected,
    after: bonusCredits,
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
  const { admin, userId: actingUserId } = await requireAdmin();
  const userId = formData.get("user_id") as string;
  const enabled = formData.get("api_access") === "true";

  const { error } = await admin
    .from("profiles")
    .update({ api_access: enabled })
    .eq("id", userId);
  if (error) {
    console.error("setApiAccess: api_access update failed", error);
    redirect(`/admin/users/${userId}?error=${encodeURIComponent(error.message)}`);
  }

  await logAdminAction(admin, actingUserId, {
    action: "user.api_access",
    targetType: "user",
    targetId: userId,
    subjectUserId: userId,
    before: enabled ? "off" : "granted",
    after: enabled ? "granted" : "off",
  });

  revalidatePath(`/admin/users/${userId}`);
}

// The Producer for one account (2026-09-26, operator: "Give me an option to
// grant users access to The assistant in the admin area"). Any plan, even
// while producer_elite is off; it meters against Elite's assistant
// allowance (lib/producer/enabled.ts). Revoking takes the lamp away on their
// next page; their conversation and notes are kept.
export async function setProducerAccess(formData: FormData) {
  const { admin, userId: actingUserId } = await requireAdmin();
  const userId = formData.get("user_id") as string;
  const enabled = formData.get("producer_access") === "true";

  const { error } = await admin
    .from("profiles")
    .update({ producer_access: enabled })
    .eq("id", userId);
  if (error) {
    console.error("setProducerAccess: producer_access update failed", error);
    // Before producer-access.sql runs the column is missing: say what to do.
    const message = /producer_access/.test(error.message)
      ? "Run supabase/applied/2026-09-26/producer-access.sql in Supabase first, then grant again."
      : error.message;
    redirect(`/admin/users/${userId}?error=${encodeURIComponent(message)}`);
  }

  await logAdminAction(admin, actingUserId, {
    action: "user.producer_access",
    targetType: "user",
    targetId: userId,
    subjectUserId: userId,
    before: enabled ? "off" : "granted",
    after: enabled ? "granted" : "off",
  });

  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/users");
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
// Model health lives on Admin → Models (2026-10-02); back to the product it was changed from.
function modelsPage(formData: FormData): string {
  const p = formData.get("product");
  const fallback = formData.get("kind") === "image" ? "picture" : "video";
  return `/admin/models?p=${typeof p === "string" && /^[a-z]{1,20}$/.test(p) ? p : fallback}`;
}

export async function restoreModel(formData: FormData): Promise<void> {
  const { userId: actingUserId } = await requireAdmin();
  const modelId = (formData.get("model_id") as string) ?? "";
  if (!modelId) redirect(`${modelsPage(formData)}&error=Missing+model`);

  // Validate against the actual catalogues instead of trusting the form
  // value: model_health rows are keyed by model_id, and an arbitrary string
  // here would upsert/update junk rows in the health table (and the same
  // string round-trips into admin UI). The forms only ever post catalogue
  // ids, so anything else is a hand-crafted request.
  const known =
    VIDEO_MODELS.some((m) => m.id === modelId) || IMAGE_MODELS.some((m) => m.id === modelId);
  if (!known) redirect(`${modelsPage(formData)}&error=Unknown+model`);

  const admin = createAdminClient();
  const { error } = await admin
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
  if (error) {
    console.error("restoreModel: model_health update failed — nothing changed", error);
    redirect(`${modelsPage(formData)}&error=${encodeURIComponent(error.message)}`);
  }

  await logAdminAction(admin, actingUserId, {
    action: "model.restore",
    targetType: "model",
    targetId: modelId,
    before: "suspended",
    after: "running",
  });

  revalidatePath("/admin/models");
  redirect(modelsPage(formData));
}

export async function suspendModel(formData: FormData): Promise<void> {
  const { userId: actingUserId } = await requireAdmin();
  const modelId = (formData.get("model_id") as string) ?? "";
  const rawKind = (formData.get("kind") as string) || "video";
  if (!modelId) redirect(`${modelsPage(formData)}&error=Missing+model`);

  // kind comes from a closed set and model_id must exist in the catalogue
  // FOR that kind — the old blind `as "video" | "image"` cast let a crafted
  // request upsert a health row with any string in either column, and
  // suspendModel writes rows (unlike restore, which only updates existing
  // ones), so junk here would live in model_health indefinitely.
  if (rawKind !== "video" && rawKind !== "image") {
    redirect(`${modelsPage(formData)}&error=Unknown+model`);
  }
  const kind = rawKind as "video" | "image";
  const catalogue = kind === "video" ? VIDEO_MODELS : IMAGE_MODELS;
  if (!catalogue.some((m) => m.id === modelId)) {
    redirect(`${modelsPage(formData)}&error=Unknown+model`);
  }

  const admin = createAdminClient();
  const { error } = await admin.from("model_health").upsert({
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
  if (error) {
    console.error("suspendModel: model_health upsert failed — nothing changed", error);
    redirect(`${modelsPage(formData)}&error=${encodeURIComponent(error.message)}`);
  }

  await logAdminAction(admin, actingUserId, {
    action: "model.suspend",
    targetType: "model",
    targetId: modelId,
    before: "running",
    after: "suspended",
  });

  revalidatePath("/admin/models");
  redirect(modelsPage(formData));
}

// Community moderation (operator: "I need a moderation area for it") — the
// hide/unhide toggle from /admin/moderation. Rides the "Admins moderate
// posts" RLS policy with the admin's own session, same as the in-feed
// control; hiding is the moderation verb on purpose (reversible, keeps the
// sharer's row intact) — deletion stays the owner's own act.
// Clear on Moderation's failed renders (2026-09-27, operator: "Clear whatever
// is resolved"). A failed render has no open/resolved state of its own, so
// Clear stamps the moment it was pressed: the badge and the list then count
// only failures after it, and "Show cleared" brings the rest back. Upsert
// through the service client, for the reason setSeedanceProvider gives.
export async function clearModerationFailures() {
  const { admin, userId: actingUserId } = await requireAdmin();
  const now = new Date().toISOString();
  const { error } = await admin.from("app_settings").upsert(
    {
      key: MODERATION_CLEARED_KEY,
      value: now,
      description: "When an admin last cleared Moderation's failed renders. Its badge and list count only failures after this.",
      updated_at: now,
    },
    { onConflict: "key" },
  );

  if (error) {
    console.error("clearModerationFailures: upsert failed", error);
    redirect(`/admin/moderation?error=${encodeURIComponent(error.message)}`);
  }

  await logAdminAction(admin, actingUserId, { action: "moderation.clear", targetType: "setting", targetId: MODERATION_CLEARED_KEY });

  revalidatePath("/admin", "layout");
}

export async function setCommunityPostModeration(formData: FormData) {
  const { supabase, admin, userId: actingUserId } = await requireAdmin();
  const postId = formData.get("post_id") as string;
  const hide = formData.get("hide") === "1";

  const { error } = await supabase
    .from("community_posts")
    .update({ hidden_at: hide ? new Date().toISOString() : null })
    .eq("id", postId);

  if (error) {
    console.error("setCommunityPostModeration: hidden_at update failed", error);
    redirect(`/admin/moderation?error=${encodeURIComponent(error.message)}`);
  }

  await logAdminAction(admin, actingUserId, {
    action: hide ? "post.hide" : "post.show",
    targetType: "post",
    targetId: postId,
    before: hide ? "shown" : "hidden",
    after: hide ? "hidden" : "shown",
  });

  revalidatePath("/admin/moderation");
  revalidatePath("/app/community");
}

// Give or take bonus credits, with a reason (2026-09-28 admin redesign,
// "Give or take credits" on the person's page). Adds to the balance instead
// of replacing it, through the same atomic RPCs renders and refunds use
// (add_bonus_credits / spend_bonus_credits), so a render spending at the
// same moment can't be overwritten. The reason is required: it is what the
// activity log shows next to the change.
export async function adjustBonusCredits(formData: FormData) {
  const { admin, userId: actingUserId } = await requireAdmin();
  const userId = formData.get("user_id") as string;
  const redirectTo = `/admin/users/${userId}`;
  const result = await opAdjustCredits(admin, actingUserId, {
    userId,
    direction: formData.get("direction") === "take" ? "take" : "give",
    amount: Number.parseInt((formData.get("amount") as string) ?? "", 10),
    reason: (formData.get("reason") as string) ?? "",
  });
  if (!result.ok) redirect(`${redirectTo}?error=${encodeURIComponent(result.error)}`);
  revalidatePath(redirectTo);
}

// Refund one render by hand (2026-09-28 admin redesign): everything it took
// comes back as bonus credits, once. The whole move is one transaction in
// admin_refund_render (supabase/applied/2026-09-29/admin-activity.sql), which also
// writes the log line; its unique index is what makes a second press, or a
// second admin, fail instead of paying twice.
export async function refundRender(formData: FormData) {
  const { admin, userId: actingUserId } = await requireAdmin();
  const userId = formData.get("user_id") as string;
  const redirectTo = adminReturnPath(formData, `/admin/users/${userId}`);
  const result = await opRefundRender(admin, actingUserId, {
    generationId: formData.get("generation_id") as string,
    reason: (formData.get("reason") as string) ?? "",
  });
  if (!result.ok) redirect(`${redirectTo}?error=${encodeURIComponent(result.error)}`);

  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin");
  revalidatePath("/admin/renders");
}

// Where a form pressed on Today or the render queue returns to: only ever a
// page inside the admin area, never a path taken on trust from the form.
function adminReturnPath(formData: FormData, fallback: string): string {
  const raw = (formData.get("redirect_to") as string | null) ?? "";
  return raw === "/admin" || raw.startsWith("/admin/") ? raw.split("?")[0] : fallback;
}

// Render queue (2026-09-28 admin redesign, part 3). "Check now" drives the
// render one step through the SAME state machine the poller, the webhook and
// the reaper use (advanceGeneration): a render whose webhook was dropped is
// collected, a finished stage moves on, a dead job fails with the refund
// rules. It never cancels a render that is still working.
export async function checkRender(formData: FormData) {
  const { admin, userId: actingUserId } = await requireAdmin();
  const redirectTo = adminReturnPath(formData, "/admin/renders");
  const result = await opCheckRender(admin, actingUserId, { generationId: formData.get("generation_id") as string });
  if (!result.ok) redirect(`${redirectTo}?error=${encodeURIComponent(result.error)}`);

  revalidatePath("/admin");
  revalidatePath("/admin/renders");
}

// Stop a render for someone, as their own Stop button would: the cooperative
// cancel flag, then one step of advanceGeneration so the provider is told
// now rather than on the next poll. With refund=1 whatever the render still
// holds afterwards comes back as bonus credits (admin_refund_render, once);
// a stop that already gave the credits back by the refund rules leaves
// nothing to refund, and that is said, not treated as an error.
export async function stopRender(formData: FormData) {
  const { admin, userId: actingUserId } = await requireAdmin();
  const redirectTo = adminReturnPath(formData, "/admin/renders");
  const result = await opStopRender(admin, actingUserId, {
    generationId: formData.get("generation_id") as string,
    refund: formData.get("refund") === "1",
  });
  if (!result.ok) redirect(`${redirectTo}?error=${encodeURIComponent(result.error)}`);

  revalidatePath("/admin");
  revalidatePath("/admin/renders");
  revalidatePath("/admin/users", "layout");
}

// Private admin notes on a person (2026-09-28 admin redesign). Only admins
// read them (service role; the table has no policies), and they go with the
// account when it is deleted.
export async function addUserNote(formData: FormData) {
  const { admin, userId: actingUserId } = await requireAdmin();
  const userId = formData.get("user_id") as string;
  const redirectTo = `/admin/users/${userId}`;
  const result = await opAddNote(admin, actingUserId, { userId, body: (formData.get("body") as string) ?? "" });
  if (!result.ok) redirect(`${redirectTo}?error=${encodeURIComponent(result.error)}`);
  revalidatePath(redirectTo);
}
