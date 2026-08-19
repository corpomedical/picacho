"use client";

import { useRef, useState } from "react";

// Full-width homepage reel: plays each clip to the end, then the next,
// looping the whole set forever — added 2026-08-19 when the band grew from
// one clip to two. A single <video loop> can't sequence files, so this
// swaps src on `ended`. The swap is a hard cut on purpose: both clips are
// real renders of the same character, and a cut reads like an edit, not a
// glitch (a crossfade would need two stacked videos and double the memory
// for marginal polish — revisit only if a flash ever shows up in testing).
//
// muted + playsInline are required for mobile autoplay policies, and the
// `muted` prop must ALSO be set imperatively on ref — React has a long-
// standing quirk where the attribute alone doesn't always survive
// hydration, and an unmuted video silently refuses to autoplay.
export function HeroReel({ sources, badge }: { sources: string[]; badge: string }) {
  const [index, setIndex] = useState(0);
  const ref = useRef<HTMLVideoElement | null>(null);

  return (
    <section className="relative bg-slate-900">
      <video
        ref={(el) => {
          ref.current = el;
          if (el) el.muted = true;
        }}
        key={sources[index]}
        src={sources[index]}
        autoPlay
        muted
        playsInline
        preload="metadata"
        aria-hidden
        className="block max-h-[70vh] w-full object-cover"
        style={{ aspectRatio: "16 / 9" }}
        onEnded={() => setIndex((i) => (i + 1) % sources.length)}
        // Single-clip degenerate case: behave exactly like the old band.
        loop={sources.length === 1}
      />
      <span className="absolute bottom-4 left-4 rounded-full bg-slate-900/80 px-3 py-1 text-xs font-medium text-white shadow-sm sm:bottom-6 sm:left-6">
        {badge}
      </span>
    </section>
  );
}
