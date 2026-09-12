// A look's cutout, made once and kept (Astra Sets, 2026-09-12). Server-side,
// but relative imports only and the Supabase client passed in, so the test
// suite loads this file as it is, with fakes for storage and for SAM 2.
//
// The look a shot carries is never the earlier still itself, only its
// objects cut out onto grey (look-cutout.ts says why). Made the first time
// a still is someone's look:
//
//   the still, from the owner's own folder → where its objects and its
//   person are, from the camera and figure recorded with it (look-cutout.ts)
//   → SAM 2 cuts the objects out (providers/fal-segment.ts) → the person's
//   region cleared, the rest laid on grey and cropped (look-cutout-image.ts)
//   → kept at setLookCutoutPath, beside the set's card.
//
// and every later shot with the same look reuses the kept file: the cut is
// paid for once per still (look-cutout.ts, THE MONEY). Any step that fails
// is a reason, never a throw: the shot then goes without its look, and says
// so (sets/actions.ts shootInSet).
//
// WHERE THEY GO. A cutout is the person's own data, in their own folder of a
// bucket account deletion sweeps whole. Deleting the set removes all of its
// cutouts (removeSetLookCutouts); deleting the still a cutout was cut from
// removes that one (removeLookCutoutsOf, from History's delete), as a derived
// copy should go with what it was made from.
//
// The owner can write to that folder, so a kept cutout is theirs to replace,
// as the still it was cut from always was. Whatever is there rides as the
// look like any other attached picture: gated in the strict lane with the
// rest of the shot, and never a source of anyone's identity
// (providers/reference-notes.ts).

import type { SupabaseClient } from "@supabase/supabase-js";
import { segmentWithBoxes } from "../generations/providers/fal-segment";
import { lookCutoutBoxes, type ShotCamera } from "./look-cutout";
import { composeLookCutout } from "./look-cutout-image";
import { setLookCutoutPath, setLookCutoutPrefix } from "./set-config";
import type { SetSpec } from "./set-spec";

const BUCKET = "generated-images";
/** A still is at most a few MB; a download past this is not a still. */
const MAX_STILL_BYTES = 30 * 1024 * 1024;

/** Why a shot went without its look. Logged as it is: none of these carries anything of the person's. */
export type LookDrop =
  | "not a finished still of this set"
  | "no camera"
  | "still unreadable"
  | "nothing to cut"
  | "cut failed"
  | "empty mask"
  | "mask took the whole frame"
  | "storage";

export type LookCutoutResult = { ok: true; path: string; made: boolean } | { ok: false; reason: LookDrop };

async function exists(admin: SupabaseClient, path: string): Promise<boolean> {
  try {
    const { data } = await admin.storage.from(BUCKET).exists(path);
    return data === true;
  } catch {
    return false;
  }
}

async function stillSize(bytes: Buffer): Promise<{ width: number; height: number } | null> {
  try {
    const { default: sharp } = await import("sharp");
    const meta = await sharp(bytes, { limitInputPixels: 25_000_000 }).metadata();
    return meta.width && meta.height ? { width: meta.width, height: meta.height } : null;
  } catch {
    return null;
  }
}

/**
 * The cutout for this look: the kept one, or one made now. `stillPath` is
 * the look still's own storage path, already checked to be the person's
 * finished picture (look.ts lookStoragePath); `camera` is the one recorded
 * with it (shot-camera.ts), null when none was.
 */
export async function lookCutout(
  input: {
    admin: SupabaseClient;
    userId: string;
    setId: string;
    lookGenerationId: string;
    stillPath: string;
    spec: Pick<SetSpec, "objects">;
    camera: ShotCamera | null;
  },
  deps: { segment?: typeof segmentWithBoxes } = {},
): Promise<LookCutoutResult> {
  const { admin, userId, setId, lookGenerationId } = input;
  const path = setLookCutoutPath(userId, setId, lookGenerationId);
  if (await exists(admin, path)) return { ok: true, path, made: false };
  if (!input.camera) return { ok: false, reason: "no camera" };

  let still: Buffer;
  try {
    const { data, error } = await admin.storage.from(BUCKET).download(input.stillPath);
    if (error || !data) return { ok: false, reason: "storage" };
    still = Buffer.from(await data.arrayBuffer());
  } catch {
    return { ok: false, reason: "storage" };
  }
  if (still.byteLength === 0 || still.byteLength > MAX_STILL_BYTES) return { ok: false, reason: "still unreadable" };
  const size = await stillSize(still);
  if (!size) return { ok: false, reason: "still unreadable" };

  const { boxes, person } = lookCutoutBoxes(input.spec, input.camera, size);
  if (boxes.length === 0) return { ok: false, reason: "nothing to cut" };
  const cut = await (deps.segment ?? segmentWithBoxes)(still, boxes);
  if (!cut) return { ok: false, reason: "cut failed" };
  // Whatever SAM 2 kept where the person may be is cleared before it is laid out.
  const laid = await composeLookCutout(cut, person);
  if (!laid.ok) {
    return { ok: false, reason: laid.reason === "empty" ? "empty mask" : laid.reason === "whole" ? "mask took the whole frame" : "cut failed" };
  }

  try {
    const { error } = await admin.storage.from(BUCKET).upload(path, laid.jpeg, { contentType: "image/jpeg", upsert: false });
    // Refused because it is there already: a shot beside this one made it
    // first, and a kept cutout is never rewritten (media URLs are cached as
    // immutable). Either copy is a cut of the same still.
    if (error && !(await exists(admin, path))) return { ok: false, reason: "storage" };
  } catch {
    return { ok: false, reason: "storage" };
  }
  return { ok: true, path, made: true };
}

/** Every file in the owner's `sets/` folder whose name starts with `prefix`. */
async function listCutouts(admin: SupabaseClient, userId: string, prefix: string): Promise<string[]> {
  const PAGE = 1000;
  const folder = `${userId}/sets`;
  const paths: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin.storage.from(BUCKET).list(folder, { limit: PAGE, offset, search: prefix });
    if (error || !data) break;
    for (const entry of data as { name: string }[]) {
      if (typeof entry.name === "string" && entry.name.startsWith(prefix)) paths.push(`${folder}/${entry.name}`);
    }
    if (data.length < PAGE) break;
  }
  return paths;
}

/** Best-effort, never throws: remove every cutout a set's looks were given. */
export async function removeSetLookCutouts(admin: SupabaseClient, userId: string, setId: string): Promise<void> {
  try {
    const paths = await listCutouts(admin, userId, setLookCutoutPrefix(setId));
    for (let i = 0; i < paths.length; i += 1000) {
      await admin.storage.from(BUCKET).remove(paths.slice(i, i + 1000));
    }
  } catch (err) {
    console.warn("[sets] a set's look cutouts could not be removed:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Best-effort, never throws: remove the cutouts cut from these stills, in
 * whichever of the owner's sets they were shot. A still's cutout sits at a
 * fixed path per set, so the shots' own rows say where to look. `db` may be
 * the owner's own client: they can read their shots and remove files from
 * their own folder.
 */
export async function removeLookCutoutsOf(db: SupabaseClient, userId: string, generationIds: string[]): Promise<void> {
  if (generationIds.length === 0) return;
  try {
    const { data } = await db
      .from("location_set_shots")
      .select("set_id, generation_id")
      .eq("user_id", userId)
      .in("generation_id", generationIds);
    const paths = ((data ?? []) as { set_id: unknown; generation_id: unknown }[])
      .filter((s) => typeof s.set_id === "string" && typeof s.generation_id === "string")
      .map((s) => setLookCutoutPath(userId, s.set_id as string, s.generation_id as string));
    if (paths.length > 0) await db.storage.from(BUCKET).remove(paths);
  } catch (err) {
    console.warn("[sets] look cutouts of a deleted still could not be removed:", err instanceof Error ? err.message : String(err));
  }
}
