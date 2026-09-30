"use server";

// Helios Studio · Render ▸ "Video with your character" (2026-09-30; the
// operator picked it: "Video with your character"). The Studio's doors to
// Recast: the recording is uploaded, read and started through Recast's OWN
// actions (lib/recast/actions.ts — reserve, inspect, start), so its gates,
// its price, its checks of the clip and the words, its double-charge guard
// (the press's sendId) and its refunds are the ones its door runs. Nothing
// here charges, prices or renders on its own.
//
// WHO: every door asks setsAccess first and stops on its refusal — the rule
// that keeps an account on no plan out of Helios (access-rule.test.ts pins
// it) — and then Recast asks its own (admins, behind the `recast` switch,
// today). Both must say yes.

import { setsAccess, UUID_RE } from "@/lib/sets/access";
import { SET_NOT_FOUND, STUDIO_LOOK_GONE } from "@/lib/sets/messages";
import { canUseRecast, discardRecastUpload, inspectRecastClip, reserveRecastUpload, startRecastTakes } from "@/lib/recast/actions";
import { pollGeneration } from "@/lib/generations/actions";
import { isRenderableUrl, thumbUrl, toMediaUrl } from "@/lib/media/url";
import { RECAST_MODEL_IDS } from "@/lib/recast/recast";
import { copyStudioLook } from "@/lib/sets/studio-looks";
import { inActionRows } from "@/lib/characters/in-action";
import { recastTakeOutcome } from "@/lib/recast/door-truth";
import type { RecastRead } from "@/lib/recast/recast-read";
import { parseStudioRecastEngine, studioOutfitFromPrompt, studioRecastStart } from "@/lib/sets/studio-recast";
import { readRecastCharacters } from "@/lib/recast/data";
import { serverTimer } from "@/lib/server-timing";

type Access = Awaited<ReturnType<typeof setsAccess>>;

/** The set is theirs (and not deleted): the Studio's doors act for one set. */
async function ownsSet(access: Extract<Access, { error: null }>, setId: unknown): Promise<boolean> {
  if (typeof setId !== "string" || !UUID_RE.test(setId)) return false;
  const { data } = await access.supabase
    .from("location_sets")
    .select("id")
    .eq("id", setId)
    .eq("user_id", access.userId)
    .is("deleted_at", null)
    .maybeSingle();
  return !!data;
}

/** Step 1: a place in Recast's storage for the recording (Recast's own reserve). */
export async function reserveStudioRecast(
  setId: string,
  input: { size: number; type: string },
): Promise<{ error: string } | { error: null; path: string; contentType: string }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  if (!(await ownsSet(access, setId))) return { error: SET_NOT_FOUND };
  const type = typeof input?.type === "string" ? input.type.split(";")[0].trim() : "";
  const ext = type === "video/mp4" ? "mp4" : type === "video/quicktime" ? "mov" : "webm";
  return reserveRecastUpload({ size: typeof input?.size === "number" ? input.size : 0, type, name: `helios-studio.${ext}` });
}

/** Step 2: the recording read the way Recast reads any clip — its real numbers, and what is in it. */
export async function inspectStudioRecast(
  setId: string,
  input: { path: string },
): Promise<
  | { error: string }
  | { error: null; path: string; seconds: number; frames: number | null; width: number; height: number; read: RecastRead | null }
> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  if (!(await ownsSet(access, setId))) return { error: SET_NOT_FOUND };
  const path = typeof input?.path === "string" ? input.path : "";
  // No frames from the browser: Recast samples the file itself (convert-run.ts).
  const seen = await inspectRecastClip({ path, frames: "" });
  if (seen.error !== null) return { error: seen.error };
  return { error: null, path: seen.path ?? path, seconds: seen.seconds, frames: seen.frames, width: seen.width, height: seen.height, read: seen.read };
}

/** Stopped before the take started: the recording is let go (Recast keeps any clip a take stands on). */
export async function discardStudioRecast(setId: string, input: { path: string }): Promise<void> {
  const access = await setsAccess();
  if (access.error !== null) return;
  if (!(await ownsSet(access, setId))) return;
  if (typeof input?.path === "string") await discardRecastUpload(input.path);
}

/** How many of a character's pictures the window's gallery strip shows, newest first. */
const STUDIO_LOOKS_MAX = 30;
export type StudioLook = { id: string; url: string; outfit: string };

/**
 * "Look from their gallery" (2026-09-30, operator: "…pick from eva's image gallery generation"): the chosen
 * character's own finished pictures, newest first — the character page's "In action" rows, images only — each
 * with a thumbnail and the outfit words its prompt gives (studioOutfitFromPrompt), for the Outfit box.
 */
/**
 * "Video with your character", opened (2026-09-30, operator: "Pushed, measure it"): Recast's own gate and its
 * list of characters, asked when the window first opens — the Studio's page no longer waits on them (live,
 * the gate alone took ~1 s of the page's server time). Every step of the window's own doors still asks
 * setsAccess and Recast's gate again, server-side. `timing`: the steps, for our own measurement.
 */
export async function openStudioRecast(
  setId: string,
): Promise<{ error: string; timing: string } | { error: null; characters: { id: string; name: string; photos: number }[]; timing: string }> {
  const tm = serverTimer("studio.recast");
  const access = await tm.step("access", () => setsAccess());
  if (access.error !== null) return { error: access.error, timing: tm.value() };
  if (!(await tm.step("owns", () => ownsSet(access, setId)))) return { error: SET_NOT_FOUND, timing: tm.value() };
  const [gate, characters] = await Promise.all([
    tm.step("gate", () => canUseRecast()),
    tm.step("characters", () => readRecastCharacters(access.supabase, access.userId)),
  ]);
  if (gate.error !== null) return { error: gate.error, timing: tm.value() };
  return { error: null, characters: characters.map((c) => ({ id: c.id, name: c.name, photos: c.photos.length })), timing: tm.value() };
}

export async function listStudioLooks(setId: string, input: { characterId: string }): Promise<{ error: string } | { error: null; looks: StudioLook[] }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  if (!(await ownsSet(access, setId))) return { error: SET_NOT_FOUND };
  const characterId = typeof input?.characterId === "string" && UUID_RE.test(input.characterId) ? input.characterId : null;
  if (!characterId) return { error: null, looks: [] };
  // The character page's "In action" rows, images only — one source and one rule (lib/characters/in-action.ts).
  const { data, error } = await inActionRows(access.supabase, { userId: access.userId, characterId, limit: STUDIO_LOOKS_MAX, imagesOnly: true });
  // A read that fails is said in the logs, never passed off as an empty gallery without a trace (2026-09-30).
  if (error) console.error("listStudioLooks couldn't read the gallery:", (error as { message?: string }).message ?? error);
  const looks = ((data ?? []) as Record<string, unknown>[])
    .map((r) => {
      const url = toMediaUrl(r.result_url as string) ?? "";
      return { id: r.id as string, url: isRenderableUrl(url) ? (thumbUrl(url, 320) ?? url) : "", outfit: studioOutfitFromPrompt(r.prompt_input as string | null) };
    })
    .filter((l) => l.url);
  return { error: null, looks };
}

/**
 * The look, checked and put where Recast takes added images: the picture must be this person's, of THIS
 * character, a finished image — then it is copied into their own folder of Recast's image bucket, which is the
 * only place Recast reads an added image from (actions.ts readAddedImage). Null when it isn't theirs.
 */
async function lookForRecast(access: Extract<Access, { error: null }>, lookId: string, characterId: string): Promise<string | null> {
  return copyStudioLook(access.supabase, { userId: access.userId, lookId, characterId });
}

/**
 * Step 3: the take, started by Recast's own start with this press's id —
 * the first take's row id, so a second delivery of the same press follows
 * the take the first one started and is never charged (recast/repeat.ts).
 * Only the Studio's lanes, one character, the whole recording.
 */
export async function startStudioRecast(
  setId: string,
  input: {
    sendId: string;
    path: string;
    characterId: string;
    engine: string;
    seconds: number;
    direction: string;
    read: RecastRead | null;
    castTag: string | null;
    /** Whether the face can be read at the recording's first and last frame (the Studio measures its figure). */
    faceAt?: { first: boolean; last: boolean } | null;
    /** A picture from the character's own gallery, for the outfit and look (listStudioLooks). */
    lookId?: string | null;
  },
): Promise<{ error: string } | { error: null; ids: string[] }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  if (!(await ownsSet(access, setId))) return { error: SET_NOT_FOUND };
  const engine = parseStudioRecastEngine(input?.engine);
  const seconds = typeof input?.seconds === "number" && Number.isFinite(input.seconds) ? input.seconds : 0;
  if (!engine || typeof input?.characterId !== "string" || typeof input?.sendId !== "string" || !(seconds > 0)) return { error: SET_NOT_FOUND };
  // The look is checked again here — this person's, this character's — and nothing starts on one that isn't.
  let imagePath: string | null = null;
  if (typeof input.lookId === "string" && input.lookId) {
    imagePath = await lookForRecast(access, input.lookId, input.characterId);
    if (!imagePath) return { error: STUDIO_LOOK_GONE };
  }
  return startRecastTakes(
    studioRecastStart({
      sendId: input.sendId,
      path: typeof input.path === "string" ? input.path : "",
      characterId: input.characterId,
      engine,
      seconds,
      direction: typeof input.direction === "string" ? input.direction : "",
      // Bounded again by Recast (reboundRecastRead); never trusted for money.
      read: (input.read ?? null) as RecastRead | null,
      castTag: typeof input.castTag === "string" ? input.castTag : null,
      faceAt:
        input.faceAt && typeof input.faceAt === "object"
          ? { first: input.faceAt.first !== false, last: input.faceAt.last !== false }
          : null,
      imagePath,
    }),
  );
}

export type StudioRecastRead =
  | { error: string }
  | { error: null; state: "none" }
  | { error: null; state: "working"; progress: string }
  | { error: null; state: "done"; url: string }
  | { error: null; state: "stopped" }
  | { error: null; state: "failed"; reason: string | null; refused: boolean; charged: boolean };

/**
 * Where the take under this press's id is: nothing yet, rendering (with the
 * runner's own progress line), done, stopped or failed — and why, in
 * Recast's door's words (door-truth.ts). A take still rendering is advanced
 * the way every video's poll advances it (pollGeneration).
 */
export async function readStudioRecast(setId: string, input: { id: string }): Promise<StudioRecastRead> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  if (!(await ownsSet(access, setId))) return { error: SET_NOT_FOUND };
  const id = typeof input?.id === "string" && UUID_RE.test(input.id) ? input.id.toLowerCase() : null;
  if (!id) return { error: SET_NOT_FOUND };
  const recast = await canUseRecast();
  if (recast.error !== null) return { error: recast.error };

  const readRow = async () =>
    (
      await access.supabase
        .from("generations")
        .select("id, status, result_url, credits_used")
        .eq("id", id)
        .eq("user_id", access.userId)
        .in("model_id", RECAST_MODEL_IDS)
        .is("deleted_at", null)
        .maybeSingle<{ id: string; status: string; result_url: string | null; credits_used: number | null }>()
    ).data;
  const settled = async (row: { status: string; result_url: string | null; credits_used: number | null }): Promise<StudioRecastRead | null> => {
    const url = toMediaUrl(row.result_url);
    if (row.status === "succeeded" && url) return { error: null, state: "done", url };
    if (row.status !== "failed") return null;
    // The log in a read of its own: a statement naming a column the database lacks fails whole.
    const { data } = await access.supabase.from("generations").select("pipeline_log").eq("id", id).eq("user_id", access.userId).maybeSingle();
    const outcome = recastTakeOutcome({ credits_used: row.credits_used, pipeline_log: (data as { pipeline_log?: unknown } | null)?.pipeline_log ?? null });
    return outcome.stopped ? { error: null, state: "stopped" } : { error: null, state: "failed", reason: outcome.reason, refused: outcome.refused, charged: outcome.charged };
  };

  const row = await readRow();
  if (!row) return { error: null, state: "none" };
  const before = await settled(row);
  if (before) return before;

  const poll = await pollGeneration(id);
  if (poll.error !== null) return { error: poll.error };
  if (poll.state === "pending") return { error: null, state: "working", progress: poll.progress };
  const after = await readRow();
  return (after && (await settled(after))) ?? { error: null, state: "working", progress: "" };
}
