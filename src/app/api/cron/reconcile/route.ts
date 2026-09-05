import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { reapStaleJobs } from "@/lib/generations/job-runner";
import { persistGeneratedVideo, persistImageBytes } from "@/lib/generations/core";
import { extractVideoFrame } from "@/lib/generations/providers/fal";
import { providerDownloadUrl } from "@/lib/generations/providers/provider-url";

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

  // Community heal (2026-09-05, closing the last sliver of the expiring-link
  // finding): sharing copies a provider-hosted video into our storage first,
  // but when that copy fails at the moment of sharing the post deliberately
  // goes through with the temporary link rather than blocking the person.
  // This sweep is what makes that choice safe — every daily run re-copies
  // any post still pointing at a provider CDN, so a temporary link has a day
  // to heal instead of a week to die. Bounded and best-effort: one failed
  // post must not block the rest, and a post that cannot be copied today is
  // simply tried again tomorrow.
  let postsHealed = 0;
  try {
    const { data: staleShares } = await admin
      .from("community_posts")
      .select("id, user_id, generation_id, media_url")
      .not("media_url", "like", "/api/media/%")
      .limit(10);
    for (const post of staleShares ?? []) {
      try {
        // The generation may have been repointed to our storage since the
        // share (the history backfill, a later share) — reuse its copy
        // instead of paying for a second download.
        const { data: gen } = await admin
          .from("generations")
          .select("result_url")
          .eq("id", post.generation_id)
          .maybeSingle<{ result_url: string | null }>();
        const owned =
          gen?.result_url?.startsWith("/api/media/") === true
            ? gen.result_url
            : await persistGeneratedVideo(admin, post.user_id as string, post.media_url as string);
        if (!owned) continue;
        await admin.from("community_posts").update({ media_url: owned }).eq("id", post.id);
        if (gen?.result_url && !gen.result_url.startsWith("/api/media/")) {
          await admin.from("generations").update({ result_url: owned }).eq("id", post.generation_id);
        }
        postsHealed += 1;
      } catch (err) {
        console.warn(`reconcile: community heal failed for post ${post.id}:`, err);
      }
    }
  } catch (err) {
    console.warn("reconcile: community heal sweep failed:", err);
  }

  // Poster backfill (2026-09-05): finished videos now save a poster frame at
  // collect time, but everything rendered before today has none, and the
  // collect path's save is best-effort. Twenty-five a day at fal's
  // $0.0002/second frame price is under three cents — the whole history
  // grows stills within a couple of weeks. Newest first, because those are
  // the tiles people actually scroll past.
  let postersFilled = 0;
  try {
    const { data: bare } = await admin
      .from("generations")
      .select("id, user_id, result_url")
      .eq("content_type", "video")
      .eq("status", "succeeded")
      .is("poster_url", null)
      .order("created_at", { ascending: false })
      .limit(25);
    for (const row of bare ?? []) {
      try {
        const frameUrl = await extractVideoFrame(providerDownloadUrl(row.result_url as string));
        if (!frameUrl) continue;
        const res = await fetch(frameUrl, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) continue;
        const posterUrl = await persistImageBytes(
          admin,
          row.user_id as string,
          `${row.user_id}/posters/${row.id}.jpg`,
          new Uint8Array(await res.arrayBuffer()),
          res.headers.get("content-type") ?? "image/jpeg",
        );
        await admin.from("generations").update({ poster_url: posterUrl }).eq("id", row.id);
        postersFilled += 1;
      } catch (err) {
        console.warn(`reconcile: poster backfill failed for ${row.id}:`, err);
      }
    }
  } catch (err) {
    console.warn("reconcile: poster backfill sweep failed:", err);
  }

  console.log(`reconcile: healed ${postsHealed} community post(s), filled ${postersFilled} poster(s)`);
  return NextResponse.json({ users: userIds.length, reaped, failures, postsHealed, postersFilled });
}
