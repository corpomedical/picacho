// Relative imports on purpose: the test loads this module, and vitest has no
// "@/" alias configured (the repo's standing gotcha).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttemptLog } from "./pipeline";
import { angleSortIndex } from "./angles";
import { toMediaUrl } from "../media/url";

// ONE SEND, DELIVERED TWICE (2026-09-22, Play reviewer account on the
// Android emulator): two image sends each showed "Couldn't start this
// generation — try again." while both takes rendered, scored 88 and 85, and
// took their credit. The batch script waited for each send to settle, so this
// was not two sends racing: it was one send arriving twice.
//
// Chromium, the engine inside the Android WebView and every Chrome, RESENDS
// a request, a POST included, when a reused connection drops before any
// response headers arrive. Reproduced locally over HTTP/1.1 and HTTP/2
// (picacho.ai is HTTP/2): the server gets the same body twice and the page
// only ever sees the second answer. The composer's action takes its row id
// from the client (generation_id, so Stop works before the action returns).
// On the image lane the request stays open for the whole render with no
// response headers yet, which leaves a long window for that resend. So the
// first delivery reserved the row, charged it and rendered it, with nobody
// left to read its answer. The second hit the row's primary key in
// reserve_generation, and ITS answer, the false start error, is the one the
// person saw.
//
// A second delivery must never start a second take, and must never report
// the first one as failed. It follows the first instead: it waits on the row
// the first delivery owns and answers with that take's own outcome. That is
// the answer the person would have got had the first reply arrived.
//
// Keyed by the send's own id (runGeneration), by the batch's group id
// (runMultiAngleGeneration), or by the row ids of a Recast press, which are
// all made from the one id the door sends (recast/repeat.ts). Each is made
// by the client for ONE send, so finding this user's row under any of them
// means this send has already started. None can be charged twice: the id is
// the row's primary key, and a batch meets generations_angle_group_unique
// (user, group, angle). Before this, a second delivery of a batch was told
// "That request was already started" or "Couldn't start these generations"
// while the batch rendered.

// How often a follower re-reads the row. An image render takes about a
// minute, so this adds at most a couple of seconds to the answer.
export const REPEAT_POLL_MS = 2_000;

// The follower's own wall clock, counted from its send's first line. The
// page allows 300 s. The row's owner is normally the first delivery, which
// started earlier under the same ceiling, so it has finished, or been
// stopped by the platform, before the follower's clock runs out.
export const REPEAT_FOLLOW_DEADLINE_MS = 280_000;

// A queued take's label while it renders: the same words the first delivery
// answers with, which the composer localizes (server-text.ts "stageVideo").
const QUEUED_PROGRESS = "Rendering your video";

// Said only when the first delivery's take is STILL rendering inside its own
// request as the follower's clock runs out, which in practice means the
// platform stopped that request mid-render. Either the take lands or the
// reaper settles and refunds it; both show in History. The one thing this
// must not say is that it did not start.
export const REPEAT_STILL_RUNNING =
  "This take is still going — it'll appear in History when it lands.";

/** Postgres unique_violation: the reservation's primary key is already taken. */
export function isRepeatReservation(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23505";
}

export type FollowedTake = {
  id: string;
  angle: string | null;
  succeeded: boolean;
  attempts: AttemptLog[];
  finalPrompt: string;
  resultUrl: string | null;
  matchScore: number | null;
  // Queued at the provider and still rendering. The caller polls it, as it
  // would have after the first delivery's answer.
  pending: boolean;
};

export type FollowOutcome =
  // Nothing of this user's under that key: this is not a repeat.
  | { kind: "none" }
  // Every take has finished or is queued at the provider, where polling
  // picks it up.
  | { kind: "settled"; takes: FollowedTake[] }
  // Still rendering inside the first delivery when the clock ran out. The
  // rows the last read found: they exist and are charged, whatever else is
  // still to happen to them.
  | { kind: "running"; ids: string[] };

type Row = {
  id: string;
  status: string;
  result_url: string | null;
  pipeline_log: AttemptLog[] | null;
  match_score: number | null;
  angle: string | null;
};

const TERMINAL = new Set(["succeeded", "failed"]);

export async function followRepeatSend(
  admin: SupabaseClient,
  userId: string,
  key: { id: string } | { ids: string[] } | { groupId: string },
  opts: {
    deadlineAt: number;
    intervalMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<FollowOutcome> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  // Once a row has been seen this IS a repeat. A failed read after that is
  // retried, not taken as "no row": that answer would send the caller back
  // to the false start error.
  let seen = false;
  let seenIds: string[] = [];

  for (;;) {
    let query = admin
      .from("generations")
      .select("id, status, result_url, pipeline_log, match_score, angle")
      .eq("user_id", userId);
    query =
      "id" in key
        ? query.eq("id", key.id)
        : "ids" in key
          ? query.in("id", key.ids)
          : query.eq("angle_group_id", key.groupId);
    const { data, error } = await query;
    const rows = (data ?? []) as Row[];

    if (!error) {
      if (rows.length === 0) return { kind: "none" };
      seen = true;
      seenIds = rows.map((r) => r.id);

      const open = rows.filter((r) => !TERMINAL.has(r.status));
      let queued = new Set<string>();
      let jobsRead = true;
      if (open.length > 0) {
        const { data: jobs, error: jobsError } = await admin
          .from("generation_jobs")
          .select("generation_id")
          .eq("user_id", userId)
          .in(
            "generation_id",
            open.map((r) => r.id),
          );
        jobsRead = !jobsError;
        queued = new Set(((jobs ?? []) as { generation_id: string }[]).map((j) => j.generation_id));
      }

      if (jobsRead && open.every((r) => queued.has(r.id))) {
        return {
          kind: "settled",
          takes: rows.map((r) => {
            const attempts = (r.pipeline_log ?? []) as AttemptLog[];
            const pending = !TERMINAL.has(r.status);
            return {
              id: r.id,
              angle: r.angle ?? null,
              succeeded: r.status === "succeeded",
              attempts,
              finalPrompt: attempts[attempts.length - 1]?.compiledPrompt ?? "",
              resultUrl: pending ? null : toMediaUrl(r.result_url),
              matchScore: r.match_score ?? null,
              pending,
            };
          }),
        };
      }
    } else if (!seen) {
      // Not known to be a repeat. The caller carries on as it would have.
      return { kind: "none" };
    }

    if (now() >= opts.deadlineAt) return { kind: "running", ids: seenIds };
    await sleep(opts.intervalMs ?? REPEAT_POLL_MS);
  }
}

/**
 * runGeneration's answer for a repeat, or null when this is not one.
 *
 * The same shape the first delivery answers with, read back from its row.
 * A brand-rules block's structured fix (rulesBlock) is not stored on the row,
 * so a repeat of a blocked send shows the failure without the one-tap
 * override.
 */
export function repeatRunResult(outcome: FollowOutcome):
  | null
  | { error: string }
  | {
      error: null;
      id: string;
      succeeded: boolean;
      attempts: AttemptLog[];
      finalPrompt: string;
      resultUrl: string | null;
      matchScore: number | null;
      pending?: boolean;
      progress?: string;
    } {
  if (outcome.kind === "none") return null;
  if (outcome.kind === "running") return { error: REPEAT_STILL_RUNNING };
  const take = outcome.takes[0];
  return {
    error: null,
    id: take.id,
    succeeded: take.succeeded,
    attempts: take.attempts,
    finalPrompt: take.finalPrompt,
    resultUrl: take.resultUrl,
    matchScore: take.matchScore,
    ...(take.pending ? { pending: true, progress: QUEUED_PROGRESS } : {}),
  };
}

/**
 * runMultiAngleGeneration's answer for a repeated batch, or null when this is
 * not one: every angle of the first delivery's batch, in display order.
 */
export function repeatMultiResult(
  outcome: FollowOutcome,
  groupId: string,
):
  | null
  | { error: string }
  | {
      error: null;
      groupId: string;
      angles: {
        angleId: string;
        id: string;
        succeeded: boolean;
        attempts: AttemptLog[];
        finalPrompt: string;
        resultUrl: string | null;
        pending?: boolean;
      }[];
    } {
  if (outcome.kind === "none") return null;
  if (outcome.kind === "running") return { error: REPEAT_STILL_RUNNING };
  return {
    error: null,
    groupId,
    angles: outcome.takes
      .slice()
      .sort((a, b) => angleSortIndex(a.angle) - angleSortIndex(b.angle))
      .map((t) => ({
        angleId: t.angle ?? "",
        id: t.id,
        succeeded: t.succeeded,
        attempts: t.attempts,
        finalPrompt: t.finalPrompt,
        resultUrl: t.resultUrl,
        ...(t.pending ? { pending: true } : {}),
      })),
  };
}
