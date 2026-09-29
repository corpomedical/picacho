// Press Tour's price: ONE money grammar, made here and printed by every
// surface (synthesis v2 N3). The door's receipt, the Generate mode, the
// Producer's card and MCP all show this object; none of them computes a
// price of its own (the door test forbids browser-side estimates).
//
// THE FORMULA (spec §7.2, v2 §3.3), from the credit weights in code, never
// from a number typed here:
//   paint   = Σ stills × the picked engine's weight (image-resolution.ts):
//             GPT Image at `high` $0.0909 -> 1 credit a still; Nano Banana
//             Pro (Gemini) 2K $0.15 -> weigh(0.15) = ceil(0.15 / 0.28) = 1
//             credit a still
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
import { getImageModel } from "../generations/providers/image-models";
import { imageResolutionOffers, type ImageAspect, type ImageQuality, type ImageResolution } from "../generations/providers/image-resolution";
import type { PressQuote, QuoteRow, StillEngine, StillEngineOffer } from "./campaign-types";

/** Bumped whenever the formula or the lanes below change, so a stored quote is known to be stale. */
export const PRESS_QUOTE_VERSION = 1;

/** One picture engine's lane: the catalogue id and the exact band a still is asked for (and priced at). */
export type StillLane = {
  modelId: StillEngine;
  quality: ImageQuality | null;
  resolution: ImageResolution | null;
  aspect: ImageAspect | null;
};

/**
 * The picture engines a person picks between before painting (operator,
 * 2026-09-29). GPT Image `high` at 1024x1536 is the default (spec §1.5);
 * Nano Banana Pro ("gemini") at 2K in the tall 2:3, the same frame the crop
 * was tuned on, at fal's $0.15 a picture (1K and 2K are one price; 4K is
 * never asked for here). No automatic fallback between them: a refusal on
 * the pick stays a refusal (providers/image.ts).
 */
export const STILL_LANES: Readonly<Record<StillEngine, StillLane>> = {
  "gpt-image": { modelId: "gpt-image", quality: "high", resolution: null, aspect: null },
  gemini: { modelId: "gemini", quality: null, resolution: "2K", aspect: "2:3" },
};

export const STILL_ENGINES: readonly StillEngine[] = ["gpt-image", "gemini"];
export const DEFAULT_STILL_ENGINE: StillEngine = "gpt-image";

/** The default picture lane (GPT Image `high`), for callers that name no engine. */
export const STILL_LANE = STILL_LANES[DEFAULT_STILL_ENGINE];

export function isStillEngine(v: unknown): v is StillEngine {
  return typeof v === "string" && (STILL_ENGINES as readonly string[]).includes(v);
}

/** The engine a plan (or anything carrying one) names; GPT Image when it names none. */
export function stillEngineOf(carrier: { engine?: unknown } | null | undefined): StillEngine {
  return isStillEngine(carrier?.engine) ? carrier.engine : DEFAULT_STILL_ENGINE;
}

/**
 * What one still costs us on a fal lane, from the lane's own price row
 * (image-resolution.ts): no usage comes back from fal, so this is what is
 * booked. GPT Image reports its own (openai-images.ts onUsage): 0 here.
 */
export function stillLaneUsd(engine: StillEngine): number {
  const lane = STILL_LANES[engine];
  if (engine === "gpt-image") return 0;
  return imageResolutionOffers(lane.modelId).find((o) => o.value === lane.resolution)?.costPerImageUsd ?? 0;
}

/** Every engine as the quote prints it: its name and one still's price. */
export function stillEngineOffers(): StillEngineOffer[] {
  return STILL_ENGINES.map((id) => ({ id, name: getImageModel(id).name, credits: stillCredits(id) }));
}

/** The film lane shots will be animated on (spec §1.7: kling-o3 first frame until the bake-off). */
export const FILM_LANE = { modelId: "kling-o3" } as const;

/** The launch policy every surface prints (operator, 2026-09-26). */
export const PRESS_POLICY: PressQuote["policy"] = { reshoot: "off", refund: false };

/** A person's repaint of one still: always the still's own price on its engine (N4). */
export function repaintCredits(engine: StillEngine = DEFAULT_STILL_ENGINE): number {
  return stillCredits(engine);
}

/** One still, at the picked engine's weight. */
export function stillCredits(engine: StillEngine = DEFAULT_STILL_ENGINE): number {
  const lane = STILL_LANES[engine];
  return quoteSend({
    contentType: "image",
    imageModelId: lane.modelId,
    imageQuality: lane.quality,
    imageResolution: lane.resolution,
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
  /** The picture engine the stills are painted on (default GPT Image). */
  engine?: StillEngine;
};

/** The quote, from the plan's shots and the account's balance. Pure. */
export function buildPressQuote(input: QuoteInput): PressQuote {
  const trial = input.trial === true;
  const engine = isStillEngine(input.engine) ? input.engine : DEFAULT_STILL_ENGINE;
  const paint = trial ? 0 : input.shots.length * stillCredits(engine);
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
    engine,
    engines: stillEngineOffers(),
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
    engine: isStillEngine(r.engine) ? r.engine : DEFAULT_STILL_ENGINE,
    engines: parseEngineOffers(r.engines),
  };
}

function parseEngineOffers(raw: unknown): StillEngineOffer[] {
  if (!Array.isArray(raw)) return [];
  const out: StillEngineOffer[] = [];
  for (const o of raw) {
    const x = (o ?? {}) as Record<string, unknown>;
    const credits = nonNegInt(x.credits);
    if (!isStillEngine(x.id) || typeof x.name !== "string" || credits === null) return [];
    out.push({ id: x.id, name: x.name.slice(0, 60), credits });
  }
  return out;
}

/**
 * Whether the price a person saw differs from the price now: another
 * formula version, another paint or filming price, or another engine. The balance lines
 * are not the price and never count.
 */
export function quotePriceChanged(seen: PressQuote | null, now: PressQuote): boolean {
  if (!seen) return true;
  return (
    seen.version !== now.version ||
    seen.paint !== now.paint ||
    seen.animate !== now.animate ||
    seen.trial !== now.trial ||
    (seen.engine ?? DEFAULT_STILL_ENGINE) !== now.engine
  );
}
