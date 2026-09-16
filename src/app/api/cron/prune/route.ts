import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { pruneRateHits } from "@/lib/rate-hits";

// The daily prune (2026-09-16): the limiter's rows older than it ever
// counts (lib/rate-hits.ts), for everyone. The limiter prunes only the
// bucket it is asked about, so without this a feature a person never used
// again kept their rows for good.
//
// Same auth as the other crons: Vercel Cron sends Authorization: Bearer
// CRON_SECRET. Fails closed when the secret is unset.

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rateHits = await pruneRateHits(createAdminClient());
  if (rateHits.error) console.error("prune: rate hits stopped:", rateHits.error, { removed: rateHits.removed });
  else console.info("prune: rate hits", { removed: rateHits.removed, done: rateHits.done });
  return NextResponse.json({ rateHits }, { status: rateHits.error ? 500 : 200 });
}
