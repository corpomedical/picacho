import type { SupabaseClient } from "@supabase/supabase-js";
import {
  keptDirections,
  LIVE_MODEL_ID,
  liveRefundCredits,
  liveRefundSplit,
  liveTakeAbandoned,
  liveUsedSeconds,
  readLiveMeter,
  type LiveMeter,
} from "./live";

// The server's half of a live take's money: settling it, and sweeping the
// ones nobody settled. Only this module and the relay write the `live`
// column (supabase/pending/live.sql).
//
// THE ORDER THAT KEEPS IT HONEST. A take is charged its whole paid length
// when it starts (actions.ts). It settles exactly once, and the settlement
// is one compare-and-swap on the row: the credit columns as they were read,
// and `live->>settledAt` still empty. Only the call that wins that write
// hands credits back, so a Stop pressed twice, a Stop racing the sweep, or
// the sweep running in two places at once can refund at most once.

type Admin = SupabaseClient;

export type LiveRow = {
  id: string;
  user_id: string;
  status: string;
  created_at: string;
  credits_used: number | null;
  purchased_credits_used: number | null;
  bonus_credits_used: number | null;
  live: unknown;
};

export const LIVE_ROW_COLUMNS = "id, user_id, status, created_at, credits_used, purchased_credits_used, bonus_credits_used, live";

/**
 * Settles a take: charges the seconds it ran (liveUsedSeconds), hands back
 * the rest, and writes down how it ended. Returns the meter as settled, or
 * null when someone else settled it first (or it is not a live take).
 */
export async function settleLiveTake(
  admin: Admin,
  row: LiveRow,
  opts: { nowMs: number; directions?: unknown },
): Promise<LiveMeter | null> {
  const meter = readLiveMeter(row.live);
  if (!meter || meter.settledAt !== null) return null;

  const usedSeconds = liveUsedSeconds({
    paidSeconds: meter.paidSeconds,
    startedAtMs: meter.startedAt,
    lastBeatAtMs: meter.lastBeatAt,
    stoppedAtMs: opts.nowMs,
    openingAtMs: meter.openingAt,
  });
  const creditsUsed = Number(row.credits_used) || 0;
  const purchasedUsed = Number(row.purchased_credits_used) || 0;
  const bonusUsed = Number(row.bonus_credits_used) || 0;
  // Priced against what the row was actually charged, which is the paid
  // credits unless something upstream already reduced it.
  const refund = Math.min(creditsUsed, liveRefundCredits(meter.paidCredits, usedSeconds));
  const split = liveRefundSplit({ refund, creditsUsed, purchasedUsed, bonusUsed });

  const settled: LiveMeter = {
    ...meter,
    settledAt: opts.nowMs,
    usedSeconds,
    refunded: refund,
    directions: opts.directions === undefined ? meter.directions : keptDirections(opts.directions),
  };

  const { data: claimed, error } = await admin
    .from("generations")
    .update({
      credits_used: split.creditsUsed,
      purchased_credits_used: split.purchasedUsed,
      bonus_credits_used: split.bonusUsed,
      video_duration_seconds: usedSeconds || null,
      live: settled,
    })
    .eq("id", row.id)
    .eq("model_id", LIVE_MODEL_ID)
    .eq("credits_used", creditsUsed)
    .eq("purchased_credits_used", purchasedUsed)
    .eq("bonus_credits_used", bonusUsed)
    .is("live->>settledAt", null)
    .select("id");
  if (error) {
    console.error("[live] settle write failed:", error.message);
    return null;
  }
  if (!claimed?.length) return null;

  // Atomic adds — a read-then-write would race a concurrent spend.
  if (split.purchasedBack > 0) {
    const { error: e } = await admin.rpc("add_purchased_credits", { p_user_id: row.user_id, p_amount: split.purchasedBack });
    if (e) console.error("[live] purchased refund failed:", e.message, row.id, split.purchasedBack);
  }
  if (split.bonusBack > 0) {
    const { error: e } = await admin.rpc("add_bonus_credits", { p_user_id: row.user_id, p_amount: split.bonusBack });
    if (e) console.error("[live] bonus refund failed:", e.message, row.id, split.bonusBack);
  }

  // A take that never opened a session has nothing to keep: it ends here,
  // refunded whole. One that ran stays at "generating" a little longer, for
  // its recording (keepLiveRecording, or the sweep below if none comes).
  if (meter.startedAt === null) {
    const line =
      usedSeconds > 0
        ? `The live take was stopped while its stage was still opening; fal's ${usedSeconds} s minimum was charged, the rest came back.`
        : "The live take never started, so nothing was charged.";
    await admin
      .from("generations")
      .update({ status: "failed", progress_stage: null, pipeline_log: [liveLogStep(line)] })
      .eq("id", row.id)
      .eq("status", "generating");
  }
  return settled;
}

/**
 * A live row with no meter: reserved before live.sql ran (reserve_generations
 * drops a column it does not know). The relay refuses every call on it, so it
 * cannot have streamed — it is refunded whole and closed. startLiveTake does
 * this at once; this is the backstop, so the reaper never has to read the
 * `live` column (it would fail before live.sql runs, and take the orphan
 * write-off for everyone down with it — review, 2026-09-24).
 */
async function writeOffMeterless(admin: Admin, row: LiveRow): Promise<void> {
  const creditsUsed = Number(row.credits_used) || 0;
  const purchasedUsed = Number(row.purchased_credits_used) || 0;
  const bonusUsed = Number(row.bonus_credits_used) || 0;
  const split = liveRefundSplit({ refund: creditsUsed, creditsUsed, purchasedUsed, bonusUsed });
  const { data: claimed } = await admin
    .from("generations")
    .update({
      status: "failed",
      progress_stage: null,
      credits_used: split.creditsUsed,
      purchased_credits_used: split.purchasedUsed,
      bonus_credits_used: split.bonusUsed,
      pipeline_log: [liveLogStep("The live take never started, so nothing was charged.")],
    })
    .eq("id", row.id)
    .eq("status", "generating")
    .eq("credits_used", creditsUsed)
    .eq("purchased_credits_used", purchasedUsed)
    .eq("bonus_credits_used", bonusUsed)
    .select("id");
  if (!claimed?.length) return;
  if (split.purchasedBack > 0) await admin.rpc("add_purchased_credits", { p_user_id: row.user_id, p_amount: split.purchasedBack });
  if (split.bonusBack > 0) await admin.rpc("add_bonus_credits", { p_user_id: row.user_id, p_amount: split.bonusBack });
}

/** How long a settled take waits for its recording before the sweep closes it. */
export const LIVE_RECORDING_WAIT_MS = 15 * 60_000;

/**
 * Settles every take of this person's that was left open (the tab closed,
 * the phone slept), and closes the settled ones whose recording never came.
 * Called from the reaper (job-runner.ts reapStaleJobs — the cron and the
 * workspace's page load) and from /app/live's own page load, BEFORE the
 * reaper's orphan write-off, which would otherwise refund a live row whole.
 */
export async function sweepLiveTakes(admin: Admin, userId: string, nowMs = Date.now()): Promise<void> {
  const { data: rows, error } = await admin
    .from("generations")
    .select(LIVE_ROW_COLUMNS)
    .eq("user_id", userId)
    .eq("model_id", LIVE_MODEL_ID)
    .eq("status", "generating")
    .limit(20)
    .returns<LiveRow[]>();
  // Before live.sql runs, selecting `live` fails: there is then no live take
  // anywhere to settle, and nothing else here depends on this read.
  if (error || !rows?.length) return;

  for (const row of rows) {
    const meter = readLiveMeter(row.live);
    const createdMs = Date.parse(row.created_at);
    if (!meter) {
      if (nowMs - createdMs > 10 * 60_000) await writeOffMeterless(admin, row);
      continue;
    }
    if (meter.settledAt === null) {
      const since = Math.max(createdMs, meter.startedAt ?? 0);
      if (!liveTakeAbandoned(since, meter.paidSeconds, nowMs)) continue;
      await settleLiveTake(admin, row, { nowMs });
      continue;
    }
    if (nowMs - meter.settledAt > LIVE_RECORDING_WAIT_MS) {
      await admin
        .from("generations")
        .update({
          status: "failed",
          progress_stage: null,
          pipeline_log: [
            liveLogStep(
              `The live take ran ${meter.usedSeconds ?? 0} s and was charged for that; its recording was never saved, so there is nothing to keep.`,
            ),
          ],
        })
        .eq("id", row.id)
        .eq("status", "generating");
    }
  }
}

/** One pipeline_log attempt holding one sentence — the AttemptLog shape History reads. */
export function liveLogStep(detail: string, compiledPrompt = "") {
  return { attempt: 1, steps: [{ step: "generate" as const, detail }], passed: true, issues: [] as string[], compiledPrompt };
}
