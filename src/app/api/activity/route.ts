import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Heartbeat from ActivityHeartbeat, roughly once a minute while a signed-in
// user has a tab open and visible.
//
// All the accounting is done by public.record_user_activity() inside the
// database: it credits the gap since the last beat (capped), starts a fresh
// visit after an idle period, and is scoped to auth.uid() so a caller can
// only ever update their own row. Nothing here is trusted from the client —
// the request carries no body at all.
export async function POST() {
  try {
    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    await supabase.rpc("record_user_activity");
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to record activity heartbeat:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
