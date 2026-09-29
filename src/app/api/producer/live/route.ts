import { NextResponse, type NextRequest } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import {
  isProducerEnabled,
  isProducerLiveEnabled,
  isProducerOpenToElite,
  producerAllowed,
  producerUnitCap,
  readProducerGrant,
  PRODUCER_UNAVAILABLE,
} from "@/lib/producer/enabled";
import { appendMessages, loadMessages, loadPersonality, loadPrefs, openThread } from "@/lib/producer/store";
import { answerPending, recentLines } from "@/lib/producer/history";
import { createLiveSession, liveInstructions, liveSeed, parseLiveVoice } from "@/lib/producer/live";
import {
  beatLiveCall,
  closeLiveCall,
  hangUpLiveCall,
  isLiveSessionId,
  LIVE_BEAT_MS,
  LIVE_BLOCK_UNITS,
  openLiveCall,
  releaseReservation,
  sweepLiveCalls,
} from "@/lib/producer/live-ledger";
import { parseTalk, talkMessages } from "@/lib/producer/live-talk";
import { reserveAssistantUnits } from "@/lib/agent/allowance";
import { monthlyWindowStart } from "@/lib/generations/core";
import { isNativeApp } from "@/lib/native/server";
import type { PlanId } from "@/lib/plans";
import { rateLimited } from "@/lib/rate-limit";

// Aly's live voice (lib/producer/live.ts) for everyone who has Aly
// (2026-09-29, operator: "Every Aly user, after 3 fixes"; admins-only the
// day before). One route, four things:
//
//   { sdp, voice }             starts a call: the browser's WebRTC offer in,
//                              a GPT-Live session out, five minutes of the
//                              allowance held (live-ledger.ts).
//   { action: "beat" }         every minute while it's open: the server keeps
//                              the allowance ahead of it, or hangs it up.
//   { action: "close" }        it ended: charged what it used, once.
//   { action: "talk", lines }  her small talk goes into the chat
//                              (live-talk.ts) when no answer is being written.
//
// What the voice hands to her brain goes to /api/producer (live: true) and
// is metered there like any turn of hers.

export const maxDuration = 30;

const ALLOWANCE_USED = "You've used this period's assistant allowance.";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!(await isProducerEnabled(supabase))) return NextResponse.json({ error: PRODUCER_UNAVAILABLE }, { status: 403 });

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("plan, plan_status, role, status, current_period_start")
    .eq("id", user.id)
    .maybeSingle<{ plan: PlanId | null; plan_status: string | null; role: string | null; status: string | null; current_period_start: string | null }>();
  // Who has Aly: the brain route's own rule.
  const isAdmin = profile?.role === "admin";
  const granted = !isAdmin && profile ? await readProducerGrant(admin, user.id) : false;
  const access = producerAllowed(
    profile ? { ...profile, producer_access: granted } : profile,
    isAdmin || granted || (await isProducerOpenToElite(supabase)),
  );
  if (access.error) return NextResponse.json({ error: access.error }, { status: 403 });

  const body = (await request.json().catch(() => null)) as {
    sdp?: unknown;
    voice?: unknown;
    action?: unknown;
    sessionId?: unknown;
    seconds?: unknown;
    ended?: unknown;
    lines?: unknown;
  } | null;
  const key = process.env.OPENAI_API_KEY;
  const sessionId = isLiveSessionId(body?.sessionId) ? body.sessionId : null;

  // ---- Still open: the allowance kept ahead of it --------------------------
  if (body?.action === "beat") {
    if (!sessionId) return NextResponse.json({ error: "Which call?" }, { status: 400 });
    const beat = await beatLiveCall(admin, { id: sessionId, userId: user.id });
    if (beat.ok) return NextResponse.json({ ok: true });
    if (beat.reason === "error") return NextResponse.json({ ok: false }, { status: 503 });
    // Out of allowance (or already ended here): hung up and charged.
    if (key) await hangUpLiveCall(sessionId, key);
    await closeLiveCall(admin, { id: sessionId, userId: user.id, reported: null, reason: beat.reason });
    if (beat.reason === "allowance") {
      return NextResponse.json({ closed: true, reason: "allowance", error: ALLOWANCE_USED, topUp: !(await isNativeApp()) });
    }
    return NextResponse.json({ closed: true, reason: "gone" });
  }

  // ---- It ended: charged once, and ended at OpenAI too ---------------------
  if (body?.action === "close") {
    if (!sessionId) return NextResponse.json({ ok: true });
    const seconds = typeof body.seconds === "number" && Number.isFinite(body.seconds) ? body.seconds : null;
    const charged = await closeLiveCall(admin, { id: sessionId, userId: user.id, reported: seconds, reason: "ended" });
    // Still open on our side and the page didn't see OpenAI end it (it closed
    // on a timeout, or the page went away): hung up there too. Not one already
    // ended — hanging up a finished call waited out the whole 5 s (tested
    // 2026-09-29) — nor one the server had already hung up and charged.
    if (charged && key && body.ended !== true) await hangUpLiveCall(sessionId, key);
    return NextResponse.json({ ok: true, ...(charged ? { seconds: charged.seconds, units: charged.units } : {}) });
  }

  // ---- Her small talk, into the chat ----------------------------------------
  if (body?.action === "talk") {
    const lines = parseTalk(body.lines);
    if (lines.length === 0) return NextResponse.json({ saved: 0 });
    if (await rateLimited(user.id, "producer-live-talk", 60, 20)) return NextResponse.json({ saved: 0, busy: true }, { status: 429 });
    try {
      const thread = await openThread(admin, user.id);
      for (let attempt = 0; attempt < 2; attempt++) {
        const rows = await loadMessages(admin, thread.id);
        // An answer being written (or a turn that never finished, which the
        // next one repairs first): its turn is still adding to the chat.
        if (answerPending(rows)) return NextResponse.json({ saved: 0, busy: true });
        const fromSeq = rows.length > 0 ? rows[rows.length - 1].seq + 1 : 0;
        const r = await appendMessages(admin, { threadId: thread.id, userId: user.id, fromSeq, messages: talkMessages(lines) });
        if (r.ok) return NextResponse.json({ saved: lines.length });
        if (!r.busy) break;
      }
      return NextResponse.json({ saved: 0, busy: true });
    } catch (err) {
      console.error("producer-live: talk not saved", err instanceof Error ? err.message : err);
      return NextResponse.json({ saved: 0 }, { status: 503 });
    }
  }

  // ---- A new call -------------------------------------------------------------
  if (!(await isProducerLiveEnabled(supabase))) {
    return NextResponse.json({ error: "The live voice is switched off for the moment." }, { status: 403 });
  }
  if (typeof body?.sdp !== "string" || !body.sdp.trim() || body.sdp.length > 20_000) {
    return NextResponse.json({ error: "That connection offer didn't arrive whole." }, { status: 400 });
  }
  if (!key) return NextResponse.json({ error: "Voice isn't set up on this server yet." }, { status: 503 });
  if (await rateLimited(user.id, "producer-live", 60, 6)) {
    return NextResponse.json({ error: "Slow down a moment." }, { status: 429 });
  }

  // One call at a time: one still open elsewhere (another tab, a reload) is
  // hung up and charged first, so the allowance below counts it.
  await sweepLiveCalls(admin, { key, userId: user.id, others: true }).catch(() => 0);

  // Five minutes of the allowance held before OpenAI is asked (and charged).
  const cap = producerUnitCap(access, profile?.plan ?? "none");
  const since = monthlyWindowStart(profile?.current_period_start).toISOString();
  const held = await reserveAssistantUnits(admin, { userId: user.id, since, cap, units: LIVE_BLOCK_UNITS });
  if (!held.ok) {
    console.error("producer-live: budget check failed", held.error);
    return NextResponse.json({ error: "Your assistant is unavailable right now." }, { status: 503 });
  }
  if (!held.id) {
    return NextResponse.json({ error: ALLOWANCE_USED, topUp: !(await isNativeApp()) }, { status: 402 });
  }
  const reservationId = held.id;

  let session: { id: string; sdp: string };
  try {
    // Who she is, how she talks, and the conversation so far.
    const [prefs, personality, thread] = await Promise.all([
      loadPrefs(admin, user.id),
      loadPersonality(admin, user.id),
      openThread(admin, user.id),
    ]);
    const rows = await loadMessages(admin, thread.id).catch(() => []);
    session = await createLiveSession({
      sdp: body.sdp,
      voice: parseLiveVoice(body.voice),
      instructions: liveInstructions({ name: prefs.name, personality }),
      input: liveSeed(recentLines(rows, 10)),
      key,
    });
  } catch (err) {
    await releaseReservation(admin, reservationId);
    console.error("producer-live: couldn't start", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "The live voice couldn't start. Try again." }, { status: 502 });
  }

  // On the ledger before the browser gets the answer. Not recorded (the table
  // isn't there yet): nothing may run uncounted, so the call is hung up.
  const opened = await openLiveCall(admin, { id: session.id, userId: user.id, since, cap, reservationId });
  if (!opened.ok) {
    console.error("producer-live: call not recorded", opened.error);
    await hangUpLiveCall(session.id, key);
    await releaseReservation(admin, reservationId);
    return NextResponse.json({ error: "The live voice isn't set up yet." }, { status: 503 });
  }
  return NextResponse.json({ sessionId: session.id, sdp: session.sdp, beatMs: LIVE_BEAT_MS }, { status: 201 });
}
