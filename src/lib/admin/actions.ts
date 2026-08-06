"use server";

import { revalidatePath } from "next/cache";
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
// client-side result handling, so they return void (errors are logged for
// now — shows up in the Terminal running `npm run dev`). If Wigly wants
// errors surfaced in the UI later, these forms would need to become Client
// Components using useActionState.

export async function setUserStatus(formData: FormData) {
  const { supabase } = await requireAdmin();
  const userId = formData.get("user_id") as string;
  const status = formData.get("status") as string;

  if (status !== "active" && status !== "suspended") {
    console.error("setUserStatus: invalid status", status);
    return;
  }

  const { error } = await supabase.from("profiles").update({ status }).eq("id", userId);
  if (error) {
    console.error("setUserStatus failed:", error.message);
    return;
  }

  revalidatePath("/admin/users");
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
    console.error("toggleFeatureFlag failed:", error.message);
    return;
  }

  revalidatePath("/admin/flags");
}

export async function updateAppSetting(formData: FormData) {
  const { supabase } = await requireAdmin();
  const key = formData.get("key") as string;
  const value = (formData.get("value") as string)?.trim();

  if (!value) {
    console.error("updateAppSetting: value can't be empty");
    return;
  }

  const { error } = await supabase
    .from("app_settings")
    .update({ value, updated_at: new Date().toISOString() })
    .eq("key", key);

  if (error) {
    console.error("updateAppSetting failed:", error.message);
    return;
  }

  revalidatePath("/admin/settings");
}

export async function setUserRole(formData: FormData) {
  const { supabase } = await requireAdmin();
  const userId = formData.get("user_id") as string;
  const role = formData.get("role") as string;

  if (role !== "user" && role !== "admin") {
    console.error("setUserRole: invalid role", role);
    return;
  }

  const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
  if (error) {
    console.error("setUserRole failed:", error.message);
    return;
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
    console.error("setVideoModel failed:", error.message);
    return;
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
    console.error("setImageModel failed:", error.message);
    return;
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
    console.error("addVoicePreset: label and elevenlabs_voice_id are required");
    return;
  }

  const { error } = await supabase.from("voice_presets").insert({
    label,
    description,
    elevenlabs_voice_id: elevenlabsVoiceId,
  });

  if (error) {
    console.error("addVoicePreset failed:", error.message);
    return;
  }

  revalidatePath("/admin/voices");
}

export async function deleteVoicePreset(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = formData.get("id") as string;

  const { error } = await supabase.from("voice_presets").delete().eq("id", id);
  if (error) {
    console.error("deleteVoicePreset failed:", error.message);
    return;
  }

  revalidatePath("/admin/voices");
  revalidatePath("/app/character");
}

export async function setUserPlan(formData: FormData) {
  const { supabase } = await requireAdmin();
  const userId = formData.get("user_id") as string;
  const plan = formData.get("plan") as string;

  if (!Object.keys(PLAN_LIMITS).includes(plan)) {
    console.error("setUserPlan: invalid plan", plan);
    return;
  }

  const { error } = await supabase.from("profiles").update({ plan }).eq("id", userId);
  if (error) {
    console.error("setUserPlan failed:", error.message);
    return;
  }

  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/users");
}
