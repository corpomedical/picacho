// What Director's Cut charges, in credits (operator, 2026-10-03, on opening
// it to paying customers: "Pay what it uses", every paid plan). Pure
// arithmetic, so the page quotes exactly what the server holds.
//
// The rule is Live's: a cut or a change HOLDS the most it can cost, and when
// Opus is done you pay what it used — the rest comes back. No video, nothing
// charged. Music and Export are fixed prices, refunded when they fail.
//
// Why it can't lose money: the editing platform stops Opus at a hard budget
// (agent.ts — CUT_BUDGET_USD for the first cut, CHANGE_BUDGET_USD more for
// each change), and the hold always covers that budget plus OVERSHOOT_USD
// (the one request already running when the budget is reached, and the
// session's running time) plus the footage's download. One credit carries
// at most CREDIT_USD of our cost — the house rule every lane prices by
// (effects/catalog.ts USD_PER_CREDIT, recast.ts, Live), which keeps every
// plan and pack at 32% or more on its worst month (Studio, 27% VAT inside).
//
// Unit prices, each read at source on 2026-10-03:
//  - Opus 5.5 in the editing sandbox: the platform reports each session's
//    list cost itself (agent.ts readSession); three real first cuts cost
//    $2.09, $2.26 and $2.77 (MEASURED_CUT_USD).
//  - Whisper: prices.ts (each clip is listened to twice).
//  - Download of the footage to the sandbox and the renderer: Supabase Pro,
//    "250 GB included, then $0.09 per GB" (supabase.com/pricing).
//  - Export: HeyGen's HyperFrames renderer, 1080p / 30 fps, $0.10 a minute
//    (their listing; their own docs say 0.1 credit a minute at $0.50 a
//    credit — the higher reading is used).
//  - Music: composer.ts (ElevenLabs $0.60 per started minute per take,
//    ACE-Step $0.0002 a second).
//
// When the one-balance switch lands (docs/CREDITS_V2.md, 2¢ credits), these
// prices move by changing CREDIT_USD — nothing else here names a credit.

import { composeCostUsd, type ComposerEngine } from "./composer";
import { whisperCostUsd } from "./prices";

/** The most of our cost one credit may carry, US dollars. */
export const CREDIT_USD = 0.28;
/** Opus's hard budget for a first cut, US dollars (agent.ts sends it as the session's limit). */
export const CUT_BUDGET_USD = 4;
/** What each change may add to the session's budget, US dollars. */
export const CHANGE_BUDGET_USD = 2;
/** The request already running when the budget is reached, plus the session's running time. */
export const OVERSHOOT_USD = 0.6;
export const EGRESS_USD_PER_GB = 0.09;
export const EXPORT_USD_PER_MINUTE = 0.1;
/** The renderer takes bundles up to 200 MB (heygen.ts); its download is priced at that size. */
const EXPORT_BUNDLE_USD = 0.2 * EGRESS_USD_PER_GB;

/** The list cost of the three real first cuts so far (2026-09-24/25), US dollars. */
export const MEASURED_CUT_USD = [2.09, 2.26, 2.77] as const;

/** Credits for a dollar cost: rounded up, at least one. */
export function creditsForUsd(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 1;
  return Math.max(1, Math.ceil(usd / CREDIT_USD - 1e-9));
}

export function egressUsd(bytes: number): number {
  return (Math.max(0, Number(bytes) || 0) / 1e9) * EGRESS_USD_PER_GB;
}

/** What starting a cut holds: Opus's whole budget, the overshoot, and the footage's download. */
export function cutHold(footageBytes: number): number {
  return creditsForUsd(CUT_BUDGET_USD + OVERSHOOT_USD + egressUsd(footageBytes));
}

/** What asking for a change holds: the change's budget, the overshoot, and the footage (and song) again. */
export function changeHold(footageBytes: number): number {
  return creditsForUsd(CHANGE_BUDGET_USD + OVERSHOOT_USD + egressUsd(footageBytes));
}

/** What most first cuts come to, from the real ones (with a typical pile's listening and download). */
export function typicalCut(): { low: number; high: number } {
  const extras = whisperCostUsd(120) * 2 + egressUsd(500e6);
  return { low: creditsForUsd(Math.min(...MEASURED_CUT_USD) + extras), high: creditsForUsd(Math.max(...MEASURED_CUT_USD) + extras) };
}

/**
 * What a finished turn costs the customer: what Opus used in it, the
 * listening (first cut only) and the download, rounded up — never more than
 * was held.
 */
export function turnCharge(input: { sessionUsd: number; whisperUsd: number; footageBytes: number; held: number }): number {
  const usd = Math.max(0, input.sessionUsd) + Math.max(0, input.whisperUsd) + egressUsd(input.footageBytes);
  return Math.min(Math.max(0, input.held), creditsForUsd(usd));
}

/** Composing music: the engine's price for the takes asked for. */
export function composeCredits(engine: ComposerEngine, seconds: number, takes: number): number {
  return creditsForUsd(composeCostUsd(engine, seconds, takes));
}

/** Exporting the timeline: the renderer's per-minute price and the bundle's download. */
export function exportCredits(seconds: number): number {
  const minutes = Math.max(1, Math.ceil((Number(seconds) || 0) / 60));
  return creditsForUsd(minutes * EXPORT_USD_PER_MINUTE + EXPORT_BUNDLE_USD);
}

/** The cents the editing platform is told for a first cut. */
export const CUT_BUDGET_CENTS = Math.round(CUT_BUDGET_USD * 100);
/** The cents a change adds to the session's budget. */
export const CHANGE_BUDGET_CENTS = Math.round(CHANGE_BUDGET_USD * 100);
