import { NextResponse } from "next/server";
import { withJobAlert } from "@/lib/push/admin-alerts";
import { createAdminClient } from "@/lib/supabase/server";
import { sweepLiveCalls } from "@/lib/producer/live-ledger";

// Aly's live calls whose page went quiet (2026-09-29, lib/producer/live-ledger.ts),
// every minute: a call with no heartbeat for two and a half minutes (a
// closed laptop, a crashed tab, a page that stopped reporting) is hung up at
// OpenAI, which bills it while it's open, and charged up to a minute past
// its last heartbeat. So is one that ran two hours.
//
// Same auth as the other crons: Vercel Cron sends Authorization: Bearer
// CRON_SECRET, and the route fails closed when it is unset.

export const runtime = "nodejs";
export const maxDuration = 60;

async function run(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  // Without a key nothing can be hung up at OpenAI, but the ledger still closes.
  const ended = await sweepLiveCalls(admin, { key: process.env.OPENAI_API_KEY ?? "" });
  return NextResponse.json({ ok: true, ended });
}

// A 5xx or a throw reaches the operator's phone, damped per job (lib/push/admin-alerts.ts).
export const GET = withJobAlert("producer-live", run);
