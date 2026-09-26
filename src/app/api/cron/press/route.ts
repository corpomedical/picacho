import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { isPressTourEnabled } from "@/lib/press-tour/enabled";
import { pressTick } from "@/lib/press-tour/campaign-machine";
import { machineDeps } from "@/lib/press-tour/campaign-runtime";

// Press Tour's clock (2026-09-26, Cut 2; spec §1.12, synthesis #19), every
// minute: campaigns that waited 7 days on the person close, drafts whose
// planning died fail, a campaign stuck 45 minutes in one working stage
// tells Admin once, an ad whose cut we owed for a day closes with its
// filming refunded by the ordinary rules (Cut 4: cut.ts lateCuts, counted as
// `late`), and then up to BATCH campaigns are claimed through
// claim_press_campaigns (oldest first, FOR UPDATE SKIP LOCKED, a 6-minute
// lease) and each gets ONE step: one still painted and checked, or one
// move of the stage machine (lib/press-tour/campaign-machine.ts). The steps
// run side by side; one still is well inside maxDuration.
//
// The kill switch is Press Tour's own: the press_tour switch off (or
// PRESS_TOUR_DISABLED=1, or a provider key missing) and nothing is touched.
// A kick after a person's press drives the same machine (campaign-
// runtime.ts); this clock carries on whatever a kick left.
//
// Same auth as the other crons: Vercel Cron sends Authorization: Bearer
// CRON_SECRET, and the route fails closed when it is unset. Crons follow
// the last READY deploy.

export const runtime = "nodejs";
export const maxDuration = 300;

const BATCH = 4;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  if (!(await isPressTourEnabled(admin))) return NextResponse.json({ ok: true, skipped: "off" });

  const report = await pressTick(machineDeps(), { batch: BATCH });
  if (report.expired || report.stale || report.overdue || report.late || Object.keys(report.stepped).length > 0) {
    console.info("press: tick", report);
  }
  return NextResponse.json({ ok: true, ...report });
}
