"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { PLAN_LIMITS } from "@/lib/plans";
import { computeAdminBadgeCounts, type AdminBadgeCounts } from "@/lib/admin/badges";
import { requireAdmin } from "@/lib/admin/require-admin";

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
  const { supabase, userId: actingUserId } = await requireAdmin();
  const userId = formData.get("user_id") as string;
  const status = formData.get("status") as string;
  const redirectTo = (formData.get("redirect_to") as string) || "/admin/users";

  if (status !== "active" && status !== "suspended") {
    redirect(`${redirectTo}?error=${encodeURIComponent("Invalid status.")}`);
  }

  // An admin suspending their own account would lock them out with no one
  // else able to undo it if they're the only admin — block it outright
  // rather than trust everyone to remember not to.
  if (userId === actingUserId && status === "suspended") {
    redirect(`${redirectTo}?error=${encodeURIComponent("You can't suspend your own account.")}`);
  }

  const { error } = await supabase.from("profiles").update({ status }).eq("id", userId);
  if (error) {
    redirect(`${redirectTo}?error=${encodeURIComponent(error.message)}`);
  }

  // Also ban/unban at the auth layer, not just flip the profile flag. The
  // profiles.status check (middleware + generation gate) blocks access on
  // every request using an existing session, but a suspended user could
  // otherwise still sign in again to get a fresh session. Banning makes
  // Supabase reject their login and token refresh outright, so suspension
  // actually keeps them out. ban_duration "none" lifts it on reinstate.
  const admin = createAdminClient();
  const { error: banError } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: status === "suspended" ? "876000h" : "none",
  });
  if (banError) {
    redirect(`${redirectTo}?error=${encodeURIComponent(banError.message)}`);
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

  // Purge the user's Storage files before deleting the account. Every file a
  // user uploads or generates lives under a `${userId}/...` path in these
  // buckets. The DB rows cascade automatically when the auth user is deleted,
  // but Storage objects don't — without this they'd sit orphaned and billed
  // with no record left to find them by. Mirrors the account self-deletion
  // flow in profile/actions.ts. Best-effort: a storage hiccup must not block
  // the actual account deletion below.
  for (const bucket of ["character-references", "generated-images", "chat-attachments"]) {
    try {
      const { data: files } = await admin.storage.from(bucket).list(userId, { limit: 1000 });
      if (files && files.length > 0) {
        await admin.storage
          .from(bucket)
          .remove(files.map((f: { name: string }) => `${userId}/${f.name}`));
      }
    } catch {
      // swallow — proceed to delete the account regardless
    }
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    redirect(`/admin/users/${userId}?error=${encodeURIComponent(error.message)}`);
  }

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

export async function updateAppSetting(formData: FormData) {
  const { supabase } = await requireAdmin();
  const key = formData.get("key") as string;
  const value = (formData.get("value") as string)?.trim();

  if (!value) {
    redirect(`/admin/settings?error=${encodeURIComponent("Value can't be empty.")}`);
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
  const { supabase, userId: actingUserId } = await requireAdmin();
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

  const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
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

export async function setUserPlan(formData: FormData) {
  const { supabase } = await requireAdmin();
  const userId = formData.get("user_id") as string;
  const plan = formData.get("plan") as string;
  const redirectTo = `/admin/users/${userId}`;

  if (!Object.keys(PLAN_LIMITS).includes(plan)) {
    redirect(`${redirectTo}?error=${encodeURIComponent("Invalid plan.")}`);
  }

  const { error } = await supabase.from("profiles").update({ plan }).eq("id", userId);
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
  const { supabase } = await requireAdmin();
  const userId = formData.get("user_id") as string;
  const redirectTo = `/admin/users/${userId}`;
  const raw = formData.get("bonus_credits") as string;
  const bonusCredits = Number.parseInt(raw, 10);

  if (!Number.isFinite(bonusCredits) || bonusCredits < 0) {
    redirect(`${redirectTo}?error=${encodeURIComponent("Bonus credits must be 0 or more.")}`);
  }

  const { error } = await supabase
    .from("profiles")
    .update({ bonus_credits: bonusCredits })
    .eq("id", userId);
  if (error) {
    redirect(`${redirectTo}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/admin/users/${userId}`);
}

// Grants API access to an account that isn't on Elite.
//
// Elite includes the API by plan, so this is only ever the exception: a pilot
// customer, a partner, someone mid-migration. Kept as a separate flag rather
// than a plan bump so it can be given and taken back without touching what
// they pay or what else they can do.
export async function setApiAccess(formData: FormData) {
  const { supabase } = await requireAdmin();
  const userId = formData.get("user_id") as string;
  const enabled = formData.get("api_access") === "true";

  const { error } = await supabase
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
  const kind = ((formData.get("kind") as string) || "video") as "video" | "image";
  if (!modelId) redirect("/admin/providers?error=Missing+model");

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
