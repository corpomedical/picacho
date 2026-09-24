"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { playableAudioUrl } from "@/lib/audio/playable-url";
import { appCannotRecord, nativeAppBuild } from "@/lib/native/app-build";

// What a refused microphone means, said for where the person actually is.
const APP_TOO_OLD =
  "Talking needs the latest Picacho app. Update it from Google Play, then tap the mic again. You can type to the Producer meanwhile.";
const APP_MIC_DENIED =
  "The microphone is off for Picacho. Turn it on in your phone's Settings → Apps → Picacho → Permissions → Microphone, then tap the mic again.";
const WEB_MIC_DENIED =
  "The microphone is blocked for this site. Allow it from the lock icon next to the address, then tap the mic again.";

// Talking to the Producer out loud, like a ChatGPT voice conversation
// (2026-09-25, operator: "add voice for the user to work hands free", then
// "must speak and interact like ChatGPT. Even if you close the conversation,
// the mic and speaker does not turn off until the user manually turns it off
// or tells it to turn off", and "the light bulb lights depending on the sound
// that is spoken or spoken to").
//
// ONE SESSION, ONE OPEN MIC. start() opens the microphone and an AudioContext
// and keeps both until stop() — closing the sheet, changing page inside the
// app, a long silence: none of them end it. Only the person does (the mic on
// the wheel, the End button, or asking the Producer, which answers with
// voice_control → endAfterPlayback).
//
// WHAT BECOMES A MESSAGE. Audio is recorded in segments on the open mic. A
// segment is only sent when it held real speech: at least MIN_VOICED_MS of
// sound clearly above the room's floor (tracked continuously while it's quiet),
// ended by SILENCE_MS of quiet. Coughs, a door, a short noise: dropped, and
// the segment restarts. A quiet room costs nothing; nothing is sent.
//
// TALKING OVER IT. While the Producer speaks, the mic keeps listening. Its own
// voice comes back through the mic as echo, so interrupting takes more: sound
// well above the echo level measured during this reply, held for BARGE_MS.
// Then the reply stops at once, the rest of that answer is dropped, and what
// the person is saying becomes the next message (onInterrupt lets the sheet
// abandon the answer still streaming).
//
// THE LIGHT. `level` (0..1) is the loudness of whoever is talking right now —
// the person while they speak, the Producer while it answers — for the bulb.

export type VoicePhase = "off" | "listening" | "hearing" | "sending" | "speaking";
export type SpokenAudio = { data: string; mime: string; seconds: number };

const TICK_MS = 50;
const SILENCE_MS = 850;
const MIN_VOICED_MS = 250;
const BARGE_MS = 350;
const MAX_SPEECH_MS = 45_000;
const SEGMENT_RESET_MS = 20_000;

function pickMime(): string {
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  if (typeof MediaRecorder === "undefined") return "";
  return options.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function rmsOf(analyser: AnalyserNode, buf: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

type Session = {
  stream: MediaStream;
  ctx: AudioContext;
  micAnalyser: AnalyserNode;
  outAnalyser: AnalyserNode;
  outBus: GainNode;
  micBuf: Float32Array<ArrayBuffer>;
  outBuf: Float32Array<ArrayBuffer>;
  timer: number;
  recorder: MediaRecorder | null;
  chunks: Blob[];
  segmentAt: number;
};

export function useHandsFree({
  onUtterance,
  onInterrupt,
}: {
  onUtterance: (audio: SpokenAudio) => void;
  onInterrupt?: () => void;
}) {
  const [phase, setPhase] = useState<VoicePhase>("off");
  const [level, setLevel] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const phaseRef = useRef<VoicePhase>("off");
  const session = useRef<Session | null>(null);
  const handlers = useRef({ onUtterance, onInterrupt });
  useEffect(() => {
    handlers.current = { onUtterance, onInterrupt };
  }, [onUtterance, onInterrupt]);

  // Playback: pieces arrive by index and play strictly in order.
  const queue = useRef(new Map<number, string>());
  const nextIndex = useRef(0);
  const playing = useRef<HTMLAudioElement | null>(null);
  const turnDone = useRef(true);
  const dropTurnAudio = useRef(false);
  const endPending = useRef(false);
  const playNextRef = useRef<() => void>(() => {});
  const stopRef = useRef<() => void>(() => {});

  const supported =
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined" &&
    typeof AudioContext !== "undefined";

  const go = useCallback((p: VoicePhase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  /** A fresh recording segment on the open mic; the previous one is dropped. */
  const newSegment = useCallback(() => {
    const s = session.current;
    if (!s) return;
    if (s.recorder && s.recorder.state !== "inactive") {
      s.recorder.ondataavailable = null;
      s.recorder.onstop = null;
      try {
        s.recorder.stop();
      } catch {}
    }
    const mime = pickMime();
    const recorder = mime ? new MediaRecorder(s.stream, { mimeType: mime }) : new MediaRecorder(s.stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    s.recorder = recorder;
    s.chunks = chunks;
    s.segmentAt = performance.now();
    recorder.start(250);
  }, []);

  /** The segment held speech: send it, and keep listening on a new one. */
  const sendSegment = useCallback(
    (speechMs: number) => {
      const s = session.current;
      if (!s?.recorder) return;
      const recorder = s.recorder;
      const chunks = s.chunks;
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (blob.size === 0) return;
        try {
          handlers.current.onUtterance({
            data: await toBase64(blob),
            mime: blob.type || "audio/webm",
            seconds: Math.max(1, Math.round(speechMs / 1000)),
          });
        } catch {
          // A recording that can't be read is dropped; the mic stays open.
        }
      };
      try {
        recorder.stop();
      } catch {}
      s.recorder = null;
      newSegment();
    },
    [newSegment],
  );

  const stopPlayback = useCallback(() => {
    queue.current.clear();
    if (playing.current) {
      playing.current.pause();
      playing.current = null;
    }
  }, []);

  const playNext = useCallback(() => {
    if (playing.current) return;
    if (dropTurnAudio.current) queue.current.clear();
    const data = queue.current.get(nextIndex.current);
    if (data === undefined) {
      if (turnDone.current && phaseRef.current === "speaking") {
        if (endPending.current) stopRef.current();
        else go(session.current ? "listening" : "off");
      }
      return;
    }
    queue.current.delete(nextIndex.current);
    nextIndex.current++;
    // A blob: URL, not data: — the site's CSP refuses data: media, which is
    // why no reply was ever heard (lib/audio/playable-url.ts).
    const source = playableAudioUrl(data);
    const el = new Audio(source.url);
    const s = session.current;
    if (s && s.ctx.state === "running") {
      // Through the session's graph, so the bulb can follow the reply's voice.
      // Only while the graph is running: a suspended one would swallow the
      // sound, and a reply heard without the light beats a light with none.
      try {
        s.ctx.createMediaElementSource(el).connect(s.outBus);
      } catch {}
    }
    playing.current = el;
    go("speaking");
    const done = () => {
      source.release();
      if (playing.current === el) playing.current = null;
      playNextRef.current();
    };
    el.onended = done;
    el.onerror = done;
    void el.play().catch(() => {
      setNotice("Tap anywhere to let the Producer's voice play.");
      done();
    });
  }, [go]);

  useEffect(() => {
    playNextRef.current = playNext;
  }, [playNext]);

  const stop = useCallback(() => {
    const s = session.current;
    session.current = null;
    endPending.current = false;
    stopPlayback();
    if (s) {
      window.clearInterval(s.timer);
      if (s.recorder && s.recorder.state !== "inactive") {
        s.recorder.onstop = null;
        try {
          s.recorder.stop();
        } catch {}
      }
      s.stream.getTracks().forEach((t) => t.stop());
      void s.ctx.close().catch(() => {});
    }
    setLevel(0);
    go("off");
  }, [go, stopPlayback]);

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
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      go("off");
      setNotice((await nativeAppBuild()) !== null ? APP_MIC_DENIED : WEB_MIC_DENIED);
      return;
    }
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
    const micAnalyser = ctx.createAnalyser();
    micAnalyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(micAnalyser);
    const outBus = ctx.createGain();
    const outAnalyser = ctx.createAnalyser();
    outAnalyser.fftSize = 1024;
    outBus.connect(outAnalyser);
    outAnalyser.connect(ctx.destination);

    const s: Session = {
      stream,
      ctx,
      micAnalyser,
      outAnalyser,
      outBus,
      micBuf: new Float32Array(micAnalyser.fftSize),
      outBuf: new Float32Array(outAnalyser.fftSize),
      timer: 0,
      recorder: null,
      chunks: [],
      segmentAt: performance.now(),
    };
    session.current = s;
    newSegment();
    go("listening");

    let floor = 0.01; // the room when nobody speaks
    let echoFloor = 0.02; // the Producer's own voice, as the mic hears it
    let voicedMs = 0;
    let speechAt = 0;
    let lastVoice = 0;
    let bargeMs = 0;
    let shown = 0;

    s.timer = window.setInterval(() => {
      if (session.current !== s) return;
      const now = performance.now();
      const mic = rmsOf(micAnalyser, s.micBuf);
      const out = rmsOf(outAnalyser, s.outBuf);
      const speaking = phaseRef.current === "speaking";

      // The light: whoever is talking.
      const target = Math.min(1, (speaking ? out * 6 : mic * 12));
      shown = shown * 0.55 + target * 0.45;
      setLevel(Math.round(shown * 100) / 100);

      if (speaking) {
        echoFloor = echoFloor * 0.95 + mic * 0.05;
        if (mic > Math.max(0.05, echoFloor * 2.4)) bargeMs += TICK_MS;
        else bargeMs = Math.max(0, bargeMs - TICK_MS);
        if (bargeMs >= BARGE_MS) {
          // Cut in: silence the reply, drop the rest of it, listen.
          bargeMs = 0;
          dropTurnAudio.current = true;
          stopPlayback();
          handlers.current.onInterrupt?.();
          newSegment();
          voicedMs = BARGE_MS;
          speechAt = now - BARGE_MS;
          lastVoice = now;
          go("hearing");
        }
        return;
      }

      const talking = mic > Math.max(0.018, floor * 3);
      if (talking) {
        voicedMs += TICK_MS;
        lastVoice = now;
        if (!speechAt) speechAt = now;
        if (voicedMs >= MIN_VOICED_MS && phaseRef.current !== "hearing") go("hearing");
      } else if (!speechAt) {
        floor = floor * 0.97 + mic * 0.03;
      }

      if (speechAt && now - lastVoice > SILENCE_MS) {
        const heard = voicedMs >= MIN_VOICED_MS;
        const speechMs = lastVoice - speechAt;
        voicedMs = 0;
        speechAt = 0;
        if (heard) {
          go("sending");
          sendSegment(speechMs);
        } else {
          // A short noise, not speech: start the segment over.
          newSegment();
          if (phaseRef.current === "hearing") go("listening");
        }
      } else if (speechAt && now - speechAt > MAX_SPEECH_MS) {
        voicedMs = 0;
        speechAt = 0;
        go("sending");
        sendSegment(MAX_SPEECH_MS);
      } else if (!speechAt && now - s.segmentAt > SEGMENT_RESET_MS) {
        // Quiet for a while: keep the recording short, not the mic closed.
        newSegment();
      }
    }, TICK_MS);
  }, [go, newSegment, sendSegment, stopPlayback, supported]);

  /** A new answer is on its way: its spoken pieces start from 0. */
  const beginTurn = useCallback(() => {
    stopPlayback();
    nextIndex.current = 0;
    turnDone.current = false;
    dropTurnAudio.current = false;
  }, [stopPlayback]);

  const enqueue = useCallback(
    (index: number, data: string) => {
      if (dropTurnAudio.current) return;
      queue.current.set(index, data);
      playNext();
    },
    [playNext],
  );

  /** The answer finished arriving: once it has all played, listen again. */
  const endTurn = useCallback(() => {
    turnDone.current = true;
    if (playing.current || queue.current.size > 0) return;
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
    notice,
    supported,
    active: phase !== "off",
    start,
    stop,
    beginTurn,
    enqueue,
    endTurn,
    endAfterPlayback,
  };
}
