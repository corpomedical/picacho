import { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

// The Atelier paper sheet — ONE definition of the app's most repeated object.
//
// Padding is a PROP, not something a caller overrides through className, and
// that is forced by cn(): it is a plain string join, so `cn("p-8", "p-3")`
// emits both and lets Tailwind's stylesheet order decide the winner. cn.ts
// documents a real bug from exactly that. A prop makes the choice explicit
// and impossible to lose.
//
// The lift is two layers (2026-08-21 refinement — flat boxes read cheap next
// to ChatGPT-class chrome; popovers still float harder). Before this file was
// adopted across the app the sheet was hand-typed 41 times in three different
// elevations: 15 with a single shadow layer, some with none at all.
const PADS = {
  none: "",
  sm: "p-3",
  md: "p-6",
  lg: "p-8",
} as const;

export type CardPad = keyof typeof PADS;

// The recipe on its own, for the rare host that cannot be a div — a Next
// <Link> that must stay an anchor, say. Padding is the caller's problem
// there; everything else still has exactly one home.
export const CARD_SHEET =
  "rounded-control border border-atelier-rule bg-atelier-surface shadow-[0_1px_2px_rgba(33,29,22,0.04),0_16px_40px_-24px_rgba(33,29,22,0.12)]";

export function Card({
  className,
  pad = "lg",
  ...props
}: HTMLAttributes<HTMLDivElement> & { pad?: CardPad }) {
  return (
    <div
      className={cn(CARD_SHEET, PADS[pad], className)}
      {...props}
    />
  );
}
