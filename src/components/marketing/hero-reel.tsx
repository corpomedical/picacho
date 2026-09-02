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

// The dark front page's hero backdrop (2026-09-02): the same reel, but
// filling the hero section behind the headline instead of being its own
// band — absolute, cover-fit, muted, sequencing on ended exactly as above.
// The poster paints the first frame's territory while metadata loads so
// the hero never opens on a black hole.
// `captions`/`pillLabel`: the board's bottom-right composition — a per-clip
// provenance caption ("Seedance 2.0 · 15s · real output") beside a
// "Playing: the reel" pill. The caption must ride the clip that is actually
// playing, which only this component knows, so it renders here rather than
// in the page. z-10 lifts it above the page's scrim overlays (later
// siblings in the same stacking context). Captions are truthful per clip —
// a clip whose engine we haven't pinned down gets the bare "real output"
// caption, never an invented name.
export function HeroBackdropReel({
  sources,
  poster,
  captions,
  pillLabel,
}: {
  sources: string[];
  poster?: string;
  captions?: string[];
  pillLabel?: string;
}) {
  const [index, setIndex] = useState(0);
  const ref = useRef<HTMLVideoElement | null>(null);

  return (
    <>
      <video
        ref={(el) => {
          ref.current = el;
          if (el) el.muted = true;
        }}
        key={sources[index]}
        src={sources[index]}
        poster={poster}
        autoPlay
        muted
        playsInline
        preload="metadata"
        aria-hidden
        className="absolute inset-0 h-full w-full object-cover"
        onEnded={() => setIndex((i) => (i + 1) % sources.length)}
        loop={sources.length === 1}
      />
      {captions && (
        <div className="pointer-events-none absolute bottom-8 right-4 z-10 hidden items-center gap-4 sm:bottom-10 sm:right-8 sm:flex lg:right-[max(2rem,calc((100%-72rem)/2))]">
          <span className="text-[12px] tracking-[0.02em] text-[#f7f6f4]/60">{captions[index]}</span>
          {pillLabel && (
            <span className="inline-flex items-center gap-[7px] rounded-full border border-[#f7f6f4]/[0.14] bg-[#101014]/60 px-3.5 py-[7px] text-[12px] text-[#f7f6f4]/85">
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-[11px] w-[11px]" aria-hidden>
                <path d="M8 5v14l11-7z" />
              </svg>
              {pillLabel}
            </span>
          )}
        </div>
      )}
    </>
  );
}
