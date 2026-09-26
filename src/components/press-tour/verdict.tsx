import type { Verdict } from "@/lib/press-tour/campaign-types";
import type { Messages } from "@/lib/i18n/messages/en";
import { cn } from "@/lib/cn";
import s from "./press-tour.module.css";

// The fixed verdict set (synthesis S4/N2): ONE word and ONE shape per
// verdict, the same on every surface and in all four languages. Red is only
// ever "Didn't match". Nothing here says "locked".

export type PressWords = Messages["pressTour"];

export function verdictWord(v: Verdict, m: PressWords): string {
  switch (v) {
    case "match":
      return m.verdictMatch;
    case "didnt_match":
      return m.verdictDidntMatch;
    case "not_readable":
      return m.verdictNotReadable;
    case "product_missing":
      return m.verdictProductMissing;
    case "not_checked":
      return m.verdictNotChecked;
    case "no_one_in_shot":
      return m.verdictNoOne;
  }
}

const GLYPH: Record<Verdict, string> = {
  match: s.gMatch,
  didnt_match: s.gMiss,
  not_readable: s.gUnread,
  product_missing: s.gMissing,
  not_checked: s.gUnchecked,
  no_one_in_shot: s.gNone,
};

/** The verdict's shape: a tick disc, a cross square, a hatched square, a dashed square, a ring, a dash. */
export function Glyph({ v }: { v: Verdict }) {
  return (
    <i aria-hidden="true" className={cn(s.g, GLYPH[v])}>
      {v === "match" && (
        <svg viewBox="0 0 12 12">
          <path d="M3 6.3 5.1 8.3 9 4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {v === "didnt_match" && (
        <svg viewBox="0 0 12 12">
          <path d="M3.8 3.8 8.2 8.2M8.2 3.8 3.8 8.2" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        </svg>
      )}
    </i>
  );
}

/**
 * The press stamp a still wears: "Face · Match", "Product · Not readable",
 * or, for a packshot, simply "No one in this shot". A shot planned without
 * the product (a hook) wears "Product · Not planned" with the plain
 * dash: it is not a verdict, so it never reads as "Not checked" (PT-01).
 */
export function Stamp({ v, check, m, land, notPlanned }: { v: Verdict; check: string; m: PressWords; land?: boolean; notPlanned?: boolean }) {
  if (notPlanned) {
    return (
      <span className={s.stamp}>
        <Glyph v="no_one_in_shot" />
        <span className={s.k}>{check} ·</span>
        <span className="truncate">{m.productNotPlanned}</span>
      </span>
    );
  }
  return (
    <span className={cn(s.stamp, v === "match" && s.stampMatch, v === "didnt_match" && s.stampMiss, land && s.land)}>
      <Glyph v={v} />
      {v !== "no_one_in_shot" && <span className={s.k}>{check} ·</span>}
      <span className="truncate">{verdictWord(v, m)}</span>
    </span>
  );
}

/** The same verdict inline, for the phone's rows. */
export function VerdictInline({ v, m, notPlanned }: { v: Verdict; m: PressWords; notPlanned?: boolean }) {
  if (notPlanned) {
    return (
      <span className={s.vd}>
        <Glyph v="no_one_in_shot" />
        <span>{m.productNotPlanned}</span>
      </span>
    );
  }
  return (
    <span className={cn(s.vd, v === "match" && s.vdMatch, v === "didnt_match" && s.vdMiss)}>
      <Glyph v={v} />
      <span>{verdictWord(v, m)}</span>
    </span>
  );
}
