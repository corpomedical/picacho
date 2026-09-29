"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { commentaryPieces, type LiveVoice } from "@/lib/producer/live";
import { LiveTalk, mergeTalk, type TalkWho } from "@/lib/producer/live-talk";
import { playCue } from "./use-hands-free";
import { vlog } from "./voice-log";

// Aly's live voice in the browser (lib/producer/live.ts): a WebRTC call to
// GPT-Live, which listens and talks; what it hands over goes to her brain
// (the sheet's onDelegation → /api/producer, live: true) and the answer
// comes back as commentary it says in its own words. For everyone who has
// Aly (2026-09-29); the server counts the minutes (live-ledger.ts) from a
// heartbeat every minute, and the small talk goes into the chat
// (live-talk.ts): with the next hand-over, on a heartbeat when no answer is
// being written, and when the call ends.

export type LivePhase = "off" | "connecting" | "live" | "closing";

/** Two minutes with nobody talking closes the call: it's billed while open. */
const IDLE_MS = 120_000;
/** When the call ends, hand-overs still being answered are waited for this long before the chat is saved. */
const END_WAIT_MS = 20_000;
/** A call OpenAI accepted that never connects (a network that blocks it) gives up after this long. */
const CONNECT_MS = 15_000;

type Talk = { who: TalkWho; text: string }[];

// Read after hydration, like use-hands-free's check (a render-time read made
// the server's HTML and the browser's differ).
const noSubscribe = () => () => {};
const canCall = () => typeof RTCPeerConnection !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

export type LiveFailure = {
  /** The assistant allowance is used up (the sheet offers top-ups). */
  limit?: boolean;
  topUp?: boolean;
  /** It never started: the sheet can use her usual voice instead. */
  starting?: boolean;
};

export function useLiveVoice(opts: {
  /**
   * Her brain answers what the voice handed over: the request's words, the
   * small talk said before it that isn't in the chat yet, and the recent
   * transcript (live-talk.ts).
   */
  onDelegation: (words: string, before: Talk, context: string) => Promise<string>;
  /** It couldn't start, or the server ended it (the sheet shows why). */
  onError?: (message: string, failure: LiveFailure) => void;
  /** The call ended and its small talk was saved: the sheet can reload the chat. */
  onEnded?: () => void;
}) {
  const [phase, setPhase] = useState<LivePhase>("off");
  const [level, setLevel] = useState(0);
  // What the person is saying (or last said), and what she is saying (or last said).
  const [heard, setHeard] = useState("");
  const [said, setSaid] = useState("");
  const [talking, setTalking] = useState<"person" | "her" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cb = useRef(opts);
  useEffect(() => {
    cb.current = opts;
  });

  const peer = useRef<RTCPeerConnection | null>(null);
  const channel = useRef<RTCDataChannel | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const audioEl = useRef<HTMLAudioElement | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const raf = useRef<number | null>(null);
  const idle = useRef<number | undefined>(undefined);
  const closeWait = useRef<number | undefined>(undefined);
  const beat = useRef<number | undefined>(undefined);
  const sessionId = useRef<string | null>(null);
  const seconds = useRef<number | null>(null);
  // OpenAI said the call is over (session.closed): the server needn't hang it up.
  const ended = useRef(false);
  // It connected (session.started): until then nothing was used, so nothing is charged.
  const connected = useRef(false);
  const connectWait = useRef<number | undefined>(undefined);
  const reported = useRef(false);
  const phaseRef = useRef<LivePhase>("off");
  // The call's own clock (ms since it started), for pieces that come without one.
  const t0 = useRef(0);
  // What was said, sorted (live-talk.ts); small talk a save didn't take yet; hand-overs being answered.
  const talk = useRef(new LiveTalk());
  const backlog = useRef<Talk>([]);
  const inflight = useRef(0);
  const heardBuf = useRef("");
  const saidBuf = useRef("");
  const last = useRef<"person" | "her" | null>(null);
  const eventSeq = useRef(0);
  const quiet = useRef<number | undefined>(undefined);
  const supported = useSyncExternalStore(noSubscribe, canCall, () => false);
  // Who is talking goes back to nobody when the words stop.
  const speakerNow = useCallback((who: "person" | "her") => {
    setTalking(who);
    window.clearTimeout(quiet.current);
    quiet.current = window.setTimeout(() => setTalking(null), 1500);
  }, []);

  const go = useCallback((p: LivePhase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const post = useCallback((payload: Record<string, unknown>, keepalive = false) => {
    return fetch("/api/producer/live", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      keepalive,
    });
  }, []);

  /** Small talk into the chat; what doesn't go in stays for the next try. */
  const saveTalk = useCallback(
    async (lines: Talk, keepalive = false) => {
      const all = mergeTalk([...backlog.current, ...lines]);
      backlog.current = [];
      if (all.length === 0) return true;
      try {
        const res = await post({ action: "talk", lines: all }, keepalive);
        const body = (await res.json().catch(() => null)) as { saved?: number } | null;
        if (res.ok && (body?.saved ?? 0) > 0) return true;
      } catch {}
      backlog.current = mergeTalk([...all, ...backlog.current]).slice(-16);
      return false;
    },
    [post],
  );

  // Its seconds, for the server's count (it keeps them inside what the heartbeats prove).
  const report = useCallback(
    (keepalive: boolean) => {
      const id = sessionId.current;
      if (reported.current || !id) return;
      reported.current = true;
      const used = connected.current ? seconds.current : 0;
      void post({ action: "close", sessionId: id, seconds: used, ended: ended.current }, keepalive).catch(() => {});
    },
    [post],
  );

  const cleanup = useCallback(() => {
    window.clearTimeout(idle.current);
    window.clearTimeout(closeWait.current);
    window.clearTimeout(connectWait.current);
    window.clearTimeout(quiet.current);
    window.clearInterval(beat.current);
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    mic.current?.getTracks().forEach((t) => t.stop());
    mic.current = null;
    try {
      channel.current?.close();
    } catch {}
    channel.current = null;
    try {
      peer.current?.close();
    } catch {}
    peer.current = null;
    if (audioEl.current) {
      audioEl.current.srcObject = null;
      audioEl.current = null;
    }
    void ctx.current?.close().catch(() => {});
    ctx.current = null;
    setLevel(0);
    setTalking(null);
    const wasOn = phaseRef.current !== "off";
    report(true);
    go("off");
    if (!wasOn || !sessionId.current) return;
    sessionId.current = null;
    // The rest of the small talk, once the answers still coming have landed.
    const t = talk.current;
    const began = Date.now();
    const finish = () => {
      if (inflight.current > 0 && Date.now() - began < END_WAIT_MS) {
        window.setTimeout(finish, 400);
        return;
      }
      void saveTalk(t.flush()).finally(() => cb.current.onEnded?.());
    };
    finish();
  }, [go, report, saveTalk]);

  const send = useCallback((event: Record<string, unknown>) => {
    const c = channel.current;
    if (!c || c.readyState !== "open") return false;
    c.send(JSON.stringify({ event_id: `aly_${++eventSeq.current}`, ...event }));
    return true;
  }, []);

  const stop = useCallback(() => {
    if (phaseRef.current === "off" || phaseRef.current === "closing") return;
    vlog("live.stop");
    if (!send({ type: "session.close" })) return cleanup();
    go("closing");
    // No "session.closed" in 5 s: close it here.
    closeWait.current = window.setTimeout(cleanup, 5000);
  }, [send, cleanup, go]);

  const touch = useCallback(() => {
    window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => {
      vlog("live.idle", "two minutes with nobody talking: closed");
      stop();
    }, IDLE_MS);
  }, [stop]);

  // Every minute: the server keeps the allowance ahead of the call (or ends
  // it), and the small talk so far goes into the chat when no answer is
  // being written.
  const heartbeat = useCallback(async () => {
    const id = sessionId.current;
    if (!id || phaseRef.current === "off") return;
    try {
      const res = await post({ action: "beat", sessionId: id });
      const body = (await res.json().catch(() => null)) as { closed?: boolean; reason?: string; error?: string; topUp?: boolean } | null;
      if (body?.closed) {
        vlog("live.ended", body.reason ?? "");
        if (body.reason === "allowance") {
          const message = body.error ?? "You've used this period's assistant allowance.";
          setError(message);
          cb.current.onError?.(message, { limit: true, topUp: body.topUp === true });
        }
        // The server hung it up: session.closed follows; if not, close here.
        closeWait.current = window.setTimeout(cleanup, 5000);
        return;
      }
    } catch {}
    if (inflight.current === 0) void saveTalk(talk.current.flush(performance.now() - t0.current));
  }, [post, cleanup, saveTalk]);

  const handle = useCallback(
    (ev: { type?: string; [k: string]: unknown }) => {
      const at = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : performance.now() - t0.current);
      switch (ev.type) {
        case "session.started":
          vlog("live.started");
          connected.current = true;
          window.clearTimeout(connectWait.current);
          t0.current = performance.now();
          go("live");
          touch();
          // She's listening now: what's said before this (while connecting) isn't heard.
          playCue("ready", ctx.current);
          break;
        case "session.input_transcript.delta": {
          const d = typeof ev.delta === "string" ? ev.delta : "";
          talk.current.heard(d, at(ev.start_ms), at(ev.end_ms));
          if (last.current !== "person") heardBuf.current = "";
          last.current = "person";
          heardBuf.current += d;
          setHeard(heardBuf.current);
          speakerNow("person");
          touch();
          break;
        }
        case "session.output_transcript.delta": {
          const d = typeof ev.delta === "string" ? ev.delta : "";
          talk.current.said(d, at(ev.start_ms), at(ev.end_ms));
          if (last.current !== "her") saidBuf.current = "";
          last.current = "her";
          saidBuf.current += d;
          setSaid(saidBuf.current);
          speakerNow("her");
          touch();
          break;
        }
        case "session.delegation.created": {
          const delegation = ev.delegation as { id?: unknown } | undefined;
          const id = typeof delegation?.id === "string" ? delegation.id : null;
          if (!id) break;
          // Its words, worked out from the transcripts (the event carries none).
          const { words, before, context } = talk.current.handOver(at(ev.offset_ms));
          const earlier = mergeTalk([...backlog.current, ...before]);
          backlog.current = [];
          inflight.current++;
          const started = performance.now();
          vlog("live.handover", { words: words.split(/\s+/).filter(Boolean).length, before: earlier.length });
          const answer = (content: string) => {
            talk.current.answered(content);
            for (const piece of commentaryPieces(content)) send({ type: "session.commentary.append", delegation_id: id, content: piece });
          };
          cb.current
            .onDelegation(words, earlier, context)
            .then((text) => {
              vlog("live.answer", { ms: Math.round(performance.now() - started), chars: text.length });
              answer(text.trim() ? text : "I couldn't find anything to say to that. Ask me again another way?");
            })
            .catch(() => {
              vlog("live.answer", "the brain failed");
              answer("Sorry, I couldn't get that just now. Could you ask me again?");
            })
            .finally(() => {
              inflight.current = Math.max(0, inflight.current - 1);
            });
          break;
        }
        case "session.usage.updated": {
          const u = ev.usage as { seconds?: unknown } | undefined;
          if (typeof u?.seconds === "number") seconds.current = u.seconds;
          break;
        }
        case "session.closed": {
          const u = ev.usage as { seconds?: unknown } | undefined;
          if (typeof u?.seconds === "number") seconds.current = u.seconds;
          ended.current = true;
          vlog("live.closed", { s: seconds.current, why: typeof ev.reason === "string" ? ev.reason : null });
          cleanup();
          break;
        }
        case "error": {
          const e = (ev.error ?? ev) as { message?: unknown };
          const message = typeof e.message === "string" ? e.message : "error";
          vlog("live.error", message.slice(0, 120));
          break;
        }
      }
    },
    [go, touch, send, cleanup, speakerNow],
  );

  const start = useCallback(
    async (voice: LiveVoice) => {
      if (phaseRef.current !== "off") return;
      setError(null);
      setHeard("");
      setSaid("");
      heardBuf.current = "";
      saidBuf.current = "";
      last.current = null;
      talk.current = new LiveTalk();
      inflight.current = 0;
      seconds.current = null;
      sessionId.current = null;
      ended.current = false;
      connected.current = false;
      reported.current = false;
      t0.current = performance.now();
      go("connecting");
      vlog("live.connecting", { voice });
      try {
        const pc = new RTCPeerConnection();
        peer.current = pc;
        const el = new Audio();
        el.autoplay = true;
        audioEl.current = el;
        const ac = new AudioContext();
        ctx.current = ac;
        const outAnalyser = ac.createAnalyser();
        outAnalyser.fftSize = 512;
        pc.addEventListener("track", (e) => {
          const stream = new MediaStream([e.track]);
          el.srcObject = stream;
          void el.play().catch(() => {});
          try {
            ac.createMediaStreamSource(stream).connect(outAnalyser);
          } catch {}
        });
        const m = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        mic.current = m;
        for (const t of m.getAudioTracks()) pc.addTrack(t, m);
        const micAnalyser = ac.createAnalyser();
        micAnalyser.fftSize = 512;
        try {
          ac.createMediaStreamSource(m).connect(micAnalyser);
        } catch {}
        // The lamp's light follows whoever is talking.
        const buf = new Float32Array(512);
        const rmsOf = (a: AnalyserNode) => {
          a.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          return Math.sqrt(sum / buf.length);
        };
        let shown = 0;
        let frame = 0;
        const tick = () => {
          const target = Math.min(1, Math.max(rmsOf(outAnalyser) * 6, rmsOf(micAnalyser) * 12));
          shown = shown * 0.55 + target * 0.45;
          if (++frame % 3 === 0) setLevel(Math.round(shown * 100) / 100);
          raf.current = requestAnimationFrame(tick);
        };
        raf.current = requestAnimationFrame(tick);

        // The event channel is made before the offer (OpenAI's quickstart).
        const dc = pc.createDataChannel("oai-events");
        channel.current = dc;
        dc.addEventListener("message", ({ data }) => {
          try {
            handle(JSON.parse(String(data)));
          } catch {}
        });
        dc.addEventListener("close", () => {
          if (phaseRef.current !== "off") cleanup();
        });

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (pc.iceGatheringState !== "complete") {
          await new Promise<void>((resolve) => {
            const done = () => {
              if (pc.iceGatheringState === "complete") resolve();
            };
            pc.addEventListener("icegatheringstatechange", done);
            window.setTimeout(resolve, 5000);
          });
        }
        const sdp = pc.localDescription?.sdp;
        if (!sdp) throw new Error("no offer");
        const res = await post({ sdp, voice });
        const body = (await res.json().catch(() => null)) as { sdp?: string; sessionId?: string; beatMs?: number; error?: string; topUp?: boolean } | null;
        if (!res.ok || !body?.sdp || !body.sessionId) {
          const message = body?.error ?? "The live voice couldn't start. Try again.";
          throw Object.assign(new Error(message), { failure: res.status === 402 ? { limit: true, topUp: body?.topUp === true } : { starting: true } });
        }
        sessionId.current = body.sessionId;
        vlog("live.session", body.sessionId);
        // A page closed without a word still stops being billed: the server
        // hangs up a call whose heartbeats stop.
        const every = typeof body.beatMs === "number" && body.beatMs >= 10_000 ? body.beatMs : 60_000;
        beat.current = window.setInterval(() => void heartbeat(), every);
        await pc.setRemoteDescription({ type: "answer", sdp: body.sdp });
        // OpenAI took the call but it never connects (a network that blocks
        // it): her usual voice instead, and nothing charged.
        const failed = () => {
          if (connected.current || phaseRef.current !== "connecting") return;
          const message = "The live voice couldn't connect.";
          vlog("live.failed", "no connection");
          setError(message);
          cleanup();
          cb.current.onError?.(message, { starting: true });
        };
        connectWait.current = window.setTimeout(failed, CONNECT_MS);
        pc.addEventListener("connectionstatechange", () => {
          if (pc.connectionState === "failed") failed();
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "The live voice couldn't start. Try again.";
        const failure = ((err as { failure?: LiveFailure } | null)?.failure ?? { starting: true }) as LiveFailure;
        vlog("live.failed", message.slice(0, 120));
        setError(message);
        cleanup();
        cb.current.onError?.(message, failure);
      }
    },
    [go, handle, cleanup, post, heartbeat],
  );

  // Closing the page ends the call (and its bill), and saves what it can.
  useEffect(() => {
    const leave = () => {
      if (phaseRef.current !== "off") {
        send({ type: "session.close" });
        report(true);
        void saveTalk(talk.current.flush(), true);
      }
    };
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    phase,
    active: phase !== "off",
    level,
    heard,
    said,
    /** Who is talking right now (from the transcripts). */
    talking,
    error,
    start,
    stop,
    supported,
  };
}
