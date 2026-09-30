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
import { SET_NOT_FOUND } from "@/lib/sets/messages";
import { canUseRecast, discardRecastUpload, inspectRecastClip, reserveRecastUpload, startRecastTakes } from "@/lib/recast/actions";
import { pollGeneration } from "@/lib/generations/actions";
import { toMediaUrl } from "@/lib/media/url";
import { RECAST_MODEL_IDS } from "@/lib/recast/recast";
import { recastTakeOutcome } from "@/lib/recast/door-truth";
import type { RecastRead } from "@/lib/recast/recast-read";
import { parseStudioRecastEngine, studioRecastStart } from "@/lib/sets/studio-recast";

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
  },
): Promise<{ error: string } | { error: null; ids: string[] }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  if (!(await ownsSet(access, setId))) return { error: SET_NOT_FOUND };
  const engine = parseStudioRecastEngine(input?.engine);
  const seconds = typeof input?.seconds === "number" && Number.isFinite(input.seconds) ? input.seconds : 0;
  if (!engine || typeof input?.characterId !== "string" || typeof input?.sendId !== "string" || !(seconds > 0)) return { error: SET_NOT_FOUND };
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
