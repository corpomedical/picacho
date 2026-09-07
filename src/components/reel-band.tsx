"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

// The dashboard highlight reel (2026-09-07).
//
// Operator: "the website takes best scoring videos generated, 3 at max.
// Making a one video with 3 to 5 seconds of footage from each", built "with the
// lowest data consumption possible and cacheable".
//
// This is direction F, the one that was chosen: cinema over the working
// surface. The parts that make it that rather than a video in a box are the
// segmented bar across the top (one segment per cut, so it reads as an
// assembly rather than one long take), the identity meter showing the takes'
// scores as an instrument instead of a badge, the slug naming each cut in the
// person's own words as it arrives, and the cast rail underneath. An earlier
// pass shipped only the frame and the name: the bytes were right and the
// design was gone.
//
// Restraint about data, in the order it matters:
//   1. The POSTER is server-rendered as a plain <img>. First paint costs about
//      18 KB and no JavaScript, so the band is never black and never shifts.
//   2. The VIDEO is not in the DOM until an effect says it is welcome, so the
//      browser cannot start fetching before we have asked.
//   3. It plays ONCE. The file is ~260 KB and immutable-cached for a year, so
//      looping costs battery rather than data — the viewer's to spend, not
//      ours.
//
// COLOUR. Everything here rides on a photograph, so it uses `onmedia`, never
// `white`. Dark theme re-declares --color-white to a near-black so ordinary
// surfaces repaint without a dark: variant — which silently erases anything
// sitting on a video. globals.css names this failure and lists "the empty pips
// of a meter" among its casualties, which is exactly the segmented bar below.

export type ReelCut = {
  /** 0-100 identity score for this take, or null if it predates scoring. */
  score: number | null;
  /** The person's own prompt, already trimmed. */
  label: string | null;
  /** How long this cut runs inside the reel. */
  seconds: number;
};

export type ReelCastMember = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

type ReelBandProps = {
  posterUrl: string | null;
  videoUrl: string;
  /** Small uppercase line above the headline. */
  eyebrow: string;
  /** The character's name, or the example reel's invitation. */
  headline: string;
  subtitle: string | null;
  href: string;
  ctaLabel: string;
  replayLabel: string;
  /** One per cut, in reel order. Empty for the example reel. */
  cuts?: ReelCut[];
  /** Mean identity for the character, shown on the meter. */
  meanIdentity?: number | null;
  /** The cast rail. The reel's own character is ringed. */
  cast?: ReelCastMember[];
  selectedCharacterId?: string | null;
};

export function ReelBand({
  posterUrl,
  videoUrl,
  eyebrow,
  headline,
  subtitle,
  href,
  ctaLabel,
  replayLabel,
  cuts = [],
  meanIdentity = null,
  cast = [],
  selectedCharacterId = null,
}: ReelBandProps) {
  // Starts false so the server and the first client render agree on the
  // poster; only an effect can promote it to video.
  const [videoWelcome, setVideoWelcome] = useState(false);
  const [finished, setFinished] = useState(false);
  const [replayKey, setReplayKey] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection;
    if (connection?.saveData) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    setVideoWelcome(true);
  }, []);

  // Cumulative end time of each cut, so the playback position maps to a cut
  // without the player knowing anything about how the file was assembled.
  const bounds = useMemo(() => {
    // A plain loop, not a map that mutates a counter in its callback: the
    // React compiler treats the escaping closure as a reassignment after
    // render and refuses it.
    const ends: number[] = [];
    let running = 0;
    for (const cut of cuts) {
      running += cut.seconds;
      ends.push(running);
    }
    return ends;
  }, [cuts]);

  const activeIndex = bounds.findIndex((end) => elapsed < end);
  const current = activeIndex >= 0 ? cuts[activeIndex] : cuts[cuts.length - 1];

  return (
    <section className="relative overflow-hidden rounded-card bg-[#0e0d0c]">
      <div className="relative aspect-video w-full">
        {videoWelcome ? (
          <video
            key={replayKey}
            ref={(el) => {
              ref.current = el;
              // The muted ATTRIBUTE alone does not reliably survive hydration,
              // and an unmuted video silently refuses to autoplay — the same
              // quirk hero-reel.tsx works around.
              if (el) el.muted = true;
            }}
            src={videoUrl}
            poster={posterUrl ?? undefined}
            autoPlay
            muted
            playsInline
            preload="auto"
            aria-hidden
            className="h-full w-full object-cover"
            onTimeUpdate={(e) => setElapsed(e.currentTarget.currentTime)}
            onEnded={() => setFinished(true)}
          />
        ) : posterUrl ? (
          // A plain <img>, deliberately: no loader, no srcset, no JS — one
          // request for a file the edge already has.
          <img src={posterUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full bg-[#0e0d0c]" />
        )}

        {/* Legibility for the text, not decoration. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0e0d0c] via-[#0e0d0c]/20 to-[#0e0d0c]/65"
        />

        {/* One segment per cut — this is what says "assembly" and not "clip". */}
        {cuts.length > 1 && (
          <div aria-hidden className="absolute inset-x-4 top-3 flex gap-1 sm:inset-x-5">
            {cuts.map((cut, i) => {
              const start = i === 0 ? 0 : bounds[i - 1];
              const filled = Math.max(0, Math.min(1, (elapsed - start) / cut.seconds));
              return (
                <span key={i} className="h-[2.5px] flex-1 overflow-hidden rounded-full bg-onmedia/25">
                  <span
                    className="block h-full rounded-full bg-onmedia"
                    style={{ width: `${filled * 100}%` }}
                  />
                </span>
              );
            })}
          </div>
        )}

        <div className="absolute inset-x-4 top-7 flex items-start justify-between gap-3 sm:inset-x-5">
          <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-onmedia/65">
            {eyebrow}
          </p>
          {/* The identity meter: one bar per cut, height by that take's score,
              with the character's mean beside it. A reading, not a badge. */}
          {meanIdentity !== null && cuts.length > 0 && (
            <div className="flex flex-none items-center gap-1.5">
              <span aria-hidden className="flex h-3.5 items-end gap-[2px]">
                {cuts.map((cut, i) => (
                  <span
                    key={i}
                    className="w-[2.5px] rounded-full bg-atelier-accent"
                    style={{ height: `${Math.max(20, ((cut.score ?? 60) / 100) * 100)}%` }}
                  />
                ))}
              </span>
              <span className="font-numeral text-lg leading-none tabular-nums text-onmedia">
                {meanIdentity}
              </span>
            </div>
          )}
        </div>

        <div className="absolute inset-x-4 bottom-3 sm:inset-x-5 sm:bottom-4">
          {/* The cut naming itself, in the words the person typed. */}
          {current?.label && (
            <div className="mb-2 flex items-center gap-2">
              {current.score !== null && (
                <span className="rounded-full bg-black/50 px-2 py-0.5 font-numeral text-[11px] tabular-nums text-onmedia backdrop-blur-sm">
                  {current.score}
                </span>
              )}
              <span className="truncate text-[11px] text-onmedia/80">{current.label}</span>
            </div>
          )}

          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-numeral text-3xl font-semibold leading-none tracking-tight text-onmedia sm:text-4xl">
                {headline}
              </p>
              {subtitle && (
                <p className="mt-1.5 truncate text-[11px] tabular-nums text-onmedia/60">{subtitle}</p>
              )}
            </div>

            <div className="flex flex-none items-center gap-2">
              {finished && (
                <button
                  type="button"
                  onClick={() => {
                    setFinished(false);
                    setElapsed(0);
                    // Remounting restarts from the top without touching
                    // currentTime on a possibly-detached node.
                    setReplayKey((k) => k + 1);
                  }}
                  className="rounded-control border border-onmedia/30 px-3 py-1.5 text-xs font-medium text-onmedia transition-opacity duration-150 hover:opacity-80"
                >
                  {replayLabel}
                </button>
              )}
              <Link
                href={href}
                className="rounded-control bg-atelier-paper px-3.5 py-1.5 text-xs font-medium text-atelier-ink transition-opacity duration-150 hover:opacity-90"
              >
                {ctaLabel}
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* The cast rail, on the reel's own dark ground: who the reel is about,
          and one tap to anyone else. The ring answers "why them?".
          pb-9 rather than pb-4 because the working surface rides up over this
          edge by 24px, and a smaller pad let it clip the avatars. */}
      {cast.length > 0 && (
        <div className="flex items-center gap-2.5 px-4 pb-9 sm:px-5">
          {cast.map((member) => {
            const selected = member.id === selectedCharacterId;
            return (
              <Link
                key={member.id}
                href={`/app/character/${member.id}`}
                title={member.name}
                className={`relative h-11 w-11 flex-none overflow-hidden rounded-full ${
                  selected
                    ? "ring-2 ring-atelier-accent ring-offset-2 ring-offset-[#0e0d0c]"
                    : "ring-1 ring-onmedia/15"
                }`}
              >
                {member.avatarUrl ? (
                  <img
                    src={member.avatarUrl}
                    alt={member.name}
                    className={`h-full w-full object-cover ${selected ? "" : "opacity-45"}`}
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center bg-onmedia/10 text-xs font-medium text-onmedia/70">
                    {member.name.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
