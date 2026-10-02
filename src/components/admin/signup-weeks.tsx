"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

// Admin → Who comes back → Sign-up weeks (2026-10-03, the canvas's website
// board): everyone grouped by the week they joined; click a week to see each
// person with four dots — joined, first render, came back the next week,
// paid — and one line on where they are.

export type WeekPerson = {
  id: string;
  name: string;
  /** -1 tried and it didn't land, 0 not yet, 1 done. */
  steps: number[];
  note: string;
  seen: string;
  plan: string;
  paying: boolean;
};

export type WeekRow = {
  week: string;
  label: string;
  current: boolean;
  joined: number;
  rendered: number;
  cameBack: number | null;
  paid: number;
  people: WeekPerson[];
};

const COLS = "grid-cols-[150px_70px_minmax(0,1fr)_minmax(0,1fr)_70px_16px]";
const PEOPLE_COLS = "grid-cols-[170px_100px_minmax(0,1fr)_90px_80px]";

function pct(n: number, of: number): number {
  return of > 0 ? Math.round((n / of) * 100) : 0;
}

function Share({ n, of }: { n: number; of: number }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="w-16 text-[13.5px] font-semibold tabular-nums text-atelier-ink">
        {n} <span className="font-normal text-atelier-muted">{pct(n, of)}%</span>
      </span>
      <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--apple-fill)]">
        <span className="absolute inset-y-0 left-0 rounded-full bg-[var(--apple-blue)]" style={{ width: `${pct(n, of)}%` }} />
      </span>
    </span>
  );
}

function Dot({ step }: { step: number }) {
  return (
    <i
      className={cn(
        "inline-block h-[9px] w-[9px] rounded-full border-[1.5px]",
        step === 1
          ? "border-[var(--apple-blue)] bg-[var(--apple-blue)]"
          : step === -1
            ? "border-[var(--apple-red)]"
            : "border-neutral-400",
      )}
    />
  );
}

export function SignupWeeks({ weeks, initialOpen }: { weeks: WeekRow[]; initialOpen: string | null }) {
  const [open, setOpen] = useState<string | null>(initialOpen);

  if (weeks.length === 0) {
    return <p className="px-5 pb-5 text-sm text-atelier-muted">Nobody has joined yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px]">
        <div className={cn("grid gap-x-4 border-b border-atelier-rule px-5 py-1.5 text-xs font-semibold text-atelier-muted", COLS)}>
          <span>Week of</span>
          <span className="text-right">Joined</span>
          <span>Made a first render</span>
          <span>Came back the next week</span>
          <span className="text-right">Paid</span>
          <span />
        </div>
        {weeks.map((w) => {
          const isOpen = open === w.week;
          return (
            <div key={w.week} className="border-b border-atelier-rule">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : w.week)}
                aria-expanded={isOpen}
                className={cn(
                  "grid w-full items-center gap-x-4 px-5 py-3 text-left text-atelier-ink transition-colors hover:bg-atelier-ink/[0.03]",
                  COLS,
                )}
              >
                <span className="text-[13.5px] font-medium">
                  {w.label}
                  {w.current && <span className="block text-[11.5px] font-normal text-atelier-muted">this week</span>}
                </span>
                <span className="text-right text-[15px] font-semibold tabular-nums">{w.joined}</span>
                <Share n={w.rendered} of={w.joined} />
                {w.cameBack === null ? (
                  <span className="text-[12.5px] text-atelier-muted">too early — week not over</span>
                ) : (
                  <Share n={w.cameBack} of={w.joined} />
                )}
                <span className="text-right text-[13.5px] font-semibold tabular-nums">{w.paid}</span>
                <span className="text-sm text-neutral-400" aria-hidden>
                  {isOpen ? "▾" : "›"}
                </span>
              </button>
              {isOpen && (
                <div className="bg-atelier-ink/[0.025] px-5 pb-3.5 pt-1">
                  <div className={cn("grid gap-x-4 border-b border-atelier-rule pb-1.5 pt-2 text-xs font-semibold text-atelier-muted", PEOPLE_COLS)}>
                    <span>Person</span>
                    <span>Joined · render · back · paid</span>
                    <span>Where they are</span>
                    <span>Last seen</span>
                    <span>Plan</span>
                  </div>
                  {w.people.map((p) => (
                    <div key={p.id} className={cn("grid items-center gap-x-4 border-b border-atelier-rule py-[7px] text-[13px] last:border-b-0", PEOPLE_COLS)}>
                      <Link href={`/admin/users/${p.id}`} className="truncate font-medium text-atelier-ink no-underline hover:underline">
                        {p.name}
                      </Link>
                      <span className="flex gap-1.5" aria-label={`Steps: ${p.steps.map((s) => (s === 1 ? "done" : s === -1 ? "didn't land" : "not yet")).join(", ")}`}>
                        {p.steps.map((s, i) => (
                          <Dot key={i} step={s} />
                        ))}
                      </span>
                      <span className="truncate text-atelier-muted">{p.note}</span>
                      <span className="tabular-nums text-atelier-muted">{p.seen}</span>
                      <span>
                        <span
                          data-ui="badge"
                          data-tone={p.paying ? "success" : "neutral"}
                          className="inline-block rounded-full px-2 py-0.5 text-[11.5px] font-semibold"
                        >
                          {p.plan}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
