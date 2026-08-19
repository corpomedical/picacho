"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";

// Shown in place of a result while a generation is genuinely still rendering.
//
// This exists because the UI used to tell an outright lie. Anything without a
// result URL rendered as "No result — the pipeline couldn't produce a passing
// attempt", including videos that were happily rendering at fal and would
// arrive minutes later. Someone who has just paid credits and is told their
// generation failed does not come back to check whether it quietly succeeded
// afterwards; they assume the product is broken. Reported by Wigly on
// 2026-08-10 after watching it say exactly that about two working renders.
//
// A running counter rather than a static "please wait" is deliberate: a
// spinner with no number gives no way to tell "working" from "hung", which is
// the same ambiguity in a friendlier font. Seeing 2:14 tick to 2:15 is what
// actually tells someone the system is alive.
export function StillRendering({ startedAt }: { startedAt: string | Date }) {
  const { t } = useLocale();
  const h = t.history;
  // Milliseconds, not a Date object, so the useEffect dependency below is a
  // stable primitive — a Date constructed during render is a new identity
  // every render, which react-hooks/exhaustive-deps rightly flags.
  const startMs =
    typeof startedAt === "string" ? new Date(startedAt).getTime() : startedAt.getTime();
  // Server-rendered as 0 and computed for real only after mount. The old
  // version seeded this with Date.now() during render, which made the SSR
  // HTML and the client's first hydration render disagree by however long
  // streaming + hydration took — the recurring "Minified React error #418"
  // crash auto-reported from /app/history/[id] on 2026-08-10. A hydration
  // mismatch here is structural (time moves between server and client), so
  // the counter must not read the clock until it's client-only.
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const tick = () => setElapsed(Math.max(0, Date.now() - startMs));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startMs]);

  const totalSeconds = Math.floor(elapsed / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;

  return (
    // The Darkroom stage — the same warm charcoal in both themes, standing in
    // for the media it will become. Everything on it is a fixed Darkroom
    // literal (never a theme-mapped color): the stage doesn't flip, so its
    // ink mustn't either. That constancy is also why the old dark: variants
    // are gone rather than translated.
    <div className="mt-2 flex items-start gap-3 rounded-media bg-atelier-stage p-4">
      <span
        aria-hidden
        className="mt-0.5 h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-[#3b3323] border-t-[#e0a468]"
      />
      <div className="min-w-0">
        <p className="text-sm font-medium text-[#eae6dc]">
          {h.stillRendering}{" "}
          {/* The ticking counter IS the liveness signal — amber, serif
              tabular numerals, so the one moving thing is the lit one. */}
          <span className="font-numeral tabular-nums font-normal text-[#e0a468]">
            {mins}:{String(secs).padStart(2, "0")}
          </span>
        </p>
        <p className="mt-1 text-xs leading-relaxed text-[#a39a88]">
          {/* The reassurance that matters most is that leaving is safe. Since
              the fire-and-poll rewrite the job genuinely does survive the page
              closing, so this is a promise the system can actually keep. */}
          {formatMsg(h.stillRenderingBody, { minutes: 10 })}
        </p>
      </div>
    </div>
  );
}
