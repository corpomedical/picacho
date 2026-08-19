"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { formatMsg } from "@/lib/i18n/format";

// Homepage "Try it" proof widget. Every prompt, image and score rendered
// here is a REAL stored generation from the showcase character's history
// (see lib/showcase.ts — the same rows the hero grid serves); this
// component only replays them. Picking a prompt plays a short staged trace
// of the pipeline's real stages (draft → review → validate → score,
// ~2.5s), then fades in the stored render with its stored score — the
// footnote under the image says exactly that, so the animation reads as a
// replay, not a fake live generation. No network requests beyond the same
// /api/showcase/<i> images the hero grid already loads.

export type TryItWidgetEntry = {
  /** Showcase index — the image is `/api/showcase/${index}`. */
  index: number;
  /** Real prompt_input text (whitespace-trimmed). Clamped visually; full text in title. */
  prompt: string;
  /** Real match_score, 0-100 integer. */
  score: number;
  /** Real attempts count, or null when underivable (then the line is omitted). */
  attempts: number | null;
  /** Optional crop anchor for tiles whose faces sit off-centre (mirrors the hero grid). */
  objectPosition?: string;
};

export type TryItWidgetLabels = {
  /** "Pick a scene" heading over the prompt list. */
  pick: string;
  /** The four stage chips, in play order: draft, review, validate, score. */
  steps: string[];
  /** Score-chip label ("Identity match"). */
  match: string;
  /** Tooltip template with {n} ("Identity match: {n}%"). */
  matchTitle: string;
  /** "Passed on attempt" — suffixed with the real attempts count. */
  passed: string;
  /** Honesty footnote template with {score}. */
  realNote: string;
  /** CTA button text (links to /signup). */
  cta: string;
};

// ~2.5s total: four stages at 500ms each, then a 500ms settle before the
// image fades in. Reduced-motion picks skip straight to the final state.
const STEP_MS = 500;
const SETTLE_MS = 500;

// Same inline-SVG convention as the rest of the marketing page (see the
// icons at the top of app/page.tsx) — not a new icon dependency.
function CheckIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function TryItWidget({
  entries,
  labels,
}: {
  entries: TryItWidgetEntry[];
  labels: TryItWidgetLabels;
}) {
  // Which entry (position in `entries`) is playing/shown; null = idle.
  const [selected, setSelected] = useState<number | null>(null);
  // How many stage chips have completed (0..steps.length).
  const [stage, setStage] = useState(0);
  // Trace finished — image + score visible.
  const [done, setDone] = useState(false);
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  };
  // Cleanup on unmount so a mid-play navigation can't fire stale setState.
  useEffect(() => clearTimers, []);

  function pick(i: number) {
    clearTimers();
    setSelected(i);
    // Checked per pick, same pattern as home-hero.tsx: reduced motion skips
    // the staged trace entirely and shows the finished result instantly.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStage(labels.steps.length);
      setDone(true);
      return;
    }
    setStage(0);
    setDone(false);
    for (let s = 1; s <= labels.steps.length; s++) {
      timers.current.push(window.setTimeout(() => setStage(s), s * STEP_MS));
    }
    timers.current.push(
      window.setTimeout(() => setDone(true), labels.steps.length * STEP_MS + SETTLE_MS),
    );
  }

  const entry = selected === null ? null : (entries[selected] ?? null);

  return (
    <div className="rounded-[18px] border border-neutral-200 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_20px_44px_-18px_rgba(0,0,0,0.14)] sm:p-6">
      <div className="grid gap-6 sm:grid-cols-2 sm:gap-8">
        {/* Real prompts — the "pick a scene" list. */}
        <div>
          <p className="text-xs font-medium text-neutral-400">{labels.pick}</p>
          <div className="mt-3 space-y-2">
            {entries.map((e, i) => (
              <button
                key={e.index}
                type="button"
                onClick={() => pick(i)}
                aria-pressed={selected === i}
                title={e.prompt}
                className={cn(
                  "w-full rounded-[12px] border px-3.5 py-2.5 text-left text-sm leading-relaxed transition-colors",
                  selected === i
                    ? "border-ochre/50 bg-ochre-soft text-neutral-900"
                    : "border-neutral-100 bg-neutral-50 text-neutral-600 hover:border-neutral-200 hover:bg-neutral-100",
                )}
              >
                <span className="line-clamp-2">{e.prompt}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Pipeline trace + the stored render. */}
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            {labels.steps.map((label, s) => {
              const complete = selected !== null && (done || s < stage);
              const active = selected !== null && !done && !complete && s === stage;
              return (
                <span
                  key={label}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors",
                    complete && "bg-neutral-50 text-neutral-700",
                    active && "bg-ochre-soft text-neutral-800",
                    !complete && !active && "bg-neutral-50 text-neutral-300",
                  )}
                >
                  {complete ? (
                    <CheckIcon className="h-3 w-3 flex-shrink-0 text-emerald-500" />
                  ) : (
                    <span
                      className={cn(
                        "h-1.5 w-1.5 flex-shrink-0 rounded-full",
                        active ? "animate-pulse bg-ochre" : "bg-neutral-200",
                      )}
                    />
                  )}
                  {label}
                </span>
              );
            })}
          </div>

          {/* Aspect box is always reserved — the image fades in over the same
              dark render surface the ValidateMockup uses, so nothing shifts. */}
          <div className="relative mt-3 aspect-square w-full overflow-hidden rounded-[12px] bg-gradient-to-br from-neutral-900 via-neutral-800 to-neutral-700">
            {entry !== null && !done && (
              <div className="absolute inset-x-6 top-1/2 h-px animate-pulse bg-white/30" />
            )}
            {entry !== null && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                key={entry.index}
                src={`/api/showcase/${entry.index}`}
                alt={entry.prompt}
                className={cn(
                  "h-full w-full object-cover transition-opacity duration-500 motion-reduce:transition-none",
                  done ? "opacity-100" : "opacity-0",
                )}
                style={entry.objectPosition ? { objectPosition: entry.objectPosition } : undefined}
              />
            )}
            {entry !== null && done && (
              <span
                className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-semibold text-neutral-800 shadow-sm"
                title={formatMsg(labels.matchTitle, { n: entry.score })}
              >
                {labels.match}
                <span className="text-ochre">{entry.score}%</span>
              </span>
            )}
          </div>

          {/* Caption + honesty footnote. min-h reserves roughly the final
              height so the reveal doesn't push the CTA around. aria-live so
              screen readers hear the outcome once, not every stage tick. */}
          <div aria-live="polite" className="mt-3 min-h-12">
            {entry !== null && done && (
              <>
                {entry.attempts !== null && (
                  <p className="flex items-center gap-2 text-xs text-neutral-500">
                    <CheckIcon className="h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />
                    {labels.passed} {entry.attempts}
                  </p>
                )}
                <p className={cn("text-xs leading-relaxed text-neutral-400", entry.attempts !== null && "mt-1.5")}>
                  {formatMsg(labels.realNote, { score: entry.score })}
                </p>
              </>
            )}
          </div>

          <Link
            href="/signup"
            className="mt-4 inline-flex items-center justify-center rounded-[10px] bg-ochre px-5 py-2.5 text-sm font-semibold text-white shadow-[0_1px_1px_rgba(0,0,0,0.08)] transition-colors hover:bg-ochre-deep"
          >
            {labels.cta}
          </Link>
        </div>
      </div>
    </div>
  );
}
