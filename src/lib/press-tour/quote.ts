// Press Tour's price: ONE money grammar, made here and printed by every
// surface (synthesis v2 N3). The door's receipt, the Generate mode, the
// Producer's card and MCP all show this object; none of them computes a
// price of its own (the door test forbids browser-side estimates).
//
// THE FORMULA (spec §7.2, v2 §3.3), from the credit weights in code, never
// from a number typed here:
//   paint   = Σ stills × the picture lane's weight (gpt-image at `high`,
//             image-resolution.ts: 1 credit a still)
//   animate = Σ shots × the film lane's weight for that shot's seconds
//             (kling-o3's catalogue row, video-models.ts: 5 s = 2 credits)
//   total   = paint + animate
// Both go through quoteSend (generations/quote.ts), the same function every
// other charge in the product is priced by, so a weight edited in the
// catalogue moves this price in the same commit and pricingAudit still
// holds it to its cost.
//
// POLICY (operator, 2026-09-26): no re-shoot of any kind before the checker
// is calibrated ("off"), and no refund for a miss (false). A miss shows its
// verdict; the person may repaint a still at its normal price (N4: always 1
// credit) or, in a later cut, re-film a shot at its normal price.
//
// Alias-free (vitest has no "@/"): quote.test.ts imports it as it is.

import { quoteSend } from "../generations/quote";
import type { PressQuote, QuoteRow } from "./campaign-types";

/** Bumped whenever the formula or the lanes below change, so a stored quote is known to be stale. */
export const PRESS_QUOTE_VERSION = 1;

/** The picture lane stills are painted on (spec §1.5: GPT Image `high` until the bake-off says otherwise). */
export const STILL_LANE = { modelId: "gpt-image", quality: "high" } as const;

/** The film lane shots will be animated on (spec §1.7: kling-o3 first frame until the bake-off). */
export const FILM_LANE = { modelId: "kling-o3" } as const;

/** The launch policy every surface prints (operator, 2026-09-26). */
export const PRESS_POLICY: PressQuote["policy"] = { reshoot: "off", refund: false };

/** A person's repaint of one still: always the still's own price (N4). */
export function repaintCredits(): number {
  return stillCredits();
}

/** One still, at the picture lane's weight. */
export function stillCredits(): number {
  return quoteSend({
    contentType: "image",
    imageModelId: STILL_LANE.modelId,
    imageQuality: STILL_LANE.quality,
    imageResolution: null,
    videoModelId: FILM_LANE.modelId,
    videoDurationSeconds: 5,
    videoResolution: null,
    storyboardTotalSeconds: null,
    referencePhotoCount: 0,
    framePicked: false,
    continuationSourceSeconds: null,
    dialoguePresent: false,
    renderCount: 1,
  }).totalCredits;
}

/**
 * One shot of `seconds`, filmed from its approved still. Silent in v1
 * (critique #18: no dialogue surcharge), the still riding as the lane's own
 * first frame (no start/end frame surcharge).
 */
export function shotCredits(seconds: number): number {
  return quoteSend({
    contentType: "video",
    videoModelId: FILM_LANE.modelId,
    videoDurationSeconds: seconds,
    videoResolution: null,
    storyboardTotalSeconds: null,
    referencePhotoCount: 0,
    framePicked: false,
    continuationSourceSeconds: null,
    dialoguePresent: false,
    renderCount: 1,
  }).totalCredits;
}

export type QuoteInput = {
  /** Every shot of the plan, in order: one still and one filmed shot each. */
  shots: readonly { seconds: number }[];
  /** The account's spendable credits right now. */
  balanceNow: number;
  /** The stills have been charged. */
  paintPaid: boolean;
  /** The filming has been charged. */
  animatePaid: boolean;
  /** The account's one free first ad (a later cut): nothing is charged. */
  trial: boolean;
  /** False for an account whose credits never move (admins): the balance after is the balance now. */
  charged: boolean;
};

/** The quote, from the plan's shots and the account's balance. Pure. */
export function buildPressQuote(input: QuoteInput): PressQuote {
  const trial = input.trial === true;
  const paint = trial ? 0 : input.shots.length * stillCredits();
  const animate = trial ? 0 : input.shots.reduce((sum, s) => sum + shotCredits(s.seconds), 0);
  const balanceNow = Math.max(0, Math.floor(Number.isFinite(input.balanceNow) ? input.balanceNow : 0));
  // What the NEXT press spends: the stills until they are paid, then the filming.
  const next = !input.paintPaid ? paint : !input.animatePaid ? animate : 0;
  const moves = input.charged && !trial;
  const rows: QuoteRow[] = [
    { key: "stills", credits: paint, paid: input.paintPaid },
    { key: "film", credits: animate, paid: input.animatePaid },
    // Absorbed in v1 (spec §7.2): shown as "included".
    { key: "checks", credits: 0, paid: false },
    { key: "posting", credits: 0, paid: false },
  ];
  return {
    version: PRESS_QUOTE_VERSION,
    paint,
    animate,
    total: paint + animate,
    rows,
    policy: { ...PRESS_POLICY },
    balanceNow,
    balanceAfterNextStep: moves ? Math.max(0, balanceNow - next) : balanceNow,
    trial,
  };
}

const QUOTE_KEYS: readonly QuoteRow["key"][] = ["stills", "film", "checks", "posting"];
const nonNegInt = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

/** A stored quote as the code reads it, or null when it is not one (a stale or malformed row is re-quoted). */
export function parsePressQuote(raw: unknown): PressQuote | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const version = nonNegInt(r.version);
  const paint = nonNegInt(r.paint);
  const animate = nonNegInt(r.animate);
  const total = nonNegInt(r.total);
  const balanceNow = nonNegInt(r.balanceNow);
  const balanceAfter = nonNegInt(r.balanceAfterNextStep);
  if (version === null || paint === null || animate === null || total === null || total !== paint + animate) return null;
  if (balanceNow === null || balanceAfter === null) return null;
  if (!Array.isArray(r.rows)) return null;
  const rows: QuoteRow[] = [];
  for (const row of r.rows) {
    if (!row || typeof row !== "object") return null;
    const { key, credits, paid } = row as Record<string, unknown>;
    const c = nonNegInt(credits);
    if (typeof key !== "string" || !(QUOTE_KEYS as readonly string[]).includes(key) || c === null || typeof paid !== "boolean") return null;
    rows.push({ key: key as QuoteRow["key"], credits: c, paid });
  }
  const policy = r.policy as Record<string, unknown> | null | undefined;
  const reshoot = policy?.reshoot;
  if (reshoot !== "off" && reshoot !== "person" && reshoot !== "auto") return null;
  if (typeof policy?.refund !== "boolean") return null;
  return {
    version,
    paint,
    animate,
    total,
    rows,
    policy: { reshoot, refund: policy.refund },
    balanceNow,
    balanceAfterNextStep: balanceAfter,
    trial: r.trial === true,
  };
}

/**
 * Whether the price a person saw differs from the price now: another
 * formula version, or another paint or filming price. The balance lines
 * are not the price and never count.
 */
export function quotePriceChanged(seen: PressQuote | null, now: PressQuote): boolean {
  if (!seen) return true;
  return seen.version !== now.version || seen.paint !== now.paint || seen.animate !== now.animate || seen.trial !== now.trial;
}
