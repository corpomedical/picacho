import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

// Small shared pieces of the new Settings page (2026-09-19). Everything
// else composes these with SettingsSection, which stays the page's card.

// cn() is a plain join (lib/cn.ts): two classes for one property do not
// override each other by order. So the card's border COLOUR is left out of
// CARD_FRAME and added by exactly one of CARD or the caller.
export const CARD_FRAME =
  "rounded-card border bg-atelier-surface shadow-[0_1px_2px_rgba(33,29,22,0.04),0_16px_40px_-24px_rgba(33,29,22,0.12)]";
export const CARD = `${CARD_FRAME} border-atelier-rule`;

export const BUTTON_PRIMARY =
  "inline-flex min-h-9 flex-shrink-0 items-center justify-center rounded-control bg-atelier-ink px-3.5 py-2 text-[13px] font-medium text-atelier-paper transition-colors hover:bg-atelier-ink/90";

export const BUTTON_SECONDARY =
  "inline-flex min-h-8 flex-shrink-0 items-center justify-center rounded-control border border-atelier-rule px-3 py-1.5 text-[13px] text-atelier-ink transition-colors hover:bg-atelier-ink/5";

/** The small mono label ("PLAN CREDITS") — the slate voice. */
export function Slate({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("text-[10.5px] font-medium uppercase tracking-[0.14em] text-atelier-muted", className)}>
      {children}
    </span>
  );
}

/** A fuel gauge: the filled part is what is LEFT. */
export function Meter({ left, cap, className }: { left: number; cap: number; className?: string }) {
  const pct = cap > 0 ? Math.max(0, Math.min(100, (left / cap) * 100)) : 0;
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={cap}
      aria-valuenow={left}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-atelier-ink/10", className)}
    >
      <div
        className="h-full rounded-full bg-atelier-accent"
        // Something left always shows as something, however little.
        style={{ width: `${left > 0 ? Math.max(pct, 2) : 0}%` }}
      />
    </div>
  );
}

export function StatusDot({ tone }: { tone: "good" | "warn" | "off" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "h-1.5 w-1.5 flex-shrink-0 rounded-full",
        tone === "good" ? "bg-emerald-500" : tone === "warn" ? "bg-atelier-accent" : "bg-atelier-ink/30",
      )}
    />
  );
}

export function Chevron({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn("h-4 w-4 flex-shrink-0 text-atelier-muted", className)}
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn("h-[15px] w-[15px]", className)}
    >
      <path d="M12 4v11" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  );
}

/** A label/value row in a card body (plan price, next payment…). */
export function FactRow({ label, children, last }: { label: string; children: ReactNode; last?: boolean }) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-0.5 py-2.5 sm:grid-cols-[170px_minmax(0,1fr)] sm:gap-4",
        !last && "border-b border-atelier-rule/60",
      )}
    >
      <span className="text-[13px] text-atelier-muted">{label}</span>
      <div className="min-w-0 text-sm text-atelier-ink">{children}</div>
    </div>
  );
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-atelier-ink underline underline-offset-2 transition-colors hover:text-atelier-accent">
      {children}
    </Link>
  );
}

/**
 * "Sep 9 – Oct 9, 2026" in the app's own date style, beside the app's other
 * dates on the same row. (The invoice PDF writes its dates the invoice's way,
 * en-GB for English: that is a document, this is the app.)
 */
export function periodLabel(start: number, end: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Madrid",
  }).formatRange(new Date(start * 1000), new Date(end * 1000));
}
