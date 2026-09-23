"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// The dashboard's working surface — direction A's momentum, as the sheet that
// rides up over direction F's cinema.
//
// Its own component because the page is a server component that reads the
// user's session, which makes it impossible to render in a local harness. Every
// pass at this design was verified on the band alone and never on the page it
// sits in, which is exactly how the dashboard ended up unchanged underneath a
// new video card. Extracted so the composition can actually be looked at.

export type MomentumTake = {
  href: string;
  title: string | null;
  thumbUrl: string | null;
  isVideo: boolean;
  /** ISO timestamp of the take; turned into "2 hours ago" on the client. */
  createdAt: string | null;
  /** Duration for a video take, appended to the meta line. */
  seconds: number | null;
  score: number | null;
};

type MomentumSurfaceProps = {
  take: MomentumTake | null;
  /** Request locale, so Intl does the translating instead of four message files. */
  locale: string;
  creditsLeft: number;
  meanIdentity: number | null;
  takes: number;
  labels: {
    pickUp: string;
    continue: string;
    newScene: string;
    empty: string;
    untitled: string;
    credits: string;
    meanIdentity: string;
    takes: string;
  };
};

export function MomentumSurface({
  take,
  locale,
  creditsLeft,
  meanIdentity,
  takes,
  labels,
}: MomentumSurfaceProps) {
  // "2 hours ago · 5s", computed in an effect rather than during render.
  // Relative time needs the current clock, which is impure — the page is a
  // server component, so doing it there both trips the compiler and bakes the
  // build time into the HTML. Empty on first paint, filled on hydration.
  const [meta, setMeta] = useState<string | null>(null);
  useEffect(() => {
    if (!take) return setMeta(null);
    const bits: string[] = [];
    const at = take.createdAt ? Date.parse(take.createdAt) : NaN;
    if (Number.isFinite(at)) {
      const mins = Math.round((at - Date.now()) / 60000);
      const abs = Math.abs(mins);
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
      bits.push(
        abs < 60
          ? rtf.format(mins, "minute")
          : abs < 60 * 24
            ? rtf.format(Math.round(mins / 60), "hour")
            : rtf.format(Math.round(mins / 1440), "day"),
      );
    }
    if (take.isVideo && take.seconds) bits.push(`${take.seconds}s`);
    setMeta(bits.length ? bits.join(" · ") : null);
  }, [take, locale]);

  // The three figures, in one ruled slab rather than three boxes: a reading
  // across, the way the Generate receipt reads.
  const figures = [
    { label: labels.credits, value: creditsLeft, accent: false },
    { label: labels.meanIdentity, value: meanIdentity ?? "—", accent: true },
    { label: labels.takes, value: takes, accent: false },
  ];

  // The sheet lifts over the cinema's bottom edge — the negative margin is the
  // overlap, not a spacing accident.
  return (
    // Rounded at the foot too, to the band's radius: in the dark room the band
    // and this sheet are one object on the frame's ground (data-dash-hero).
    <div className="relative -mt-6 rounded-t-[26px] rounded-b-card bg-atelier-paper px-4 pb-4 pt-5 sm:px-5 sm:pb-5">
      <p className="text-[9px] font-semibold uppercase tracking-[0.17em] text-atelier-muted">
        {labels.pickUp}
      </p>

      {take ? (
        <div
          data-dash-slab
          // A grid, so on a phone the two keys take the card's full width under
          // the take instead of wrapping inside a 200px column beside it.
          className="mt-2.5 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 rounded-card border border-atelier-rule bg-atelier-surface p-3 sm:grid-rows-[auto_auto] sm:gap-y-0 sm:p-3.5"
        >
          {take.thumbUrl && (
            <Link
              href={take.href}
              data-dash-media
              className="relative aspect-[4/3] w-[96px] flex-none overflow-hidden rounded-media bg-atelier-rule ring-1 ring-atelier-rule sm:row-span-2 sm:w-[136px]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={take.thumbUrl} alt="" className="h-full w-full object-cover" />
              {/* The lock, as the stage draws it round a scored take. */}
              {typeof take.score === "number" && (
                <span aria-hidden className="lock-frame absolute inset-1.5 [--lock-arm:10px] [--lock-stroke:1.5px]" />
              )}
              {typeof take.score === "number" && (
                <span className="absolute left-2.5 top-2.5 rounded-full bg-black/60 px-1.5 py-0.5 font-numeral text-[10px] leading-none tabular-nums text-onmedia backdrop-blur-sm">
                  {take.score}
                </span>
              )}
              {take.isVideo && (
                <span className="absolute bottom-2.5 right-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-[7px] text-onmedia backdrop-blur-sm">
                  ▶
                </span>
              )}
            </Link>
          )}
          <div className={`min-w-0 sm:self-end ${take.thumbUrl ? "" : "col-span-2"}`}>
            <p className="line-clamp-2 text-[13.5px] font-semibold leading-snug text-atelier-ink sm:text-[15px]">
              {take.title ?? labels.untitled}
            </p>
            {meta && (
              <p className="mt-1 text-[10px] uppercase tracking-[0.1em] text-atelier-muted">
                {meta}
              </p>
            )}
          </div>
          <div
            className={`col-span-2 flex gap-2 sm:mt-3 sm:self-start ${take.thumbUrl ? "sm:col-span-1 sm:col-start-2" : ""}`}
          >
            <Link
              href={take.href}
              data-dash-key
              className="flex-1 rounded-full bg-atelier-ink px-3.5 py-2.5 text-center text-xs font-semibold text-atelier-paper transition-[filter,opacity] duration-150 hover:opacity-90 hover:brightness-105 sm:flex-none sm:py-1.5"
            >
              {labels.continue}
            </Link>
            <Link
              href="/app/generate"
              className="flex-1 rounded-full border border-atelier-rule bg-atelier-ink/[0.04] px-3.5 py-2.5 text-center text-xs font-medium text-atelier-ink transition-colors duration-150 hover:bg-atelier-ink/[0.08] sm:flex-none sm:py-1.5"
            >
              {labels.newScene}
            </Link>
          </div>
        </div>
      ) : (
        <Link
          href="/app/generate"
          className="mt-2.5 flex items-center justify-center rounded-card border border-dashed border-atelier-rule px-4 py-6 text-xs text-atelier-muted"
        >
          {labels.empty}
        </Link>
      )}

      {/* Credits, mean identity, takes — the three figures the mock kept. */}
      <div
        data-dash-slab
        className="mt-3 grid grid-cols-3 divide-x divide-atelier-rule rounded-card border border-atelier-rule bg-atelier-surface"
      >
        {figures.map((f) => (
          <div key={f.label} className="flex min-w-0 flex-col justify-between gap-1.5 px-3.5 py-3 sm:px-4 sm:py-3.5">
            <p className="text-[9px] font-semibold uppercase leading-snug tracking-[0.17em] text-atelier-muted">
              {f.label}
            </p>
            <p
              className={`font-numeral text-2xl font-semibold leading-none tabular-nums sm:text-[28px] ${
                f.accent ? "text-atelier-accent" : "text-atelier-ink"
              }`}
            >
              {f.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
