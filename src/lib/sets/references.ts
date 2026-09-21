// Reference photos of a set (2026-09-21, "we need to add an option to upload
// reference images, this is what we missed"). Since R1 a photo goes on a
// thing — a car, an object — and names it in its file name
// (set-config.ts setElementPhotoPath); the thing's photos become one sheet
// (look-sheet.ts sheetFromPhotos) that rides every still that sees it
// (elements.ts). A photo from before R1 (the Look menu's, named by id alone)
// reads as a photo on nothing until it is put on one.
//
// Stored like the set's other files: no table, no column — the folder is the
// list, read here. Server-only.

import type { SupabaseClient } from "@supabase/supabase-js";
import { listSetFiles } from "./look-cutout-store";
import { ELEMENT_PHOTO_NAME, setElementSheetPrefix, setRefPrefix } from "./set-config";
import { mediaUrl } from "../media/url";
import type { ElementPhoto } from "./elements";

/** access.ts's own pattern, kept here so this module never loads a database client. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A photo on a thing as stored: what the page gets, and its storage path, which only the server uses. */
export type StoredElementPhoto = ElementPhoto & { path: string };

/**
 * Every photo on a set's things (R1, 2026-09-21, elements.ts), in both
 * name forms: a thing's photo names its key, slot and time; a photo from
 * before R1 is its bare id and reads as a photo on nothing, timed by
 * storage. With the hashes of the sheets already drawn.
 */
export async function listElementPhotos(admin: SupabaseClient, userId: string, setId: string): Promise<{ photos: StoredElementPhoto[]; sheets: string[] }> {
  const prefix = setRefPrefix(setId);
  const sheetPrefix = setElementSheetPrefix(setId);
  let files: Awaited<ReturnType<typeof listSetFiles>>;
  let sheetFiles: Awaited<ReturnType<typeof listSetFiles>>;
  try {
    [files, sheetFiles] = await Promise.all([listSetFiles(admin, userId, prefix), listSetFiles(admin, userId, sheetPrefix)]);
  } catch {
    return { photos: [], sheets: [] };
  }
  const photos: StoredElementPhoto[] = [];
  for (const f of files) {
    if (!f.name.startsWith(prefix)) continue;
    const rest = f.name.slice(prefix.length).replace(/\.jpg$/, "");
    const url = mediaUrl("generated-images", f.path);
    const m = ELEMENT_PHOTO_NAME.exec(rest);
    if (m) {
      photos.push({ refId: m[4], anchor: m[1], slot: Number(m[2]) as 1 | 2 | 3 | 4, at: parseInt(m[3], 36) * 1000, url, path: f.path });
    } else if (UUID_RE.test(rest)) {
      const t = Date.parse(f.createdAt);
      photos.push({ refId: rest, anchor: null, slot: null, at: Number.isFinite(t) ? t : 0, url, path: f.path });
    }
  }
  // Oldest first; within one second, a thing's front before its other sides.
  photos.sort((a, b) => a.at - b.at || (a.slot ?? 9) - (b.slot ?? 9) || a.refId.localeCompare(b.refId));
  const sheets = sheetFiles.filter((f) => f.name.startsWith(sheetPrefix)).map((f) => f.name.slice(sheetPrefix.length).replace(/\.jpg$/, ""));
  return { photos, sheets };
}

/** One photo as the page gets it: its storage path stays on the server. */
export function withoutPath(p: StoredElementPhoto): ElementPhoto {
  return { refId: p.refId, anchor: p.anchor, slot: p.slot, at: p.at, url: p.url };
}

/** The same listing with the paths taken off, for the page. */
export function forPage(listing: { photos: StoredElementPhoto[]; sheets: string[] }): { photos: ElementPhoto[]; sheets: string[] } {
  return { photos: listing.photos.map(withoutPath), sheets: listing.sheets };
}
