"use client";

import { useState, type SVGProps } from "react";
import { VoiceRecorderButton } from "@/components/voice-recorder-button";
import { useLocale } from "@/lib/i18n/provider";

function SendIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 19V5" />
      <path d="M6 11l6-6 6 6" />
    </svg>
  );
}

// The dashboard's landing composer — typing here and sending just hands the
// text off to the real Generate chat (as ?prompt=) rather than generating
// anything itself, since that needs a character and content-type picked.
//
// This component doesn't own the transition animation or the navigation
// itself — it just reports "the user submitted this" up to HomeHero, which
// fades the whole hero block out as one piece before navigating. See
// home-hero.tsx for why: an earlier version tried to have this box travel
// across the screen and reshape itself mid-flight, which looked like a glitch
// rather than a transition. A plain, coordinated fade is far more reliable.
export function HomeComposer({
  disabled = false,
  onSubmitPrompt,
}: {
  disabled?: boolean;
  onSubmitPrompt: (dest: string) => void;
}) {
  const { t } = useLocale();
  const d = t.dashboard;
  const [value, setValue] = useState("");

  function go() {
    if (disabled) return;
    const trimmed = value.trim();
    onSubmitPrompt(trimmed ? `/app/generate?prompt=${encodeURIComponent(trimmed)}` : "/app/generate");
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
      className="mx-auto w-full max-w-2xl rounded-control border border-atelier-rule bg-atelier-surface px-3 py-2 transition-colors focus-within:border-atelier-accent"
    >
      <div className="flex items-center gap-1.5">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              go();
            }
          }}
          placeholder={d.composerPlaceholder}
          autoFocus
          disabled={disabled}
          className="min-w-0 flex-1 border-none bg-transparent px-2.5 py-2 text-sm text-atelier-ink outline-none placeholder:text-atelier-muted/60 disabled:opacity-60"
        />
        <VoiceRecorderButton
          onTranscript={(text) => setValue((prev) => (prev ? `${prev} ${text}` : text))}
          // Honors the same disabled state as the input and send button —
          // `disabled` here means the hero is mid-fade-out on its way to
          // /app/generate, and starting a recording into a composer that's
          // about to unmount would just lose the transcript.
          disabled={disabled}
          size="md"
        />
        <button
          type="submit"
          title={d.start}
          aria-label={d.start}
          disabled={disabled}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-atelier-ink text-atelier-paper transition-opacity hover:opacity-90 disabled:opacity-70"
        >
          <SendIcon className="h-4 w-4" />
        </button>
      </div>
    </form>
  );
}
