import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { advanceEdit } from "@/lib/editor/advance";
import { isEditorEnabled } from "@/lib/editor/enabled";

// The video editor's clock (2026-09-24), every minute: each edit still
// working gets one tick (lib/editor/advance.ts) — a clip analysed, one
// director turn, the bundle sent, or the render checked. Oldest first, one
// at a time, and no new edit is started after START_BUDGET_MS so the last
// tick's heavy step (a director turn is capped at 230 s) still ends inside
// maxDuration.
//
// Same auth as the other crons: Vercel Cron sends Authorization: Bearer
// CRON_SECRET, and the route fails closed when it is unset.

export const runtime = "nodejs";
export const maxDuration = 300;

const START_BUDGET_MS = 25_000;
const BATCH = 10;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  if (!(await isEditorEnabled(admin))) return NextResponse.json({ ok: true, skipped: "off" });

  const { data, error } = await admin
    .from("video_edits")
    .select("id")
    .in("stage", ["analyzing", "directing", "bundling", "rendering"])
    .order("updated_at", { ascending: true })
    .limit(BATCH);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const started = Date.now();
  const outcomes: Record<string, string> = {};
  for (const { id } of data ?? []) {
    if (Date.now() - started > START_BUDGET_MS) break;
    // Each edit's own heavy-step budget counts from when IT starts, so a
    // later edit may still begin one heavy step inside this run's budget.
    outcomes[id] = await advanceEdit(id, { admin, heavyStartBudgetMs: Math.max(0, START_BUDGET_MS - (Date.now() - started)) }).catch(
      (err: unknown) => `error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return NextResponse.json({ ok: true, outcomes });
}
