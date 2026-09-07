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

  // The sheet lifts over the cinema's bottom edge — the negative margin is the
  // overlap, not a spacing accident.
  return (
    <div className="relative -mt-6 rounded-t-[26px] bg-atelier-paper px-4 pb-1 pt-5 sm:px-5">
      <p className="text-[9px] font-semibold uppercase tracking-[0.17em] text-atelier-muted">
        {labels.pickUp}
      </p>

      {take ? (
        <div className="mt-2 flex items-center gap-3 rounded-card border border-atelier-rule bg-atelier-surface p-3">
          {take.thumbUrl && (
            <div className="relative h-[62px] w-[84px] flex-none overflow-hidden rounded-[10px] bg-atelier-rule">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={take.thumbUrl} alt="" className="h-full w-full object-cover" />
              {typeof take.score === "number" && (
                <span className="absolute left-1.5 top-1.5 rounded-full bg-black/60 px-1.5 py-0.5 font-numeral text-[10px] tabular-nums text-onmedia">
                  {take.score}
                </span>
              )}
              {take.isVideo && (
                <span className="absolute bottom-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-[7px] text-onmedia">
                  ▶
                </span>
              )}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold leading-tight text-atelier-ink">
              {take.title ?? labels.untitled}
            </p>
            {meta && (
              <p className="mt-1 text-[10px] uppercase tracking-[0.1em] text-atelier-muted">
                {meta}
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <Link
                href={take.href}
                className="rounded-control bg-atelier-ink px-3 py-1.5 text-xs font-medium text-atelier-paper transition-opacity duration-150 hover:opacity-90"
              >
                {labels.continue}
              </Link>
              <Link
                href="/app/generate"
                className="rounded-control border border-atelier-rule px-3 py-1.5 text-xs font-medium text-atelier-ink transition-opacity duration-150 hover:opacity-80"
              >
                {labels.newScene}
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <Link
          href="/app/generate"
          className="mt-2 flex items-center justify-center rounded-card border border-dashed border-atelier-rule px-4 py-6 text-xs text-atelier-muted"
        >
          {labels.empty}
        </Link>
      )}

      {/* Credits, mean identity, takes — the three figures the mock kept. */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-card border border-atelier-rule bg-atelier-surface px-3 py-2.5">
          <p className="text-[9px] font-semibold uppercase tracking-[0.17em] text-atelier-muted">
            {labels.credits}
          </p>
          <p className="mt-0.5 font-numeral text-xl font-semibold tabular-nums text-atelier-ink">
            {creditsLeft}
          </p>
        </div>
        <div className="rounded-card border border-atelier-rule bg-atelier-surface px-3 py-2.5">
          <p className="text-[9px] font-semibold uppercase tracking-[0.17em] text-atelier-muted">
            {labels.meanIdentity}
          </p>
          <p className="mt-0.5 font-numeral text-xl font-semibold tabular-nums text-atelier-accent">
            {meanIdentity ?? "—"}
          </p>
        </div>
        <div className="rounded-card border border-atelier-rule bg-atelier-surface px-3 py-2.5">
          <p className="text-[9px] font-semibold uppercase tracking-[0.17em] text-atelier-muted">
            {labels.takes}
          </p>
          <p className="mt-0.5 font-numeral text-xl font-semibold tabular-nums text-atelier-ink">
            {takes}
          </p>
        </div>
      </div>
    </div>
  );
}
