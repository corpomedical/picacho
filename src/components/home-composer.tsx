"use client";

import { useState, type SVGProps } from "react";
import { useRouter } from "next/navigation";
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
export function HomeComposer() {
  const router = useRouter();
  const { t } = useLocale();
  const d = t.dashboard;
  const [value, setValue] = useState("");

  function go() {
    const trimmed = value.trim();
    router.push(trimmed ? `/app/generate?prompt=${encodeURIComponent(trimmed)}` : "/app/generate");
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
      className="mx-auto w-full max-w-2xl rounded-[24px] border border-neutral-200 bg-white px-3 py-2 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_16px_40px_-16px_rgba(0,0,0,0.12)] transition-colors focus-within:border-neutral-300"
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
          className="min-w-0 flex-1 border-none bg-transparent px-2.5 py-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
        />
        <VoiceRecorderButton
          onTranscript={(text) => setValue((prev) => (prev ? `${prev} ${text}` : text))}
          size="md"
        />
        <button
          type="submit"
          title={d.start}
          aria-label={d.start}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white transition-colors hover:bg-neutral-800"
        >
          <SendIcon className="h-4 w-4" />
        </button>
      </div>
    </form>
  );
}
