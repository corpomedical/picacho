"use client";

import { useEffect, useRef, useState } from "react";
import { previewVoice } from "@/lib/voices/actions";
import { cn } from "@/lib/cn";

// Same triangle/bars paths already used in showcase-video-player.tsx — kept
// identical rather than redrawn, for visual consistency across the app.
function PlayIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M8 5v14l11-7Z" />
    </svg>
  );
}

function PauseIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

function SpinnerIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="animate-spin" {...props}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

// Generates and plays a short spoken sample for a voice_presets row — used
// in both Admin > Voices (checking a voice before/after adding it) and the
// character form's voice picker (a real user deciding which one to use).
// One in-flight/playing sample at a time per button instance; clicking
// again while playing stops it instead of starting a second overlapping
// clip.
export function VoicePreviewButton({
  voicePresetId,
  label,
  className,
}: {
  voicePresetId: string | null | undefined;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // An Audio object isn't tied to the DOM, so it doesn't stop just because
  // this button unmounts — without this cleanup, previewing a voice and then
  // navigating away (client-side, e.g. Cancel on the character form) left
  // the sample playing over whatever page came next, with no control
  // anywhere on screen to stop it.
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  function stop() {
    audioRef.current?.pause();
    audioRef.current = null;
    setState("idle");
  }

  async function handleClick() {
    if (!voicePresetId || state === "loading") return;
    if (state === "playing") {
      stop();
      return;
    }

    setState("loading");
    const result = await previewVoice(voicePresetId);
    if (!result.url) {
      setState("error");
      setTimeout(() => setState("idle"), 2500);
      return;
    }

    const audio = new Audio(result.url);
    audio.onended = () => setState("idle");
    audio.onerror = () => setState("error");
    audioRef.current = audio;
    try {
      await audio.play();
      setState("playing");
    } catch {
      setState("error");
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!voicePresetId || state === "loading"}
      aria-label={label ?? "Preview voice"}
      title={state === "error" ? "Couldn't play preview — try again" : (label ?? "Preview voice")}
      className={cn(
        "inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-neutral-200 text-neutral-600 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40",
        state === "error" && "border-red-200 text-red-500",
        className,
      )}
    >
      {state === "loading" ? (
        <SpinnerIcon className="h-3.5 w-3.5" />
      ) : state === "playing" ? (
        <PauseIcon className="h-3.5 w-3.5" />
      ) : (
        <PlayIcon className="h-3.5 w-3.5" />
      )}
    </button>
  );
}
