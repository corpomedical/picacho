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
// ONLY THE FINISHER NOTIFIES: when the page's own tick settles a build, the
// person is watching it happen.
//
// Relative imports only, and every dependency passed in: the test suite
// loads this file as it is and drives it with fakes (finisher.test.ts).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotifyOptions } from "../push/channels";
import type { PushMessage } from "../push/send";
import { setsAccessForProfile } from "./access-rule";
import type { AdvanceSetBuildInput, SetBuildTick } from "./build-tick";
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
 * Past this, a run starts nothing new, so it ends inside the route's 300 s.
 * A tick takes up to ~100 s when the words gate reads slowly, plus up to
 * 15 s polling OpenAI (providers/astra.ts): 180 + 115 = 295 s. A tick the
 * platform cuts off anyway is a page's request cut short: its claim goes
 * stale, and a later tick delivers the draft or closes the build as lost.
 */
export const FINISHER_START_BUDGET_MS = 180_000;

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
  notification: { message: PushMessage; path: string },
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
  /** enabled.ts isSetsEnabled. */
  setsEnabled: (admin: SupabaseClient) => Promise<boolean>;
  /** enabled.ts isPhotoSetsEnabled, asked at most once a run. */
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
  /** Not started before the time budget ran out: the next run takes them. */
  deferred: number;
  /** Ticks that threw; the others carried on. */
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

  // Each owner's profile, read once, under the rule the page applies.
  const owners = [...new Set(builds.map((b) => b.userId))];
  const { data: profiles, error: profileError } = await admin
    .from("profiles")
    .select("id, plan, role, status")
    .in("id", owners);
  if (profileError) {
    // Nobody's access can be checked: nothing is advanced on a guess.
    console.error("[sets] finisher: owners' profiles query failed", profileError.message);
    return { status: 500, body: { error: "profiles query failed" } };
  }
  const profileOf = new Map(
    ((profiles ?? []) as Record<string, unknown>[]).map((p) => [p.id as string, p] as const),
  );
  const allowed = new Set<string>();
  let skipped = 0;
  for (const userId of owners) {
    const rule = setsAccessForProfile(profileOf.get(userId));
    if (rule.error === null) {
      allowed.add(userId);
      continue;
    }
    const theirs = builds.filter((b) => b.userId === userId).map((b) => b.setId);
    skipped += theirs.length;
    console.info("[sets] finisher: owner may not use Sets; builds not collected", {
      userId,
      reason: rule.error === SETS_SUSPENDED ? "suspended" : "not eligible",
      sets: theirs,
    });
  }

  const summary: FinisherSummary = {
    checked: builds.length,
    advanced: 0,
    ready: 0,
    failed: 0,
    skipped,
    deferred: 0,
    errors: 0,
  };

  // Asked once a run, and only if some photo build wants its retry.
  let photoOn: Promise<boolean> | null = null;
  const photoSwitchOn = () => (photoOn ??= deps.photoSetsEnabled(admin));

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
      if (how === "ready") {
        // The title is Astra's, and the strict-lane words gate passed it
        // before the tick saved it (build-tick.ts). A read that failed, or
        // no title, still says the set is ready.
        const title = typeof row?.title === "string" ? row.title.trim() : "";
        const message: PushMessage = title ? { key: "setReady", params: { title } } : { key: "setReady" };
        await deps.notify(userId, { message, path: `/app/sets/${setId}` }, { webOnly: true });
      } else {
        await deps.notify(userId, { message: { key: "setFailed" }, path: "/app/sets" }, { webOnly: true });
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

  // Oldest first, a few at a time, and nothing new past the budget.
  const queue = builds.filter((b) => allowed.has(b.userId));
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      if (deps.now() - startedAt >= FINISHER_START_BUDGET_MS) return;
      await finishOne(queue[next++]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(FINISHER_CONCURRENCY, queue.length) }, worker));
  summary.deferred = queue.length - next;

  console.info(
    `[sets] finisher: checked ${summary.checked}, advanced ${summary.advanced}, ready ${summary.ready}, ` +
      `failed ${summary.failed}, skipped ${summary.skipped}, deferred ${summary.deferred}, errors ${summary.errors}`,
  );
  return { status: 200, body: summary };
}
