// What the Press Tour door decides on its own, as pure rules (Cut 1 UI,
// direction A "Red Carpet"). Everything here reads the engine's view
// (campaign-types.ts) and never prices anything: every number the door
// prints is the server's quote. The door, its test and door-view.test.ts
// share these, so a rule changes in one place.
//
// Alias-free and import-free at runtime (vitest has no "@/"; the client
// bundle must not pull a server module): only types come in.

import type { CampaignStage, PressQuote, StillView, Verdict } from "./campaign-types";
import type { ProductCard } from "./types";

// ---------------------------------------------------------------------------
// The route: five stops, in the order they happen (spec §1.12 stages mapped
// onto the rail the operator picked: Plan · Stills · Film · Press wall ·
// Press line, forking to the networks).
// ---------------------------------------------------------------------------

export const ROUTE_STOPS = ["plan", "stills", "film", "wall", "line"] as const;
export type RouteStop = (typeof ROUTE_STOPS)[number];

/** Which stop an ad is at (0..4). No campaign, or a closed one, is at the Plan. */
export function routeIndex(stage: CampaignStage | null): number {
  switch (stage) {
    case "painting":
    case "checking_keyframes":
    case "awaiting_approval":
      return 1;
    case "animating":
      return 2;
    case "checking_shots":
    case "assembling":
    case "signing":
      return 3;
    case "ready":
      return 4;
    default:
      return 0;
  }
}

/** Stages the engine is working through on its own: the door asks again until they pass. */
const WORKING: readonly CampaignStage[] = ["draft", "painting", "checking_keyframes", "animating", "checking_shots", "assembling", "signing"];
export function isWorking(stage: CampaignStage): boolean {
  return WORKING.includes(stage);
}

const CLOSED: readonly CampaignStage[] = ["failed", "cancelled", "expired"];
export function isClosed(stage: CampaignStage): boolean {
  return CLOSED.includes(stage);
}

/** How often the door asks for the ad again while the engine works. */
export const POLL_MS = 4000;

// ---------------------------------------------------------------------------
// Stills and their checks. The verdict words are fixed (synthesis S4/N2);
// only these two rules decide what the door does with them.
// ---------------------------------------------------------------------------

/** A face check that asks nothing of the person: a match, or a packshot with no one in it. */
const FACE_CLEAR: readonly Verdict[] = ["match", "no_one_in_shot"];

export function stillPainted(still: StillView): boolean {
  return typeof still.imageUrl === "string" && still.imageUrl.length > 0;
}

/**
 * The product check applies to this still: its shot was planned to show the
 * product. A hook planned with the star alone has nothing to check (PT-01).
 */
export function productChecked(still: StillView): boolean {
  return still.productExpected !== false;
}

/** Every check that applies matched: the still can simply be approved. */
export function stillAllClear(still: StillView): boolean {
  return stillPainted(still) && FACE_CLEAR.includes(still.face) && (!productChecked(still) || still.product === "match");
}

/**
 * The flashbulb (the one motion, N10): the star is in the frame and every
 * check that applies matched (synthesis v2: "every applicable check
 * matched"). A hook planned without the product flashes on its face alone;
 * a packshot with no one in it gets the still afterglow instead, because the
 * flash is the press photographing the star.
 */
export function stillFlashes(still: StillView): boolean {
  return stillPainted(still) && still.face === "match" && (!productChecked(still) || still.product === "match");
}

/** A painted still whose checks did not all clear: it waits for Keep as is, or a repaint. */
export function stillNeedsDecision(still: StillView): boolean {
  return stillPainted(still) && !stillAllClear(still);
}

export function decidedCount(stills: readonly StillView[]): number {
  return stills.filter((s) => s.decision !== "pending").length;
}

/** The first still that waits on the person, or null. */
export function firstWaiting(stills: readonly StillView[]): StillView | null {
  return stills.find((s) => s.decision === "pending" && stillNeedsDecision(s)) ?? null;
}

/** "0:05–0:10" for a shot's place in the cut. */
export function spanLabel(span: readonly [number, number]): string {
  const clock = (s: number) => {
    const whole = Math.max(0, Math.floor(s));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
  };
  return `${clock(span[0])}–${clock(span[1])}`;
}

/** "01" for shot 1. */
export function shotNumber(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(2, "0");
}

/** The ad's length in seconds, from the stills the engine planned (the last span's end). */
export function plannedSeconds(stills: readonly StillView[]): number {
  return stills.reduce((end, s) => Math.max(end, s.span[1]), 0);
}

/** One shot's length, when every shot is the same (v1: 5 s each), else null. */
export function shotSeconds(stills: readonly StillView[]): number | null {
  const lengths = new Set(stills.map((s) => s.span[1] - s.span[0]));
  return lengths.size === 1 ? [...lengths][0] : null;
}

// ---------------------------------------------------------------------------
// Money: which spend comes next. Selection only: the numbers are the quote's.
// ---------------------------------------------------------------------------

export function nextSpend(quote: PressQuote | null): "paint" | "film" | null {
  if (!quote) return null;
  const stills = quote.rows.find((r) => r.key === "stills");
  const film = quote.rows.find((r) => r.key === "film");
  if (stills && !stills.paid) return "paint";
  if (film && !film.paid) return "film";
  return null;
}

// ---------------------------------------------------------------------------
// The networks the Press line forks to, as their switches say today. Nothing
// is "Ready" until its posting switch is on (Cut 5/7): the rail never claims
// a network that cannot take a post.
// ---------------------------------------------------------------------------

export type NetworkState = "ready" | "privateTest" | "comingSoon";
export type NetworkStates = { x: NetworkState; tiktok: NetworkState; instagram: NetworkState };

export function networkStates(sw: {
  press_tour_posting: boolean;
  press_post_x: boolean;
  press_post_tiktok_direct: boolean;
  press_post_meta: boolean;
}): NetworkStates {
  const posting = sw.press_tour_posting === true;
  return {
    x: posting && sw.press_post_x === true ? "ready" : "comingSoon",
    // TikTok and Meta open to testers first: a private test, never "Ready".
    tiktok: posting && sw.press_post_tiktok_direct === true ? "privateTest" : "comingSoon",
    instagram: posting && sw.press_post_meta === true ? "privateTest" : "comingSoon",
  };
}

// ---------------------------------------------------------------------------
// What blocks planning, before any campaign exists. The engine checks all of
// it again; this only lets the door say so before a press.
// ---------------------------------------------------------------------------

export type StarAnswer = "me" | "permission" | "not_a_person";

export type PlanBlock = "email" | "star" | "starPhoto" | "starAnswer" | "product" | "productRefused" | "productCard" | null;

export function planBlock(input: {
  emailConfirmed: boolean;
  star: { photoCount: number; adAnswer: StarAnswer | null } | null;
  product: Pick<ProductCard, "status" | "category"> | null;
}): PlanBlock {
  if (!input.emailConfirmed) return "email";
  if (!input.star) return "star";
  if (input.star.photoCount === 0) return "starPhoto";
  if (!input.star.adAnswer) return "starAnswer";
  if (!input.product) return "product";
  if (input.product.category === "regulated") return "productRefused";
  if (input.product.status !== "confirmed") return "productCard";
  return null;
}

// ---------------------------------------------------------------------------
// The product card sheet: what blocks Save (card-service.ts checks the same
// on the server, and its sentences are what the person reads if they differ).
// ---------------------------------------------------------------------------

/** card-service.ts ANGLES_MIN / ANGLES_MAX (door-view.test.ts pins them equal). */
export const PICK_MIN = 3;
export const PICK_MAX = 5;

export type CardBlock = "photos" | "front" | "words" | "consent" | "star" | null;

export function cardSaveBlock(input: {
  picked: number;
  hasFront: boolean;
  words: number;
  noReadableText: boolean;
  consent: boolean;
  /** The star still needs its answer (section 5 is shown). */
  starOpen: boolean;
  starAnswered: boolean;
}): CardBlock {
  if (input.picked < PICK_MIN || input.picked > PICK_MAX) return "photos";
  if (!input.hasFront) return "front";
  if (!input.noReadableText && input.words === 0) return "words";
  if (!input.consent) return "consent";
  if (input.starOpen && !input.starAnswered) return "star";
  return null;
}

/** A logo box, kept inside the photo and never smaller than a sliver. */
export type Box = { x: number; y: number; w: number; h: number };
export const BOX_MIN = 0.04;

export function clampBox(b: Box): Box {
  const w = Math.min(1, Math.max(BOX_MIN, Number.isFinite(b.w) ? b.w : BOX_MIN));
  const h = Math.min(1, Math.max(BOX_MIN, Number.isFinite(b.h) ? b.h : BOX_MIN));
  const x = Math.min(1 - w, Math.max(0, Number.isFinite(b.x) ? b.x : 0));
  const y = Math.min(1 - h, Math.max(0, Number.isFinite(b.y) ? b.y : 0));
  const round = (n: number) => Math.round(n * 10000) / 10000;
  return { x: round(x), y: round(y), w: round(Math.min(w, 1 - round(x))), h: round(Math.min(h, 1 - round(y))) };
}

/** The host of a product's page, for the "solstad.coffee · 4 photos" line. */
export function sourceHost(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}
