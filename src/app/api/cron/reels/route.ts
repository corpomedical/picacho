import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { buildUserReel } from "@/lib/generations/reel-build";

// The dashboard highlight reel builder (2026-09-07).
//
// Operator: "the website takes best scoring videos generated, 3 at max.
// Making a one video with 3 to 5 seconds of footage from each" — and on the
// how, "with the lowest data consumption possible and cacheable".
//
// Its own route rather than a fourth sweep inside reconcile, for two reasons.
// It is the only route that imports the ffmpeg binary, and Next.js traces
// dependencies per route, so keeping it alone means one function carries the
// ~44 MB encoder and the rest stay small. And reconcile already runs three
// sweeps against a 220s budget; adding encode work would crowd out the
// stuck-job reaper, which is the one that has money riding on it.
//
// Same auth as the other crons: Vercel Cron sends Authorization: Bearer
// CRON_SECRET. Fails closed when the secret is unset.

export const runtime = "nodejs";
// Encoding is ~2s per reel, but the sweep is many users and each one downloads
// its takes from storage first; never let the platform default cut it short.
export const maxDuration = 300;

/** How many recent takes to scan when working out who needs a reel. */
const SCAN_ROWS = 1000;
/** Users built in one run, whichever comes first with the deadline. */
const MAX_USERS_PER_RUN = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Everyone with a finished video take, most recent first. This is the only
  // population that can have a reel at all.
  const { data: recent, error } = await admin
    .from("generations")
    .select("user_id, created_at")
    .eq("status", "succeeded")
    .eq("content_type", "video")
    .is("deleted_at", null)
    .not("result_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(SCAN_ROWS);

  if (error) {
    console.error("Reel cron: could not read generations.", error.message);
    return NextResponse.json({ error: "read-failed" }, { status: 500 });
  }

  // Newest take per user, in recency order.
  const newestByUser = new Map<string, string>();
  for (const row of recent ?? []) {
    const userId = row.user_id as string | null;
    if (!userId) continue;
    if (!newestByUser.has(userId)) newestByUser.set(userId, (row.created_at as string) ?? "");
  }
  const candidates = [...newestByUser.keys()];
  if (candidates.length === 0) {
    return NextResponse.json({ candidates: 0, built: 0, unchanged: 0, skipped: 0 });
  }

  // Skip anyone whose reel is already newer than their newest take. Without
  // this the sweep would re-derive a hash for every user every hour to learn
  // nothing; with it, a quiet account costs one row read here and no work at
  // all in the builder.
  const { data: reels } = await admin
    .from("user_reels")
    .select("user_id, built_at")
    .in("user_id", candidates);

  const builtAt = new Map<string, string>();
  for (const row of reels ?? []) {
    builtAt.set(row.user_id as string, (row.built_at as string) ?? "");
  }

  const due = candidates.filter((userId) => {
    const reel = builtAt.get(userId);
    if (!reel) return true;
    return (newestByUser.get(userId) ?? "") > reel;
  });

  // 220s against the 300s ceiling, the same headroom reconcile leaves. Whoever
  // is not reached this hour is reached next hour — the list is recency
  // ordered, so it is the least-recently-active who wait.
  const deadline = Date.now() + 220_000;
  let built = 0;
  let unchanged = 0;
  let skipped = 0;
  const reasons: Record<string, number> = {};

  for (const userId of due.slice(0, MAX_USERS_PER_RUN)) {
    if (Date.now() > deadline) break;
    try {
      const result = await buildUserReel(admin, userId);
      if (result.status === "built") built += 1;
      else if (result.status === "unchanged") unchanged += 1;
      else {
        skipped += 1;
        // Bucketed rather than logged per user: "no-eligible-takes" 40 times
        // is one fact, and a cron log nobody can skim is a cron log nobody
        // reads. A deploy problem (ffmpeg-binary-missing) shows up here as a
        // count equal to the number of users, which is unmissable.
        const key = result.reason.split(":")[0];
        reasons[key] = (reasons[key] ?? 0) + 1;
      }
    } catch (err) {
      // buildUserReel is written not to throw; this is the belt to its braces,
      // so one user can never end the sweep.
      skipped += 1;
      reasons.threw = (reasons.threw ?? 0) + 1;
      console.warn("Reel cron: builder threw.", { userId, err });
    }
  }

  console.log("Reel cron done.", { candidates: candidates.length, due: due.length, built, unchanged, skipped, reasons });
  return NextResponse.json({
    candidates: candidates.length,
    due: due.length,
    built,
    unchanged,
    skipped,
    reasons,
  });
}
