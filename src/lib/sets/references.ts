// Reference photos of a set (2026-09-21, "we need to add an option to upload
// reference images, this is what we missed"). The person uploads a photo of
// something the set should hold — the exact car, a sofa, a storefront — and
// it can be the next shot's LOOK: an object sheet is drawn from it
// (look-sheet.ts sheetFromPhoto: the thing four ways round on grey, no
// people) and rides the shot in the look's own slot, under the look's own
// tested sentence. A block car keeps its place, size and facing from the
// set; its design comes from the photo, from every side.
//
// Stored like the set's other files (set-config.ts setRefPhotoPath): no
// table, no column — the folder is the list, read here. Server-only.

import type { SupabaseClient } from "@supabase/supabase-js";
import { listSetFiles } from "./look-cutout-store";
import { SET_REFS_MAX, setRefPrefix } from "./set-config";
import { mediaUrl } from "../media/url";

export type SetReference = { id: string; url: string };

/** access.ts's own pattern, kept here so this module never loads a database client. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A set's reference photos, oldest first, at most SET_REFS_MAX — what the page lists and the look menu offers. */
export async function listSetReferences(admin: SupabaseClient, userId: string, setId: string): Promise<SetReference[]> {
  const prefix = setRefPrefix(setId);
  let files: Awaited<ReturnType<typeof listSetFiles>>;
  try {
    files = await listSetFiles(admin, userId, prefix);
  } catch {
    return [];
  }
  return files
    .map((f) => ({ id: f.name.slice(prefix.length).replace(/\.jpg$/, ""), path: f.path, createdAt: f.createdAt }))
    .filter((r) => UUID_RE.test(r.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .slice(0, SET_REFS_MAX)
    .map((r) => ({ id: r.id, url: mediaUrl("generated-images", r.path) }));
}
