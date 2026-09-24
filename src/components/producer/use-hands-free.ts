"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Hands-free talking to the Producer (2026-09-25, operator: "add voice for
// the user to work hands free").
//
// The loop: LISTEN (the mic is open, waiting for speech) → HEARING (speech
// started) → the person stops talking for SILENCE_MS → the recording is
// handed to the sheet, which sends it (SENDING) → the reply plays sentence
// by sentence as it arrives (SPEAKING) → back to LISTEN. Tap the mic to stop;
// tap it while the Producer speaks to cut in.
//
// The mic is CLOSED while the Producer speaks, so it never hears itself and
// answers its own voice; the browser's echo cancellation isn't trusted with
// that. Nothing is recorded until the person turns talking on, and a long
// silence (IDLE_MS with no speech) pauses the loop rather than leaving an
// open microphone in a forgotten tab.
//
// Speech is detected by loudness, relative to the room: the first moments
// after the mic opens set the noise floor, and speech is anything clearly
// above it. Good enough to know when a sentence ENDS; what was SAID is the
// transcription's job, on the server.

export type VoicePhase = "off" | "listening" | "hearing" | "sending" | "speaking";
export type SpokenAudio = { data: string; mime: string; seconds: number };

const SILENCE_MS = 1300;
const IDLE_MS = 12_000;
const MAX_MS = 45_000;
const CALIBRATE_MS = 350;
const TICK_MS = 60;

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

export function useHandsFree(onUtterance: (audio: SpokenAudio) => void) {
  const [phase, setPhase] = useState<VoicePhase>("off");
  const [level, setLevel] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const activeRef = useRef(false);
  const phaseRef = useRef<VoicePhase>("off");
  const onUtteranceRef = useRef(onUtterance);
  useEffect(() => {
    onUtteranceRef.current = onUtterance;
  }, [onUtterance]);

  const mic = useRef<{
    stream: MediaStream;
    ctx: AudioContext;
    recorder: MediaRecorder;
    chunks: Blob[];
    timer: number;
    startedAt: number;
  } | null>(null);

  // Playback: pieces arrive by index and play strictly in order.
  const queue = useRef(new Map<number, string>());
  const nextIndex = useRef(0);
  const playing = useRef<HTMLAudioElement | null>(null);
  const turnDone = useRef(true);
  // playNext calls itself when a piece ends; through a ref, so the callback
  // never has to name itself before it exists.
  const playNextRef = useRef<() => void>(() => {});

  const supported =
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";

  const go = useCallback((p: VoicePhase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const closeMic = useCallback(() => {
    const m = mic.current;
    mic.current = null;
    if (!m) return;
    window.clearInterval(m.timer);
    try {
      if (m.recorder.state !== "inactive") m.recorder.stop();
    } catch {}
    m.stream.getTracks().forEach((t) => t.stop());
    void m.ctx.close().catch(() => {});
    setLevel(0);
  }, []);

  const listen = useCallback(async () => {
    if (!activeRef.current || mic.current) return;
    setNotice(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      activeRef.current = false;
      go("off");
      setNotice("The microphone isn't allowed. Allow it for Picacho and tap the mic again.");
      return;
    }
    if (!activeRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const mime = pickMime();
    const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    const openedAt = performance.now();
    let floor = 0;
    let floorSamples = 0;
    let speechAt = 0;
    let lastVoice = 0;
    let finished = false;

    const finish = (heardSpeech: boolean) => {
      if (finished) return;
      finished = true;
      const m = mic.current;
      if (!m) return;
      window.clearInterval(m.timer);
      m.recorder.onstop = async () => {
        const seconds = Math.max(1, Math.round((performance.now() - (speechAt || openedAt)) / 1000));
        const blob = new Blob(chunks, { type: recorder.mimeType || mime || "audio/webm" });
        closeMic();
        if (!heardSpeech || blob.size === 0) {
          // A long quiet: pause rather than keep an open mic.
          activeRef.current = false;
          go("off");
          setNotice("Paused. Tap the mic to talk.");
          return;
        }
        go("sending");
        try {
          onUtteranceRef.current({ data: await toBase64(blob), mime: blob.type || "audio/webm", seconds });
        } catch {
          go("off");
        }
      };
      try {
        m.recorder.stop();
      } catch {
        closeMic();
      }
    };

    const timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      const now = performance.now();
      setLevel(Math.min(1, rms * 12));
      if (now - openedAt < CALIBRATE_MS) {
        floor = (floor * floorSamples + rms) / (floorSamples + 1);
        floorSamples++;
        return;
      }
      const talking = rms > Math.max(0.018, floor * 3);
      if (talking) {
        lastVoice = now;
        if (!speechAt) {
          speechAt = now;
          go("hearing");
        }
      }
      if (speechAt && now - lastVoice > SILENCE_MS) finish(true);
      else if (!speechAt && now - openedAt > IDLE_MS) finish(false);
      else if (now - openedAt > MAX_MS) finish(Boolean(speechAt));
    }, TICK_MS);

    mic.current = { stream, ctx, recorder, chunks, timer, startedAt: openedAt };
    recorder.start(250);
    go("listening");
  }, [closeMic, go]);

  const stopPlayback = useCallback(() => {
    queue.current.clear();
    if (playing.current) {
      playing.current.pause();
      playing.current = null;
    }
  }, []);

  const playNext = useCallback(() => {
    if (playing.current) return;
    const data = queue.current.get(nextIndex.current);
    if (data === undefined) {
      // Nothing more to say: when the turn is over, listen again.
      if (turnDone.current && phaseRef.current === "speaking") {
        if (activeRef.current) void listen();
        else go("off");
      }
      return;
    }
    queue.current.delete(nextIndex.current);
    nextIndex.current++;
    const el = new Audio(`data:audio/mpeg;base64,${data}`);
    playing.current = el;
    go("speaking");
    const done = () => {
      if (playing.current === el) playing.current = null;
      playNextRef.current();
    };
    el.onended = done;
    el.onerror = done;
    void el.play().catch(done);
  }, [go, listen]);

  useEffect(() => {
    playNextRef.current = playNext;
  }, [playNext]);

  /** A new turn is being sent: reset the ordering of its spoken pieces. */
  const beginTurn = useCallback(() => {
    stopPlayback();
    nextIndex.current = 0;
    turnDone.current = false;
  }, [stopPlayback]);

  const enqueue = useCallback(
    (index: number, data: string) => {
      queue.current.set(index, data);
      playNext();
    },
    [playNext],
  );

  /** The turn finished: once everything queued has played, listen again. */
  const endTurn = useCallback(() => {
    turnDone.current = true;
    if (playing.current || queue.current.size > 0) return;
    if (phaseRef.current === "speaking" || phaseRef.current === "sending") {
      if (activeRef.current) void listen();
      else go("off");
    }
  }, [go, listen]);

  const start = useCallback(() => {
    if (!supported) {
      setNotice("This browser can't record. Try Chrome, Edge or Safari.");
      return;
    }
    activeRef.current = true;
    stopPlayback();
    void listen();
  }, [listen, stopPlayback, supported]);

  const stop = useCallback(() => {
    activeRef.current = false;
    stopPlayback();
    closeMic();
    go("off");
  }, [closeMic, go, stopPlayback]);

  /** Cut in while the Producer is speaking: silence it and listen. */
  const interrupt = useCallback(() => {
    stopPlayback();
    activeRef.current = true;
    void listen();
  }, [listen, stopPlayback]);

  useEffect(() => () => {
    activeRef.current = false;
    closeMic();
    if (playing.current) playing.current.pause();
  }, [closeMic]);

  return {
    phase,
    level,
    notice,
    supported,
    active: phase !== "off",
    start,
    stop,
    interrupt,
    beginTurn,
    enqueue,
    endTurn,
  };
}
