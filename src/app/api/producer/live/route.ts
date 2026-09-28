import { NextResponse, type NextRequest } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isProducerEnabled, producerAllowed, PRODUCER_UNAVAILABLE } from "@/lib/producer/enabled";
import { loadMessages, loadPersonality, loadPrefs, openThread } from "@/lib/producer/store";
import { recentLines } from "@/lib/producer/history";
import { createLiveSession, liveCostUsd, liveInstructions, liveSeed, parseLiveVoice } from "@/lib/producer/live";
import { rateLimited } from "@/lib/rate-limit";

// Aly's live voice (lib/producer/live.ts): the browser's WebRTC offer in, a
// GPT-Live session out. ADMINS ONLY while it is tried (2026-09-29, operator:
// "Lets do it" to an admin test first). What the voice hands to her brain
// goes to /api/producer like a typed message (live: true) and is metered
// there as always; the voice's own minutes are recorded when it ends
// ({ action: "close" }). Trusting the sheet's second count is fine for
// admins; before it opens to anyone else, the minutes must be read server
// side (GPT-Live's sideband connection).

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!(await isProducerEnabled(supabase))) return NextResponse.json({ error: PRODUCER_UNAVAILABLE }, { status: 403 });

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("plan, plan_status, role, status").eq("id", user.id).maybeSingle();
  const isAdmin = profile?.role === "admin";
  const access = producerAllowed(profile ? { ...profile, producer_access: false } : profile, isAdmin);
  if (!isAdmin || access.error) {
    return NextResponse.json({ error: "The live voice is being tried by the team first." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { sdp?: unknown; voice?: unknown; action?: unknown; sessionId?: unknown; seconds?: unknown } | null;

  // The session ended: its minutes go on the ledger (cost only while admins try it).
  if (body?.action === "close") {
    const seconds = Math.min(4 * 3600, Math.max(0, Math.round(Number(body.seconds) || 0)));
    if (seconds > 0) {
      const cost = liveCostUsd(seconds);
      const { error } = await admin.from("agent_usage").insert({
        user_id: user.id,
        mode: "producer-live",
        units: Math.max(1, Math.ceil(cost / 0.02)),
        cost_usd: Number(cost.toFixed(6)),
      });
      if (error) console.error("producer-live: usage not recorded", error.message);
    }
    return NextResponse.json({ ok: true });
  }

  if (typeof body?.sdp !== "string" || !body.sdp.trim() || body.sdp.length > 20_000) {
    return NextResponse.json({ error: "That connection offer didn't arrive whole." }, { status: 400 });
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key) return NextResponse.json({ error: "Voice isn't set up on this server yet." }, { status: 503 });
  if (await rateLimited(user.id, "producer-live", 60, 6)) {
    return NextResponse.json({ error: "Slow down a moment." }, { status: 429 });
  }

  try {
    // Who she is, how she talks, and the conversation so far.
    const [prefs, personality, thread] = await Promise.all([
      loadPrefs(admin, user.id),
      loadPersonality(admin, user.id),
      openThread(admin, user.id),
    ]);
    const rows = await loadMessages(admin, thread.id).catch(() => []);
    const session = await createLiveSession({
      sdp: body.sdp,
      voice: parseLiveVoice(body.voice),
      instructions: liveInstructions({ name: prefs.name, personality }),
      input: liveSeed(recentLines(rows, 10)),
      key,
    });
    return NextResponse.json({ sessionId: session.id, sdp: session.sdp }, { status: 201 });
  } catch (err) {
    console.error("producer-live: couldn't start", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "The live voice couldn't start. Try again." }, { status: 502 });
  }
}
