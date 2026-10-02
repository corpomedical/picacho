// Reading and writing the model_controls row for a change an admin makes —
// shared by the Models page's buttons (admin/models-actions.ts) and the phone
// admin app's (admin/ops.ts opSetOffered, through /api/admin/act), so both
// save the same way and check the same locks.
//
// Reads go straight to the database (never the 15 s cache in controls.ts): a
// change is decided on what is stored now. The write is an upsert through the
// service client: app_settings has an admin UPDATE policy but no INSERT
// policy, and this row has no migration behind it.

import type { SupabaseClient } from "@supabase/supabase-js";
import { forgetModelControls } from "./controls";
import { MODEL_CONTROLS_KEY, parseModelControls, type ModelControls } from "./registry";

export async function readStoredControls(admin: SupabaseClient): Promise<ModelControls> {
  const { data, error } = await admin.from("app_settings").select("value").eq("key", MODEL_CONTROLS_KEY).maybeSingle<{ value: string | null }>();
  if (error) throw new Error(error.message);
  return parseModelControls(data?.value);
}

/** Saves the choices; returns the database's error message, or null. */
export async function saveStoredControls(admin: SupabaseClient, controls: ModelControls): Promise<string | null> {
  const { error } = await admin.from("app_settings").upsert(
    {
      key: MODEL_CONTROLS_KEY,
      value: JSON.stringify(controls),
      description: "Admin → Models: behind-the-scenes model picks and models taken off customer menus.",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
  forgetModelControls();
  return error ? error.message : null;
}

/** The video and picture defaults customers get when they pick nothing. */
export async function readModelDefaults(admin: SupabaseClient): Promise<{ video: string; picture: string }> {
  const { data } = await admin.from("app_settings").select("key, value").in("key", ["video_model", "image_model"]);
  const get = (k: string) => (data ?? []).find((r) => r.key === k)?.value as string | undefined;
  return { video: get("video_model") ?? "kling", picture: get("image_model") ?? "gpt-image" };
}
