"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { commentaryPieces, type LiveVoice } from "@/lib/producer/live";
import { vlog } from "./voice-log";

// Aly's live voice in the browser (lib/producer/live.ts): a WebRTC call to
// GPT-Live, which listens and talks; what it hands over goes to her brain
// (the sheet's onDelegation → /api/producer, live: true) and the answer
// comes back as commentary it says in its own words. Admins only while it's
// tried (the sheet's switch in Settings, and api/producer/live refuses others).

export type LivePhase = "off" | "connecting" | "live" | "closing";

/** Two minutes with nobody talking closes the session: it's billed while open. */
const IDLE_MS = 120_000;

// Read after hydration, like use-hands-free's check (a render-time read made
// the server's HTML and the browser's differ).
const noSubscribe = () => () => {};
const canCall = () => typeof RTCPeerConnection !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

export function useLiveVoice(opts: {
  /** Her brain answers what the voice handed over: the person's words since the last hand-over. */
  onDelegation: (words: string) => Promise<string>;
  /** It couldn't start (the sheet shows why). */
  onError?: (message: string) => void;
}) {
  const [phase, setPhase] = useState<LivePhase>("off");
  const [level, setLevel] = useState(0);
  // What the person is saying (or last said), and what she is saying (or last said).
  const [heard, setHeard] = useState("");
  const [said, setSaid] = useState("");
  const [talking, setTalking] = useState<"person" | "her" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onDelegationRef = useRef(opts.onDelegation);
  const onErrorRef = useRef(opts.onError);
  useEffect(() => {
    onDelegationRef.current = opts.onDelegation;
    onErrorRef.current = opts.onError;
  }, [opts.onDelegation, opts.onError]);

  const peer = useRef<RTCPeerConnection | null>(null);
  const channel = useRef<RTCDataChannel | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const audioEl = useRef<HTMLAudioElement | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const raf = useRef<number | null>(null);
  const idle = useRef<number | undefined>(undefined);
  const closeWait = useRef<number | undefined>(undefined);
  const seconds = useRef(0);
  const reported = useRef(false);
  const phaseRef = useRef<LivePhase>("off");
  // Transcript state: the words of the turn under way, and what the brain hasn't been handed yet.
  const heardBuf = useRef("");
  const saidBuf = useRef("");
  const last = useRef<"person" | "her" | null>(null);
  const pendingWords = useRef<string[]>([]);
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

  const report = useCallback(() => {
    if (reported.current || seconds.current <= 0) return;
    reported.current = true;
    // Its minutes on the ledger (admins only while it's tried).
    void fetch("/api/producer/live", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "close", seconds: seconds.current }),
      keepalive: true,
    }).catch(() => {});
  }, []);

  const cleanup = useCallback(() => {
    window.clearTimeout(idle.current);
    window.clearTimeout(closeWait.current);
    window.clearTimeout(quiet.current);
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
    report();
    go("off");
  }, [go, report]);

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

  const handle = useCallback(
    (ev: { type?: string; [k: string]: unknown }) => {
      switch (ev.type) {
        case "session.started":
          vlog("live.started");
          go("live");
          touch();
          break;
        case "session.input_transcript.delta": {
          const d = typeof ev.delta === "string" ? ev.delta : "";
          if (last.current !== "person") {
            heardBuf.current = "";
            pendingWords.current.push("");
          }
          last.current = "person";
          heardBuf.current += d;
          pendingWords.current[pendingWords.current.length - 1] += d;
          setHeard(heardBuf.current);
          speakerNow("person");
          touch();
          break;
        }
        case "session.output_transcript.delta": {
          const d = typeof ev.delta === "string" ? ev.delta : "";
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
          // What they said since the last hand-over (the voice's own event carries no words).
          const words = pendingWords.current.map((w) => w.trim()).filter(Boolean).join(" … ").slice(-1500) || heardBuf.current.trim();
          pendingWords.current = [];
          const t0 = performance.now();
          vlog("live.handover", { words: words.split(/\s+/).filter(Boolean).length });
          onDelegationRef
            .current(words)
            .then((answer) => {
              const pieces = commentaryPieces(answer);
              vlog("live.answer", { ms: Math.round(performance.now() - t0), chars: answer.length });
              if (pieces.length === 0) {
                send({ type: "session.commentary.append", delegation_id: id, content: "I couldn't find anything to say to that. Ask me again another way?" });
                return;
              }
              for (const content of pieces) send({ type: "session.commentary.append", delegation_id: id, content });
            })
            .catch(() => {
              vlog("live.answer", "the brain failed");
              send({ type: "session.commentary.append", delegation_id: id, content: "Sorry, I couldn't get that just now. Could you ask me again?" });
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
          vlog("live.closed", { s: seconds.current, why: typeof ev.reason === "string" ? ev.reason : null });
          cleanup();
          break;
        }
        case "error": {
          const message = typeof ev.message === "string" ? ev.message : "error";
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
      pendingWords.current = [];
      seconds.current = 0;
      reported.current = false;
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
        const res = await fetch("/api/producer/live", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sdp, voice }),
        });
        const body = (await res.json().catch(() => null)) as { sdp?: string; sessionId?: string; error?: string } | null;
        if (!res.ok || !body?.sdp) throw new Error(body?.error ?? "The live voice couldn't start. Try again.");
        vlog("live.session", body.sessionId ?? "");
        await pc.setRemoteDescription({ type: "answer", sdp: body.sdp });
      } catch (err) {
        const message = err instanceof Error ? err.message : "The live voice couldn't start. Try again.";
        vlog("live.failed", message.slice(0, 120));
        setError(message);
        onErrorRef.current?.(message);
        cleanup();
      }
    },
    [go, handle, cleanup],
  );

  // Closing the page ends the call (and its bill).
  useEffect(() => {
    const leave = () => {
      if (phaseRef.current !== "off") {
        send({ type: "session.close" });
        report();
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
