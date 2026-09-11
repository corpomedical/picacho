// The set finisher (Astra Sets, Phase 2, 2026-09-11): a build finishes with
// the page closed, and says so.
//
// A build runs at OpenAI in background mode with store: false, and OpenAI
// keeps an answer nobody collects for only about ten minutes. Until this,
// only the Sets page's own poll collected one, so a build whose page was
// closed went stale (SET_BUILD_STALE_MS) and was lost. This is the visit
// that always comes (the reconcile cron's pattern): Vercel Cron calls
// app/api/cron/sets every minute, and each run takes the SAME tick the page
// takes (build-tick.ts advanceSetBuild) for every set still building.
//
// A cron, not the OpenAI webhook the plan named (docs/ASTRA_SETS.md,
// Phase 2): no dashboard subscription and no new secret for the operator;
// no dependence on webhook delivery for store: false background responses,
// which was never probed; and the Pro plan allows a per-minute schedule.
//
// THE SAME RULES AS THE PAGE, without a session: the kill switch before
// any database read (enabled.ts's first two levels, which stop the page's
// poll the same way), then the flag, then the owner's access rule
// (access-rule.ts, the one setsAccess applies to the person signed in).
// The page asks the flag and the owner's access before every poll's tick,
// so the finisher asks them again before every tick it starts, and a photo
// build's retry asks the photo switch at the moment it wants it, as the
// page's does. A switch turned off or an owner suspended during a run
// therefore stops the next tick, not the next run.
//
// RACES. The page and the finisher can tick the same set at the same
// moment, and two finisher runs can overlap (a run may take minutes; the
// next starts on the minute). The tick's claim protocol already covers
// both: only the tick whose conditional write swaps response_id for
// "claiming" acts on an answer — every other returns "building" — and a
// row leaves "building" only through a write conditioned on it still
// building. So exactly one tick reports settledHere, and one notification
// goes out.
//
// ONLY THE FINISHER PUSHES. When the page's own tick settles a build, the
// page tells the person itself: the card changes, and a tab in the
// background shows a notification in the same words, with the same tag
// (leaving.ts, sets-home.tsx).
//
// Relative imports only, and every dependency passed in: the test suite
// loads this file as it is and drives it with fakes (finisher.test.ts).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotifyOptions } from "../push/channels";
import type { PushMessage } from "../push/send";
import { setsAccessForProfile } from "./access-rule";
import type { AdvanceSetBuildInput, SetBuildTick } from "./build-tick";
import { setNoticePath, setNoticeTag } from "./leaving";
import { SETS_SUSPENDED } from "./messages";

/**
 * How far back a building row is looked for. A live build writes its row at
 * every attempt and is closed as lost 15 minutes after its last write
 * (SET_BUILD_STALE_MS), so anything older than this can exist only if the
 * finisher was not running; the page still closes those when it is opened.
 */
export const FINISHER_WINDOW_MS = 2 * 60 * 60 * 1000;
/** Sets a run takes, oldest first; the next minute's run takes the rest. */
export const FINISHER_BATCH = 25;
/** Ticks in flight at once. */
export const FINISHER_CONCURRENCY = 3;
/**
 * Past this, a run starts no tick, so that the slowest tick it started still
 * ends inside the route's 300 s. A tick must never be cut off: once it has
 * claimed an answer (build-tick.ts) no other tick can collect it, so a
 * first attempt is lost, and a retry it submitted bills at OpenAI with its
 * id stored nowhere. So the budget is sized to the slowest path a tick can
 * take, every wait at its timeout, not to the usual one:
 *
 *   poll OpenAI (providers/astra.ts pollAstraJob)                  15 s
 *   the words gate (content-policy.ts score): two rounds, each
 *     reader at most 3 sends of 25 s with 2 waits of 5 s between  170 s
 *   the retry's submit (submitAstraJob)                            30 s
 *   its cancel, when the write after it fails (cancelAstraJob)     10 s
 *                                                                 225 s
 *
 * 60 + 225 = 285 s, leaving 15 s for the database, the stored photo, the
 * owner's notification and a cold start. The gate usually reads in 10–100 s,
 * so this is a ceiling, not an estimate. A run starts every minute and
 * takes the oldest rows first, so a tick not started here waits at most a
 * minute, and a run stops starting ticks about when the next one begins.
 * finisher.test.ts reads those timeouts from the code and fails if they
 * outgrow the budget.
 */
export const FINISHER_START_BUDGET_MS = 60_000;

/**
 * Whether the finisher can run at all: the cron route refuses every call
 * without CRON_SECRET, and Vercel sends it with each cron call once it is
 * set. Read on the server only — the pages are handed the answer, never
 * the secret.
 */
export function finisherCanRun(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.CRON_SECRET);
}

export type FinisherNotify = (
  userId: string,
  notification: { message: PushMessage; path: string; tag?: string },
  options: NotifyOptions,
) => Promise<void>;

export type FinisherDeps = {
  /** ASTRA_DISABLED and OPENAI_API_KEY, read before anything else. */
  env: Record<string, string | undefined>;
  /** The service-role client, made only once the kill switch has been read. */
  admin: () => SupabaseClient;
  /** build-tick.ts advanceSetBuild. */
  advance: (input: AdvanceSetBuildInput) => Promise<SetBuildTick>;
  /** push/send.ts notifyUser. */
  notify: FinisherNotify;
  now: () => number;
  /** enabled.ts isSetsEnabled: once a run, then again before every tick. */
  setsEnabled: (admin: SupabaseClient) => Promise<boolean>;
  /** enabled.ts isPhotoSetsEnabled, asked by a tick when a photo build wants its retry. */
  photoSetsEnabled: (admin: SupabaseClient) => Promise<boolean>;
};

export type FinisherSummary = {
  /** Building sets found. */
  checked: number;
  /** Ticks that ran to the end. */
  advanced: number;
  /** Settled by this run's own ticks. */
  ready: number;
  failed: number;
  /** Their owner may not use Sets (suspended, or not eligible): not touched. */
  skipped: number;
  /**
   * Not started: the time budget ran out, or the switch went off during the
   * run. The next run takes them, or finds the switch off.
   */
  deferred: number;
  /** Ticks that threw, or whose owner's access could not be read; the others carried on. */
  errors: number;
};

export type FinisherOutcome =
  | { status: 200; body: FinisherSummary | { checked: 0 } | { skipped: "disabled" | "off" } }
  | { status: 500; body: { error: string } };

type Build = { setId: string; userId: string };

export async function runSetsFinisher(deps: FinisherDeps): Promise<FinisherOutcome> {
  // The kill switch stops collection exactly as it stops the page's poll —
  // and before any database read, so it still works when the database is
  // what is wrong.
  if (deps.env.ASTRA_DISABLED === "1" || !deps.env.OPENAI_API_KEY) {
    return { status: 200, body: { skipped: "disabled" } };
  }
  const startedAt = deps.now();
  const admin = deps.admin();

  // Ids and owners only: nothing a person wrote is read here.
  const since = new Date(startedAt - FINISHER_WINDOW_MS).toISOString();
  const { data: rows, error } = await admin
    .from("location_sets")
    .select("id, user_id")
    .eq("status", "building")
    .is("deleted_at", null)
    .gte("updated_at", since)
    .order("updated_at", { ascending: true })
    .limit(FINISHER_BATCH);
  if (error) {
    console.error("[sets] finisher: building-sets query failed", error.message);
    return { status: 500, body: { error: "query failed" } };
  }
  const builds: Build[] = [];
  for (const r of (rows ?? []) as Record<string, unknown>[]) {
    if (typeof r.id === "string" && typeof r.user_id === "string") builds.push({ setId: r.id, userId: r.user_id });
  }
  if (builds.length === 0) return { status: 200, body: { checked: 0 } };

  // The switch off stops collection, as setsAccess stops the page.
  if (!(await deps.setsEnabled(admin))) return { status: 200, body: { skipped: "off" } };

  const summary: FinisherSummary = {
    checked: builds.length,
    advanced: 0,
    ready: 0,
    failed: 0,
    skipped: 0,
    deferred: 0,
    errors: 0,
  };

  // Before every tick, what setsAccess asks before every poll's tick, read
  // fresh: the switch, then the owner's profile under the one rule
  // (access-rule.ts). The first tick's read repeats the run's own a moment
  // later; two small reads a tick, at most 25 a run. Once the switch reads
  // off, no tick starts again in this run.
  let switchedOff = false;
  const mayStart = async ({ setId, userId }: Build): Promise<boolean> => {
    if (switchedOff || !(await deps.setsEnabled(admin))) {
      switchedOff = true;
      return false;
    }
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("plan, role, status")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) {
      // Their access cannot be checked: nothing is advanced on a guess.
      summary.errors += 1;
      console.error("[sets] finisher: owner's profile read failed", { setId }, profileError.message);
      return false;
    }
    const rule = setsAccessForProfile(profile);
    if (rule.error === null) return true;
    summary.skipped += 1;
    console.info("[sets] finisher: owner may not use Sets; build not collected", {
      setId,
      userId,
      reason: rule.error === SETS_SUSPENDED ? "suspended" : "not eligible",
    });
    return false;
  };

  // Asked at the moment a photo build wants its retry — at most once a tick
  // (build-tick.ts reads the photo once) — exactly as the page's tick asks
  // it, so turning astra_photo_sets off stops the very next resend.
  const photoSwitchOn = () => deps.photoSetsEnabled(admin);

  // The owner is told only when THIS run's own write settled the build, and
  // only if the set is still theirs to open.
  const tellOwner = async ({ setId, userId }: Build, how: "ready" | "failed") => {
    try {
      const { data: row, error: readError } = await admin
        .from("location_sets")
        .select("title")
        .eq("id", setId)
        .eq("user_id", userId)
        .is("deleted_at", null)
        .maybeSingle();
      // Deleted since the tick settled it: nothing to open, nothing to say.
      if (!readError && !row) return;
      // The page's own notification for this set opens the same page and
      // carries the same tag (leaving.ts).
      const where = { path: setNoticePath(setId, how), tag: setNoticeTag(setId) };
      if (how === "ready") {
        // The title is Astra's, and the strict-lane words gate passed it
        // before the tick saved it (build-tick.ts). A read that failed, or
        // no title, still says the set is ready.
        const title = typeof row?.title === "string" ? row.title.trim() : "";
        const message: PushMessage = title ? { key: "setReady", params: { title } } : { key: "setReady" };
        await deps.notify(userId, { message, ...where }, { webOnly: true });
      } else {
        await deps.notify(userId, { message: { key: "setFailed" }, ...where }, { webOnly: true });
      }
    } catch (err) {
      // A notification is never worth a build: the set is saved either way.
      console.warn("[sets] finisher: notification failed", { setId }, err instanceof Error ? err.message : err);
    }
  };

  const finishOne = async (build: Build) => {
    let tick: SetBuildTick;
    try {
      tick = await deps.advance({ admin, setId: build.setId, userId: build.userId, photoSwitchOn });
    } catch (err) {
      // One set's failure must not stop the rest of the run.
      summary.errors += 1;
      console.error("[sets] finisher: tick failed", { setId: build.setId }, err instanceof Error ? err.message : err);
      return;
    }
    summary.advanced += 1;
    if (tick.settledHere === null) return;
    summary[tick.settledHere] += 1;
    await tellOwner(build, tick.settledHere);
  };

  // Oldest first, a few at a time, and nothing new past the budget or once
  // the switch is off.
  let next = 0;
  const worker = async () => {
    while (next < builds.length && !switchedOff) {
      if (deps.now() - startedAt >= FINISHER_START_BUDGET_MS) return;
      const build = builds[next++];
      if (await mayStart(build)) await finishOne(build);
    }
  };
  await Promise.all(Array.from({ length: Math.min(FINISHER_CONCURRENCY, builds.length) }, worker));
  // Every build found is exactly one of: advanced, errors, skipped, deferred.
  summary.deferred = summary.checked - summary.advanced - summary.errors - summary.skipped;
  if (switchedOff) console.info("[sets] finisher: the astra_sets switch went off during the run; nothing more started");

  console.info(
    `[sets] finisher: checked ${summary.checked}, advanced ${summary.advanced}, ready ${summary.ready}, ` +
      `failed ${summary.failed}, skipped ${summary.skipped}, deferred ${summary.deferred}, errors ${summary.errors}`,
  );
  return { status: 200, body: summary };
}
