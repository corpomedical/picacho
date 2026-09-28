"use client";

import Link from "next/link";
import { TOOL_ICONS } from "@/components/app-sidebar";
import type { ToolKey } from "@/lib/nav/tools";

const COLUMNS: Record<number, string> = { 1: "sm:grid-cols-2", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-4" };

/** One door from a finished take into another tool. */
export type KeepGoingDoor = { key: ToolKey; href: string; label: string; sub: string; tool: string };

/**
 * A take's "Keep going" shelf (ecosystem to-do #1, operator pick B,
 * 2026-09-28): each card sends THIS take into another tool. The page decides
 * which doors exist (lib/nav/gates.ts — the same rule as the Tools menu, so a
 * card never offers a tool its menu hides) and renders nothing when none do.
 * Each card uses the tool's icon from the Tools panel.
 */
export function KeepGoing({ title, doors }: { title: string; doors: KeepGoingDoor[] }) {
  if (doors.length === 0) return null;
  return (
    <section className="mt-6" aria-label={title}>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">{title}</p>
      {/* grid-cols-1 at the base (minmax(0,1fr)), so a long word can never
          widen a column past a phone's screen (df8f70b). As many columns as
          cards on a computer; on a phone two, and an odd count lets the first
          card span the row, as the Tools panel's lead card does. */}
      <div className={`mt-2.5 grid grid-cols-1 gap-2 min-[380px]:grid-cols-2 ${COLUMNS[Math.min(doors.length, 4)]}`}>
        {doors.map((d, i) => {
          const Icon = TOOL_ICONS[d.key];
          return (
            <Link
              key={d.key}
              href={d.href}
              className={`${i === 0 && doors.length % 2 === 1 ? "min-[380px]:col-span-2 sm:col-span-1" : ""} group/door flex min-w-0 flex-col gap-2 rounded-2xl border border-atelier-rule bg-atelier-surface p-3 transition-colors hover:border-atelier-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-atelier-accent`}
            >
              <Icon aria-hidden="true" className="h-5 w-5 text-atelier-accent" />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium leading-snug text-atelier-ink">{d.label}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-atelier-muted">{d.sub}</span>
              </span>
              <span className="mt-auto text-[10.5px] font-semibold uppercase tracking-[0.12em] text-atelier-muted group-hover/door:text-atelier-ink">
                {d.tool} →
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
