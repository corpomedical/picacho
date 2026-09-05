import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { reapStaleJobs } from "@/lib/generations/job-runner";

// The daily reconcile (2026-09-05, closing a round-one audit coverage edge):
// until now the stuck-job reaper ran ONLY inside page loads — /app/generate
// and, since this week, /app/history. A user whose render's webhook was
// dropped and who then churned, or who generated through the public API and
// never opens the web app, had a row stuck "generating" with credits
// reserved forever, because every recovery path assumed a future browser
// visit. This is the visit that always comes.
//
// Scope: exactly the per-user reaper the pages run (cancel at the provider,
// write off past the absolute deadline, refund where the refund rules say),
// fanned across every user who currently has a reap-eligible job. The
// reaper's own thresholds decide staleness; this route only finds the users
// nobody else is finding.
//
// Same auth as the drip cron: Vercel Cron sends Authorization: Bearer
// CRON_SECRET. Fails closed when the secret is unset.

export const runtime = "nodejs";
// The fan-out over users with stale jobs can take a while on a bad day;
// never let the platform default cut reconciliation short.
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Users with any job old enough that the reaper would look at it. The
  // hour-based prefilter is deliberately WIDER than the reaper's own
  // thresholds (30min stale / absolute deadline) — this only nominates
  // users; reapStaleJobs re-checks every job against its real rules and
  // with fal before touching anything.
  const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();
  const { data: rows, error } = await admin
    .from("generation_jobs")
    .select("user_id")
    .lt("last_polled_at", cutoff)
    .limit(200);
  if (error) {
    console.error("reconcile: stale-user query failed", error.message);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }

  const userIds = [...new Set((rows ?? []).map((r) => r.user_id as string))];
  let reaped = 0;
  let failures = 0;
  for (const userId of userIds) {
    try {
      await reapStaleJobs(userId);
      reaped += 1;
    } catch (err) {
      // One user's wedged rows must not block the rest of the sweep.
      failures += 1;
      console.error(`reconcile: reap failed for ${userId}:`, err);
    }
  }

  console.log(`reconcile: swept ${reaped} user(s), ${failures} failure(s), ${userIds.length} nominated`);
  return NextResponse.json({ users: userIds.length, reaped, failures });
}
