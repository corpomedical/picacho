import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// The settings sheet, redesigned (2026-09-07).
//
// What was wrong, from the survey of all 63 settings surfaces:
//
//   - Radius. Every settings card was `rounded-control` (6px) — the same
//     corner as the input sitting inside it — while every surface built since
//     is 18px. The page read as a different, older product.
//   - Hierarchy. The largest thing in any section was an 11px uppercase
//     label. A section had no title, only a tag.
//   - Density. All nine cards took pad="lg" (32px), including two wrapping a
//     single 28px switch: empty in space, cramped in type.
//
// So a section is now a header and a body separated by a rule: the title is a
// real title, the description says what the section is for, and the body sets
// its own rhythm. Padding is 20/24px, not 32.
//
// Deliberately NOT a change to ui/card.tsx. That primitive is the app's most
// repeated object — 41 hand-typed copies before it existed — and moving its
// radius would restyle every surface in the product to fix one page.

export function SettingsSection({
  title,
  description,
  children,
  className,
  tone = "default",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  /** "danger" tints the header rule and title for destructive sections. */
  tone?: "default" | "danger";
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-card border bg-atelier-surface shadow-[0_1px_2px_rgba(33,29,22,0.04),0_16px_40px_-24px_rgba(33,29,22,0.12)]",
        tone === "danger" ? "border-atelier-accent/25" : "border-atelier-rule",
        className,
      )}
    >
      <header className="px-5 pb-4 pt-5 sm:px-6">
        <h2
          className={cn(
            "font-numeral text-[15px] font-semibold leading-tight tracking-tight",
            tone === "danger" ? "text-atelier-accent" : "text-atelier-ink",
          )}
        >
          {title}
        </h2>
        {description && (
          <p className="mt-1 max-w-prose text-xs leading-relaxed text-atelier-muted">
            {description}
          </p>
        )}
      </header>
      <div className="space-y-5 border-t border-atelier-rule/60 px-5 py-5 sm:px-6">{children}</div>
    </section>
  );
}

// A control with its own label and explanation, for the switch rows that used
// to sit alone inside a 32px card. Label left, control right, description
// under the label where it belongs rather than floating above the card.
export function SettingsRow({
  label,
  description,
  control,
  className,
}: {
  label: string;
  description?: string;
  control: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <p className="text-sm font-medium leading-tight text-atelier-ink">{label}</p>
        {description && (
          <p className="mt-1 max-w-prose text-xs leading-relaxed text-atelier-muted">
            {description}
          </p>
        )}
      </div>
      <div className="flex-none pt-0.5">{control}</div>
    </div>
  );
}
