import type { HTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "@/lib/cn";

// The doors' dark theatre card: one literal-colour card every door stands in
// (Recast, Live, Recce and Director's Cut each carry a copy of it today:
// mystique-door.tsx, live-stage.tsx, recce-door.tsx, directors-cut.tsx).
// Press Tour is the first door built on this shared one (2026-09-26); the
// older doors keep their copies until they are touched for another reason.
//
// Literal colours on purpose, in both themes: the app theme redefines
// Tailwind's white near-black under html.screening.dark, so a door that
// wrote its text in Tailwind's white read dark grey on black (2026-09-19).
// Ochre is for proof only; no font-semibold on DM Mono (it is loaded at 400
// and 500).

/** The card's own colours, for a door's pieces that sit on it. */
export const DOOR_INK = {
  /** The card itself. */
  ground: "#0b0c10",
  /** Body text. */
  ink: "#c6c9d1",
  /** Titles. */
  title: "#ecedf1",
  /** The line under a title. */
  sub: "#9aa0ad",
  /** Small print, meta lines. */
  meta: "#858994",
} as const;

type DoorFrameProps = {
  children: ReactNode;
  /**
   * Extra classes on the card. They ADD to it: cn() does not merge, so never
   * pass a property the card already sets (its padding, radius, colours).
   */
  className?: string;
  /** Extra classes on the outer column (a scroll margin, say; never its width). */
  outerClassName?: string;
  /** The outer column, for a door that scrolls itself into view. */
  ref?: Ref<HTMLDivElement>;
} & Omit<HTMLAttributes<HTMLDivElement>, "className" | "children">;

/**
 * The dark card a door stands in, centred in the page's widest column.
 * `rest` (data-*, aria-*, id) lands on the card itself.
 */
export function DoorFrame({ children, className, outerClassName, ref, ...rest }: DoorFrameProps) {
  return (
    <div ref={ref} className={cn("mx-auto max-w-6xl", outerClassName)}>
      <div
        {...rest}
        className={cn(
          // A phone keeps a 12 px inset (the Red Carpet phone artboards): three
          // stills side by side need every pixel of a 390 px screen.
          "rounded-[28px] bg-[#0b0c10] px-3 pb-4 pt-4 text-[#c6c9d1] shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_32px_72px_-28px_rgba(0,0,0,0.7)] sm:px-8 sm:pb-6 sm:pt-7",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
