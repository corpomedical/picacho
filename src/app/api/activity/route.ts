import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { toolForPath } from "@/lib/retention/tools";

// Heartbeat from ActivityHeartbeat, roughly once a minute while a signed-in
// user has a tab open and visible.
//
// All the time accounting is done by public.record_user_activity() inside
// the database: it credits the gap since the last beat (capped), starts a
// fresh visit after an idle period, and is scoped to auth.uid() so a caller
// can only ever update their own row.
//
// Who comes back (2026-10-03): the body may name the page the beat came
// from. Only the tool it maps to is kept (toolForPath answers null for
// anything that isn't a known /app tool), written for the signed-in person
// and today, by the server — user_tool_days has no browser write policy.
// Fails soft: before supabase/pending/who-comes-back.sql runs, nothing is
// written and the beat still counts.
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    await supabase.rpc("record_user_activity");

    const body = (await request.json().catch(() => null)) as { path?: unknown } | null;
    const tool = toolForPath(body?.path);
    if (tool) {
      const now = new Date();
      const { error } = await createAdminClient()
        .from("user_tool_days")
        .upsert(
          { user_id: userData.user.id, day: now.toISOString().slice(0, 10), tool, last_at: now.toISOString() },
          { onConflict: "user_id,day,tool" },
        );
      if (error) console.warn("activity: tool day not recorded —", error.message);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to record activity heartbeat:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
