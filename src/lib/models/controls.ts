// The operator's model choices, read on the server (see registry.ts).
//
// One app_settings row (model_controls, JSON), written by the Models page
// through the service client the way the Seedance lane is (no INSERT policy
// on app_settings, so the first save creates the row that way).
//
// Read on hot paths (the content policy reads it on every render), so each
// server instance keeps the last reading for 15 seconds. A failed read keeps
// the last good reading, or none: a database blip runs today's defaults and
// offers every menu item, never fails a render. A switch made on the Models
// page reaches every instance within those 15 seconds.

import { createAdminClient } from "@/lib/supabase/server";
import {
  EMPTY_CONTROLS,
  MODEL_CONTROLS_KEY,
  isOffered,
  parseModelControls,
  pickedJobModel,
  type JobKey,
  type MenuKey,
  type ModelControls,
} from "./registry";

const TTL_MS = 15_000;
let cached: { at: number; value: ModelControls } | null = null;

export async function getModelControls(): Promise<ModelControls> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.value;
  try {
    const { data, error } = await createAdminClient()
      .from("app_settings")
      .select("value")
      .eq("key", MODEL_CONTROLS_KEY)
      .maybeSingle<{ value: string | null }>();
    if (error) throw error;
    const value = parseModelControls(data?.value);
    cached = { at: now, value };
    return value;
  } catch {
    // Keep serving the last good reading; try again on the next call after a short pause.
    const value = cached?.value ?? EMPTY_CONTROLS;
    cached = { at: now - TTL_MS + 2_000, value };
    return value;
  }
}

/** After a save on this instance: the next read goes to the database. */
export function forgetModelControls(): void {
  cached = null;
}

/** The model the operator picked for a job, or null (the caller's env/default answers). */
export async function jobModel(key: JobKey): Promise<string | null> {
  return pickedJobModel(await getModelControls(), key);
}

export async function offered(menu: MenuKey, id: string): Promise<boolean> {
  return isOffered(await getModelControls(), menu, id);
}
