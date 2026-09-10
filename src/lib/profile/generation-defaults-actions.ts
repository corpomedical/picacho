"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { validateGenerationDefaults } from "@/lib/generations/generation-defaults";
import { buildVideoModelOptions, readExperimentalModelsFlag } from "@/lib/generations/workspace-data";

// Settings → Generation's save (2026-09-11). Validated against exactly the
// model list the composer offers this account, so a default can never name
// a model the composer would not show. Written through the service role —
// the 2026-08-18 profiles lockdown narrowed the UPDATE grant, as for every
// other profile preference.
export async function setGenerationDefaults(input: {
  videoModel: string;
  aspectRatio: string;
  durationSeconds: string;
  sound: boolean;
}): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  const offered = buildVideoModelOptions(await readExperimentalModelsFlag(supabase));
  const { data: globalDefault } = await supabase.from("app_settings").select("value").eq("key", "video_model").maybeSingle();
  const result = validateGenerationDefaults(input ?? {}, offered, (globalDefault?.value as string | undefined) ?? "kling");
  if (!result.ok) return { error: "Invalid setting." };

  const { error } = await createAdminClient()
    .from("profiles")
    .update({
      default_video_model: result.value.videoModel,
      default_aspect_ratio: result.value.aspectRatio,
      default_video_duration: result.value.durationSeconds,
      video_sound: result.value.sound,
    })
    .eq("id", userData.user.id);
  if (error) {
    console.error("setGenerationDefaults failed:", error.message);
    return { error: "Couldn't save that — try again." };
  }
  revalidatePath("/app/settings");
  revalidatePath("/app/generate");
  return { error: null };
}
