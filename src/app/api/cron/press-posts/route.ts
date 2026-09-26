import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { readPressTourSwitches } from "@/lib/press-tour/enabled";
import { postsTick } from "@/lib/social/runtime";

// Press Tour's posts clock (2026-09-26, Cut 5; spec §2.1), every minute:
//   1. housekeeping, a few rows each: expired connect states deleted, owed
//      revokes retried (daily per row), Instagram and Threads 60-day keys
//      refreshed with 10 days left, keys sealed under an older vault key
//      re-sealed (lib/social/worker.ts housekeeping). This runs whatever the
//      switches say: a revoke we owe a person is owed either way;
//   2. up to BATCH due posts claimed through claim_scheduled_posts (oldest
//      first, FOR UPDATE SKIP LOCKED, a 6-minute lease) and each advanced as
//      far as its network lets it within the step budget: media created at
//      send time, every platform id saved as it appears, the final call never
//      sent twice (a lost answer is 'unconfirmed'), the platform's AI label
//      always on (lib/social/worker.ts processClaimed).
//
// THE KILL SWITCH is press_tour_posting (read fail-closed through
// enabled.ts: off while press_tour is off, while PRESS_TOUR_DISABLED=1, or
// while a Press Tour provider key is missing): off = no post is touched.
// A "Post now" kick drives the same worker (lib/social/runtime.ts kickPost);
// this clock carries on whatever a kick left.
//
// Same auth as the other crons: Vercel Cron sends Authorization: Bearer
// CRON_SECRET, and the route fails closed when it is unset. Crons follow
// the last READY deploy.

export const runtime = "nodejs";
export const maxDuration = 300;

const BATCH = 4;
/** Claimed posts stop starting new calls after this; the lease (6 min) outlives it. */
const BUDGET_MS = 240_000;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const switches = await readPressTourSwitches(createAdminClient());
  const report = await postsTick({ batch: BATCH, budgetMs: BUDGET_MS, posting: switches.press_tour_posting });
  if (report.claimed > 0 || (report.housekeeping && (report.housekeeping.revokes > 0 || report.housekeeping.refreshed > 0 || report.housekeeping.resealed > 0))) {
    console.info("press-posts: tick", report);
  }
  return NextResponse.json({ ok: true, posting: switches.press_tour_posting, ...report });
}
