"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { playableAudioUrl } from "@/lib/audio/playable-url";
import { appCannotRecord, nativeAppBuild } from "@/lib/native/app-build";
import {
  BargeIn,
  EnergySegmenter,
  VoiceLevel,
  concat,
  encodeWav,
  rms,
  speechLevel,
  toBase64,
  toSixteenK,
} from "./voice-engine";

// What a refused microphone means, said for where the person actually is.
const APP_TOO_OLD =
  "Talking needs the latest Picacho app. Update it from Google Play, then tap the mic again. You can type meanwhile.";
const APP_MIC_DENIED =
  "The microphone is off for Picacho. Turn it on in your phone's Settings → Apps → Picacho → Permissions → Microphone, then tap the mic again.";
const WEB_MIC_DENIED =
  "The microphone is blocked for this site. Allow it from the lock icon next to the address, then tap the mic again.";
const DEVICE_ECHOES =
  "This device plays my voice back into its mic, so I may not hear you over me. Press Stop to cut me off.";

// Talking to the Producer out loud, like a ChatGPT voice conversation
// (2026-09-25, operator: "add voice for the user to work hands free", then
// "must speak and interact like ChatGPT. Even if you close the conversation,
// the mic and speaker does not turn off until the user manually turns it off
// or tells it to turn off", "the light bulb lights depending on the sound
// that is spoken or spoken to", and "I want it to work like chatgpt, like
// while she is talking and i talk she shuts up to listen. And doesnt pick up
// every voice on the background and processes it").
//
// ONE SESSION, ONE OPEN MIC. start() opens the microphone and an AudioContext
// and keeps both until stop() — closing the sheet, changing page inside the
// app, a long silence: none of them end it. Only the person does (the mic on
// the wheel, the End button, or asking the Producer, which answers with
// voice_control → endAfterPlayback).
//
// WHAT BECOMES A MESSAGE. A speech detector reads the mic every 32 ms: the
// Silero model where it loads (/vad, self-hosted), else a loudness-based
// stand-in (voice-engine.ts EnergySegmenter). It cuts out each thing said —
// only that, with 0.8 s before it (the model is slow on a word's first
// frames) — and a knock, a cough or a
// bang is dropped as a misfire. A recording is 16 kHz WAV of just the speech
// (it used to carry up to 20 s of the room before it). Each is sent with how
// loud it was against the person's own voice (learned from what the server
// accepted), and the server judges whether it was said to the Producer
// (lib/producer/gate.ts); far quieter than the person, it isn't sent at all.
//
// TALKING OVER HER. While she speaks, every frame is weighed against what she
// is playing (voice-engine.ts BargeIn): speech louder than her echo could
// explain dips her voice at once; if it holds up through the dip (her own
// echo would fall with it) for ~450 ms, she stops — paused, not dropped: the
// sheet sends what the person said, and only if the server finds it was said
// to the Producer is the rest of her answer dropped; otherwise she carries
// on. Nothing said while she talks is sent unless it stopped her. And she
// never starts a new sentence while the person is mid-sentence.
//
// THE LIGHT. `level` (0..1) is the loudness of whoever is talking right now —
// the person while they speak, the Producer while it answers — for the bulb.
// It is only measured while a mic session is open (`metered`); a reply read
// aloud with the mic off plays without a meter, so `level` stays 0 then.

export type VoicePhase = "off" | "listening" | "hearing" | "sending" | "speaking";
/** A recording as sent: WAV, how long, and how loud against the person's usual voice. */
export type SpokenAudio = { data: string; mime: string; seconds: number; level?: number; nearness?: number | null };
/** One piece of a spoken reply: the human voice's fal.media URL, or the fallback's MP3 bytes. */
export type SpokenPiece = { url: string } | { data: string };
/** How a recording came about: said over an answer that was under way. */
export type UtteranceMeta = {
  interrupting: boolean;
  /** They started while she spoke and kept talking after she went quiet (the barge-in held). */
  talkedOver?: boolean;
};

/** The longest single recording (a monologue is cut here and sent). */
const MAX_UTTERANCE_MS = 30_000;
/** Where the speech model's files are served from (public/vad). */
const VAD_BASE = "/vad/";

type Prepared = { el: HTMLAudioElement; release: () => void; crossOrigin: boolean; text: string };

/**
 * A piece becomes an audio element the moment it arrives, so it is already
 * loading while the piece before it plays — the gap between sentences is
 * then only what the browser needs to start, not a download.
 *
 * The human voice plays straight from fal.media (the CSP allows it). It is
 * requested with CORS — crossOrigin BEFORE src — because a cross-origin file
 * without it still plays through the session's graph, but SILENT: the browser
 * zeroes its samples. fal answers with access-control-allow-origin: *
 * (checked 2026-09-25). The fallback's bytes play from a blob: URL, never
 * data: (lib/audio/playable-url.ts).
 */
function prepare(piece: SpokenPiece, text: string): Prepared {
  const el = new Audio();
  el.preload = "auto";
  if ("url" in piece) {
    el.crossOrigin = "anonymous";
    el.src = piece.url;
    return { el, release: () => {}, crossOrigin: true, text };
  }
  const source = playableAudioUrl(piece.data);
  el.src = source.url;
  return { el, release: source.release, crossOrigin: false, text };
}

function discard(p: Prepared) {
  p.el.pause();
  p.el.removeAttribute("src");
  try {
    p.el.load();
  } catch {}
  p.release();
}

function rmsOf(analyser: AnalyserNode, buf: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

// ---------------------------------------------------------------------------
// The detector: Silero when its files load, else the loudness stand-in. Both
// report the same four things.

type DetectorEvents = {
  frame: (p: number, frame: Float32Array) => void;
  start: () => void;
  misfire: () => void;
  end: (audio: Float32Array) => void;
};
type Detector = { kind: "silero" | "basic"; stop: () => void; cut: () => void };

type VadGlobal = {
  MicVAD: {
    new: (opts: Record<string, unknown>) => Promise<{
      start: () => void;
      pause: () => Promise<void> | void;
      destroy: () => void;
    }>;
  };
};

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-vad="${src}"]`);
    if (existing) {
      if ((existing as HTMLScriptElement).dataset.loaded === "1") resolve();
      else {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error(`couldn't load ${src}`)), { once: true });
      }
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.dataset.vad = src;
    s.onload = () => {
      s.dataset.loaded = "1";
      resolve();
    };
    s.onerror = () => {
      // Gone, so the next start loads it afresh rather than waiting on it.
      s.remove();
      reject(new Error(`couldn't load ${src}`));
    };
    document.head.appendChild(s);
  });
}

async function sileroDetector(ctx: AudioContext, stream: MediaStream, on: DetectorEvents): Promise<Detector> {
  // Self-hosted (public/vad): the onnxruntime WASM build, then vad-web's
  // browser bundle; both register globals. Loaded only when voice starts.
  await loadScript(`${VAD_BASE}ort.wasm.min.js`);
  await loadScript(`${VAD_BASE}bundle.min.js`);
  const w = window as unknown as { ort?: { env: { wasm: Record<string, unknown> } }; vad?: VadGlobal };
  if (!w.ort || !w.vad) throw new Error("speech model didn't load");
  w.ort.env.wasm.wasmPaths = VAD_BASE;
  // One thread: several need a cross-origin-isolated page, which this isn't.
  w.ort.env.wasm.numThreads = 1;
  let speaking = false;
  const vad = await w.vad.MicVAD.new({
    model: "v5",
    baseAssetPath: VAD_BASE,
    onnxWASMBasePath: VAD_BASE,
    audioContext: ctx,
    getStream: async () => stream,
    // The session owns the microphone: pausing the model must not stop it.
    pauseStream: async () => {},
    resumeStream: async () => stream,
    positiveSpeechThreshold: 0.5,
    negativeSpeechThreshold: 0.35,
    minSpeechMs: 250,
    // The model is slow on a word's first frames: keep 0.8 s from before it
    // was sure, so "Wait, make it…" doesn't lose "Wait".
    preSpeechPadMs: 800,
    redemptionMs: 700,
    submitUserSpeechOnPause: true,
    onFrameProcessed: (probs: { isSpeech: number }, frame: Float32Array) => on.frame(probs.isSpeech, frame),
    onSpeechStart: () => {
      speaking = true;
      on.start();
    },
    onVADMisfire: () => {
      speaking = false;
      on.misfire();
    },
    onSpeechEnd: (audio: Float32Array) => {
      speaking = false;
      on.end(audio);
    },
    ortConfig: (ort: { env: { logLevel: string } }) => {
      ort.env.logLevel = "error";
    },
  });
  vad.start();
  return {
    kind: "silero",
    stop: () => {
      try {
        vad.destroy();
      } catch {}
    },
    // A monologue at the cap: pausing submits what was said so far.
    cut: () => {
      if (!speaking) return;
      // Pausing submits what was said so far; it must finish before the
      // model starts again, or it is left deaf.
      void Promise.resolve(vad.pause()).then(() => vad.start());
    },
  };
}

function basicDetector(ctx: AudioContext, stream: MediaStream, on: DetectorEvents): Detector {
  const source = ctx.createMediaStreamSource(stream);
  // A ScriptProcessor: deprecated, but everywhere and CSP-free; the frames
  // are resampled to 16 kHz and cut into the model's 512-sample slices.
  const node = ctx.createScriptProcessor(1024, 1, 1);
  const seg = new EnergySegmenter({ padFrames: 25, redemptionFrames: 22, minSpeechFrames: 8, maxFrames: 30 * 31 });
  let pending: Float32Array = new Float32Array(0);
  let forceCut = false;
  node.onaudioprocess = (e) => {
    const input = toSixteenK(e.inputBuffer.getChannelData(0).slice(), ctx.sampleRate);
    pending = concat([pending, input]);
    while (pending.length >= 512) {
      const frame = pending.slice(0, 512);
      pending = pending.slice(512);
      const mic = rms(frame);
      const r = seg.push(frame, forceCut ? 0 : mic);
      on.frame(r.p, frame);
      if (r.event?.kind === "start") on.start();
      else if (r.event?.kind === "misfire") on.misfire();
      else if (r.event?.kind === "end") {
        forceCut = false;
        on.end(r.event.audio);
      }
    }
  };
  // It must be connected to run; a muted gain keeps it silent.
  const sink = ctx.createGain();
  sink.gain.value = 0;
  source.connect(node);
  node.connect(sink);
  sink.connect(ctx.destination);
  return {
    kind: "basic",
    stop: () => {
      node.onaudioprocess = null;
      try {
        source.disconnect();
        node.disconnect();
        sink.disconnect();
      } catch {}
    },
    cut: () => {
      forceCut = true;
    },
  };
}

type Session = {
  stream: MediaStream;
  ctx: AudioContext;
  outAnalyser: AnalyserNode;
  outBus: GainNode;
  outBuf: Float32Array<ArrayBuffer>;
  detector: Detector | null;
};

export function useHandsFree({
  onUtterance,
  onInterrupt,
}: {
  onUtterance: (audio: SpokenAudio, meta: UtteranceMeta) => void;
  /** Deprecated: the sheet decides what an interruption drops (see `held`). */
  onInterrupt?: () => void;
}) {
  const [phase, setPhase] = useState<VoicePhase>("off");
  const [level, setLevel] = useState(0);
  const [metered, setMetered] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [held, setHeld] = useState(false);
  const [engine, setEngine] = useState<"silero" | "basic" | null>(null);
  // How much of her own voice the mic hears while she speaks (the learned
  // leak), about once a second while she is audible — an admin's readout.
  const [echo, setEcho] = useState<{ leak: number; strict: boolean; dips: number; stops: number } | null>(null);
  const dipCount = useRef(0);
  const stopCount = useRef(0);
  const phaseRef = useRef<VoicePhase>("off");
  const session = useRef<Session | null>(null);
  const handlers = useRef({ onUtterance, onInterrupt });
  useEffect(() => {
    handlers.current = { onUtterance, onInterrupt };
  }, [onUtterance, onInterrupt]);

  // Playback: pieces arrive by index and play strictly in order.
  const queue = useRef(new Map<number, Prepared>());
  const nextIndex = useRef(0);
  const playing = useRef<Prepared | null>(null);
  const heldRef = useRef(false);
  const turnDone = useRef(true);
  const dropTurnAudio = useRef(false);
  const endPending = useRef(false);
  const saidAloud = useRef<string[]>([]);
  const playNextRef = useRef<() => void>(() => {});
  const stopRef = useRef<() => void>(() => {});

  // The ears' state, across frames.
  const barge = useRef(new BargeIn());
  const voiceLevel = useRef(new VoiceLevel());
  const userTalking = useRef(false);
  const startedDuringReply = useRef(false);
  const bargeConfirmed = useRef(false);
  const speechStartedAt = useRef(0);
  const heldAt = useRef(0);
  const replyEndedAt = useRef(0);
  const shown = useRef(0);
  const frameCount = useRef(0);

  const supported =
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof AudioContext !== "undefined";

  const go = useCallback((p: VoicePhase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const setHold = useCallback((v: boolean) => {
    heldRef.current = v;
    setHeld(v);
  }, []);

  const setDuck = useCallback((to: number, seconds: number) => {
    const s = session.current;
    if (!s) return;
    try {
      s.outBus.gain.setTargetAtTime(to, s.ctx.currentTime, seconds);
    } catch {}
  }, []);

  const clearQueue = useCallback(() => {
    queue.current.forEach(discard);
    queue.current.clear();
  }, []);

  const stopPlayback = useCallback(() => {
    clearQueue();
    if (playing.current) {
      playing.current.el.pause();
      playing.current.release();
      playing.current = null;
    }
  }, [clearQueue]);

  /** She is audibly replying right now (a piece playing, not paused). */
  const replyingAudibly = () => playing.current !== null && !heldRef.current;
  /** An answer is under way: arriving, queued, playing or paused. */
  const replyUnderway = () => !turnDone.current || playing.current !== null || queue.current.size > 0 || heldRef.current;

  const playNext = useCallback(() => {
    if (playing.current || heldRef.current) return;
    // Never start her next sentence while the person is mid-sentence: what
    // they're saying will either stop her or turn out to be nothing.
    if (userTalking.current && !startedDuringReply.current) return;
    if (dropTurnAudio.current) clearQueue();
    const piece = queue.current.get(nextIndex.current);
    if (piece === undefined) {
      if (turnDone.current && phaseRef.current === "speaking") {
        if (endPending.current) stopRef.current();
        else go(session.current ? "listening" : "off");
      }
      return;
    }
    queue.current.delete(nextIndex.current);
    nextIndex.current++;
    const el = piece.el;
    const s = session.current;
    if (s && s.ctx.state === "running") {
      // Through the session's graph: the bulb follows her voice, her voice
      // can dip when someone talks over her, and desktop Chrome's echo
      // canceller hears all of it (it takes everything Chrome plays).
      try {
        s.ctx.createMediaElementSource(el).connect(s.outBus);
      } catch {}
    }
    playing.current = piece;
    if (piece.text) saidAloud.current.push(piece.text);
    go("speaking");
    let settled = false;
    let fallback: Prepared | null = null;
    const done = () => {
      if (settled) return;
      settled = true;
      piece.release();
      if (playing.current === piece || (fallback && playing.current === fallback)) playing.current = null;
      if (queue.current.size === 0) replyEndedAt.current = performance.now();
      playNextRef.current();
    };
    el.onended = done;
    el.onerror = () => {
      // The CORS request failed (fal changed its headers, a proxy stripped
      // them): the same file once more as a plain element outside the graph —
      // heard without the light rather than not heard.
      if (piece.crossOrigin && !settled) {
        const plain = new Audio(el.src);
        fallback = { ...piece, el: plain };
        playing.current = fallback;
        plain.onended = done;
        plain.onerror = done;
        void plain.play().catch(done);
        return;
      }
      done();
    };
    void el.play().catch((err: unknown) => {
      // A load failure is el.onerror's to handle; only a refused play (no
      // user gesture yet) asks for a tap.
      if ((err as { name?: string } | null)?.name === "NotAllowedError") {
        setNotice("Tap anywhere to let the reply play.");
        done();
      }
    });
  }, [go, clearQueue]);

  useEffect(() => {
    playNextRef.current = playNext;
  }, [playNext]);

  /** She stops mid-answer and listens (the rest stays queued: see resume / dropReply). */
  const hold = useCallback(() => {
    if (heldRef.current) return;
    playing.current?.el.pause();
    setHold(true);
    setDuck(1, 0.02);
    go("hearing");
  }, [go, setDuck, setHold]);

  /** It wasn't for her after all: she picks up where she stopped. */
  const resume = useCallback(() => {
    bargeConfirmed.current = false;
    setDuck(1, 0.06);
    if (!heldRef.current) {
      // Nothing was paused for it — but her next sentence may have waited
      // while they talked: it plays now. Else back to listening, unless an
      // answer is still coming.
      playNextRef.current();
      if ((phaseRef.current === "sending" || phaseRef.current === "hearing") && !replyUnderway()) {
        go(session.current ? "listening" : "off");
      }
      return;
    }
    setHold(false);
    if (playing.current) {
      go("speaking");
      void playing.current.el.play().catch(() => playNextRef.current());
    } else {
      playNextRef.current();
      if (!playing.current && phaseRef.current === "hearing") go(session.current ? "listening" : "off");
    }
  }, [go, setDuck, setHold]);

  /** The rest of this answer is dropped (the person moved on). */
  const dropReply = useCallback(() => {
    bargeConfirmed.current = false;
    dropTurnAudio.current = true;
    stopPlayback();
    setHold(false);
    setDuck(1, 0.02);
    if (phaseRef.current === "speaking") go(session.current ? "listening" : "off");
  }, [go, setDuck, setHold, stopPlayback]);

  /** What she had said aloud of the current answer before it stopped. */
  const heardText = useCallback(() => saidAloud.current.join(" ").trim(), []);

  /** The server took a recording as said to the Producer: its level is the person's voice. */
  const markAccepted = useCallback((level: number | undefined) => {
    if (typeof level === "number") voiceLevel.current.accept(level);
  }, []);

  const stop = useCallback(() => {
    const s = session.current;
    session.current = null;
    endPending.current = false;
    stopPlayback();
    setHold(false);
    userTalking.current = false;
    bargeConfirmed.current = false;
    if (s) {
      s.detector?.stop();
      s.stream.getTracks().forEach((t) => t.stop());
      void s.ctx.close().catch(() => {});
    }
    setLevel(0);
    setMetered(false);
    setEngine(null);
    go("off");
  }, [go, setHold, stopPlayback]);

  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  const start = useCallback(async () => {
    if (session.current) return;
    if (!supported) {
      setNotice("This browser can't record. Try Chrome, Edge or Safari.");
      return;
    }
    setNotice(null);
    // An Android app from before build 20 has no microphone to ask for:
    // Android refuses without a dialog and there is no switch to turn on.
    // Say what is true — update the app — instead of "allow it".
    if (await appCannotRecord()) {
      go("off");
      setNotice(APP_TOO_OLD);
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: { ideal: 1 },
          // Where the device can isolate the voice in front of it (some
          // ChromeOS, Apple's voice isolation), ask for it; ignored elsewhere.
          ...({ voiceIsolation: true } as Record<string, boolean>),
        },
      });
    } catch {
      go("off");
      setNotice((await nativeAppBuild()) !== null ? APP_MIC_DENIED : WEB_MIC_DENIED);
      return;
    }
    // After the mic (Android gives later output the voice-call path, which
    // its echo canceller hears).
    const ctx = new AudioContext();
    if (ctx.state === "suspended") {
      await ctx.resume().catch(() => {});
      if (ctx.state === "suspended") {
        // Coming back after a reload: the browser wants one tap first.
        setNotice("Tap anywhere to keep talking.");
        const wake = () => {
          void ctx.resume();
          setNotice(null);
        };
        window.addEventListener("pointerdown", wake, { once: true });
      }
    }
    const outBus = ctx.createGain();
    const outAnalyser = ctx.createAnalyser();
    outAnalyser.fftSize = 512;
    outBus.connect(outAnalyser);
    outAnalyser.connect(ctx.destination);

    const s: Session = { stream, ctx, outAnalyser, outBus, outBuf: new Float32Array(outAnalyser.fftSize), detector: null };
    session.current = s;
    barge.current.reset();
    setMetered(true);
    go("listening");

    let debug: Record<string, unknown>[] | null = null;
    try {
      if (window.localStorage.getItem("picacho.producer.voiceDebug") === "1") {
        debug = [];
        (window as unknown as { __voiceDebug?: unknown }).__voiceDebug = debug;
      }
    } catch {}
    const events: DetectorEvents = {
      frame: (p, frame) => {
        if (session.current !== s) return;
        const now = performance.now();
        const mic = rms(frame);
        const out = rmsOf(outAnalyser, s.outBuf);
        const action = barge.current.step({ p, mic, out, now }, replyingAudibly());
        // Diagnostics, off unless asked for (localStorage picacho.producer.voiceDebug = 1).
        if (debug && debug.push({ t: Math.round(now), p: Math.round(p * 100) / 100, mic: Math.round(mic * 1000) / 1000, out: Math.round(out * 1000) / 1000, replying: replyingAudibly(), action, leak: Math.round(barge.current.leak * 1000) / 1000 }) > 3000) debug.shift();
        if (action === "duck") dipCount.current++;
        if (action === "confirm") stopCount.current++;
        if (replyingAudibly() && frameCount.current % 30 === 0) {
          setEcho({ leak: barge.current.leak, strict: barge.current.strict, dips: dipCount.current, stops: stopCount.current });
        }
        if (action === "duck") setDuck(0, 0.01);
        else if (action === "unduck") setDuck(1, 0.08);
        else if (action === "confirm") {
          // They are talking over her: she stops and listens. What they say
          // is sent when they finish; the sheet then keeps or drops the rest.
          bargeConfirmed.current = true;
          hold();
          heldAt.current = now;
        }
        // Held, but the speech never became something said (a noise the
        // model didn't take for speech): she carries on.
        if (heldRef.current && bargeConfirmed.current && !userTalking.current && now - heldAt.current > 2000) {
          resume();
        }
        if (barge.current.strict) setNotice((n) => n ?? DEVICE_ECHOES);
        // A monologue (or a TV that never pauses) is cut at the cap.
        if (userTalking.current && now - speechStartedAt.current > MAX_UTTERANCE_MS) s.detector?.cut();
        // The light: whoever is talking, ~10 times a second.
        const target = Math.min(1, replyingAudibly() ? out * 6 : mic * 12);
        shown.current = shown.current * 0.55 + target * 0.45;
        if (++frameCount.current % 3 === 0) setLevel(Math.round(shown.current * 100) / 100);
      },
      start: () => {
        if (session.current !== s) return;
        userTalking.current = true;
        speechStartedAt.current = performance.now();
        startedDuringReply.current = replyingAudibly();
        if (!startedDuringReply.current && phaseRef.current === "listening") go("hearing");
      },
      misfire: () => {
        if (session.current !== s) return;
        userTalking.current = false;
        if (phaseRef.current === "hearing" && !heldRef.current) go(replyUnderway() ? "sending" : "listening");
        playNextRef.current();
      },
      end: (audio) => {
        if (session.current !== s) return;
        userTalking.current = false;
        const interrupting = bargeConfirmed.current;
        // Said while she was talking and it didn't stop her: her own voice,
        // or the room. Not sent — unless she finished just after they
        // started (they answered as she ended): that is a message.
        if (startedDuringReply.current && !interrupting) {
          const answeredAsSheEnded =
            !replyingAudibly() &&
            replyEndedAt.current >= speechStartedAt.current - 50 &&
            replyEndedAt.current - speechStartedAt.current < 700;
          if (!answeredAsSheEnded) {
            playNextRef.current();
            return;
          }
        }
        const lvl = speechLevel(audio);
        if (voiceLevel.current.isFarAway(lvl)) {
          // Far quieter than the person ever is at this device: not them.
          if (interrupting) resume();
          else {
            if (phaseRef.current === "hearing") go(replyUnderway() ? "sending" : "listening");
            playNextRef.current();
          }
          return;
        }
        bargeConfirmed.current = false;
        if (!heldRef.current) go("sending");
        const wav = encodeWav(audio);
        handlers.current.onUtterance(
          {
            data: toBase64(wav),
            mime: "audio/wav",
            seconds: Math.max(1, Math.round(audio.length / 16000)),
            level: lvl,
            nearness: voiceLevel.current.nearness(lvl),
          },
          { interrupting: interrupting || replyUnderway(), talkedOver: interrupting },
        );
      },
    };

    // Listening starts at once with the loudness-based ears; the speech model
    // (a 12 MB download the first time) takes over when it has loaded and
    // nobody is mid-sentence. A failed or slow load leaves the first ones
    // listening — never a deaf session.
    let active: Detector["kind"] = "basic";
    const only = (kind: Detector["kind"]): DetectorEvents => ({
      frame: (p, f) => active === kind && events.frame(p, f),
      start: () => active === kind && events.start(),
      misfire: () => active === kind && events.misfire(),
      end: (a) => active === kind && events.end(a),
    });
    s.detector = basicDetector(ctx, stream, only("basic"));
    setEngine("basic");
    const loading = sileroDetector(ctx, stream, only("silero"));
    const timeout = new Promise<null>((r) => window.setTimeout(() => r(null), 25_000));
    void Promise.race([loading, timeout])
      .then(async (silero) => {
        if (!silero) {
          // Too slow: let it finish in the background, then drop it.
          void loading.then((late) => late.stop()).catch(() => {});
          return;
        }
        for (let i = 0; i < 50 && userTalking.current && session.current === s; i++) {
          await new Promise((r) => window.setTimeout(r, 200));
        }
        if (session.current !== s) {
          silero.stop();
          return;
        }
        const basic = s.detector;
        active = "silero";
        s.detector = silero;
        basic?.stop();
        setEngine("silero");
      })
      .catch(() => {});
  }, [go, hold, resume, setDuck, supported]);

  /** A new answer is on its way: its spoken pieces start from 0. */
  const beginTurn = useCallback(() => {
    stopPlayback();
    setHold(false);
    setDuck(1, 0.02);
    bargeConfirmed.current = false;
    saidAloud.current = [];
    nextIndex.current = 0;
    turnDone.current = false;
    dropTurnAudio.current = false;
  }, [setDuck, setHold, stopPlayback]);

  const enqueue = useCallback(
    (index: number, piece: SpokenPiece, text = "") => {
      if (dropTurnAudio.current) return;
      const old = queue.current.get(index);
      if (old) discard(old);
      queue.current.set(index, prepare(piece, text));
      playNext();
    },
    [playNext],
  );

  /** The answer finished arriving: once it has all played, listen again. */
  const endTurn = useCallback(() => {
    turnDone.current = true;
    if (playing.current || queue.current.size > 0 || heldRef.current) return;
    if (endPending.current) {
      stop();
      return;
    }
    if (phaseRef.current === "speaking" || phaseRef.current === "sending") go(session.current ? "listening" : "off");
  }, [go, stop]);

  /** "End the conversation": finish saying goodbye, then close mic and speaker. */
  const endAfterPlayback = useCallback(() => {
    endPending.current = true;
    if (!playing.current && queue.current.size === 0 && turnDone.current) stop();
  }, [stop]);

  useEffect(() => () => stopRef.current(), []);

  return {
    phase,
    level,
    metered,
    notice,
    supported,
    active: phase !== "off",
    /** She stopped mid-answer because the person talked over her. */
    held,
    /** Which ears are listening: the speech model, or the loudness fallback. */
    engine,
    /** Her voice as the mic hears it while she speaks, and how often talking over her dipped or stopped her. */
    echo,
    start,
    stop,
    beginTurn,
    enqueue,
    endTurn,
    endAfterPlayback,
    resume,
    dropReply,
    heardText,
    markAccepted,
  };
}
