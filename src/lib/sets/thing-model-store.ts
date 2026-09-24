// The models kept with a set (thing-model.ts, 2026-09-24): files in the
// owner's own sets folder of THING_MODEL_BUCKET, named by the thing's key —
// no table, no column; the folder is the list, as the things' photos are
// (references.ts). Server-only: it lists with the service client, inside the
// person's own folder only.

import type { SupabaseClient } from "@supabase/supabase-js";
import { mediaUrl } from "../media/url";
import { THING_MODEL_BUCKET, parseModelName, setModelPrefix } from "./thing-model";

/** A kept model as the page gets it: whose it is, where it loads from, whether it is turned round. */
export type KeptThingModel = { key: string; url: string; flip: boolean };

/** Every model file of a set, newest first, with its storage path (which stays on the server). */
export async function listModelFiles(
  admin: SupabaseClient,
  userId: string,
  setId: string,
): Promise<{ path: string; key: string; at: number; flip: boolean }[]> {
  const folder = `${userId}/sets`;
  const prefix = setModelPrefix(setId);
  const out: { path: string; key: string; at: number; flip: boolean }[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.storage.from(THING_MODEL_BUCKET).list(folder, { limit: 1000, offset, search: prefix });
    if (error || !data) break;
    for (const entry of data as { name: string }[]) {
      const parsed = typeof entry.name === "string" ? parseModelName(setId, entry.name) : null;
      if (parsed) out.push({ path: `${folder}/${entry.name}`, ...parsed });
    }
    if (data.length < 1000) break;
  }
  return out.sort((a, b) => b.at - a.at);
}

/** The model each thing has now: the newest file of each key. Never throws — a set with none, or unreadable, has none. */
export async function listThingModels(admin: SupabaseClient, userId: string, setId: string): Promise<KeptThingModel[]> {
  let files: Awaited<ReturnType<typeof listModelFiles>>;
  try {
    files = await listModelFiles(admin, userId, setId);
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const out: KeptThingModel[] = [];
  for (const f of files) {
    if (seen.has(f.key)) continue;
    seen.add(f.key);
    out.push({ key: f.key, url: mediaUrl(THING_MODEL_BUCKET, f.path), flip: f.flip });
  }
  return out;
}

/** Best-effort, never throws: every model a set kept, gone with the set. */
export async function removeSetThingModels(admin: SupabaseClient, userId: string, setId: string): Promise<void> {
  try {
    const paths = (await listModelFiles(admin, userId, setId)).map((f) => f.path);
    if (paths.length) await admin.storage.from(THING_MODEL_BUCKET).remove(paths);
  } catch {
    // Nothing to do: the set is gone either way.
  }
}
