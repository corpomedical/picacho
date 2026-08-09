"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PLAN_LIMITS } from "@/lib/plans";

async function requireAdmin() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in.");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .single();

  if (profile?.role !== "admin") throw new Error("Admin access required.");
  return { supabase, userId: data.user.id };
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

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
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
