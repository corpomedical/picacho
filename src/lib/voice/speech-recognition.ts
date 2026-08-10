// Thin wrapper around the browser's native Web Speech API
// (SpeechRecognition / webkitSpeechRecognition) for LIVE, real-time
// speech-to-text — no server round-trip, no OPENAI_API_KEY, no
// real_ai_providers flag, and text appears on screen while the person is
// still mid-sentence. This is deliberately a separate pipeline from
// voice-recorder-button.tsx's record-then-transcribe-via-Whisper flow: that
// one can only ever hand back a finished transcript after the person stops
// talking, which can't produce live captions no matter how it's tuned —
// see the "type in realtime" request that led to this file.
//
// Browser support: Chrome, Edge, and Safari implement this (Safari behind
// the same webkit- prefix Chrome originally shipped). Firefox has no
// implementation at all as of this writing — isSpeechRecognitionSupported()
// lets callers detect that and show a clear message instead of a dead mic.
//
// None of this is in TypeScript's bundled dom.d.ts (the Web Speech API
// still isn't a finalized W3C standard), so the shapes below are hand-typed
// against what Chrome/Safari actually send — intentionally minimal, only
// the fields this app reads.

type SpeechRecognitionResultLike = {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: { readonly transcript: string };
};

type SpeechRecognitionResultListLike = {
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike;
};

type SpeechRecognitionEventLike = Event & {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
};

type SpeechRecognitionErrorEventLike = Event & {
  readonly error: string;
};

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return getRecognitionCtor() !== null;
}

export type VoiceSessionHandlers = {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  // "not-supported" — this browser has no SpeechRecognition at all.
  // "not-allowed" — mic permission denied/blocked.
  // "other" — any other transient error (dropped connection, etc).
  onError: (kind: "not-supported" | "not-allowed" | "other") => void;
  onEnd: () => void;
};

// Starts one listening pass and returns a handle to stop it. `continuous`
// keeps it running across natural pauses in speech, but browsers still end
// the session on their own after a period of true silence — callers that
// want a persistent "session" (see startVoiceSession in generate-form.tsx)
// are expected to call this again from onEnd if they still want to be
// listening, using their own flag to tell an intentional stop() apart from
// the browser's own timeout.
export function startListening(handlers: VoiceSessionHandlers): { stop: () => void } | null {
  const Ctor = getRecognitionCtor();
  if (!Ctor) {
    handlers.onError("not-supported");
    return null;
  }

  const recognition = new Ctor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US";

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result[0]?.transcript ?? "";
      if (result.isFinal) {
        const trimmed = transcript.trim();
        if (trimmed) handlers.onFinal(trimmed);
      } else {
        interim += transcript;
      }
    }
    if (interim.trim()) handlers.onInterim(interim.trim());
  };

  recognition.onerror = (event) => {
    // "no-speech" (nothing heard yet) and "aborted" (we called stop()
    // ourselves) fire constantly during totally normal use — not real
    // errors, surfacing them would just be noise.
    if (event.error === "no-speech" || event.error === "aborted") return;
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      handlers.onError("not-allowed");
      return;
    }
    handlers.onError("other");
  };

  recognition.onend = handlers.onEnd;

  try {
    recognition.start();
  } catch {
    // start() throws if called on an already-started instance — shouldn't
    // happen given how this is used, but fail safe rather than crash.
    handlers.onError("other");
    return null;
  }

  return {
    stop: () => {
      recognition.onend = null; // caller is stopping on purpose — no restart-on-end
      recognition.stop();
    },
  };
}
