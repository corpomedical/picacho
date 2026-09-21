"use server";

// Photos on the set's things (R1, 2026-09-21, "Build the references part
// now"): a car, a sofa, a lamp can each carry up to four reference photos —
// a front first, then more sides — and every still keeps that thing's
// design (elements.ts). Uploaded here, checked the way every reference photo
// is (reference-upload.ts: re-encoded, the picture gate, an hourly limit),
// and stored under the key of the thing they were put on (set-config.ts
// setElementPhotoPath) — no table. A person never gets a photo here: they
// come from their character's own photos.
//
// The set the page draws may be a moment ahead of the one saved (the Build
// editor's working copy autosaves): a key sent here is therefore RESOLVED
// against the saved set, as a photo's key is after an edit, and the photo is
// stored under the thing it finds — never refused for a key that merely
// moved. A photo's sheet is drawn at Shoot, never here: an upload costs no
// render.

import { createAdminClient } from "@/lib/supabase/server";
import { rateLimited } from "@/lib/rate-limit";
import { checkGenerationAllowance } from "@/lib/generations/core";
import { quoteSend } from "@/lib/generations/quote";
import { stillQuoteInput } from "@/lib/sets/take";
import { sheetFromPhotos } from "@/lib/sets/look-sheet";
import { setsAccess, UUID_RE } from "@/lib/sets/access";
import { normaliseSetSpec, type SetSpec } from "@/lib/sets/set-spec";
import { ELEMENT_KEY_RE, ELEMENT_PHOTOS_MAX, FIGURE_KEY, resolvePhotos, setElements, sheetHashOf, type ElementPhoto } from "@/lib/sets/elements";
import { forPage, listElementPhotos, withoutPath, type StoredElementPhoto } from "@/lib/sets/references";
import { checkReferencePhoto, parseReferencePhoto } from "@/lib/sets/reference-upload";
import { ELEMENT_SET_PHOTOS_MAX, setElementPhotoPath, setElementSheetPath, setRefSheetPath } from "@/lib/sets/set-config";
import {
  SET_ELEMENT_FULL,
  SET_ELEMENT_GONE,
  SET_ELEMENT_NOT_A_THING,
  SET_ELEMENTS_TOO_MANY,
  SET_NOT_FOUND,
  SET_NOT_READY,
  SET_PHOTO_SAVE_FAILED,
} from "@/lib/sets/messages";

const BUCKET = "generated-images";

export type ElementListing = { photos: ElementPhoto[]; sheets: string[] };

/**
 * The set is the person's own, not deleted and ready: the spec the page
 * draws — the WORKING copy when one is saved (the Build editor), read on its
 * own, defensively, as words-actions.ts reads it.
 */
async function readyOwnedSpec(setId: string, userId: string): Promise<{ error: string } | { error: null; spec: SetSpec }> {
  if (typeof setId !== "string" || !UUID_RE.test(setId)) return { error: SET_NOT_FOUND };
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("location_sets")
    .select("status, spec")
    .eq("id", setId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!row) return { error: SET_NOT_FOUND };
  if (row.status !== "ready") return { error: SET_NOT_READY };
  const n = normaliseSetSpec(row.spec);
  if (!n.ok) return { error: SET_NOT_FOUND };
  const { data: editedRow, error: editedError } = await admin
    .from("location_sets")
    .select("edited_spec")
    .eq("id", setId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (editedError) console.warn("[sets] element photos could not read the working copy:", editedError.message);
  else if (editedRow?.edited_spec) {
    const edited = normaliseSetSpec(editedRow.edited_spec);
    if (edited.ok) return { error: null, spec: edited.spec };
  }
  return { error: null, spec: n.spec };
}

/** The thing a key names on the saved set now: the same key, or where the same thing moved or changed to. */
function thingFor(spec: SetSpec, key: string): string | null {
  const probe: ElementPhoto = { refId: "00000000-0000-4000-8000-000000000000", anchor: key, slot: 1, at: 0, url: "" };
  return resolvePhotos(setElements(spec), [probe]).held[0]?.key ?? null;
}

const seconds = (ms: number) => Math.floor(ms / 1000);

/** Upload one photo onto a thing: it comes back with the set's photos as they now stand. */
export async function addElementPhoto(
  setId: string,
  input: { photoDataUri: string; element: string },
): Promise<{ error: string } | { error: null; photo: ElementPhoto; listing: ElementListing }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const { userId } = access;
  const owned = await readyOwnedSpec(setId, userId);
  if (owned.error !== null) return { error: owned.error };
  const key = input?.element;
  if (key === FIGURE_KEY) return { error: SET_ELEMENT_NOT_A_THING };
  if (typeof key !== "string" || !ELEMENT_KEY_RE.test(key)) return { error: SET_ELEMENT_GONE };
  const target = thingFor(owned.spec, key);
  if (!target) return { error: SET_ELEMENT_GONE };

  const parsed = parseReferencePhoto(input?.photoDataUri);
  if (!parsed.ok) return { error: parsed.error };

  const admin = createAdminClient();
  const before = await listElementPhotos(admin, userId, setId);
  const held = resolvePhotos(setElements(owned.spec), before.photos).held.find((h) => h.key === target) ?? null;
  const onIt = held ? [...held.photos, ...held.extra] : [];
  if (onIt.length >= ELEMENT_PHOTOS_MAX) return { error: SET_ELEMENT_FULL };
  if (before.photos.length >= ELEMENT_SET_PHOTOS_MAX) return { error: SET_ELEMENTS_TOO_MANY };

  // The hourly limit, the re-encode and the picture gate (reference-upload.ts).
  const photo = await checkReferencePhoto(userId, parsed.bytes);
  if (photo.error !== null) return { error: photo.error };

  const refId = crypto.randomUUID();
  const at = Date.now();
  const taken = new Set(onIt.map((p) => p.slot));
  // The lowest free slot; a slot another upload just took moves this one to the next.
  for (const slot of [1, 2, 3, 4] as const) {
    if (taken.has(slot)) continue;
    const path = setElementPhotoPath(userId, setId, target, slot, seconds(at), refId);
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, photo.jpeg, { contentType: "image/jpeg", upsert: false });
    if (uploadError) {
      console.warn(`[sets] element photo slot ${slot} not stored:`, uploadError.message);
      continue;
    }
    // The thing's old sheet no longer matches its photos (elements.ts sheetHashOf).
    if (held && held.photos.length > 0) await admin.storage.from(BUCKET).remove([setElementSheetPath(userId, setId, held.sheetHash)]);
    const listing = await listElementPhotos(admin, userId, setId);
    const stored = listing.photos.find((p) => p.refId === refId);
    if (!stored) return { error: SET_PHOTO_SAVE_FAILED };
    return { error: null, photo: withoutPath(stored), listing: forPage(listing) };
  }
  return { error: SET_PHOTO_SAVE_FAILED };
}

/** Remove a photo from its thing (or a photo on nothing), and the thing's sheet drawn with it. */
export async function removeElementPhoto(setId: string, refId: string): Promise<{ error: string } | { error: null; listing: ElementListing }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const { userId } = access;
  if (typeof refId !== "string" || !UUID_RE.test(refId)) return { error: SET_NOT_FOUND };
  const owned = await readyOwnedSpec(setId, userId);
  if (owned.error !== null) return { error: owned.error };
  const admin = createAdminClient();
  const before = await listElementPhotos(admin, userId, setId);
  const photo = before.photos.find((p) => p.refId === refId);
  if (!photo) return { error: null, listing: forPage(before) };
  const held = resolvePhotos(setElements(owned.spec), before.photos).held.find((h) => [...h.photos, ...h.extra].some((p) => p.refId === refId));
  const paths = [photo.path];
  // A photo from before R1 kept its own sheet beside it.
  if (photo.anchor === null) paths.push(setRefSheetPath(userId, setId, refId));
  if (held && held.photos.some((p) => p.refId === refId)) paths.push(setElementSheetPath(userId, setId, held.sheetHash));
  const { error } = await admin.storage.from(BUCKET).remove(paths);
  if (error) {
    console.warn("[sets] element photo removal failed:", error.message);
    return { error: SET_PHOTO_SAVE_FAILED };
  }
  return { error: null, listing: forPage(await listElementPhotos(admin, userId, setId)) };
}

/**
 * Put a photo on nothing — one from before R1, or one whose thing left or
 * changed past recognition — onto a thing. A photo from before R1 brings the
 * sheet already drawn from it when it is that thing's only photo: nobody
 * pays for the same sheet twice.
 */
export async function assignElementPhoto(setId: string, refId: string, element: string): Promise<{ error: string } | { error: null; listing: ElementListing }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const { userId } = access;
  if (typeof refId !== "string" || !UUID_RE.test(refId)) return { error: SET_NOT_FOUND };
  const owned = await readyOwnedSpec(setId, userId);
  if (owned.error !== null) return { error: owned.error };
  if (element === FIGURE_KEY) return { error: SET_ELEMENT_NOT_A_THING };
  if (typeof element !== "string" || !ELEMENT_KEY_RE.test(element)) return { error: SET_ELEMENT_GONE };
  const target = thingFor(owned.spec, element);
  if (!target) return { error: SET_ELEMENT_GONE };
  const admin = createAdminClient();
  const before = await listElementPhotos(admin, userId, setId);
  const photo = before.photos.find((p) => p.refId === refId);
  if (!photo) return { error: SET_NOT_FOUND };
  const resolved = resolvePhotos(setElements(owned.spec), before.photos);
  const held = resolved.held.find((h) => h.key === target) ?? null;
  if (held && [...held.photos, ...held.extra].some((p) => p.refId === refId)) return { error: null, listing: forPage(before) };
  const onIt = held ? [...held.photos, ...held.extra] : [];
  if (onIt.length >= ELEMENT_PHOTOS_MAX) return { error: SET_ELEMENT_FULL };
  const taken = new Set(onIt.map((p) => p.slot));
  const slot = ([1, 2, 3, 4] as const).find((n) => !taken.has(n))!;
  const to = setElementPhotoPath(userId, setId, target, slot, seconds(photo.at), refId);
  const { error } = await admin.storage.from(BUCKET).move(photo.path, to);
  if (error) {
    console.warn("[sets] element photo could not be put on its thing:", error.message);
    return { error: SET_PHOTO_SAVE_FAILED };
  }
  if (held && held.photos.length > 0) await admin.storage.from(BUCKET).remove([setElementSheetPath(userId, setId, held.sheetHash)]);
  else if (photo.anchor === null) {
    // Its only photo, from before R1: the sheet drawn from it is this thing's sheet.
    const own = sheetHashOf([{ ...photo, anchor: target, slot }]);
    const moved = await admin.storage.from(BUCKET).move(setRefSheetPath(userId, setId, refId), setElementSheetPath(userId, setId, own));
    if (moved.error) console.warn("[sets] a reference's sheet stays where it was:", moved.error.message);
  }
  return { error: null, listing: forPage(await listElementPhotos(admin, userId, setId)) };
}

/**
 * Rename the photos that followed their thing after an edit (moved, or
 * changed where it stood) to the thing's key now, keeping each photo's slot,
 * time and id: their sheet is named by their ids, so nothing is redrawn.
 * The page calls this on entering Shoot or Film, never on every edit.
 */
export async function settleElementPhotos(setId: string): Promise<{ error: string } | { error: null; listing: ElementListing; moved: number }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const { userId } = access;
  const owned = await readyOwnedSpec(setId, userId);
  if (owned.error !== null) return { error: owned.error };
  const admin = createAdminClient();
  const before = await listElementPhotos(admin, userId, setId);
  const byRef = new Map<string, StoredElementPhoto>(before.photos.map((p) => [p.refId, p]));
  let moved = 0;
  for (const h of resolvePhotos(setElements(owned.spec), before.photos).held) {
    if (h.how === "exact") continue;
    for (const p of [...h.photos, ...h.extra]) {
      const stored = byRef.get(p.refId);
      if (!stored || stored.anchor === h.key || stored.slot === null) continue;
      const { error } = await admin.storage.from(BUCKET).move(stored.path, setElementPhotoPath(userId, setId, h.key, stored.slot, seconds(stored.at), stored.refId));
      if (error) console.warn("[sets] element photo could not follow its thing:", error.message);
      else moved += 1;
    }
  }
  const listing = moved > 0 ? await listElementPhotos(admin, userId, setId) : before;
  return { error: null, listing: forPage(listing), moved };
}

/** Sheets drawn an hour per person: each is one render, absorbed (the operator's call, 2026-09-21). */
const ELEMENT_SHEETS_PER_HOUR = 24;
/** Sheets one call draws at once; the page asks again for the rest. */
const SHEETS_AT_ONCE = 4;

export type SheetStatus = "ready" | "drawn" | "refused" | "failed" | "storage" | "gone" | "no-photos" | "too-fast" | "queued";

/**
 * Draw the sheets these things need before a shot (R1): one render per
 * thing whose photos have no sheet yet — about a minute each — kept and
 * reused until its photos change. Run by the page before Shoot and
 * Render, never inside the shot, which has its own minutes to keep. The
 * render is absorbed, so it is held to people who could shoot a still
 * now (the allowance) and to ELEMENT_SHEETS_PER_HOUR; four at once, the
 * rest come back "queued" for the page to ask again.
 */
export async function prepareElementSheets(setId: string, keys: unknown): Promise<{ error: string } | { error: null; sheets: { key: string; status: SheetStatus }[] }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const { userId } = access;
  const owned = await readyOwnedSpec(setId, userId);
  if (owned.error !== null) return { error: owned.error };
  const wanted = [...new Set(Array.isArray(keys) ? keys.filter((k): k is string => typeof k === "string" && ELEMENT_KEY_RE.test(k)) : [])].slice(0, ELEMENT_SET_PHOTOS_MAX);
  if (wanted.length === 0) return { error: null, sheets: [] };
  const allowance = await checkGenerationAllowance(access.supabase, userId, quoteSend(stillQuoteInput()).totalCredits, { skipCooldown: true });
  if (allowance.error) return { error: allowance.error };

  const admin = createAdminClient();
  const listing = await listElementPhotos(admin, userId, setId);
  const pathOf = new Map(listing.photos.map((p) => [p.refId, p.path]));
  const els = setElements(owned.spec);
  const held = resolvePhotos(els, listing.photos).held;
  const out: { key: string; status: SheetStatus }[] = [];
  const toDraw: { key: string; hash: string; paths: string[] }[] = [];
  for (const key of wanted) {
    const h = held.find((x) => x.key === key);
    if (!h) {
      out.push({ key, status: els.some((e) => e.key === key) ? "no-photos" : "gone" });
      continue;
    }
    if (listing.sheets.includes(h.sheetHash)) {
      out.push({ key, status: "ready" });
      continue;
    }
    toDraw.push({ key, hash: h.sheetHash, paths: h.photos.map((p) => pathOf.get(p.refId)).filter((p): p is string => Boolean(p)) });
  }
  const now = toDraw.slice(0, SHEETS_AT_ONCE);
  for (const q of toDraw.slice(SHEETS_AT_ONCE)) out.push({ key: q.key, status: "queued" });
  const drawn = await Promise.all(
    now.map(async (d): Promise<{ key: string; status: SheetStatus }> => {
      if (await rateLimited(userId, "set-sheet", 60 * 60, ELEMENT_SHEETS_PER_HOUR)) return { key: d.key, status: "too-fast" };
      const r = await sheetFromPhotos({ admin, sourcePaths: d.paths, sheetPath: setElementSheetPath(userId, setId, d.hash) });
      if (r.ok) return { key: d.key, status: r.made ? "drawn" : "ready" };
      return { key: d.key, status: r.reason === "sheet refused" ? "refused" : r.reason === "storage" ? "storage" : "failed" };
    }),
  );
  const order = new Map(wanted.map((k, i) => [k, i]));
  return { error: null, sheets: [...out, ...drawn].sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0)) };
}
