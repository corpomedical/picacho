import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { notifyUser } from "@/lib/push/send";
import { advanceSetBuild } from "@/lib/sets/build-tick";
import { isPhotoSetsEnabled, isSetsEnabled } from "@/lib/sets/enabled";
import { runSetsFinisher } from "@/lib/sets/finisher";

// The Sets finisher (Astra Sets, Phase 2, 2026-09-11), every minute: a set
// build finishes with the page closed, and its owner's browser is told. The
// work — the kill switch, the flag, the owner's access, the tick, the
// notification — is lib/sets/finisher.ts, where it is tested with fakes;
// this route only authenticates and wires in the real parts.
//
// Same auth as the other crons: Vercel Cron sends Authorization: Bearer
// CRON_SECRET. Fails closed when the secret is unset — and the Sets pages
// read the same variable to say whether a build can be left to finish
// (finisherCanRun).

export const runtime = "nodejs";
// A run stops starting ticks at 180 s (FINISHER_START_BUDGET_MS) so the
// slowest tick it started still ends inside this.
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const outcome = await runSetsFinisher({
    env: process.env,
    admin: createAdminClient,
    advance: advanceSetBuild,
    notify: notifyUser,
    now: Date.now,
    setsEnabled: isSetsEnabled,
    photoSetsEnabled: isPhotoSetsEnabled,
  });
  return NextResponse.json(outcome.body, { status: outcome.status });
}
