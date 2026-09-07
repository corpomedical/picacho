"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

// The dashboard highlight reel — direction F's cinema, built to the mockup
// rather than around it.
//
// What the mockup has, in its order: the veil, the label "Your reel · cut this
// morning", the identity meter, the slug naming the current cut, the name in
// serif with a SENTENCE under it, and the cast rail with an add button. It has
// no progress bar over the video, no button inside the band, and no replay
// control — the action lives in the prompt bar at the foot of the screen, and
// the reel simply loops. Earlier passes added all three and removed the
// sentence; this one does not.
//
// Restraint about data survives that:
//   1. The POSTER is server-rendered as a plain <img>. First paint costs about
//      18 KB and no JavaScript, so the band is never black and never shifts.
//   2. The VIDEO is not in the DOM until an effect says it is welcome, so the
//      browser cannot start fetching before we have asked.
//   3. Looping costs no further data — the file is ~260 KB and immutable-cached
//      for a year, so a loop re-reads the browser's own copy. It costs battery,
//      which is the trade the operator asked for.
//
// COLOUR. Everything here rides on a photograph, so it uses `onmedia`, never
// `white`. Dark theme re-declares --color-white to a near-black so ordinary
// surfaces repaint without a dark: variant, which silently erases anything
// sitting on a video. globals.css names that failure directly.

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
  /** "Your reel", or the example reel's label. */
  eyebrow: string;
  /** When the reel was cut, so the label can say so. */
  builtAt?: string | null;
  /** Request locale, for the "cut 2 hours ago" suffix. */
  locale?: string;
  /** The character's name, or the example reel's invitation. */
  headline: string;
  /** The sentence under the name. The mockup's, not a stat line. */
  line: string | null;
  /** One per cut, in reel order. Empty for the example reel. */
  cuts?: ReelCut[];
  meanIdentity?: number | null;
  cast?: ReelCastMember[];
  selectedCharacterId?: string | null;
  /** Shown at the end of the cast rail. Omitted on the example reel. */
  addCharacterHref?: string | null;
  /** Accessible labels for the play/pause toggle. */
  playLabel?: string;
  pauseLabel?: string;
};

export function ReelBand({
  posterUrl,
  videoUrl,
  eyebrow,
  builtAt = null,
  locale = "en",
  headline,
  line,
  cuts = [],
  meanIdentity = null,
  cast = [],
  selectedCharacterId = null,
  addCharacterHref = null,
  playLabel = "Play",
  pauseLabel = "Pause",
}: ReelBandProps) {
  // Starts false so the server and the first client render agree on the
  // poster; only an effect can promote it to video.
  const [videoWelcome, setVideoWelcome] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cutAgo, setCutAgo] = useState<string | null>(null);

  useEffect(() => {
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection;
    if (connection?.saveData) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    setVideoWelcome(true);
  }, []);

  // "cut this morning", truthfully — from when the cron actually cut it.
  // Computed in an effect because relative time needs the current clock, which
  // is impure during render and would otherwise bake build time into the HTML.
  useEffect(() => {
    if (!builtAt) return setCutAgo(null);
    const at = Date.parse(builtAt);
    if (!Number.isFinite(at)) return setCutAgo(null);
    const mins = Math.round((at - Date.now()) / 60000);
    const abs = Math.abs(mins);
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    setCutAgo(
      abs < 60
        ? rtf.format(mins, "minute")
        : abs < 60 * 24
          ? rtf.format(Math.round(mins / 60), "hour")
          : rtf.format(Math.round(mins / 1440), "day"),
    );
  }, [builtAt, locale]);

  // Which cut is on screen, so the slug can name it. Derived from playback
  // position against the cuts' own durations — the player needs to know
  // nothing about how the file was assembled.
  let boundary = 0;
  let current: ReelCut | null = cuts.length > 0 ? cuts[cuts.length - 1] : null;
  for (const cut of cuts) {
    boundary += cut.seconds;
    if (elapsed < boundary) {
      current = cut;
      break;
    }
  }

  return (
    <section className="relative overflow-hidden rounded-card bg-[#0e0d0c]">
      <div className="relative aspect-video w-full">
        {videoWelcome ? (
          <video
            src={videoUrl}
            poster={posterUrl ?? undefined}
            autoPlay
            // The operator's call: it keeps playing. The file is already on the
            // device after the first fetch, so a loop spends battery, not data.
            loop
            muted
            playsInline
            preload="auto"
            aria-hidden
            ref={(el) => {
              videoRef.current = el;
              // The muted ATTRIBUTE alone does not reliably survive hydration,
              // and an unmuted video silently refuses to autoplay — the same
              // quirk hero-reel.tsx works around.
              if (el) el.muted = true;
            }}
            onPlay={() => setPaused(false)}
            onPause={() => setPaused(true)}
            className="h-full w-full object-cover"
            onTimeUpdate={(e) => setElapsed(e.currentTarget.currentTime)}
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

        <div className="absolute inset-x-4 top-4 flex items-start justify-between gap-3 sm:inset-x-5">
          <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-onmedia/65">
            {cutAgo ? `${eyebrow} · ${cutAgo}` : eyebrow}
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

        <div className="absolute inset-x-4 bottom-4 sm:inset-x-5 sm:bottom-5">
          {/* The cut naming itself, in the words the person typed. */}
          {current?.label && (
            <div className="mb-2.5 flex items-center gap-2">
              {current.score !== null && (
                <span className="rounded-full bg-black/50 px-2 py-0.5 font-numeral text-[11px] tabular-nums text-onmedia backdrop-blur-sm">
                  {current.score}
                </span>
              )}
              <span className="truncate text-[11px] text-onmedia/80">{current.label}</span>
            </div>
          )}

          <p className="font-numeral text-4xl font-semibold leading-none tracking-tight text-onmedia sm:text-5xl">
            {headline}
          </p>
          {line && (
            <p className="mt-2.5 max-w-[19rem] text-[12.5px] leading-snug text-onmedia/60">
              {line}
            </p>
          )}
        </div>

        {/* Play/pause. A reel that loops forever needs a way to stop it —
            without one the only escape from moving video on the app's most
            opened screen is to leave the page. Only rendered once the video
            exists, so the poster-only view stays a still image with no
            controls to imply otherwise. */}
        {videoWelcome && (
          <button
            type="button"
            aria-label={paused ? playLabel : pauseLabel}
            onClick={() => {
              const el = videoRef.current;
              if (!el) return;
              if (el.paused) void el.play().catch(() => {});
              else el.pause();
            }}
            className="absolute bottom-4 right-4 flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-[10px] text-onmedia backdrop-blur-sm transition-opacity duration-150 hover:opacity-80 sm:bottom-5 sm:right-5"
          >
            {paused ? "▶" : "❚❚"}
          </button>
        )}
      </div>

      {/* The cast rail, on the reel's own dark ground: who the reel is about,
          and one tap to anyone else. The ring answers "why them?".
          pb-9 rather than pb-4 because the working surface rides up over this
          edge by 24px, and a smaller pad let it clip the avatars. */}
      {(cast.length > 0 || addCharacterHref) && (
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
          {addCharacterHref && (
            <Link
              href={addCharacterHref}
              aria-label="New character"
              className="flex h-11 w-11 flex-none items-center justify-center rounded-full border border-dashed border-onmedia/25 text-lg text-onmedia/50 transition-opacity duration-150 hover:opacity-80"
            >
              +
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
