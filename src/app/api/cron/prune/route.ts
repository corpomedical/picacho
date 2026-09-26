import { NextResponse } from "next/server";
import { withJobAlert } from "@/lib/push/admin-alerts";
import { createAdminClient } from "@/lib/supabase/server";
import { pruneRateHits } from "@/lib/rate-hits";
import { retryFaceGroupDeletions } from "@/lib/faces/run";

// The daily prune (2026-09-16): the limiter's rows older than it ever
// counts (lib/rate-hits.ts), for everyone. The limiter prunes only the
// bucket it is asked about, so without this a feature a person never used
// again kept their rows for good.
//
// And (2026-09-19) the face deletions BytePlus could not take when someone
// withdrew their face or deleted their account — retried every day until
// done (lib/faces/run.ts). Owed deletions of a person's face are not left to
// chance.
//
// Same auth as the other crons: Vercel Cron sends Authorization: Bearer
// CRON_SECRET. Fails closed when the secret is unset.

export const runtime = "nodejs";
export const maxDuration = 60;

async function run(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const rateHits = await pruneRateHits(admin);
  if (rateHits.error) console.error("prune: rate hits stopped:", rateHits.error, { removed: rateHits.removed });
  else console.info("prune: rate hits", { removed: rateHits.removed, done: rateHits.done });
  const faces = await retryFaceGroupDeletions(admin);
  if (faces.deleted || faces.left) console.info("prune: owed face deletions", faces);
  return NextResponse.json({ rateHits, faces }, { status: rateHits.error ? 500 : 200 });
}

// A 5xx or a throw reaches the operator's phone, damped per job (lib/push/admin-alerts.ts, 2026-09-26).
export const GET = withJobAlert("prune", run);
