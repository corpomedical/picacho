"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

// The dashboard highlight reel (2026-09-07).
//
// Operator: "the website takes best scoring videos generated, 3 at max.
// Making a one video with 3 to 5 seconds of footage from each" — and on the
// how, "with the lowest data consumption possible and cacheable".
//
// The whole point of this component is restraint about bytes. Three rules, in
// the order they matter:
//
//   1. The POSTER is server-rendered as a plain <img>. First paint costs about
//      25 KB and no JavaScript at all, so the band is never a black rectangle
//      and never a layout shift.
//   2. The VIDEO is not referenced until an effect decides it is welcome. It
//      is not a <video> with a poster attribute — that would let the browser
//      start fetching before we have asked whether it should. The <video>
//      element does not exist in the DOM until the gate passes.
//   3. It plays ONCE. The file is ~322 KB and immutable-cached for a year, so
//      looping costs no further data — but it does cost battery and decode on
//      the app's most-opened screen, forever. A Replay control gives that back
//      to anyone who wants it.
//
// The gate mirrors HeroBackdropReel's: navigator.connection.saveData and
// prefers-reduced-motion both keep it on the poster.

type ReelBandProps = {
  posterUrl: string | null;
  videoUrl: string;
  characterName: string | null;
  /** Take count for the character the reel is about, for the caption. */
  takes: number | null;
  meanIdentity: number | null;
  /** Where the band sends you — the composer, pointed at this character. */
  href: string;
  labels: {
    /** e.g. "Your reel" */
    title: string;
    replay: string;
  };
};

export function ReelBand({
  posterUrl,
  videoUrl,
  characterName,
  takes,
  meanIdentity,
  href,
  labels,
}: ReelBandProps) {
  // Starts false so the server and the first client render agree on the
  // poster; only an effect can promote it to video.
  const [videoWelcome, setVideoWelcome] = useState(false);
  const [finished, setFinished] = useState(false);
  const [replayKey, setReplayKey] = useState(0);
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection;
    if (connection?.saveData) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    setVideoWelcome(true);
  }, []);

  const caption =
    takes && meanIdentity
      ? `${takes} takes · ${meanIdentity} mean identity`
      : takes
        ? `${takes} takes`
        : null;

  return (
    <section className="relative overflow-hidden rounded-card bg-atelier-ink/95">
      {/* aspect-video reserves the box before anything loads, so the poster,
          the video and the empty state all occupy exactly the same space and
          nothing below the band ever jumps. */}
      <div className="relative aspect-video w-full">
        {videoWelcome ? (
          <video
            key={replayKey}
            ref={(el) => {
              ref.current = el;
              // The muted ATTRIBUTE alone does not reliably survive
              // hydration, and an unmuted video silently refuses to autoplay —
              // the same quirk hero-reel.tsx works around.
              if (el) el.muted = true;
            }}
            src={videoUrl}
            poster={posterUrl ?? undefined}
            autoPlay
            muted
            playsInline
            // The file is small and we intend to play it immediately; metadata
            // -only would just cost a second round trip.
            preload="auto"
            aria-hidden
            className="h-full w-full object-cover"
            onEnded={() => setFinished(true)}
          />
        ) : posterUrl ? (
          // A plain <img>, deliberately: no loader, no srcset, no JS — one
          // request for a file the edge already has.
          <img src={posterUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full bg-atelier-ink" />
        )}

        {/* Legibility for the text below, not decoration. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-atelier-ink via-atelier-ink/25 to-transparent"
        />

        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4 sm:p-5">
          <div className="min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-atelier-paper/70">
              {labels.title}
            </p>
            {characterName && (
              <p className="truncate font-numeral text-2xl font-semibold tracking-tight text-atelier-paper sm:text-3xl">
                {characterName}
              </p>
            )}
            {caption && (
              <p className="mt-0.5 truncate text-[11px] tabular-nums text-atelier-paper/65">
                {caption}
              </p>
            )}
          </div>

          <div className="flex flex-none items-center gap-2">
            {finished && (
              <button
                type="button"
                onClick={() => {
                  setFinished(false);
                  // Remounting is how the sequence restarts from the top
                  // without touching currentTime on a possibly-detached node.
                  setReplayKey((k) => k + 1);
                }}
                className="rounded-control border border-atelier-paper/30 px-3 py-1.5 text-xs font-medium text-atelier-paper transition-opacity duration-150 hover:opacity-80"
              >
                {labels.replay}
              </button>
            )}
            <Link
              href={href}
              className="rounded-control bg-atelier-paper px-3.5 py-1.5 text-xs font-medium text-atelier-ink transition-opacity duration-150 hover:opacity-90"
            >
              {characterName ? `Put ${characterName} somewhere` : "Create"}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
