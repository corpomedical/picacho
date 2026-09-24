import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { heartbeatAllowed, LIVE_MODEL_ID, LIVE_OPEN_TIMEOUT_MS, liveOpeningInFlight, readLiveMeter, readRelayCall, type LiveMeter } from "@/lib/live/live";
import { isLiveEnabled } from "@/lib/live/enabled";

// THE RELAY (2026-09-24). fal's realtime client (@fal-ai/client, pinned) is
// pointed here with `proxyUrl: /api/live/relay?take=<id>`; it sends every
// call it would have made to fal as a POST to this URL, with the real target
// in `x-fal-target-url`. Those calls carry our FAL_KEY, so this route is the
// only place that key meets a browser's request — and it forwards exactly
// three calls (lib/live/live.ts readRelayCall), for ONE app, for a take the
// person signed in has already paid for:
//
//   /ice                 while the take is open;
//   /session             once per take — the moment fal's session opens,
//                        stamped on the row, is when the meter starts;
//   /session/heartbeat   only for that take's own session, and only while
//                        the lease it buys ends inside the paid length.
//                        Refusing it is how a take is held to what was paid:
//                        fal's client drops the lease after three refusals.
//                        (That fal's RUNNER stops when the lease lapses is
//                        not documented; the first paid take measures it.)
//
// CSRF: fal's client always sends the custom x-fal-target-url header, which
// forces a CORS preflight no other origin passes; without it nothing is
// forwarded.
//
// Everything else — another app, another host, the client's fallback that
// runs the model endpoint directly, a take that is settled or not theirs —
// answers 403/409/410 and reaches nothing.

export const maxDuration = 120;

const WMA_TIMEOUT_MS = LIVE_OPEN_TIMEOUT_MS;
const BODY_MAX_BYTES = 64 * 1024;

function refuse(status: number, detail: string) {
  return NextResponse.json({ detail }, { status });
}

export async function POST(request: Request) {
  const takeId = new URL(request.url).searchParams.get("take") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(takeId)) return refuse(400, "No take.");

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return refuse(401, "Signed out.");
  if (!(await isLiveEnabled(supabase))) return refuse(403, "Live is switched off.");

  const raw = await request.text();
  if (raw.length > BODY_MAX_BYTES) return refuse(413, "Too large.");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return refuse(400, "Not JSON.");
  }
  const target = request.headers.get("x-fal-target-url");
  const call = readRelayCall(target, request.method, body);
  if (!call || !target) return refuse(403, "Not a call this relay makes.");

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("generations")
    .select("id, status, live")
    .eq("id", takeId)
    .eq("user_id", auth.user.id)
    .eq("model_id", LIVE_MODEL_ID)
    .maybeSingle<{ id: string; status: string; live: unknown }>();
  const meter = readLiveMeter(row?.live);
  if (!row || !meter) return refuse(404, "No such take.");
  if (row.status !== "generating" || meter.settledAt !== null) return refuse(410, "This take has ended.");

  const now = Date.now();
  // Every write below is conditional on the take still being unsettled, so a
  // late call can never overwrite the settlement (lib/live/store.ts).
  const writeMeter = async (next: LiveMeter, extra?: (q: ReturnType<typeof updateQuery>) => ReturnType<typeof updateQuery>) => {
    let q = updateQuery(next);
    if (extra) q = extra(q);
    const { data } = await q.select("id");
    return (data?.length ?? 0) > 0;
  };
  const updateQuery = (next: LiveMeter) =>
    admin.from("generations").update({ live: next }).eq("id", takeId).eq("status", "generating").is("live->>settledAt", null);

  if (call.kind === "session") {
    // One session per take. Claimed BEFORE forwarding, so two offers racing
    // cannot both open (and both bill) a session.
    if (meter.sessionId !== null) return refuse(409, "This take already has its session.");
    if (liveOpeningInFlight(meter.openingAt, now)) {
      return refuse(409, "This take is already opening.");
    }
    const claimed = await writeMeter({ ...meter, openingAt: now }, (q) =>
      meter.openingAt === null ? q.is("live->>openingAt", null) : q.eq("live->>openingAt", String(meter.openingAt)),
    );
    if (!claimed) return refuse(409, "This take is already opening.");

    const answer = await forward(target, raw);
    if (!answer.ok) {
      // fal said no: nothing opened, so the person may try again on the same
      // take, and it refunds whole. A timeout is NOT a no — fal may still be
      // opening (and billing) a session — so the stamp stays, and a take
      // settled now is charged fal's minimum (liveUsedSeconds).
      if (answer.reached) await writeMeter({ ...meter, openingAt: null });
      return answer.response;
    }
    let sessionId: string | null = null;
    try {
      const parsed = JSON.parse(answer.text) as { session_id?: unknown };
      sessionId = typeof parsed.session_id === "string" ? parsed.session_id : null;
    } catch {
      sessionId = null;
    }
    if (!sessionId) {
      console.error("[live] fal answered /session without a session id", takeId);
      return refuse(502, "fal answered without a session.");
    }
    const opened = Date.now();
    const stamped = await writeMeter({ ...meter, openingAt: now, sessionId, startedAt: opened, lastBeatAt: opened });
    if (!stamped) {
      // Settled while fal was still opening (Stop, the tab closed, the
      // sweep): it was charged fal's minimum for exactly this case, and the
      // answer goes no further — without it the browser cannot connect, so
      // nothing streams on a take that has already been settled.
      return refuse(410, "This take has ended.");
    }
    return answer.response;
  }

  if (call.kind === "heartbeat") {
    if (meter.sessionId === null || meter.startedAt === null || call.sessionId !== meter.sessionId) {
      return refuse(403, "Not this take's session.");
    }
    if (!heartbeatAllowed(meter.startedAt, meter.paidSeconds, now)) return refuse(410, "The paid length is spent.");
    const answer = await forward(target, raw);
    if (answer.ok) await writeMeter({ ...meter, lastBeatAt: now });
    return answer.response;
  }

  // /ice: TURN credentials for this app, while the take is open.
  return (await forward(target, raw)).response;
}

async function forward(target: string, body: string): Promise<{ ok: boolean; reached: boolean; text: string; response: Response }> {
  const key = process.env.FAL_KEY;
  if (!key) return { ok: false, reached: true, text: "", response: refuse(503, "Live is switched off.") };
  try {
    const res = await fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Key ${key}` },
      body,
      signal: AbortSignal.timeout(WMA_TIMEOUT_MS),
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) console.warn("[live] fal refused", new URL(target).pathname, res.status, text.slice(0, 300));
    return {
      ok: res.ok,
      reached: true,
      text,
      response: new Response(text, {
        status: res.status,
        headers: { "content-type": res.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
      }),
    };
  } catch (err) {
    console.error("[live] relay could not reach fal:", err instanceof Error ? err.message : err);
    return { ok: false, reached: false, text: "", response: refuse(504, "fal did not answer.") };
  }
}
