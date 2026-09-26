// What the Press Tour door decides on its own, as pure rules (Cut 1 UI,
// direction A "Red Carpet"). Everything here reads the engine's view
// (campaign-types.ts) and never prices anything: every number the door
// prints is the server's quote. The door, its test and door-view.test.ts
// share these, so a rule changes in one place.
//
// Alias-free and import-free at runtime (vitest has no "@/"; the client
// bundle must not pull a server module): only types come in.

import type { CampaignStage, MomentView, PressQuote, ShotView, StillView, TakeView, Verdict } from "./campaign-types";
import type { ProductCard, ProductView } from "./types";

// ---------------------------------------------------------------------------
// The route: five stops, in the order they happen (spec §1.12 stages mapped
// onto the rail the operator picked: Plan · Stills · Film · Press wall ·
// Press line, forking to the networks).
// ---------------------------------------------------------------------------

export const ROUTE_STOPS = ["plan", "stills", "film", "wall", "line"] as const;
export type RouteStop = (typeof ROUTE_STOPS)[number];

/**
 * Which stop an ad is at (0..4). No campaign, or a closed one, is at the
 * Plan. An ad waiting on the person after filming (its shots are on the
 * wall) is at the Press wall, not back at the Stills.
 */
export function routeIndex(stage: CampaignStage | null, filmed = false): number {
  switch (stage) {
    case "awaiting_approval":
      return filmed ? 3 : 1;
    case "painting":
    case "checking_keyframes":
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

export type CardBlock = "photos" | "front" | "words" | "consent" | null;

// The product card is about the product alone. It once also held Save until
// the person answered for whichever character the door had picked as star,
// who may not be the star they meant, and closing the sheet to change the
// star lost everything typed on the card (pre-flight review, 2026-09-26).
// The star's answer is asked on its own Starring tile, beside Change, and
// the engine still holds painting and filming until it is given
// (paint.ts starReadiness).
export function cardSaveBlock(input: {
  picked: number;
  hasFront: boolean;
  words: number;
  noReadableText: boolean;
  consent: boolean;
}): CardBlock {
  if (input.picked < PICK_MIN || input.picked > PICK_MAX) return "photos";
  if (!input.hasFront) return "front";
  if (!input.noReadableText && input.words === 0) return "words";
  if (!input.consent) return "consent";
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

/**
 * What the card sheet opens with for a card it is given: a draft to finish,
 * or a confirmed card opened again from the door's "Edit its card" (a plan
 * the ad rules refused over its name or a ticked label word says to press
 * it: PLAN_REFUSED_LABEL_CLAIM). Its photos picked, their views (the first
 * photo is the front when none is), and its logo box when that box sits on
 * the front it opens with, the one photo a box is drawn on in the sheet.
 * The box is kept because saving sends only the box the sheet holds, and
 * confirmProductCard removes a crop no box points at: a confirmed card
 * saved again for its words would otherwise lose its logo.
 */
export function openingCard(card: Pick<ProductCard, "photos" | "angles" | "logoBox"> | null): {
  picked: string[];
  views: Record<string, ProductView>;
  logo: { path: string; box: Box } | null;
} {
  if (!card) return { picked: [], views: {}, logo: null };
  const picked = card.photos.slice(0, PICK_MAX);
  const views: Record<string, ProductView> = {};
  for (const a of card.angles) views[a.path] = a.view;
  const first = card.photos[0];
  if (first && !Object.values(views).includes("front")) views[first] = "front";
  const front = picked.find((p) => views[p] === "front") ?? null;
  const b = card.logoBox;
  const logo = b && front && b.path === front ? { path: b.path, box: { x: b.x, y: b.y, w: b.w, h: b.h } } : null;
  return { picked, views, logo };
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

// ---------------------------------------------------------------------------
// The press wall (Cut 4): the filmed takes, their moments and the person's
// choice. Nothing here decides for the person: a shot that missed waits for
// Keep, Re-film or Cut; "Not readable" and "Not checked" are never a miss.
// ---------------------------------------------------------------------------

/**
 * How bad a verdict is, worst first. The same order as the checker's own
 * (product-lock.ts VERDICT_SEVERITY; door-view.test.ts pins them equal),
 * kept here because the door imports nothing from the server at runtime.
 */
export const VERDICT_WEIGHT: Readonly<Record<Verdict, number>> = {
  didnt_match: 5,
  product_missing: 4,
  not_checked: 3,
  not_readable: 2,
  match: 1,
  no_one_in_shot: 0,
};

/** A miss: the only verdicts that ask the person to choose. */
export function isMiss(v: Verdict): boolean {
  return v === "didnt_match" || v === "product_missing";
}

/** A take we are still filming or reading. */
export function takeBusy(t: TakeView): boolean {
  return t.state === "filming" || t.state === "checking";
}

/** A shot we are still working on (being filmed again, or a take still being filmed or read). */
export function shotBusy(s: ShotView): boolean {
  return s.decision === "refilming" || s.takes.some(takeBusy);
}

/** Anything on the wall still in our hands: the door keeps asking until it is done. */
export function wallBusy(shots: readonly ShotView[]): boolean {
  return shots.some(shotBusy);
}

/**
 * The take the wall shows for a shot: the one the person picked on the wall,
 * else the take the cut uses, else the newest take that was read, else the
 * newest.
 */
export function shownTake(s: ShotView, picked: number | null = null): TakeView | null {
  if (picked !== null) {
    const p = s.takes.find((t) => t.take === picked);
    if (p) return p;
  }
  if (s.chosenTake !== null) {
    const c = s.takes.find((t) => t.take === s.chosenTake);
    if (c) return c;
  }
  const read = [...s.takes].reverse().find((t) => t.state === "checked");
  return read ?? s.takes[s.takes.length - 1] ?? null;
}

/**
 * One moment's word on the wall: the worse of the checks that apply to it
 * (the product when the shot shows it, the face when someone is in it).
 * A packshot with no one in it reads its product alone; a hook planned
 * without the product reads its face alone.
 */
export function momentVerdict(m: MomentView, productExpected: boolean): Verdict {
  const parts: Verdict[] = [];
  if (productExpected) parts.push(m.product);
  if (m.face !== "no_one_in_shot") parts.push(m.face);
  if (parts.length === 0) return "not_checked";
  return parts.reduce((a, b) => (VERDICT_WEIGHT[b] > VERDICT_WEIGHT[a] ? b : a));
}

/** One moment as the wall lays it out. */
export type WallMoment = {
  /** Stable across re-reads of the ad: shot, take and the moment's place in its take. */
  key: string;
  /** 1-based, across the whole wall, in cut order ("Moment 5"). */
  index: number;
  shot: number;
  take: number;
  /** Seconds into the ad (the shot's place in the cut plus the moment's time in its take), or null. */
  at: number | null;
  /** Seconds into the take, or null (for the frame). */
  atTake: number | null;
  verdict: Verdict;
  moment: MomentView;
};

/**
 * Every moment the wall shows, shot by shot in cut order, from the take
 * each shot shows. `starts` gives each shot's first second in the cut (its
 * still's span); a shot without one counts from 0.
 */
export function wallMoments(
  shots: readonly ShotView[],
  starts: Readonly<Record<number, number>>,
  picked: Readonly<Record<number, number>> = {},
): WallMoment[] {
  const out: WallMoment[] = [];
  for (const s of [...shots].sort((a, b) => a.shot - b.shot)) {
    if (s.decision === "cut") continue;
    const t = shownTake(s, picked[s.shot] ?? null);
    if (!t || t.state !== "checked") continue;
    const start = starts[s.shot] ?? 0;
    for (const [i, m] of t.moments.entries()) {
      out.push({
        key: `${s.shot}-${t.take}-${i}`,
        index: out.length + 1,
        shot: s.shot,
        take: t.take,
        at: m.atSeconds === null ? null : Math.round((start + m.atSeconds) * 10) / 10,
        atTake: m.atSeconds,
        verdict: momentVerdict(m, s.productExpected),
        moment: m,
      });
    }
  }
  return out;
}

/** The wall's tally: how many moments read each word (only the words that occur). */
export function wallTally(moments: readonly WallMoment[]): { verdict: Verdict; count: number }[] {
  const order: Verdict[] = ["match", "didnt_match", "product_missing", "not_readable", "not_checked"];
  return order
    .map((verdict) => ({ verdict, count: moments.filter((m) => m.verdict === verdict).length }))
    .filter((x) => x.count > 0);
}

/** The worst moment on the wall: the first of the heaviest misses, or null when nothing missed. */
export function worstMoment(moments: readonly WallMoment[]): WallMoment | null {
  let worst: WallMoment | null = null;
  for (const m of moments) {
    if (!isMiss(m.verdict)) continue;
    if (!worst || VERDICT_WEIGHT[m.verdict] > VERDICT_WEIGHT[worst.verdict]) worst = m;
  }
  return worst;
}

/** How many of a shot's shown moments missed. */
export function shotMisses(moments: readonly WallMoment[], shot: number): number {
  return moments.filter((m) => m.shot === shot && isMiss(m.verdict)).length;
}

/** The first shot that waits on the person, or null. */
export function firstDecisionShot(shots: readonly ShotView[]): ShotView | null {
  return [...shots].sort((a, b) => a.shot - b.shot).find((s) => s.needsDecision) ?? null;
}

/** The shots that still go into the cut. The last of them can't be cut. */
export function shotsInCut(shots: readonly ShotView[]): number {
  return shots.filter((s) => s.decision !== "cut").length;
}

/** "0:07.2": a moment's place, to a tenth of a second. */
export function clockTenths(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "–";
  const tenths = Math.round(seconds * 10);
  const whole = Math.floor(tenths / 10);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}.${tenths % 10}`;
}

/** "0:15": a length in whole seconds. */
export function clockSeconds(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "–";
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** One cell of the letter row: the letter read, and the one the label has when they differ. */
export type LetterCell = {
  /** The letter read here ("" when the label has a letter that wasn't read). */
  read: string;
  /** The label's letter here when it differs ("" when this letter shouldn't be there), else null. */
  want: string | null;
};

const LETTERS_MAX = 24;

function lettersOf(s: string): string[] {
  return Array.from(s.normalize("NFC").toLocaleUpperCase().replace(/\s+/g, " ").trim());
}

function distance(a: readonly string[], b: readonly string[]): number[][] {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d;
}

/**
 * The letter row of "Why moment N missed": what was read, letter by letter,
 * against the label's word, marking every letter that differs and the
 * letter the label has there. The part of the reading nearest the word is
 * used (a line may carry other words). Null when the two are too far apart
 * to spell out (more than half the letters differ), too long for a row, or
 * the same.
 */
export function letterRow(read: string, expected: string): { cells: LetterCell[]; wrong: number } | null {
  const want = lettersOf(expected);
  const words = read.trim().split(/\s+/).filter(Boolean);
  const span = Math.max(1, expected.trim().split(/\s+/).filter(Boolean).length);
  const candidates = new Set<string>([read.trim()]);
  for (let i = 0; i + span <= words.length; i++) candidates.add(words.slice(i, i + span).join(" "));
  let best: { got: string[]; d: number[][] } | null = null;
  for (const c of candidates) {
    const got = lettersOf(c);
    if (got.length === 0) continue;
    const d = distance(got, want);
    if (!best || d[got.length][want.length] < best.d[best.got.length][want.length]) best = { got, d };
  }
  if (!best || want.length === 0) return null;
  const { got, d } = best;
  const total = d[got.length][want.length];
  if (total === 0 || total * 2 > want.length || Math.max(got.length, want.length) > LETTERS_MAX) return null;
  const cells: LetterCell[] = [];
  let i = got.length;
  let j = want.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (got[i - 1] === want[j - 1] ? 0 : 1)) {
      cells.unshift({ read: got[i - 1], want: got[i - 1] === want[j - 1] ? null : want[j - 1] });
      i--;
      j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      cells.unshift({ read: got[i - 1], want: "" });
      i--;
    } else {
      cells.unshift({ read: "", want: want[j - 1] });
      j--;
    }
  }
  return { cells, wrong: cells.filter((c) => c.want !== null).length };
}

/** The one wrong letter, when exactly one letter was read as another: its 1-based place and the label's letter. */
export function singleSwap(row: { cells: readonly LetterCell[]; wrong: number }): { at: number; want: string } | null {
  if (row.wrong !== 1) return null;
  const at = row.cells.findIndex((c) => c.want !== null);
  const cell = row.cells[at];
  return cell && cell.read && cell.want ? { at: at + 1, want: cell.want } : null;
}
