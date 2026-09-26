// The ad as Claude and ChatGPT see it: ONE projection of the campaign
// engine's CampaignView (campaign-types.ts), sent as the tool result's
// structuredContent. The model reads it; Picacho's card (widget.ts) draws
// it. No lane, cost, raw score or attempt history (synthesis #30), no money
// but credits, and every count from the record.
//
// The card's one-time code for a paid step is NOT here: it rides in the
// result's _meta, which hosts hand to the card and never to the model
// (nonce.ts).
//
// Pure and alias-free.

import type { CampaignStage, CampaignView, StillView, Verdict } from "../../press-tour/campaign-types";
import { PRODUCT_NOT_CONFIRMED } from "../../press-tour/campaign-messages";
import { CHECKS_LINE, POLICY_LINE, STAGE_LINES, shortOfCredits } from "./messages";

export const AD_CARD_VERSION = 1;

export type AdCardStill = {
  shot: number;
  role: StillView["role"];
  span: [number, number];
  image_url: string | null;
  face: Verdict;
  /** "not_planned" for a shot planned without the product (its check does not apply). */
  product: Verdict | "not_planned";
  reason: string | null;
  decision: StillView["decision"];
  /** Still being painted (no picture yet). */
  painting: boolean;
  house_repainted: boolean;
};

export type AdCardQuote = {
  total: number;
  paint: number;
  animate: number;
  paint_paid: boolean;
  film_paid: boolean;
  balance_now: number;
  balance_after_next_step: number;
  /** A person's repaint of one still (N4: always the still's own price). */
  repaint_credits: number;
  /** The launch policy, in words (quote.policy). */
  policy: string;
};

/**
 * What the person can do next:
 *   paint              paint the stills (a tap on the card)
 *   wait               we're working; the card polls
 *   decide             approve or keep each still (free)
 *   film               film the shots (a tap on the card)
 *   film_in_picacho    the stills are decided; filming opens in Picacho
 *   set_up_product     the product's card needs confirming in Picacho
 *   finish_in_picacho  something only Picacho's own page can ask (the star's ad-use answer)
 *   post               the ad is ready; the press line is in Picacho
 *   closed             stopped, failed or expired
 */
export type AdCardNext =
  | "paint"
  | "wait"
  | "decide"
  | "film"
  | "film_in_picacho"
  | "set_up_product"
  | "finish_in_picacho"
  | "post"
  | "closed";

export type AdCard = {
  kind: "press_tour_ad";
  version: number;
  plan_id: string | null;
  stage: CampaignStage | null;
  title: string | null;
  star: string | null;
  product: string | null;
  cut: { shots: number; seconds: number; aspect: "9:16" } | null;
  checks: string;
  poster_url: string | null;
  stills: AdCardStill[];
  quote: AdCardQuote | null;
  /** The worst product verdict among the painted stills that carry the product, or null before any. */
  product_verdict: Verdict | null;
  blocker: string | null;
  error: string | null;
  next: AdCardNext;
  /** Set when the next paid step needs more credits than the account has. */
  short_by: { needed: number; have: number } | null;
  /** Whether filming can be started from the card (Cut 4's film step, when it lands). */
  film_open: boolean;
  open_url: string;
  press_line_url: string | null;
  /** One line for the model: where the ad is, and what happens next. */
  summary: string;
};

const CLOSED: readonly CampaignStage[] = ["failed", "cancelled", "expired"];
const VERDICT_RANK: Verdict[] = ["didnt_match", "product_missing", "not_readable", "not_checked", "match"];

/** The door, opened on this ad (the page reads ?campaign=<id>: app/app/press-tour/page.tsx fromAddress). */
export function doorUrl(origin: string, planId: string | null): string {
  return planId ? `${origin}/app/press-tour?campaign=${planId}` : `${origin}/app/press-tour`;
}

/** The press line, on the door. */
export function pressLineUrl(origin: string, planId: string): string {
  return `${origin}/app/press-tour?campaign=${planId}#press-line`;
}

function absolute(url: string | null, origin: string): string | null {
  if (!url) return null;
  if (url.startsWith("/")) return `${origin}${url}`;
  return /^https:\/\//.test(url) ? url : null;
}

function worstProductVerdict(stills: readonly AdCardStill[]): Verdict | null {
  const read = stills.filter((s) => !s.painting && s.product !== "not_planned").map((s) => s.product as Verdict);
  if (read.length === 0) return null;
  for (const v of VERDICT_RANK) if (read.includes(v)) return v;
  return null;
}

export type CardContext = {
  origin: string;
  /** False for an account whose credits never move (admins): a short balance never blocks it. */
  charged: boolean;
  /** Whether the film step can be started from the card. */
  filmOpen: boolean;
  starName: string | null;
  productName: string | null;
  /** A picture for the card before any still is painted (the star's photo), relative or absolute. */
  posterFallback: string | null;
  repaintCredits: number;
};

/** The campaign as the card and the model see it. */
export function adCardFromView(view: CampaignView, ctx: CardContext): AdCard {
  const painting = view.stage === "painting" || view.stage === "checking_keyframes" || view.stage === "draft";
  const stills: AdCardStill[] = view.stills.map((s) => ({
    shot: s.shot,
    role: s.role,
    span: [s.span[0], s.span[1]],
    image_url: absolute(s.imageUrl, ctx.origin),
    face: s.face,
    product: s.productExpected ? s.product : "not_planned",
    reason: s.reason,
    decision: s.decision,
    painting: s.imageUrl === null && painting,
    house_repainted: s.houseRepainted,
  }));
  const q = view.quote;
  const quote: AdCardQuote | null = q
    ? {
        total: q.total,
        paint: q.paint,
        animate: q.animate,
        paint_paid: q.rows.some((r) => r.key === "stills" && r.paid),
        film_paid: q.rows.some((r) => r.key === "film" && r.paid),
        balance_now: q.balanceNow,
        balance_after_next_step: q.balanceAfterNextStep,
        repaint_credits: ctx.repaintCredits,
        policy: POLICY_LINE,
      }
    : null;

  let next: AdCardNext;
  let shortBy: AdCard["short_by"] = null;
  if (CLOSED.includes(view.stage)) next = "closed";
  else if (view.stage === "ready") next = "post";
  else if (view.stage === "planned") {
    if (view.blocker === PRODUCT_NOT_CONFIRMED) next = "set_up_product";
    else if (view.blocker) next = "finish_in_picacho";
    else {
      next = "paint";
      if (quote && ctx.charged && !quote.paint_paid && quote.paint > quote.balance_now) {
        shortBy = { needed: quote.paint, have: quote.balance_now };
      }
    }
  } else if (view.stage === "awaiting_approval" && (view.shots ?? []).length > 0) {
    // Filmed: a shot waits on the press wall (keep a take, film it again,
    // or cut it). Those choices are made on Picacho's own page in v1.
    next = "finish_in_picacho";
  } else if (view.stage === "awaiting_approval") {
    const undecided = stills.some((s) => s.painting || s.decision === "pending");
    if (undecided) next = "decide";
    else if (ctx.filmOpen) {
      next = "film";
      if (quote && ctx.charged && !quote.film_paid && quote.animate > quote.balance_now) {
        shortBy = { needed: quote.animate, have: quote.balance_now };
      }
    } else next = "film_in_picacho";
  } else next = "wait";

  const firstStill = stills.find((s) => s.image_url)?.image_url ?? null;
  const card: AdCard = {
    kind: "press_tour_ad",
    version: AD_CARD_VERSION,
    plan_id: view.id,
    stage: view.stage,
    title: view.angle,
    star: ctx.starName,
    product: ctx.productName,
    cut: { shots: view.stills.length, seconds: view.lengthSeconds, aspect: "9:16" },
    checks: CHECKS_LINE,
    poster_url: firstStill ?? absolute(ctx.posterFallback, ctx.origin),
    stills,
    quote,
    product_verdict: worstProductVerdict(stills),
    blocker: view.blocker,
    error: view.error,
    next,
    short_by: shortBy,
    film_open: ctx.filmOpen,
    open_url: doorUrl(ctx.origin, view.id),
    press_line_url: view.stage === "ready" ? pressLineUrl(ctx.origin, view.id) : null,
    summary: "",
  };
  card.summary = summaryOf(card);
  return card;
}

/** The card for a product that needs its card confirmed before any plan exists. */
export function setUpProductCard(ctx: { origin: string; productName: string | null; starName: string | null; posterFallback: string | null }): AdCard {
  const card: AdCard = {
    kind: "press_tour_ad",
    version: AD_CARD_VERSION,
    plan_id: null,
    stage: null,
    title: null,
    star: ctx.starName,
    product: ctx.productName,
    cut: null,
    checks: CHECKS_LINE,
    poster_url: absolute(ctx.posterFallback, ctx.origin),
    stills: [],
    quote: null,
    product_verdict: null,
    blocker: PRODUCT_NOT_CONFIRMED,
    error: null,
    next: "set_up_product",
    short_by: null,
    film_open: false,
    open_url: doorUrl(ctx.origin, null),
    press_line_url: null,
    summary: "",
  };
  card.summary = summaryOf(card);
  return card;
}

/** One paragraph for the model, built only from the card's own fields. */
export function summaryOf(card: AdCard): string {
  const parts: string[] = [];
  if (card.stage) parts.push(STAGE_LINES[card.stage] ?? "");
  if (card.error) parts.push(card.error);
  else if (card.blocker && card.next !== "decide") parts.push(card.blocker);
  if (card.quote) {
    parts.push(
      `Quote: ${card.quote.total} credits (${card.quote.paint} for the stills${card.quote.paint_paid ? ", paid" : ""}, ${card.quote.animate} to film).`,
    );
  }
  if (card.short_by) parts.push(shortOfCredits(card.short_by.needed, card.short_by.have));
  switch (card.next) {
    case "paint":
      parts.push("The stills are painted only when the person taps Paint on Picacho's card; you can't start it for them.");
      break;
    case "decide":
      parts.push("The person approves or keeps each still on Picacho's card.");
      break;
    case "film":
      parts.push("Filming starts only when the person taps Film on Picacho's card.");
      break;
    case "set_up_product":
    case "finish_in_picacho":
      parts.push(`The person finishes this in Picacho: ${card.open_url}`);
      break;
    case "post":
      if (card.press_line_url) parts.push(`The ad posts from Picacho's press line: ${card.press_line_url}`);
      break;
    default:
      break;
  }
  return parts.filter(Boolean).join(" ");
}
