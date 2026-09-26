// Press Tour's campaign actions, on the server (campaign-types.ts
// CampaignActions; spec §1.4-§1.6, §1.12 as corrected by v2). campaign-
// actions.ts is the thin "use server" door onto this module: it finds the
// signed-in person and hands over the real clients; everything that decides
// anything is here, alias-free, so campaign-service.test.ts runs it against
// an in-memory database and fake providers.
//
// EVERY ACTION, IN THIS ORDER, before anything is read, written or spent:
//   1. who: pressTourCaller (the door): Press Tour on, the person allowed,
//      a CONFIRMED EMAIL; then campaignGate: in this cut only admins may
//      plan or paint (campaign-machine.ts CAMPAIGNS_OPEN_TO);
//   2. whose: every id the request names is the caller's own (owned.ts;
//      one answer for "not there" and "not yours");
//   3. how much: planning spends the 'press-plan' budget (planner.ts), a
//      paid press reserves through reserve_generations (paint.ts);
//   4. only then a model or a picture lane.
//
// EVERY SPEND CARRIES A CLIENT-MADE sendId, and the rows it reserves take
// their ids from it (campaign-machine.ts): a resent "Plan" meets its
// campaign, a resent "Paint stills" meets its rows, a resent "Repaint"
// meets its row, and each answers with the campaign as it stands instead
// of charging again.
//
// THE PROJECTION. Nobody reads press_campaigns with their own session (it
// has no policies at all); every answer is campaignView: no lane, cost, raw
// score or attempt history, each still as a signed link, the quote with the
// balance of now, and a blocker in plain words.
//
// Relative imports only (vitest has no "@/").

import type { SupabaseClient } from "@supabase/supabase-js";
import { adVerdict } from "../product-lock/product-lock";
import type { CampaignResult, CampaignSource, CampaignView } from "./campaign-types";
import {
  CAMPAIGN_BAD_REQUEST,
  CAMPAIGN_CLOSED,
  CAMPAIGN_MOVED_ON,
  CAMPAIGN_READ_FAILED,
  CAMPAIGN_SAVE_FAILED,
  CANCEL_WAIT,
  BLOCK_FILMING_NOT_OPEN,
  PAINT_COULDNT_START as RESERVE_COULDNT_START,
  PAINT_FREE_SLOT as RESERVE_FREE_SLOT,
  CHARACTER_NEEDS_PHOTO,
  PAINT_COULDNT_START,
  PAINT_NOT_STARTED,
  PLAN_UNAVAILABLE,
  PRODUCT_NOT_CONFIRMED,
  SHOT_NOT_IN_AD,
  STILL_IN_PROGRESS,
  STILL_NOT_READY,
  STILL_REPAINT_LIMIT,
  blockDecide,
  priceChanged,
} from "./campaign-messages";
import {
  CAMPAIGNS_OPEN_TO,
  LEASE_MS,
  MAX_ATTEMPTS_PER_STILL,
  MAX_REPAINTS_PER_STILL,
  WAIT_MS,
  WORKING_STAGES,
  campaignView,
  contextOf,
  closeAttempts,
  cutOwed,
  stillRowId,
  inFlight,
  initialStills,
  isTerminal,
  keptAttempt,
  mutateCampaign,
  parseUuid,
  pressCampaignId,
  readCampaign,
  releaseAttempts,
  repaintRowId,
  repaintsOf,
  reservedAttempts,
  stillOf,
  withDecision,
  withReserved,
  type CampaignRow,
  type DecideAction,
  type StillAttempt,
  type StillState,
} from "./campaign-machine";
import { PRESS_WRITE_LIMIT } from "./card-service";
import { CUT_DUE_MS } from "./cut";
import { initialAssembly, parseAssembly, RENDITION_KINDS, parseRenditions, type RenditionKind } from "./cut-state";
import { PRESS_TOUR_NOT_OPEN } from "./enabled";
import {
  filmRowId,
  filmRowPayload,
  filmSpec,
  refilmRowId,
  refilmText,
  shotContext,
  type FilmLane,
  type FilmRowSpec,
} from "./film";
import {
  CUT_BEING_MADE,
  CUT_CANCEL_WAIT,
  CUT_LAST_SHOT,
  CUT_NOTHING,
  FILM_BUSY,
  FILM_CANCEL_WAIT,
  FILM_COULDNT_START,
  FILM_FREE_SLOT,
  FILM_NOT_STARTED,
  FILM_STILLS_MISSING,
  REFILM_LIMIT,
  SHOT_BEING_FILMED,
  SHOTS_NOT_FILMED,
  TAKE_NOT_IN_SHOT,
  TAKE_NOT_READY,
} from "./film-messages";
import {
  canRefilm,
  cutList,
  filmed,
  firstDecision,
  initialShots,
  openTakes,
  settleForCut,
  shotBusy,
  shotOf,
  withCut,
  withKeep,
  withTakeReserved,
  type DecideFailure,
  type ShotContext,
  type ShotState,
} from "./shots";
import { NOT_YOURS, checkOwned } from "./owned";
import {
  endStillRow,
  readConfirmedCard,
  reservePressRows,
  reserveStillRows,
  starReadiness,
  type MoneyDeps,
  type PressRowSpec,
} from "./paint";
import {
  DEFAULT_AD_LENGTH,
  PLAN_LIMITS,
  adPolicyCheck,
  endorsementCheck,
  parseAdLength,
  planAd,
  planBudget,
  repaintText,
  type PlanBudgetDeps,
  type PlannerDeps,
  type PolicyRule,
  type StarKind,
} from "./planner";
import { buildPressQuote, quotePriceChanged, repaintCredits, shotCredits, stillCredits } from "./quote";
import { BRAND_KIT_COLUMNS, brandKitFromRow, cleanText, type BrandKit } from "./types";

/** The person asking, as the door's pressTourCaller found them. */
export type CampaignCaller = { userId: string; via: "admin" | "plan" | "trial" };

export interface CampaignDeps extends PlanBudgetDeps {
  /** The service-role client (press_campaigns has no policies for people). */
  db: SupabaseClient;
  /** The money doors, bound to the person asking (their allowance, their spends). */
  money: MoneyDeps;
  /** The planner's model and gates. */
  planner: PlannerDeps;
  /** The person's own active brand rules (the ad policy step runs them beside the ad packs). */
  ownRules: (userId: string) => Promise<PolicyRule[]>;
  /** The person's spendable credits right now (plans.ts spendableCredits). */
  balance: (userId: string) => Promise<number>;
  /** Start the machine on a campaign after the answer is sent (after()). */
  kick: (campaignId: string) => void;
  /** A still's stored path as a viewable link. */
  imageUrl: (path: string) => string | null;
  now?: () => Date;
  /** Cut 4: filming's switch and lane, and the links the press wall shows. Absent = filming isn't open. */
  filmDoor?: FilmDoorDeps;
}

/** What the person's presses need from filming (campaign-runtime.ts wires the real ones). */
export interface FilmDoorDeps {
  /** film.ts readFilmOpening: press_tour and press_tour_film on, a priced lane. */
  opening(): Promise<{ open: boolean; lane: FilmLane | null }>;
  /** model-health.ts: the lane is tripped (checked before anything is reserved). */
  laneBusy(modelId: string): Promise<boolean>;
  /** A kept take's stored link as a viewable one. */
  videoUrl(stored: string): string | null;
  /** A short-lived link to a finished file in the private press-kit bucket. */
  renditionUrl(path: string, kind: RenditionKind): Promise<string | null>;
}

const DEFAULT_SOURCE: CampaignSource = "door";
const PERSON_SOURCES: readonly CampaignSource[] = ["door", "generate", "producer", "mcp"];
/** Decisions share the card's write budget (no paid call behind them). */
const WRITES_PER_HOUR = 120;

const nowOf = (deps: { now?: () => Date }) => (deps.now ? deps.now() : new Date());
const failure = (error: string): CampaignResult => ({ ok: false, error });

/** In this cut, only admins plan and paint (the operator's rule, admins first). */
export function campaignGate(caller: CampaignCaller): string | null {
  return CAMPAIGNS_OPEN_TO.includes(caller.via) ? null : PRESS_TOUR_NOT_OPEN;
}

async function owns(deps: CampaignDeps, caller: CampaignCaller, refs: Parameters<typeof checkOwned>[1]): Promise<string | null> {
  const check = await checkOwned(caller.userId, refs, deps.db);
  return check.ok ? null : check.error;
}

/** The campaign as the person sees it: fresh balance lines, and at `planned` what still blocks painting. */
async function viewOf(deps: CampaignDeps, caller: CampaignCaller, row: CampaignRow): Promise<CampaignView> {
  let quote = row.quote;
  if (row.plan && !isTerminal(row.stage)) {
    const balance = await deps.balance(caller.userId).catch(() => row.quote?.balanceNow ?? 0);
    quote = buildPressQuote({
      shots: row.plan.shots,
      balanceNow: balance,
      paintPaid: row.stage !== "planned" && row.stage !== "draft",
      animatePaid: row.filmChargedAt !== null,
      trial: row.trialId !== null,
      charged: caller.via !== "admin",
    });
  }
  // The finished files, each as a short-lived link (press-kit is private).
  const renditionUrls: Partial<Record<RenditionKind, string>> = {};
  if (row.stage === "ready" && deps.filmDoor) {
    const recs = parseRenditions(row.renditions);
    for (const kind of RENDITION_KINDS) {
      const rec = recs[kind];
      const url = rec ? await deps.filmDoor.renditionUrl(rec.path, kind).catch(() => null) : null;
      if (url) renditionUrls[kind] = url;
    }
  }
  const view = campaignView(row, {
    imageUrl: deps.imageUrl,
    quote,
    videoUrl: deps.filmDoor ? (stored) => deps.filmDoor!.videoUrl(stored) : undefined,
    renditionUrls,
    admin: caller.via === "admin",
  });
  if (row.stage === "planned") view.blocker = await paintBlocker(deps, caller, row);
  // Every still decided: the Film press is open when filming is (else the line says it isn't).
  if (view.blocker === BLOCK_FILMING_NOT_OPEN && deps.filmDoor) {
    const opening = await deps.filmDoor.opening().catch(() => ({ open: false, lane: null }));
    if (opening.open) view.blocker = null;
  }
  return view;
}

/** What stands between a planned campaign and "Paint stills", or null. */
async function paintBlocker(deps: CampaignDeps, caller: CampaignCaller, row: CampaignRow): Promise<string | null> {
  const card = await readConfirmedCard(deps.db, caller.userId, row.productId);
  if (card !== "unavailable" && !card) return PRODUCT_NOT_CONFIRMED;
  if (row.plan?.shots.some((s) => s.star) && row.characterIds[0]) {
    const ready = await starReadiness(deps.db, caller.userId, row.characterIds[0]);
    if (!ready.ok && ready.missing !== "unavailable") return ready.error;
  }
  return null;
}

async function answer(deps: CampaignDeps, caller: CampaignCaller, id: string): Promise<CampaignResult> {
  const row = await readCampaign(deps.db, id, caller.userId);
  if (row === "unavailable") return failure(CAMPAIGN_READ_FAILED);
  if (!row) return failure(NOT_YOURS);
  return { ok: true, campaign: await viewOf(deps, caller, row) };
}

async function readBrand(db: SupabaseClient, userId: string, kitId: string): Promise<BrandKit | null> {
  try {
    const { data } = await db.from("brand_kits").select(BRAND_KIT_COLUMNS).eq("id", kitId).eq("user_id", userId).is("deleted_at", null).maybeSingle();
    return brandKitFromRow(data);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export async function planCampaign(
  deps: CampaignDeps,
  caller: CampaignCaller,
  input: {
    sendId: string;
    productId: string;
    characterId: string;
    brandKitId?: string | null;
    lengthSeconds?: 10 | 15 | 30;
    goal?: string;
    source?: CampaignSource;
  },
): Promise<CampaignResult> {
  const gate = campaignGate(caller);
  if (gate) return failure(gate);
  const sendId = parseUuid(input?.sendId);
  const productId = parseUuid(input?.productId);
  const characterId = parseUuid(input?.characterId);
  const brandKitId = input?.brandKitId ? parseUuid(input.brandKitId) : null;
  const length = input?.lengthSeconds === undefined ? DEFAULT_AD_LENGTH : parseAdLength(input.lengthSeconds);
  const source = input?.source ?? DEFAULT_SOURCE;
  if (!sendId || !productId || !characterId || (input?.brandKitId && !brandKitId) || !length || !PERSON_SOURCES.includes(source)) {
    return failure(CAMPAIGN_BAD_REQUEST);
  }
  const goal = cleanText(input?.goal, PLAN_LIMITS.goal);
  const id = pressCampaignId(sendId);

  // A second delivery of the same press: the campaign as it stands.
  const existing = await readCampaign(deps.db, id, caller.userId);
  if (existing === "unavailable") return failure(PLAN_UNAVAILABLE);
  if (existing) return { ok: true, campaign: await viewOf(deps, caller, existing) };

  const notYours = await owns(deps, caller, { product: productId, character: characterId, brandKit: brandKitId });
  if (notYours) return failure(notYours);
  const card = await readConfirmedCard(deps.db, caller.userId, productId);
  if (card === "unavailable") return failure(PLAN_UNAVAILABLE);
  if (!card) return failure(PRODUCT_NOT_CONFIRMED);

  // The star needs photos to be painted from; who is in them is asked
  // before painting (the ad-use attestation), not before planning.
  const ready = await starReadiness(deps.db, caller.userId, characterId);
  if (!ready.ok && (ready.missing === "character" || ready.missing === "photos")) return failure(CHARACTER_NEEDS_PHOTO);
  if (!ready.ok && ready.missing === "unavailable") return failure(PLAN_UNAVAILABLE);
  // Until the person has said, the rubric judges the star as a real person
  // who agreed to appear (the stricter reading).
  const star: StarKind = ready.ok ? ready.star.kind : "permission";

  const brand = brandKitId ? await readBrand(deps.db, caller.userId, brandKitId) : null;

  const budget = await planBudget(deps, caller);
  if (budget) return failure(budget);

  try {
    const { error } = await deps.db.from("press_campaigns").insert({
      id,
      user_id: caller.userId,
      source,
      send_id: sendId,
      product_id: productId,
      brand_kit_id: brandKitId,
      character_ids: [characterId],
      length_s: length,
      aspect: "9:16",
      goal,
      stage: "draft",
      stills: [],
    });
    if (error) {
      // The other delivery made it first: answer with it.
      const again = await readCampaign(deps.db, id, caller.userId);
      if (again && again !== "unavailable") return { ok: true, campaign: await viewOf(deps, caller, again) };
      return failure(PLAN_UNAVAILABLE);
    }
  } catch {
    return failure(PLAN_UNAVAILABLE);
  }

  const own = await deps.ownRules(caller.userId).catch(() => [] as PolicyRule[]);
  const planned = await planAd(deps.planner, {
    length,
    product: card,
    brand: brand ? { name: brand.name, tone: brand.tone, tagline: brand.tagline, defaultCta: brand.defaultCta } : null,
    goal,
    star,
    ownRules: own,
  });

  if (!planned.ok) {
    await mutateCampaign(deps.db, id, caller.userId, (row) =>
      row.stage !== "draft" ? { refuse: null } : { patch: { stage: "failed", error: planned.error }, value: null },
    );
    return failure(planned.error);
  }

  const balance = await deps.balance(caller.userId).catch(() => 0);
  const quote = buildPressQuote({
    shots: planned.plan.shots,
    balanceNow: balance,
    paintPaid: false,
    animatePaid: false,
    trial: false,
    charged: caller.via !== "admin",
  });
  const written = await mutateCampaign(deps.db, id, caller.userId, (row) =>
    row.stage !== "draft"
      ? { refuse: null }
      : {
          patch: {
            stage: "planned",
            plan: planned.plan,
            quote,
            stills: initialStills(planned.plan),
            expires_at: new Date(nowOf(deps).getTime() + WAIT_MS).toISOString(),
          },
          value: null,
        },
  );
  if (!written.ok) return written.reason === "refused" ? answer(deps, caller, id) : failure(PLAN_UNAVAILABLE);
  return { ok: true, campaign: await viewOf(deps, caller, written.row) };
}

// ---------------------------------------------------------------------------
// Paint
// ---------------------------------------------------------------------------

/**
 * Rows a campaign reserved but could not write down: refunded (forced:
 * nothing was delivered), then ended. True only when every charge went back,
 * so the answer says "Nothing was charged" only when it is so (PT-12); a row
 * whose refund failed stays for the reaper to settle.
 */
async function releaseRows(deps: CampaignDeps, caller: CampaignCaller, ids: readonly string[], credits: number, reason: string): Promise<boolean> {
  let all = true;
  for (const id of ids) {
    const back = await endStillRow({ db: deps.db, refund: deps.money.refund }, { userId: caller.userId, rowId: id, credits, detail: reason, force: true });
    if (credits > 0 && !back) all = false;
  }
  return all;
}

export async function paintStills(
  deps: CampaignDeps,
  caller: CampaignCaller,
  input: { sendId: string; campaignId: string },
): Promise<CampaignResult> {
  const gate = campaignGate(caller);
  if (gate) return failure(gate);
  const sendId = parseUuid(input?.sendId);
  const id = parseUuid(input?.campaignId);
  if (!sendId || !id) return failure(CAMPAIGN_BAD_REQUEST);

  const row = await readCampaign(deps.db, id, caller.userId);
  if (row === "unavailable") return failure(PAINT_COULDNT_START);
  if (!row) return failure(NOT_YOURS);
  if (isTerminal(row.stage)) return failure(CAMPAIGN_CLOSED);
  // Already painting (a second delivery of this press, or another tab): as it stands.
  if (row.stage !== "planned") return { ok: true, campaign: await viewOf(deps, caller, row) };
  const plan = row.plan;
  if (!plan) return failure(CAMPAIGN_MOVED_ON);

  const card = await readConfirmedCard(deps.db, caller.userId, row.productId);
  if (card === "unavailable") return failure(PAINT_COULDNT_START);
  if (!card) return failure(PRODUCT_NOT_CONFIRMED);
  if (plan.shots.some((s) => s.star)) {
    const characterId = row.characterIds[0];
    if (!characterId) return failure(CHARACTER_NEEDS_PHOTO);
    const ready = await starReadiness(deps.db, caller.userId, characterId);
    if (!ready.ok) return failure(ready.missing === "unavailable" ? PAINT_COULDNT_START : ready.error);
  }

  // The price the person saw must still be the price (N3).
  const balance = await deps.balance(caller.userId).catch(() => 0);
  const fresh = buildPressQuote({
    shots: plan.shots,
    balanceNow: balance,
    paintPaid: false,
    animatePaid: false,
    trial: row.trialId !== null,
    charged: caller.via !== "admin",
  });
  if (quotePriceChanged(row.quote, fresh)) {
    await mutateCampaign(deps.db, id, caller.userId, (r) => (r.stage !== "planned" ? { refuse: null } : { patch: { quote: fresh }, value: null }));
    return failure(priceChanged(fresh.paint));
  }

  const perStill = stillCredits();
  const specs: PressRowSpec[] = plan.shots.map((s) => ({
    id: stillRowId(sendId, s.shot),
    campaignId: row.id,
    shot: s.shot,
    role: s.role,
    kind: "paint",
    attempt: 1,
    credits: perStill,
    characterIds: s.star ? row.characterIds : [],
    label: `Press Tour · ${plan.angle} · shot ${s.shot}`,
    trialId: row.trialId,
  }));
  const paidQuote = { ...fresh, rows: fresh.rows.map((r) => (r.key === "stills" ? { ...r, paid: true } : r)) };
  const reserved = await reserveStillRows(deps.money, caller.userId, specs);
  if (!reserved.ok) {
    // This press, delivered again: its rows are already reserved.
    if (reserved.code === "repeat") return adoptOrAnswer(deps, caller, id, specs, paidQuote);
    return failure(reserved.error);
  }

  const written = await writePainting(deps, caller, id, specs, paidQuote, reserved.credits);
  if (!written.ok) {
    // Another press (a second tab) moved the ad on first. Its rows stand;
    // these are given back, unless the ad holds them (an adoption did).
    const now = await readCampaign(deps.db, id, caller.userId);
    if (now && now !== "unavailable" && holdsRows(now.stills, specs)) return { ok: true, campaign: await viewOf(deps, caller, now) };
    const gaveBack = await releaseRows(deps, caller, specs.map((s) => s.id), perStill, "The ad moved on before its stills were painted.");
    if (written.reason === "refused") return failure(CAMPAIGN_MOVED_ON);
    return failure(gaveBack ? PAINT_COULDNT_START : PAINT_NOT_STARTED);
  }
  deps.kick(id);
  return { ok: true, campaign: await viewOf(deps, caller, written.row) };
}

/** Whether the campaign's stills already name these rows. */
function holdsRows(stills: readonly StillState[], specs: readonly PressRowSpec[]): boolean {
  const held = new Set(stills.flatMap((s) => s.attempts.map((a) => a.rowId)));
  return specs.every((s) => held.has(s.id));
}

/** planned -> painting, the rows written down as reserved attempts. */
function writePainting(
  deps: CampaignDeps,
  caller: CampaignCaller,
  id: string,
  specs: readonly PressRowSpec[],
  quote: ReturnType<typeof buildPressQuote>,
  credits: number,
) {
  const nowIso = nowOf(deps).toISOString();
  return mutateCampaign(deps.db, id, caller.userId, (r) => {
    if (r.stage !== "planned" || !r.plan) return { refuse: null };
    let stills: StillState[] | null = initialStills(r.plan);
    for (const spec of specs) {
      stills = stills ? withReserved(stills, spec.shot, { rowId: spec.id, kind: "paint", credits: spec.credits }, nowIso) : null;
    }
    if (!stills) return { refuse: null };
    return {
      patch: { stage: "painting", stills, quote, credits_charged: r.creditsCharged + credits, expires_at: null },
      value: null,
    };
  });
}

/**
 * A second delivery of a "Paint stills" press met its own rows. Normally
 * the first delivery wrote them down, and this answers with the ad as it
 * stands. If the first delivery died between reserving and writing down,
 * the ad is still planned with its rows reserved and charged: they are
 * adopted here (only rows that are still reserved for this very campaign),
 * so the charge is never stranded.
 */
async function adoptOrAnswer(
  deps: CampaignDeps,
  caller: CampaignCaller,
  id: string,
  specs: readonly PressRowSpec[],
  quote: ReturnType<typeof buildPressQuote>,
): Promise<CampaignResult> {
  const row = await readCampaign(deps.db, id, caller.userId);
  // This press's rows are reserved (and charged): never "nothing was charged" here.
  if (row === "unavailable") return failure(CAMPAIGN_READ_FAILED);
  if (!row) return failure(NOT_YOURS);
  if (row.stage !== "planned") return { ok: true, campaign: await viewOf(deps, caller, row) };
  let rows: { id?: unknown; status?: unknown; credits_used?: unknown; press_tour?: unknown }[] = [];
  try {
    const { data } = await deps.db
      .from("generations")
      .select("id, status, credits_used, press_tour")
      .eq("user_id", caller.userId)
      .in(
        "id",
        specs.map((s) => s.id),
      );
    rows = Array.isArray(data) ? data : [];
  } catch {
    rows = [];
  }
  const ours = specs.every((spec) =>
    rows.some(
      (r) =>
        r.id === spec.id &&
        r.status === "generating" &&
        (r.press_tour as { campaign_id?: unknown } | null)?.campaign_id === id,
    ),
  );
  if (!ours) return { ok: true, campaign: await viewOf(deps, caller, row) };
  const credits = rows.reduce((sum, r) => sum + (typeof r.credits_used === "number" ? r.credits_used : 0), 0);
  const written = await writePainting(deps, caller, id, specs, quote, credits);
  if (written.ok) {
    deps.kick(id);
    return { ok: true, campaign: await viewOf(deps, caller, written.row) };
  }
  return answer(deps, caller, id);
}

// ---------------------------------------------------------------------------
// The person's decisions on a still
// ---------------------------------------------------------------------------

const DECIDING_STAGES = ["awaiting_approval", "painting", "checking_keyframes"] as const;

async function decide(deps: CampaignDeps, caller: CampaignCaller, input: { campaignId: string; shot: number }, action: DecideAction) {
  const gate = campaignGate(caller);
  if (gate) return failure(gate);
  const id = parseUuid(input?.campaignId);
  const shot = input?.shot;
  if (!id || typeof shot !== "number" || !Number.isInteger(shot) || shot < 1 || shot > 12) return failure(CAMPAIGN_BAD_REQUEST);
  if (await deps.rateLimited(caller.userId, "press-card-write", 60 * 60, WRITES_PER_HOUR)) return failure(PRESS_WRITE_LIMIT);

  const written = await mutateCampaign(deps.db, id, caller.userId, (row) => {
    if (isTerminal(row.stage)) return { refuse: CAMPAIGN_CLOSED };
    if (!(DECIDING_STAGES as readonly string[]).includes(row.stage) || filmed(row.shots)) return { refuse: CAMPAIGN_MOVED_ON };
    const next = withDecision(row.stills, shot, action);
    if (!next.ok) return { refuse: next.reason === "shot" ? SHOT_NOT_IN_AD : next.reason === "busy" ? STILL_IN_PROGRESS : STILL_NOT_READY };
    return { patch: { stills: next.stills }, value: null };
  });
  if (!written.ok) {
    if (written.reason === "missing") return failure(NOT_YOURS);
    if (written.reason === "refused" && written.value) return failure(written.value);
    // Nothing was being painted: a neutral line, no word about charges (PT-12).
    return failure(CAMPAIGN_SAVE_FAILED);
  }
  return { ok: true as const, campaign: await viewOf(deps, caller, written.row) };
}

export function approveStill(deps: CampaignDeps, caller: CampaignCaller, input: { campaignId: string; shot: number }) {
  return decide(deps, caller, input, "approve");
}

export function keepStill(deps: CampaignDeps, caller: CampaignCaller, input: { campaignId: string; shot: number }) {
  return decide(deps, caller, input, "keep");
}

export function undoStill(deps: CampaignDeps, caller: CampaignCaller, input: { campaignId: string; shot: number }) {
  return decide(deps, caller, input, "undo");
}

// ---------------------------------------------------------------------------
// Repaint one still (1 credit, N4)
// ---------------------------------------------------------------------------

export async function repaintStill(
  deps: CampaignDeps,
  caller: CampaignCaller,
  input: { sendId: string; campaignId: string; shot: number; note?: string },
): Promise<CampaignResult> {
  const gate = campaignGate(caller);
  if (gate) return failure(gate);
  const sendId = parseUuid(input?.sendId);
  const id = parseUuid(input?.campaignId);
  const shot = input?.shot;
  if (!sendId || !id || typeof shot !== "number" || !Number.isInteger(shot) || shot < 1 || shot > 12) return failure(CAMPAIGN_BAD_REQUEST);
  const note = cleanText(input?.note, 200);
  const rowId = repaintRowId(sendId);

  const row = await readCampaign(deps.db, id, caller.userId);
  if (row === "unavailable") return failure(PAINT_COULDNT_START);
  if (!row) return failure(NOT_YOURS);
  if (isTerminal(row.stage)) return failure(CAMPAIGN_CLOSED);
  const planned = row.plan?.shots.find((s) => s.shot === shot);
  const still = stillOf(row.stills, shot);
  if (!planned || !still) return failure(SHOT_NOT_IN_AD);
  // This very press, delivered again: the campaign as it stands.
  if (row.stills.some((s) => s.attempts.some((a) => a.rowId === rowId))) return answer(deps, caller, id);
  if (!(DECIDING_STAGES as readonly string[]).includes(row.stage) || filmed(row.shots)) return failure(CAMPAIGN_MOVED_ON);
  if (inFlight(still)) return failure(STILL_IN_PROGRESS);
  if (!keptAttempt(still)) return failure(STILL_NOT_READY);
  if (repaintsOf(still) >= MAX_REPAINTS_PER_STILL || still.attempts.length >= MAX_ATTEMPTS_PER_STILL) return failure(STILL_REPAINT_LIMIT);

  const card = await readConfirmedCard(deps.db, caller.userId, row.productId);
  if (card === "unavailable") return failure(PAINT_COULDNT_START);
  if (!card) return failure(PRODUCT_NOT_CONFIRMED);
  let realPerson = false;
  // Who the star is, for the rubric: a packshot's is judged as a real
  // person who agreed to appear (the stricter reading), as planning does.
  let starKind: StarKind = "permission";
  if (planned.star) {
    const ready = row.characterIds[0] ? await starReadiness(deps.db, caller.userId, row.characterIds[0]) : null;
    if (!ready) return failure(CHARACTER_NEEDS_PHOTO);
    if (!ready.ok) return failure(ready.missing === "unavailable" ? PAINT_COULDNT_START : ready.error);
    realPerson = ready.star.kind !== "not_a_person";
    starKind = ready.star.kind;
  }

  // The person's own words for the repaint are judged BEFORE anything is
  // charged (the content gate, the ad policy step, then the endorsement
  // rubric on the plan with this note, PT-SEC-2): a refusal costs nothing,
  // and the still keeps the painting it has.
  if (note) {
    try {
      await deps.planner.assertPromptAllowed({ prompt: note, hasRealPersonReference: realPerson });
    } catch (err) {
      const message = err && typeof err === "object" && typeof (err as { userMessage?: unknown }).userMessage === "string" ? (err as { userMessage: string }).userMessage : null;
      return failure(message ?? PAINT_COULDNT_START);
    }
    const own = await deps.ownRules(caller.userId).catch(() => [] as PolicyRule[]);
    const policy = await adPolicyCheck(deps.planner, note, own);
    if (!policy.ok) return failure(policy.code === "refused" ? policy.error : PAINT_COULDNT_START);
    if (row.plan) {
      const endorsement = await endorsementCheck(deps.planner, repaintText(row.plan, shot, note), starKind);
      if (!endorsement.ok) return failure(endorsement.code === "refused" ? endorsement.error : PAINT_COULDNT_START);
    }
  }

  const credits = repaintCredits();
  const spec: PressRowSpec = {
    id: rowId,
    campaignId: row.id,
    shot,
    role: planned.role,
    kind: "repaint",
    attempt: still.attempts.length + 1,
    credits,
    characterIds: planned.star ? row.characterIds : [],
    label: `Press Tour · ${row.plan?.angle ?? "Ad"} · shot ${shot} repainted`,
    trialId: row.trialId,
  };
  const reserved = await reserveStillRows(deps.money, caller.userId, [spec]);
  if (!reserved.ok) {
    if (reserved.code !== "repeat") return failure(reserved.error);
    // This press, delivered again. If its first delivery died between
    // reserving and writing down, the row is adopted (never stranded).
    const again = await readCampaign(deps.db, id, caller.userId);
    if (again && again !== "unavailable" && !holdsRows(again.stills, [spec]) && (await rowReservedFor(deps, caller, rowId, id))) {
      const adopted = await writeRepaint(deps, caller, id, shot, spec, note);
      if (adopted.ok) {
        deps.kick(id);
        return { ok: true, campaign: await viewOf(deps, caller, adopted.row) };
      }
    }
    return answer(deps, caller, id);
  }

  const written = await writeRepaint(deps, caller, id, shot, spec, note);
  if (!written.ok) {
    const now = await readCampaign(deps.db, id, caller.userId);
    if (now && now !== "unavailable" && holdsRows(now.stills, [spec])) return { ok: true, campaign: await viewOf(deps, caller, now) };
    const gaveBack = await releaseRows(deps, caller, [rowId], credits, "The ad moved on before this still was repainted.");
    if (written.reason === "refused" && written.value) return failure(written.value);
    return failure(gaveBack ? PAINT_COULDNT_START : PAINT_NOT_STARTED);
  }
  deps.kick(id);
  return { ok: true, campaign: await viewOf(deps, caller, written.row) };
}

/** The repaint written down as a reserved attempt; the ad goes back to painting. */
function writeRepaint(deps: CampaignDeps, caller: CampaignCaller, id: string, shot: number, spec: PressRowSpec, note: string | null) {
  const nowIso = nowOf(deps).toISOString();
  return mutateCampaign<string | null>(deps.db, id, caller.userId, (r) => {
    if (isTerminal(r.stage)) return { refuse: CAMPAIGN_CLOSED };
    if (!(DECIDING_STAGES as readonly string[]).includes(r.stage) || filmed(r.shots)) return { refuse: CAMPAIGN_MOVED_ON };
    const stills = withReserved(r.stills, shot, { rowId: spec.id, kind: "repaint", credits: spec.credits, note }, nowIso);
    if (!stills) return { refuse: STILL_IN_PROGRESS };
    return {
      patch: { stills, stage: "painting", credits_charged: r.creditsCharged + spec.credits, expires_at: null },
      value: null,
    };
  });
}

/** A row still reserved ('generating') for this campaign. */
async function rowReservedFor(deps: CampaignDeps, caller: CampaignCaller, rowId: string, campaignId: string): Promise<boolean> {
  try {
    const { data } = await deps.db.from("generations").select("id, status, press_tour").eq("id", rowId).eq("user_id", caller.userId).maybeSingle();
    const r = data as { status?: unknown; press_tour?: unknown } | null;
    return r?.status === "generating" && (r.press_tour as { campaign_id?: unknown } | null)?.campaign_id === campaignId;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Read and cancel
// ---------------------------------------------------------------------------

export async function getCampaign(deps: CampaignDeps, caller: CampaignCaller, input: { campaignId: string }): Promise<CampaignResult> {
  const gate = campaignGate(caller);
  if (gate) return failure(gate);
  const id = parseUuid(input?.campaignId);
  if (!id) return failure(CAMPAIGN_BAD_REQUEST);
  return answer(deps, caller, id);
}

/**
 * Stop here: the stills stay in History. A campaign whose still is being
 * painted right now waits for the brush (the lease) rather than stranding a
 * paid painting; every still it held but never painted is refunded.
 *
 * Once filmed (fixer 2026-09-26, MONEY-1): while we still owe the cut
 * (filming charged, the 24 h rule's clock running: checking, cutting,
 * finishing, or a cut parked for the team) it can't be closed — closing
 * would keep the filming credits AND disarm the rule that refunds them, and
 * refunding on a close would hand out filmed shots for free. The cut is
 * delivered, or the 24 h rule closes it and refunds by the ordinary rules.
 * On the press wall (waiting on the person, the clock stopped) it can be
 * closed, and the filming credits stay spent: the door says so.
 */
export async function cancelCampaign(deps: CampaignDeps, caller: CampaignCaller, input: { campaignId: string }): Promise<CampaignResult> {
  const gate = campaignGate(caller);
  if (gate) return failure(gate);
  const id = parseUuid(input?.campaignId);
  if (!id) return failure(CAMPAIGN_BAD_REQUEST);
  const now = nowOf(deps);
  const held = (row: CampaignRow) =>
    (WORKING_STAGES as readonly string[]).includes(row.stage) &&
    row.lockedAt !== null &&
    now.getTime() - new Date(row.lockedAt).getTime() < LEASE_MS;

  const closed = await mutateCampaign<StillAttempt[] | "closed" | "held" | "filming" | "cut">(deps.db, id, caller.userId, (row) => {
    if (isTerminal(row.stage)) return { refuse: "closed" as const };
    // A ready ad is finished: nothing to stop.
    if (row.stage === "ready") return { refuse: "closed" as const };
    if (held(row)) return { refuse: "held" as const };
    // A shot the film lane holds is waited for, never stranded mid-render.
    if (openTakes(row.shots).length > 0) return { refuse: "filming" as const };
    // The cut we owe is finished or closed by the 24 h rule, never abandoned with its filming kept (MONEY-1).
    if (cutOwed(row)) return { refuse: "cut" as const };
    return {
      patch: { stage: "cancelled", stills: closeAttempts(row.stills, "cancelled", now.toISOString()), expires_at: null, cut_due_at: null },
      value: reservedAttempts(row.stills).map((r) => r.attempt),
    };
  });
  if (!closed.ok) {
    if (closed.reason === "missing") return failure(NOT_YOURS);
    if (closed.reason === "refused" && closed.value === "held") return failure(CANCEL_WAIT);
    if (closed.reason === "refused" && closed.value === "filming") return failure(FILM_CANCEL_WAIT);
    if (closed.reason === "refused" && closed.value === "cut") return failure(CUT_CANCEL_WAIT);
    if (closed.reason === "refused") return answer(deps, caller, id);
    return failure(CAMPAIGN_SAVE_FAILED);
  }
  const attempts = Array.isArray(closed.value) ? closed.value : [];
  if (attempts.length > 0) {
    const back = await releaseAttempts(
      {
        releaseRow: ({ userId, rowId, credits, reason }) =>
          endStillRow({ db: deps.db, refund: deps.money.refund }, { userId, rowId, credits, detail: reason, force: true }),
      },
      caller.userId,
      attempts,
      "The ad was stopped before this still was painted.",
    );
    if (back > 0) {
      await mutateCampaign(deps.db, id, caller.userId, (r) => ({ patch: { credits_refunded: r.creditsRefunded + back }, value: null }));
    }
  }
  return answer(deps, caller, id);
}

// ---------------------------------------------------------------------------
// Cut 4: filming, the press wall and the cut
// ---------------------------------------------------------------------------


const WALL_BUSY: Partial<Record<string, string>> = {
  animating: SHOT_BEING_FILMED,
  checking_shots: SHOT_BEING_FILMED,
  assembling: CUT_BEING_MADE,
  signing: CUT_BEING_MADE,
};

const DECIDE_FAILURE: Record<DecideFailure, string> = {
  shot: SHOT_NOT_IN_AD,
  busy: SHOT_BEING_FILMED,
  take: TAKE_NOT_IN_SHOT,
  notReady: TAKE_NOT_READY,
  last: CUT_LAST_SHOT,
  notFilmed: SHOTS_NOT_FILMED,
};

/** A reservation's refusal in filming's words. */
function filmReserveError(error: string): string {
  if (error === RESERVE_FREE_SLOT) return FILM_FREE_SLOT;
  if (error === RESERVE_COULDNT_START) return FILM_COULDNT_START;
  return error;
}

/** Filming is open, on a lane that isn't tripped: the lane, or the sentence that says why not. */
async function filmLane(deps: CampaignDeps): Promise<{ ok: true; lane: FilmLane } | { ok: false; error: string }> {
  if (!deps.filmDoor) return { ok: false, error: BLOCK_FILMING_NOT_OPEN };
  const opening = await deps.filmDoor.opening().catch(() => ({ open: false, lane: null }));
  if (!opening.open || !opening.lane) return { ok: false, error: BLOCK_FILMING_NOT_OPEN };
  // No substitution: a tripped lane refuses before anything is reserved.
  if (await deps.filmDoor.laneBusy(opening.lane.modelId).catch(() => true)) return { ok: false, error: FILM_BUSY };
  return { ok: true, lane: opening.lane };
}

/** The product and (when any shot has the star) the star, as a press needs them before any money moves. */
async function readyToFilm(deps: CampaignDeps, caller: CampaignCaller, row: CampaignRow, shots: readonly { star: boolean }[]) {
  const card = await readConfirmedCard(deps.db, caller.userId, row.productId);
  if (card === "unavailable") return { ok: false as const, error: FILM_COULDNT_START };
  if (!card) return { ok: false as const, error: PRODUCT_NOT_CONFIRMED };
  if (shots.some((s) => s.star)) {
    const characterId = row.characterIds[0];
    if (!characterId) return { ok: false as const, error: CHARACTER_NEEDS_PHOTO };
    const ready = await starReadiness(deps.db, caller.userId, characterId);
    if (!ready.ok) return { ok: false as const, error: ready.missing === "unavailable" ? FILM_COULDNT_START : ready.error };
    return { ok: true as const, card, star: ready.star };
  }
  return { ok: true as const, card, star: null };
}

/** Rows a film press reserved and could not write down: back (forced: nothing was sent), then ended. True when all went back. */
async function releaseFilmRows(deps: CampaignDeps, caller: CampaignCaller, specs: readonly FilmRowSpec[], reason: string): Promise<boolean> {
  let all = true;
  for (const spec of specs) {
    const back = await endStillRow({ db: deps.db, refund: deps.money.refund }, { userId: caller.userId, rowId: spec.id, credits: spec.credits, detail: reason, force: true });
    if (spec.credits > 0 && !back) all = false;
  }
  return all;
}

/** Whether every one of these rows is reserved ("generating") for this campaign: a press whose first delivery died after reserving. */
async function rowsReservedFor(deps: CampaignDeps, caller: CampaignCaller, ids: readonly string[], campaignId: string): Promise<{ ok: boolean; credits: number }> {
  try {
    const { data } = await deps.db.from("generations").select("id, status, credits_used, press_tour").eq("user_id", caller.userId).in("id", [...ids]);
    const rows = (Array.isArray(data) ? data : []) as { id?: unknown; status?: unknown; credits_used?: unknown; press_tour?: unknown }[];
    const ok = ids.every((id) =>
      rows.some((r) => r.id === id && r.status === "generating" && (r.press_tour as { campaign_id?: unknown } | null)?.campaign_id === campaignId),
    );
    return { ok, credits: rows.reduce((sum, r) => sum + (typeof r.credits_used === "number" ? r.credits_used : 0), 0) };
  } catch {
    return { ok: false, credits: 0 };
  }
}

/**
 * Film every shot from its approved (or kept) still: the quote's film line,
 * charged once whatever the network does to the press (every row's id is
 * made from this press's sendId). Admins only in this cut, behind
 * press_tour_film; a tripped lane refuses before anything is reserved.
 */
export async function filmShots(
  deps: CampaignDeps,
  caller: CampaignCaller,
  input: { sendId: string; campaignId: string; captions?: boolean; locale?: string },
): Promise<CampaignResult> {
  const gate = campaignGate(caller);
  if (gate) return failure(gate);
  const sendId = parseUuid(input?.sendId);
  const id = parseUuid(input?.campaignId);
  if (!sendId || !id || (input?.captions !== undefined && typeof input.captions !== "boolean")) return failure(CAMPAIGN_BAD_REQUEST);

  const row = await readCampaign(deps.db, id, caller.userId);
  if (row === "unavailable") return failure(FILM_COULDNT_START);
  if (!row) return failure(NOT_YOURS);
  if (isTerminal(row.stage)) return failure(CAMPAIGN_CLOSED);
  // Filmed already (this press delivered again, or another tab): as it stands.
  if (filmed(row.shots)) return { ok: true, campaign: await viewOf(deps, caller, row) };
  if (row.stage !== "awaiting_approval" || !row.plan) return failure(CAMPAIGN_MOVED_ON);
  // The free trial ad's filming arrives with its own cut (Cut 7).
  if (row.trialId !== null) return failure(PRESS_TOUR_NOT_OPEN);
  const plan = row.plan;

  // Every still decided, each with its painting.
  for (const s of plan.shots) {
    const still = stillOf(row.stills, s.shot);
    if (!still || inFlight(still) || still.decision === "pending") return failure(blockDecide(s.shot));
    if (!keptAttempt(still)?.path) return failure(FILM_STILLS_MISSING);
  }

  const lane = await filmLane(deps);
  if (!lane.ok) return failure(lane.error);
  const ready = await readyToFilm(deps, caller, row, plan.shots);
  if (!ready.ok) return failure(ready.error);

  // The price the person saw must still be the price (N3).
  const balance = await deps.balance(caller.userId).catch(() => 0);
  const fresh = buildPressQuote({ shots: plan.shots, balanceNow: balance, paintPaid: true, animatePaid: false, trial: false, charged: caller.via !== "admin" });
  if (quotePriceChanged(row.quote, fresh)) {
    await mutateCampaign(deps.db, id, caller.userId, (r) => (r.stage !== "awaiting_approval" || filmed(r.shots) ? { refuse: null } : { patch: { quote: fresh }, value: null }));
    return failure(priceChanged(fresh.animate));
  }

  const specs = plan.shots.map((s) =>
    filmSpec(row, s, { id: filmRowId(sendId, s.shot), kind: "film", take: 1, credits: shotCredits(s.seconds), modelId: lane.lane.modelId }),
  );
  const paidQuote = { ...fresh, rows: fresh.rows.map((r) => (r.key === "stills" || r.key === "film" ? { ...r, paid: true } : r)) };
  const assembly = initialAssembly({ locale: input?.locale, captions: input?.captions });
  const reserved = await reservePressRows(deps.money, caller.userId, specs, filmRowPayload);
  let credits = reserved.ok ? reserved.credits : 0;
  if (!reserved.ok) {
    if (reserved.code !== "repeat") return failure(filmReserveError(reserved.error));
    // This press delivered again: adopt its rows only if its first delivery died before writing them down.
    const now = await readCampaign(deps.db, id, caller.userId);
    if (now === "unavailable") return failure(CAMPAIGN_READ_FAILED);
    if (!now || filmed(now.shots)) return answer(deps, caller, id);
    const held = await rowsReservedFor(deps, caller, specs.map((s) => s.id), id);
    if (!held.ok) return answer(deps, caller, id);
    credits = held.credits;
  }

  const written = await writeFilming(deps, caller, id, specs, paidQuote, credits, assembly);
  if (!written.ok) {
    const now = await readCampaign(deps.db, id, caller.userId);
    if (now && now !== "unavailable" && specs.every((sp) => now.shots.some((x) => x.takes.some((t) => t.rowId === sp.id)))) {
      return { ok: true, campaign: await viewOf(deps, caller, now) };
    }
    const gaveBack = await releaseFilmRows(deps, caller, specs, "The ad moved on before its shots were filmed.");
    if (written.reason === "refused") return failure(CAMPAIGN_MOVED_ON);
    return failure(gaveBack ? FILM_COULDNT_START : FILM_NOT_STARTED);
  }
  deps.kick(id);
  return { ok: true, campaign: await viewOf(deps, caller, written.row) };
}

/** awaiting_approval -> animating, every take written down as reserved, the 24 h rule's clock started. */
function writeFilming(
  deps: CampaignDeps,
  caller: CampaignCaller,
  id: string,
  specs: readonly FilmRowSpec[],
  quote: ReturnType<typeof buildPressQuote>,
  credits: number,
  assembly: ReturnType<typeof initialAssembly>,
) {
  const now = nowOf(deps);
  const nowIso = now.toISOString();
  return mutateCampaign(deps.db, id, caller.userId, (r) => {
    if (r.stage !== "awaiting_approval" || !r.plan || filmed(r.shots)) return { refuse: null };
    let shots: ShotState[] | null = initialShots(r.plan.shots.length);
    for (const spec of specs) {
      shots = shots ? withTakeReserved(shots, spec.shot, { rowId: spec.id, kind: "film", credits: spec.credits }, nowIso) : null;
    }
    if (!shots) return { refuse: null };
    return {
      patch: {
        stage: "animating",
        shots,
        shot_ids: [...r.shotIds, ...specs.map((s) => s.id)].slice(-32),
        quote,
        credits_charged: r.creditsCharged + credits,
        film_charged_at: r.filmChargedAt ?? nowIso,
        cut_due_at: new Date(now.getTime() + CUT_DUE_MS).toISOString(),
        expires_at: null,
        assembly,
      },
      value: null,
    };
  });
}

/**
 * Film one shot again from its still, at that shot's normal film price (the
 * operator's rule: no free re-shoot before calibration). `credits` is the
 * price the press wall showed: a price that moved since is refused with the
 * new one before anything is reserved (N3, as the Film press does; MONEY-5).
 */
export async function refilmShot(
  deps: CampaignDeps,
  caller: CampaignCaller,
  input: { sendId: string; campaignId: string; shot: number; credits: number; note?: string },
): Promise<CampaignResult> {
  const gate = campaignGate(caller);
  if (gate) return failure(gate);
  const sendId = parseUuid(input?.sendId);
  const id = parseUuid(input?.campaignId);
  const shot = input?.shot;
  const shown = input?.credits;
  if (!sendId || !id || typeof shot !== "number" || !Number.isInteger(shot) || shot < 1 || shot > 12) return failure(CAMPAIGN_BAD_REQUEST);
  if (typeof shown !== "number" || !Number.isInteger(shown) || shown < 0) return failure(CAMPAIGN_BAD_REQUEST);
  const note = cleanText(input?.note, 200);
  const rowId = refilmRowId(sendId);

  const row = await readCampaign(deps.db, id, caller.userId);
  if (row === "unavailable") return failure(FILM_COULDNT_START);
  if (!row) return failure(NOT_YOURS);
  if (isTerminal(row.stage)) return failure(CAMPAIGN_CLOSED);
  // This very press, delivered again: the campaign as it stands.
  if (row.shots.some((s) => s.takes.some((t) => t.rowId === rowId))) return answer(deps, caller, id);
  if (!filmed(row.shots)) return failure(SHOTS_NOT_FILMED);
  if (row.stage !== "awaiting_approval") return failure(WALL_BUSY[row.stage] ?? CAMPAIGN_MOVED_ON);
  const planned = row.plan?.shots.find((s) => s.shot === shot);
  const s = shotOf(row.shots, shot);
  if (!planned || !s || !row.plan) return failure(SHOT_NOT_IN_AD);
  if (shotBusy(s)) return failure(SHOT_BEING_FILMED);
  if (!canRefilm(s)) return failure(REFILM_LIMIT);
  // The price the person saw must still be the price (N3).
  const price = shotCredits(planned.seconds);
  if (shown !== price) return failure(priceChanged(price));

  const lane = await filmLane(deps);
  if (!lane.ok) return failure(lane.error);
  const ready = await readyToFilm(deps, caller, row, [planned]);
  if (!ready.ok) return failure(ready.error);

  // The person's own words are judged BEFORE anything is charged (repaint's order, PT-SEC-2).
  if (note) {
    const realPerson = ready.star !== null && ready.star.kind !== "not_a_person";
    try {
      await deps.planner.assertPromptAllowed({ prompt: note, hasRealPersonReference: realPerson });
    } catch (err) {
      const message = err && typeof err === "object" && typeof (err as { userMessage?: unknown }).userMessage === "string" ? (err as { userMessage: string }).userMessage : null;
      return failure(message ?? FILM_COULDNT_START);
    }
    const own = await deps.ownRules(caller.userId).catch(() => [] as PolicyRule[]);
    const policy = await adPolicyCheck(deps.planner, note, own);
    if (!policy.ok) return failure(policy.code === "refused" ? policy.error : FILM_COULDNT_START);
    const endorsement = await endorsementCheck(deps.planner, refilmText(row.plan, shot, note), ready.star?.kind ?? "permission");
    if (!endorsement.ok) return failure(endorsement.code === "refused" ? endorsement.error : FILM_COULDNT_START);
  }

  const spec = filmSpec(row, planned, { id: rowId, kind: "refilm", take: s.takes.length + 1, credits: price, modelId: lane.lane.modelId });
  const reserved = await reservePressRows(deps.money, caller.userId, [spec], filmRowPayload);
  if (!reserved.ok) {
    if (reserved.code !== "repeat") return failure(filmReserveError(reserved.error));
    const held = await rowsReservedFor(deps, caller, [rowId], id);
    if (!held.ok) return answer(deps, caller, id);
  }
  const written = await writeRefilm(deps, caller, id, shot, spec, note);
  if (!written.ok) {
    const now = await readCampaign(deps.db, id, caller.userId);
    if (now && now !== "unavailable" && now.shots.some((x) => x.takes.some((t) => t.rowId === rowId))) return { ok: true, campaign: await viewOf(deps, caller, now) };
    const gaveBack = await releaseFilmRows(deps, caller, [spec], "The ad moved on before this shot was filmed again.");
    if (written.reason === "refused" && written.value) return failure(written.value);
    return failure(gaveBack ? FILM_COULDNT_START : FILM_NOT_STARTED);
  }
  deps.kick(id);
  return { ok: true, campaign: await viewOf(deps, caller, written.row) };
}

function writeRefilm(deps: CampaignDeps, caller: CampaignCaller, id: string, shot: number, spec: FilmRowSpec, note: string | null) {
  const now = nowOf(deps);
  const nowIso = now.toISOString();
  return mutateCampaign<string | null>(deps.db, id, caller.userId, (r) => {
    if (isTerminal(r.stage)) return { refuse: CAMPAIGN_CLOSED };
    if (r.stage !== "awaiting_approval" || !filmed(r.shots)) return { refuse: WALL_BUSY[r.stage] ?? CAMPAIGN_MOVED_ON };
    const s = shotOf(r.shots, shot);
    if (!s || !canRefilm(s)) return { refuse: s && shotBusy(s) ? SHOT_BEING_FILMED : REFILM_LIMIT };
    const shots = withTakeReserved(r.shots, shot, { rowId: spec.id, kind: "refilm", credits: spec.credits, note }, nowIso);
    if (!shots) return { refuse: SHOT_BEING_FILMED };
    const a = parseAssembly(r.assembly);
    return {
      patch: {
        stage: "animating",
        shots,
        shot_ids: [...r.shotIds, spec.id].slice(-32),
        credits_charged: r.creditsCharged + spec.credits,
        cut_due_at: new Date(now.getTime() + CUT_DUE_MS).toISOString(),
        expires_at: null,
        assembly: { ...a, parked: false, failures: 0, lastError: null },
      },
      value: null,
    };
  });
}

/**
 * A decision on the press wall (keep a take, cut a shot, or make the cut
 * now): written, and when nothing waits on the person any more the cut
 * starts (the 24 h rule's clock with it) and the machine is kicked.
 */
async function wallDecision(
  deps: CampaignDeps,
  caller: CampaignCaller,
  campaignId: unknown,
  decide: (row: CampaignRow, ctxOf: (shot: number) => ShotContext) => { ok: true; shots: ShotState[]; forceCut: boolean } | { ok: false; error: string },
): Promise<CampaignResult> {
  const gate = campaignGate(caller);
  if (gate) return failure(gate);
  const id = parseUuid(campaignId);
  if (!id) return failure(CAMPAIGN_BAD_REQUEST);
  if (await deps.rateLimited(caller.userId, "press-card-write", 60 * 60, WRITES_PER_HOUR)) return failure(PRESS_WRITE_LIMIT);
  const now = nowOf(deps);
  const written = await mutateCampaign<string | "cut" | "wall" | "asIs">(deps.db, id, caller.userId, (row) => {
    if (isTerminal(row.stage)) return { refuse: CAMPAIGN_CLOSED };
    if (!filmed(row.shots)) return { refuse: SHOTS_NOT_FILMED };
    if (row.stage !== "awaiting_approval") return { refuse: WALL_BUSY[row.stage] ?? CAMPAIGN_MOVED_ON };
    const ctxOf = (shot: number) => contextOf(row.plan, shot);
    const next = decide(row, ctxOf);
    if (!next.ok) return { refuse: next.error };
    const waiting = firstDecision(next.shots, ctxOf) !== null;
    if (waiting && !next.forceCut) return { patch: { shots: next.shots }, value: "wall" };
    const settled = settleForCut(next.shots, ctxOf);
    if (!settled) return { refuse: CUT_NOTHING };
    const a = parseAssembly(row.assembly);
    return {
      patch: {
        shots: settled,
        stage: "assembling",
        // The ad's product verdict is the worst of the takes that go INTO this
        // cut (a shot cut out no longer counts; a mismatched take kept does):
        // the press line's warning reads it (PT-R3-05).
        product_verdict: adVerdict(cutList(settled).map(({ shot, take }) => ({ verdict: take.product, productExpected: ctxOf(shot).productExpected }))),
        cut_due_at: new Date(now.getTime() + CUT_DUE_MS).toISOString(),
        expires_at: null,
        assembly: { ...a, parked: false, failures: 0, lastError: null },
      },
      value: "cut",
    };
  });
  if (!written.ok) {
    if (written.reason === "missing") return failure(NOT_YOURS);
    if (written.reason === "refused" && written.value) return failure(written.value);
    return failure(CAMPAIGN_SAVE_FAILED);
  }
  if (written.value === "cut") deps.kick(id);
  return { ok: true, campaign: await viewOf(deps, caller, written.row) };
}

/** Put this take of this shot in the cut (free). */
export function keepTake(deps: CampaignDeps, caller: CampaignCaller, input: { campaignId: string; shot: number; take: number }): Promise<CampaignResult> {
  const shot = input?.shot;
  const take = input?.take;
  if (typeof shot !== "number" || !Number.isInteger(shot) || shot < 1 || shot > 12 || typeof take !== "number" || !Number.isInteger(take) || take < 1 || take > 12) {
    return Promise.resolve(failure(CAMPAIGN_BAD_REQUEST));
  }
  return wallDecision(deps, caller, input?.campaignId, (row) => {
    const next = withKeep(row.shots, shot, take);
    return next.ok ? { ok: true, shots: next.shots, forceCut: false } : { ok: false, error: DECIDE_FAILURE[next.reason] };
  });
}

/** Leave this shot out of the cut (free; at least one shot stays). */
export function cutShot(deps: CampaignDeps, caller: CampaignCaller, input: { campaignId: string; shot: number }): Promise<CampaignResult> {
  const shot = input?.shot;
  if (typeof shot !== "number" || !Number.isInteger(shot) || shot < 1 || shot > 12) return Promise.resolve(failure(CAMPAIGN_BAD_REQUEST));
  return wallDecision(deps, caller, input?.campaignId, (row) => {
    const next = withCut(row.shots, shot);
    return next.ok ? { ok: true, shots: next.shots, forceCut: false } : { ok: false, error: DECIDE_FAILURE[next.reason] };
  });
}

/**
 * Make the cut now with the takes as they stand (a shot still waiting keeps
 * its chosen take: the person's press is the decision), or again after it
 * couldn't be finished (free). A cut already being made answers as it is.
 */
export async function assembleNow(deps: CampaignDeps, caller: CampaignCaller, input: { campaignId: string }): Promise<CampaignResult> {
  const gate = campaignGate(caller);
  if (gate) return failure(gate);
  const id = parseUuid(input?.campaignId);
  if (!id) return failure(CAMPAIGN_BAD_REQUEST);
  const row = await readCampaign(deps.db, id, caller.userId);
  if (row === "unavailable") return failure(CAMPAIGN_READ_FAILED);
  if (!row) return failure(NOT_YOURS);
  if (row.stage === "assembling" || row.stage === "signing" || row.stage === "ready") return { ok: true, campaign: await viewOf(deps, caller, row) };
  return wallDecision(deps, caller, id, (r) => {
    if (r.shots.some(shotBusy)) return { ok: false, error: SHOT_BEING_FILMED };
    return { ok: true, shots: r.shots, forceCut: true };
  });
}

/** The shot's planned checks (for callers outside the machine). */
export function shotCheckContext(row: CampaignRow, shot: number): ShotContext {
  const p = row.plan?.shots.find((s) => s.shot === shot);
  return p ? shotContext(p) : { productExpected: false, star: false };
}
