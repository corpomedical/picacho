// Press Tour's filming and the checks on filmed shots (Cut 4; spec §1.7-§1.8
// as changed by v2: synthesis §3.1 items 11, 13, 18, 19, 22; operator
// 2026-09-26).
//
// FILMING. Each approved (or kept) still is animated as the shot's OPENING
// FRAME on the film lane (the setting press_film_lane; kling-o3 first-frame
// image-to-video until the bake-off says otherwise):
//   - openingFrame: the still is already the clip's exact 9:16 and is sent
//     as it is, never reframed (fal.ts);
//   - audio OFF (critique #18: generate_audio false; native sound is also
//     taken out of the kept file and replaced by silence in the cut);
//   - no circuit-breaker substitution: the lane is named here and nothing
//     swaps it; a tripped lane refuses the Film press before anything is
//     reserved ("Filming is busy"), and a take that fails feeds the breaker;
//   - every gate called EXPLICITLY before the lane (the Recast pattern, as
//     paint.ts does for stills): the row is still reserved, the product is
//     the person's confirmed card, the star has photos and the ad-use
//     attestation, the prompt gate, the ad policy step, and for a re-film
//     with the person's own words the endorsement rubric; the OUTPUT gate on
//     the filmed take (judgeRender, strict lane) before it is kept.
// One generations row per take, id made from the press (film: the Film
// press's sendId and the shot; refilm: the Re-film press's sendId; retry:
// the failed row), reserved through reserve_generations exactly as the
// quote's film line prices it (quote.ts shotCredits). The lane's handle is
// written onto the take's own row the moment the lane takes it, so a step
// that dies before writing the campaign never films the shot twice: the
// next step adopts the handle.
//
// MONEY. A take that fails before the lane was called gets its credits back
// FORCED (nothing was spent: a gate, a read, the still's link); once the
// lane was called, the ordinary refund rules decide (the render may be
// billed: PT-06). Then v2 #11: one retry, paid again at its price when the
// charge went back (same billing window), on the house when it stayed. A
// content refusal (a gate before the lane, or the output gate after it) is
// never retried, and is terminal for THAT TAKE (fixer 2026-09-26, MONEY-2):
// a refused re-film sends its shot back to the wall with its earlier take,
// and a refused first filming leaves its shot on the wall with nothing to
// keep (the person cuts it free, or films it again). The ad closes on a
// refusal only when no shot has any take that came through (shots.ts
// adRefused). No re-shoot, no refund for a miss (policy.reshoot 'off').
//
// CHECKS (record-only). Every filmed take is read at 3 moments (4 for a
// packshot: product-lock/sampling.ts) with the ffmpeg sampler, by the
// product checker and the face scorer (product-lock/check.ts checkMoments),
// which writes its own product_frame_checks rows. The take's verdict is the
// worst moment's. A miss starts nothing on its own: the ad waits on the
// person (shots.ts needsDecision).
//
// Alias-free (vitest has no "@/"): film.test.ts imports it as it is.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CheckResult } from "../product-lock/check";
import { MAX_ESCALATIONS_PER_AD, adVerdict } from "../product-lock/product-lock";
import type { MomentView, ShotRole, Verdict } from "./campaign-types";
import { PRODUCT_NOT_CONFIRMED } from "./campaign-messages";
import {
  WAIT_MS,
  derivedUuid,
  escalationsUsed,
  failCampaign,
  isTerminal,
  keptAttempt,
  mutateCampaign,
  stillOf,
  type CampaignPatch,
  type CampaignRow,
  type MachineDeps,
  type StepResult,
} from "./campaign-machine";
import { adPath } from "./cut-state";
import { FILM_FLAG, FILM_LANE_SETTING, resolveFilmLane, type FilmLane } from "./film-lane";
import { FILM_REFUSED, FILM_STILLS_MISSING } from "./film-messages";
import { pressTourEnvReady } from "./enabled";
import { endStillRow, readConfirmedCard, starReadiness, type GateAnswer, type Star } from "./paint";
import { adPolicyCheck, endorsementCheck, type PlannedShot, type PlannerDeps, type PolicyRule, type ProductVisibility } from "./planner";
import { FILM_LANE } from "./quote";
import {
  adRefused,
  anyInFlight,
  filmedTakes,
  filmingTakes,
  firstDecision,
  momentDetailFrom,
  momentFace,
  momentProduct,
  reservedTakes,
  retryDue,
  settleForCut,
  shotOf,
  takeEscalations,
  tagCornerFor,
  takeOf,
  withTakeChecked,
  withTakeFailed,
  withTakeFilmed,
  withTakeReserved,
  withTakeSubmitted,
  chosenTake,
  type LaneJob,
  type ShotContext,
  type ShotState,
  type Take,
  type TakeCheckResult,
  type TakeFailCause,
  type TakeKind,
} from "./shots";
import { cleanText, type ProductCard } from "./types";

// ---------------------------------------------------------------------------
// The switch and the lane
// ---------------------------------------------------------------------------

// The switch, the lane setting and the lanes live in the leaf film-lane.ts
// (Admin validates the setting without loading this machine); re-exported
// here so filming's names stay where the rest of Cut 4 reads them.
export { DEFAULT_FILM_LANE, FILM_FLAG, FILM_LANE_SETTING, FILM_LANES, resolveFilmLane, validateFilmLaneSetting, type FilmLane } from "./film-lane";

/**
 * Whether filming is open, and on which lane: the environment ready, the
 * press_tour AND press_tour_film switches on, a priced lane. Fail-closed:
 * a missing row or a failed read is closed.
 */
export async function readFilmOpening(db: SupabaseClient): Promise<{ open: boolean; lane: FilmLane | null }> {
  const closed = { open: false, lane: null };
  if (!pressTourEnvReady()) return closed;
  try {
    const [{ data: flags, error: flagError }, { data: setting, error: settingError }] = await Promise.all([
      db.from("feature_flags").select("key, enabled").in("key", ["press_tour", FILM_FLAG]),
      db.from("app_settings").select("value").eq("key", FILM_LANE_SETTING).maybeSingle(),
    ]);
    if (flagError || settingError || !Array.isArray(flags)) return closed;
    const on = (key: string) => (flags as { key?: unknown; enabled?: unknown }[]).some((f) => f.key === key && f.enabled === true);
    if (!on("press_tour") || !on(FILM_FLAG)) return closed;
    const lane = resolveFilmLane((setting as { value?: unknown } | null)?.value);
    return lane ? { open: true, lane } : closed;
  } catch {
    return closed;
  }
}

// ---------------------------------------------------------------------------
// Ids made from a press (the repeat-send pattern)
// ---------------------------------------------------------------------------

/** Take 1 of each shot, from the Film press's own send id: a resent press meets its own rows. */
export function filmRowId(filmSendId: string, shot: number): string {
  return derivedUuid(`press-film:${filmSendId.toLowerCase()}:${shot}`);
}

/** A person's re-film, from that press's own send id. */
export function refilmRowId(refilmSendId: string): string {
  return derivedUuid(`press-refilm:${refilmSendId.toLowerCase()}`);
}

/** A paid retry (v2 #11), made from the failed take it replaces. */
export function filmPaidRetryRowId(failedRowId: string): string {
  return derivedUuid(`press-film-paid-retry:${failedRowId.toLowerCase()}`);
}

/** A house retry (0 credits), made by the machine. */
export function filmHouseRowId(campaignId: string, shot: number, n: number): string {
  return derivedUuid(`press-film-retry:${campaignId.toLowerCase()}:${shot}:${n}`);
}

// ---------------------------------------------------------------------------
// The rows
// ---------------------------------------------------------------------------

export type FilmRowSpec = {
  id: string;
  campaignId: string;
  shot: number;
  role: ShotRole;
  kind: TakeKind;
  /** The take's number within its shot. */
  take: number;
  credits: number;
  seconds: number;
  modelId: string;
  characterIds: string[];
  /** What History shows as the row's words. */
  label: string;
  trialId: string | null;
};

/** The generations row reserve_generations writes for one take (the paint.ts shape, as a video). */
export function filmRowPayload(spec: FilmRowSpec, spend: { purchased: number; bonus: number } = { purchased: 0, bonus: 0 }) {
  return {
    id: spec.id,
    character_profile_id: spec.characterIds[0] ?? null,
    character_profile_ids: spec.characterIds,
    prompt_input: (cleanText(spec.label, 200) ?? "Press Tour shot").slice(0, 200),
    content_type: "video",
    status: "generating",
    attempts: 0,
    result_url: null,
    pipeline_log: [],
    model_id: spec.modelId,
    video_model_id: spec.modelId,
    video_duration_seconds: Math.round(spec.seconds),
    video_aspect_ratio: "9:16",
    credits_used: spec.credits,
    purchased_credits_used: spend.purchased,
    bonus_credits_used: spend.bonus,
    // Never the daily free slot (v2 #1, #22).
    free_generation_used: false,
    press_tour: {
      campaign_id: spec.campaignId,
      shot: spec.shot,
      role: spec.role,
      kind: "shot",
      take: spec.take,
      film: spec.kind,
      house: spec.credits === 0,
      trial_id: spec.trialId,
    },
  };
}

/** One take's row spec for a planned shot of a campaign. */
export function filmSpec(
  row: Pick<CampaignRow, "id" | "characterIds" | "trialId" | "plan">,
  shot: PlannedShot,
  a: { id: string; kind: TakeKind; take: number; credits: number; modelId: string },
): FilmRowSpec {
  const angle = row.plan?.angle ?? "Ad";
  const words = a.kind === "refilm" ? "filmed again" : a.kind === "retry" ? "filmed, retried" : "filmed";
  return {
    id: a.id,
    campaignId: row.id,
    shot: shot.shot,
    role: shot.role,
    kind: a.kind,
    take: a.take,
    credits: a.credits,
    seconds: shot.seconds,
    modelId: a.modelId,
    characterIds: shot.star ? row.characterIds : [],
    label: `Press Tour · ${angle} · shot ${shot.shot} ${words}`,
    trialId: row.trialId,
  };
}

// ---------------------------------------------------------------------------
// The words the lane is given
// ---------------------------------------------------------------------------

const PRODUCT_MOTION: Record<ProductVisibility, string> = {
  required_label:
    "The product stays exactly as it is in the first frame, its shape, colours, label and logo unchanged; its label stays turned to the camera, sharp and readable, never covered by a hand.",
  required_shape: "The product stays exactly as it is in the first frame, its shape, colours and logo unchanged, and stays in view.",
  absent: "",
};

/**
 * The film prompt for one take: the plan's own words (which passed every
 * gate when it was planned and are judged again here as a whole), the
 * product's confirmed label words, and the person's note on a re-film.
 */
export function filmPrompt(input: {
  shot: Pick<PlannedShot, "direction" | "motion" | "camera" | "productVisibility" | "star">;
  product: Pick<ProductCard, "name" | "labelStrings" | "noReadableText">;
  note: string | null;
}): string {
  const { shot, product } = input;
  const lines: string[] = [
    "Animate this exact picture: it is the first frame of a short vertical video ad. Keep everything in it as it is and bring it to life.",
    `What happens: ${shot.direction}`,
    `Movement: ${shot.motion}`,
  ];
  if (shot.camera) lines.push(`Camera: ${shot.camera}.`);
  if (shot.star) lines.push("The person keeps exactly the face, hair and features they have in the first frame.");
  if (PRODUCT_MOTION[shot.productVisibility]) lines.push(PRODUCT_MOTION[shot.productVisibility]);
  if (shot.productVisibility !== "absent" && !product.noReadableText && product.labelStrings.length > 0) {
    const words = product.labelStrings.map((s) => `"${(cleanText(s, 80) ?? "").replace(/"/g, "'")}"`).join(", ");
    lines.push(`The label's printed words stay spelled exactly: ${words}.`);
  }
  lines.push("Natural, unhurried movement. No new text, captions, logos or watermarks appear. No one speaks.");
  const note = cleanText(input.note, 200);
  if (note) lines.push(`The advertiser asks for this change: ${note}`);
  return lines.join("\n");
}

/** The words the endorsement rubric reads for a re-film that carries the person's note (PT-SEC-2's shape). */
export function refilmText(plan: { angle: string; cta: string; shots: readonly PlannedShot[] }, shot: number, note: string): string {
  const planned = plan.shots.find((s) => s.shot === shot);
  return [
    `Ad: ${plan.angle}. Call to action: ${plan.cta}`,
    planned ? `Shot ${shot} is being filmed again: ${planned.direction} ${planned.motion}` : `Shot ${shot} is being filmed again.`,
    `The advertiser asks for this change to shot ${shot}: ${note}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// The checks' words
// ---------------------------------------------------------------------------

/** A shot's checks: does its plan show the product, and the star. */
export function shotContext(shot: Pick<PlannedShot, "productVisibility" | "star">): ShotContext {
  return { productExpected: shot.productVisibility !== "absent", star: shot.star };
}

/** The checker's answer (checkMoments) as the take keeps it: each moment's words, the take's, and the tag's corner. */
export function takeCheckFrom(result: CheckResult, ctx: ShotContext, faceThreshold: number): TakeCheckResult {
  const moments: MomentView[] = result.signals.moments.map((m) => {
    const detail = ctx.productExpected ? momentDetailFrom(m) : null;
    return {
      atSeconds: m.at,
      face: momentFace(m.face, faceThreshold, ctx.star),
      product: momentProduct(m.verdict, ctx.productExpected),
      reason: m.reason,
      ...(detail ? { detail } : {}),
    };
  });
  const face: Verdict = ctx.star ? (result.face === "no_one_in_shot" || !result.face ? "not_checked" : result.face) : "no_one_in_shot";
  const product: Verdict = result.product === "no_one_in_shot" ? "not_checked" : result.product;
  return {
    face,
    product,
    reason: result.reason,
    moments,
    escalations: result.signals.escalationsUsed,
    corner: tagCornerFor(result.signals.moments.map((m) => m.box)),
  };
}

// ---------------------------------------------------------------------------
// The machine's providers for filming
// ---------------------------------------------------------------------------

export type LanePoll = { state: "pending" } | { state: "completed" } | { state: "failed"; error: string };

export type TakeCheckInput = {
  userId: string;
  campaignId: string;
  generationId: string;
  shot: number;
  /** The kept take (our stored link, or the provider's). */
  video: string;
  seconds: number;
  packshot: boolean;
  productVisibility: ProductVisibility;
  product: ProductCard;
  star: Pick<Star, "identityPath" | "traitSummary"> | null;
  escalationsLeft: number;
  lane: string;
};

export type TakeCheckOutcome = { check: TakeCheckResult; usd: number };

export interface FilmDeps {
  /** The lane filming uses now (null: filming is closed). */
  lane(): Promise<FilmLane | null>;
  /** model-health.ts: the lane is tripped. */
  laneBusy(modelId: string): Promise<boolean>;
  /** fal.ts submitVideoJob on the lane: the still as the opening frame, audio off, 9:16. Throws when the lane refused the request. */
  submit(input: { modelId: string; prompt: string; stillUrl: string; seconds: number }): Promise<LaneJob>;
  /** fal.ts checkQueuedJob. Throws on a transport error (the next step asks again). */
  poll(job: LaneJob): Promise<LanePoll>;
  /** fal.ts fetchQueuedVideoUrl: the finished take's provider link. */
  result(job: LaneJob): Promise<string>;
  cancel(job: LaneJob): Promise<void>;
  /** output-policy.ts judgeRender on the take (strict lane). */
  outputGate(input: { url: string }): Promise<GateAnswer>;
  /** core.ts persistVideo with the sound taken out: our stored link, or null (keep the provider's). */
  keep(input: { userId: string; providerUrl: string }): Promise<string | null>;
  /** The approved still, as a link the lane can fetch whenever it starts (a capability link that never expires). */
  stillUrl(path: string): string;
  promptGate(input: { prompt: string; hasRealPersonReference: boolean }): Promise<GateAnswer>;
  classify: PlannerDeps["classify"];
  review: PlannerDeps["review"];
  ownRules(userId: string): Promise<PolicyRule[]>;
  /** job-runner.ts refundGenerationCosts. */
  refund(rowId: string, opts: { force?: boolean }): Promise<boolean>;
  /** v2 #11: a paid retry against the person's own allowance (paint.ts reservePaidRetryWith). */
  reservePaid(input: { campaign: CampaignRow; spec: FilmRowSpec; failedReservedAt: string }): Promise<"reserved" | "window" | "refused">;
  /** A house retry (0 credits, paint.ts reserveHouseRowWith). True when the row exists (a repeat included). */
  reserveHouse(input: { campaign: CampaignRow; spec: FilmRowSpec }): Promise<boolean>;
  healthSuccess(modelId: string): Promise<void>;
  healthFailure(modelId: string, detail: string, userId: string): Promise<void>;
  /** product-lock check.ts checkMoments on the take, with the face scorer. Never throws. */
  checkTake(input: TakeCheckInput): Promise<TakeCheckOutcome>;
  /** The lane's booked provider price per second (video-models.ts costPerSecondUsd). */
  usdPerSecond(modelId: string): number;
  /** A take the lane has held this long is written off (default FILM_TIMEOUT_MS). */
  timeoutMs?: number;
}

/** A take still unfinished after this is written off as the lane's failure (the reaper's absolute deadline). */
export const FILM_TIMEOUT_MS = 45 * 60_000;
/** Finished takes collected per step (each: a download, the output gate, a copy): well inside the function. */
export const COLLECTS_PER_STEP = 2;

const nowOf = (deps: { now?: () => Date }) => (deps.now ? deps.now() : new Date());

type RowRead = { status?: unknown; credits_used?: unknown; press_tour?: unknown; result_url?: unknown } | null;

async function readRow(db: SupabaseClient, userId: string, rowId: string): Promise<RowRead | "unavailable"> {
  try {
    const { data, error } = await db.from("generations").select("id, status, credits_used, press_tour, result_url").eq("id", rowId).eq("user_id", userId).maybeSingle();
    if (error) return "unavailable";
    return (data ?? null) as RowRead;
  } catch {
    return "unavailable";
  }
}

function tourOf(row: RowRead): Record<string, unknown> {
  const pt = row?.press_tour;
  return pt && typeof pt === "object" && !Array.isArray(pt) ? (pt as Record<string, unknown>) : {};
}

/** The lane's handle written onto the take's row the moment the lane took it: the adoption record. */
function jobOnRow(row: RowRead): LaneJob | null {
  const j = tourOf(row).job as Record<string, unknown> | undefined;
  if (!j || typeof j !== "object") return null;
  const { requestId, statusUrl, responseUrl, cancelUrl, label } = j as Record<string, unknown>;
  if (typeof requestId !== "string" || typeof statusUrl !== "string" || typeof responseUrl !== "string") return null;
  if (!statusUrl.startsWith("https://") || !responseUrl.startsWith("https://")) return null;
  return {
    requestId,
    statusUrl,
    responseUrl,
    cancelUrl: typeof cancelUrl === "string" && cancelUrl.startsWith("https://") ? cancelUrl : "",
    label: typeof label === "string" ? label.slice(0, 80) : "film",
  };
}

type Failure = { cause: TakeFailCause; error: string; when: "before" | "after" };

/**
 * A take that will not be delivered: its row ended (credits back forced
 * before the lane was called, by the ordinary rules after: PT-06), then the
 * one retry reserved (v2 #11) BEFORE anything is written, then one campaign
 * write. A retry reserved but not written down is given back at once.
 */
async function failTake(deps: MachineDeps, row: CampaignRow, shot: number, take: Take, f: Failure): Promise<"failed" | "retrying" | "unavailable"> {
  const film = deps.film!;
  const nowIso = nowOf(deps).toISOString();
  const refunded =
    f.cause === "gone"
      ? false
      : await endStillRow({ db: deps.db, refund: film.refund }, { userId: row.userId, rowId: take.rowId, credits: take.credits, detail: f.error, force: f.when === "before" });
  // A row settled elsewhere (the reaper): its charge went back when it now holds none.
  let wentBack = refunded;
  if (f.cause === "gone") {
    const r = await readRow(deps.db, row.userId, take.rowId);
    wentBack = take.credits > 0 && r !== "unavailable" && r !== null && r.credits_used === 0;
  }

  let retry: { rowId: string; credits: number } | null = null;
  const s = shotOf(row.shots, shot);
  const planned = row.plan?.shots.find((p) => p.shot === shot);
  const lane = await film.lane().catch(() => null);
  if ((f.cause === "provider" || f.cause === "gone") && s && planned && lane && retryDue(s, take)) {
    const n = s.takes.length + 1;
    let house = !(take.credits > 0 && wentBack);
    if (!house) {
      const rowId = filmPaidRetryRowId(take.rowId);
      const spec = filmSpec(row, planned, { id: rowId, kind: "retry", take: n, credits: take.credits, modelId: lane.modelId });
      const paid = await film.reservePaid({ campaign: row, spec, failedReservedAt: take.at }).catch((): "refused" => "refused");
      if (paid === "reserved") retry = { rowId, credits: take.credits };
      else if (paid === "window") house = true;
    }
    if (house) {
      const rowId = filmHouseRowId(row.id, shot, n);
      const spec = filmSpec(row, planned, { id: rowId, kind: "retry", take: n, credits: 0, modelId: lane.modelId });
      if (await film.reserveHouse({ campaign: row, spec }).catch(() => false)) retry = { rowId, credits: 0 };
    }
  }

  const written = await mutateCampaign(deps.db, row.id, null, (fresh) => {
    if (isTerminal(fresh.stage)) return { refuse: null };
    let shots = withTakeFailed(fresh.shots, shot, take.n, { error: f.error, cause: f.cause, refunded: wentBack }, nowIso);
    const patch: CampaignPatch = {};
    if (wentBack && take.credits > 0) patch.credits_refunded = fresh.creditsRefunded + take.credits;
    if (retry) {
      const next = withTakeReserved(shots, shot, { rowId: retry.rowId, kind: "retry", credits: retry.credits, note: take.note }, nowIso);
      if (next) {
        shots = next;
        if (retry.credits > 0) patch.credits_charged = fresh.creditsCharged + retry.credits;
        if (!fresh.shotIds.includes(retry.rowId)) patch.shot_ids = [...fresh.shotIds, retry.rowId].slice(-32);
      }
    }
    patch.shots = shots;
    return { patch, value: null };
  });
  if (retry && !(written.ok && written.row.shots.some((x) => x.takes.some((t) => t.rowId === retry.rowId)))) {
    await endStillRow({ db: deps.db, refund: film.refund }, { userId: row.userId, rowId: retry.rowId, credits: retry.credits, detail: "The ad moved on before this shot was retried.", force: true }).catch(
      () => false,
    );
  }
  if (!written.ok) return "unavailable";
  return retry ? "retrying" : "failed";
}

/** Submit one reserved take: every gate, then the lane; the handle onto the row, then onto the campaign. */
async function submitTake(deps: MachineDeps, row: CampaignRow, shot: number, take: Take): Promise<StepResult> {
  const film = deps.film!;
  const nowIso = nowOf(deps).toISOString();
  const planned = row.plan?.shots.find((p) => p.shot === shot);
  if (!planned) return failTake(deps, row, shot, take, { cause: "gate", error: FILM_STILLS_MISSING, when: "before" }).then(() => "failed");

  // 1. The row is still ours; a handle already on it is adopted, never filmed twice.
  const r = await readRow(deps.db, row.userId, take.rowId);
  if (r === "unavailable") return "unavailable";
  const adopted = jobOnRow(r);
  if (r && adopted && r.status === "generating") {
    const w = await mutateCampaign(deps.db, row.id, null, (fresh) =>
      isTerminal(fresh.stage) ? { refuse: null } : { patch: { shots: withTakeSubmitted(fresh.shots, shot, take.n, adopted, nowIso) }, value: null },
    );
    return w.ok ? "submitted" : "unavailable";
  }
  if (!r || r.status !== "generating") return failTake(deps, row, shot, take, { cause: "gone", error: "the take's row is no longer reserved", when: "before" });

  // 2. The still it is filmed from, the product, the star.
  const still = stillOf(row.stills, shot);
  const kept = still ? keptAttempt(still) : null;
  if (!kept?.path) return failTake(deps, row, shot, take, { cause: "gate", error: FILM_STILLS_MISSING, when: "before" });
  const card = await readConfirmedCard(deps.db, row.userId, row.productId);
  if (card === "unavailable") return "unavailable";
  if (!card) return failTake(deps, row, shot, take, { cause: "gate", error: PRODUCT_NOT_CONFIRMED, when: "before" });
  let star: Star | null = null;
  if (planned.star) {
    const ready = row.characterIds[0] ? await starReadiness(deps.db, row.userId, row.characterIds[0]) : null;
    if (ready && !ready.ok && ready.missing === "unavailable") return "unavailable";
    if (!ready || !ready.ok) return failTake(deps, row, shot, take, { cause: "gate", error: ready && !ready.ok ? ready.error : FILM_STILLS_MISSING, when: "before" });
    star = ready.star;
  }

  // 3. The gates, on the whole prompt.
  const prompt = filmPrompt({ shot: planned, product: card, note: take.note });
  const gate = await film
    .promptGate({ prompt, hasRealPersonReference: star !== null && star.kind !== "not_a_person" })
    .catch((): GateAnswer => ({ ok: false, reason: "unavailable", message: "The safety check could not run." }));
  if (!gate.ok) {
    return gate.reason === "refused"
      ? failTake(deps, row, shot, take, { cause: "refused", error: gate.message, when: "before" })
      : failTake(deps, row, shot, take, { cause: "provider", error: "The safety check couldn't run.", when: "before" });
  }
  const own = await film.ownRules(row.userId).catch(() => [] as PolicyRule[]);
  const policy = await adPolicyCheck(film, prompt, own);
  if (!policy.ok) {
    return policy.code === "refused"
      ? failTake(deps, row, shot, take, { cause: "refused", error: policy.error, when: "before" })
      : failTake(deps, row, shot, take, { cause: "provider", error: "The ad check couldn't run.", when: "before" });
  }
  if (take.note && row.plan) {
    const endorsement = await endorsementCheck(film, refilmText(row.plan, shot, take.note), star?.kind ?? "permission");
    if (!endorsement.ok) {
      return endorsement.code === "refused"
        ? failTake(deps, row, shot, take, { cause: "refused", error: endorsement.error, when: "before" })
        : failTake(deps, row, shot, take, { cause: "provider", error: "The ad check couldn't run.", when: "before" });
    }
  }

  // 4. The lane: the still as the opening frame, audio off. No substitution.
  const lane = await film.lane().catch(() => null);
  if (!lane) return failTake(deps, row, shot, take, { cause: "provider", error: "filming was switched off before this shot was filmed", when: "before" });
  let job: LaneJob;
  try {
    job = await film.submit({ modelId: lane.modelId, prompt, stillUrl: film.stillUrl(kept.path), seconds: planned.seconds });
  } catch (err) {
    await film.healthFailure(lane.modelId, err instanceof Error ? err.message.slice(0, 300) : "submit failed", row.userId).catch(() => undefined);
    // The request may have reached the lane before the answer was lost: the ordinary rules decide.
    return failTake(deps, row, shot, take, { cause: "provider", error: "the lane didn't take the shot", when: "after" });
  }

  // 5. The adoption record first, then the campaign.
  try {
    await deps.db
      .from("generations")
      .update({ press_tour: { ...tourOf(r), job, submitted_at: nowIso }, progress_stage: "Filming your shot" })
      .eq("id", take.rowId)
      .eq("user_id", row.userId)
      .eq("status", "generating");
  } catch {
    /* the campaign write below still carries the handle */
  }
  const written = await mutateCampaign(deps.db, row.id, null, (fresh) =>
    isTerminal(fresh.stage) ? { refuse: null } : { patch: { shots: withTakeSubmitted(fresh.shots, shot, take.n, job, nowIso) }, value: null },
  );
  if (!written.ok && written.reason === "refused") {
    // The ad closed while the lane took the shot: stop it where the lane allows, settle by the ordinary rules.
    await film.cancel(job).catch(() => undefined);
    await endStillRow({ db: deps.db, refund: film.refund }, { userId: row.userId, rowId: take.rowId, credits: take.credits, detail: "The ad closed while this shot was filmed.", force: false });
  }
  return written.ok ? "submitted" : "unavailable";
}

/** Ask the lane about one take; collect it when finished. */
async function pollTake(deps: MachineDeps, row: CampaignRow, shot: number, take: Take, collect: boolean): Promise<"changed" | "pending" | "unavailable"> {
  const film = deps.film!;
  const now = nowOf(deps);
  const job = take.job;
  if (!job) {
    const out = await failTake(deps, row, shot, take, { cause: "provider", error: "the take lost its lane handle", when: "after" });
    return out === "unavailable" ? "unavailable" : "changed";
  }
  const lane = await film.lane().catch(() => null);
  const modelId = lane?.modelId ?? FILM_LANE.modelId;
  const submitted = take.submittedAt ? Date.parse(take.submittedAt) : NaN;
  if (Number.isFinite(submitted) && now.getTime() - submitted > (film.timeoutMs ?? FILM_TIMEOUT_MS)) {
    await film.cancel(job).catch(() => undefined);
    await film.healthFailure(modelId, "the lane never finished the shot", row.userId).catch(() => undefined);
    const out = await failTake(deps, row, shot, take, { cause: "provider", error: "the lane never finished the shot", when: "after" });
    return out === "unavailable" ? "unavailable" : "changed";
  }

  let state: LanePoll;
  try {
    state = await film.poll(job);
  } catch {
    return "pending";
  }
  if (state.state === "pending") return "pending";
  if (state.state === "failed") {
    await film.healthFailure(modelId, state.error.slice(0, 300), row.userId).catch(() => undefined);
    const out = await failTake(deps, row, shot, take, { cause: "provider", error: "the lane couldn't film the shot", when: "after" });
    return out === "unavailable" ? "unavailable" : "changed";
  }
  if (!collect) return "pending";

  // Finished: still ours to deliver? (the reaper may have settled a take left too long)
  const r = await readRow(deps.db, row.userId, take.rowId);
  if (r === "unavailable") return "unavailable";
  // Already delivered by a step whose campaign write was lost: adopted, never filmed or charged again.
  const delivered = r && r.status === "succeeded" && tourOf(r).filmed === true && typeof r.result_url === "string" ? r.result_url : null;
  if (delivered) {
    const planned = row.plan?.shots.find((p) => p.shot === shot);
    const w = await mutateCampaign(deps.db, row.id, null, (fresh) =>
      isTerminal(fresh.stage)
        ? { refuse: null }
        : { patch: { shots: withTakeFilmed(fresh.shots, shot, take.n, { video: delivered, seconds: planned?.seconds ?? 5 }, now.toISOString()) }, value: null },
    );
    return w.ok ? "changed" : "unavailable";
  }
  if (!r || r.status !== "generating") {
    // Settled elsewhere (the reaper): nothing more is collected or billed for it.
    await film.cancel(job).catch(() => undefined);
    const out = await failTake(deps, row, shot, take, { cause: "gone", error: "the take's row was settled before it was collected", when: "after" });
    return out === "unavailable" ? "unavailable" : "changed";
  }
  let providerUrl: string;
  try {
    providerUrl = await film.result(job);
  } catch {
    return "pending";
  }
  const judged = await film.outputGate({ url: providerUrl }).catch((): GateAnswer => ({ ok: false, reason: "unavailable", message: "The picture check could not run." }));
  if (!judged.ok) {
    const out = await failTake(
      deps,
      row,
      shot,
      take,
      judged.reason === "refused" ? { cause: "refused", error: judged.message, when: "after" } : { cause: "provider", error: "the picture check couldn't run", when: "after" },
    );
    return out === "unavailable" ? "unavailable" : "changed";
  }
  const stored = await film.keep({ userId: row.userId, providerUrl }).catch(() => null);
  const video = stored ?? providerUrl;
  const planned = row.plan?.shots.find((p) => p.shot === shot);
  const seconds = planned?.seconds ?? 5;
  const usd = Math.round(seconds * Math.max(0, film.usdPerSecond(modelId)) * 10_000) / 10_000;
  await film.healthSuccess(modelId).catch(() => undefined);

  const nowIso = now.toISOString();
  const written = await mutateCampaign(deps.db, row.id, null, (fresh) =>
    isTerminal(fresh.stage)
      ? { refuse: null }
      : {
          patch: {
            shots: withTakeFilmed(fresh.shots, shot, take.n, { video, seconds }, nowIso),
            cost_usd: Math.round((fresh.costUsd + usd) * 10_000) / 10_000,
          },
          value: null,
        },
  );
  if (!written.ok) {
    // Written nowhere: the next step collects it again (the row is still "generating").
    // A closed ad already stopped and settled this take (campaign-machine.ts releaseTakes).
    return "unavailable";
  }
  // Delivered to History (the shot stays there whatever becomes of the ad).
  try {
    await deps.db
      .from("generations")
      .update({
        status: "succeeded",
        result_url: video,
        progress_stage: null,
        video_duration_seconds: Math.round(seconds),
        press_tour: { ...tourOf(r), job: null, filmed: true },
        pipeline_log: [
          {
            attempt: 1,
            passed: true,
            issues: [],
            compiledPrompt: "",
            steps: [
              { step: "generate", detail: `Filmed shot ${shot} from its approved still.` },
              { step: "validate", detail: "Checked the finished picture against the content rules." },
            ],
          },
        ],
      })
      .eq("id", take.rowId)
      .eq("user_id", row.userId)
      .eq("status", "generating");
  } catch {
    console.error(`[press-tour] take ${take.rowId} filmed but its row could not be marked delivered`);
  }
  return "changed";
}

/**
 * ONE step of an ad in `animating`: submit every reserved take, else ask
 * the lane about every take it holds (collecting at most COLLECTS_PER_STEP),
 * else move on: to checking_shots, or closed when a take was refused.
 */
export async function filmStep(deps: MachineDeps, row: CampaignRow): Promise<StepResult> {
  if (!deps.film) return "idle";
  const reserved = reservedTakes(row.shots);
  if (reserved.length > 0) {
    let last: StepResult = "submitted";
    for (const { shot, take } of reserved) {
      // Each take reads the campaign as it now stands (a failed one may have reserved a retry).
      last = await submitTake(deps, row, shot, take);
      if (last === "unavailable") return "unavailable";
    }
    return last === "failed" ? "filming" : "submitted";
  }

  const filming = filmingTakes(row.shots);
  if (filming.length > 0) {
    let changed = false;
    let collects = 0;
    for (const { shot, take } of filming) {
      const out = await pollTake(deps, row, shot, take, collects < COLLECTS_PER_STEP);
      if (out === "unavailable") return "unavailable";
      if (out === "changed") {
        changed = true;
        collects += 1;
      }
    }
    return changed ? "filmed" : "filming";
  }

  // Nothing in flight: a refusal closes the ad only when no shot has a take
  // that came through (MONEY-2); otherwise the checks, then the wall, where a
  // refused shot waits with nothing to keep.
  if (adRefused(row.shots)) {
    await failCampaign(deps, row, FILM_REFUSED);
    if (deps.cut?.notify) await deps.cut.notify({ userId: row.userId, key: "adFailed", path: adPath(row.id) }).catch(() => undefined);
    return "failed";
  }
  const moved = await mutateCampaign(deps.db, row.id, null, (fresh) =>
    fresh.stage !== "animating" || anyInFlight(fresh.shots) ? { refuse: null } : { patch: { stage: "checking_shots" }, value: null },
  );
  return moved.ok ? "filmed" : "busy";
}

/**
 * ONE step of an ad in `checking_shots`: read one filmed take (3 moments,
 * record-only), else decide what comes next: the press wall when a shot
 * waits on the person (a miss starts nothing on its own), else the cut.
 */
export async function checkShotsStep(deps: MachineDeps, row: CampaignRow): Promise<StepResult> {
  const film = deps.film;
  if (!film || !row.plan) return "idle";
  const now = nowOf(deps);
  const [next] = filmedTakes(row.shots);
  if (next) {
    const planned = row.plan.shots.find((p) => p.shot === next.shot);
    const card = await readConfirmedCard(deps.db, row.userId, row.productId);
    if (card === "unavailable") return "unavailable";
    let star: Star | null = null;
    if (planned?.star && row.characterIds[0]) {
      const ready = await starReadiness(deps.db, row.userId, row.characterIds[0]);
      if (ready.ok) star = ready.star;
    }
    const lane = await film.lane().catch(() => null);
    const ctx = planned ? shotContext(planned) : { productExpected: false, star: false };
    let outcome: TakeCheckOutcome;
    if (!card || !planned || !next.take.video) {
      // Nothing to read against: not checked, never a miss.
      outcome = {
        check: { face: ctx.star ? "not_checked" : "no_one_in_shot", product: "not_checked", reason: null, moments: [], escalations: 0, corner: null },
        usd: 0,
      };
    } else {
      outcome = await film
        .checkTake({
          userId: row.userId,
          campaignId: row.id,
          generationId: next.take.rowId,
          shot: next.shot,
          video: next.take.video,
          seconds: next.take.seconds ?? planned.seconds,
          packshot: !planned.star && planned.productVisibility !== "absent",
          productVisibility: planned.productVisibility,
          product: card,
          star: star ? { identityPath: star.identityPath, traitSummary: star.traitSummary } : null,
          escalationsLeft: Math.max(0, MAX_ESCALATIONS_PER_AD - escalationsUsed(row.stills) - takeEscalations(row.shots)),
          lane: lane?.modelId ?? FILM_LANE.modelId,
        })
        .catch((): TakeCheckOutcome => ({
          check: { face: ctx.star ? "not_checked" : "no_one_in_shot", product: "not_checked", reason: null, moments: [], escalations: 0, corner: null },
          usd: 0,
        }));
    }
    const nowIso = now.toISOString();
    const written = await mutateCampaign(deps.db, row.id, null, (fresh) =>
      isTerminal(fresh.stage)
        ? { refuse: null }
        : {
            patch: {
              shots: withTakeChecked(fresh.shots, next.shot, next.take.n, outcome.check, nowIso),
              cost_usd: Math.round((fresh.costUsd + Math.max(0, outcome.usd || 0)) * 10_000) / 10_000,
            },
            value: null,
          },
    );
    // The verdict word rides beside the delivered take (History shows it; only the word: #30).
    try {
      await deps.db.from("generations").update({ product_verdict: ctx.productExpected ? outcome.check.product : null }).eq("id", next.take.rowId).eq("user_id", row.userId);
    } catch {
      /* the campaign holds it */
    }
    return written.ok ? "checked_shot" : "unavailable";
  }

  // Every take is read. The press wall, or the cut.
  const plan = row.plan;
  const ctxOf = (shot: number): ShotContext => {
    const p = plan.shots.find((x) => x.shot === shot);
    return p ? shotContext(p) : { productExpected: false, star: false };
  };
  const moved = await mutateCampaign<"wall" | "cut">(deps.db, row.id, null, (fresh) => {
    if (fresh.stage !== "checking_shots" || anyInFlight(fresh.shots) || filmedTakes(fresh.shots).length > 0) return { refuse: "wall" };
    const verdict = adVerdict(
      fresh.shots.flatMap((s) => {
        const ctx = ctxOf(s.shot);
        const t = chosenTake(s, ctx);
        return t ? [{ verdict: t.product, productExpected: ctx.productExpected }] : [];
      }),
    );
    const waiting = firstDecision(fresh.shots, ctxOf) !== null;
    const settled = waiting ? null : settleForCut(fresh.shots, ctxOf);
    if (!settled) {
      return {
        patch: {
          stage: "awaiting_approval",
          product_verdict: verdict,
          expires_at: new Date(now.getTime() + WAIT_MS).toISOString(),
          // Waiting on the person: the 24 h rule's clock stops (it starts again on their press).
          cut_due_at: null,
        },
        value: "wall",
      };
    }
    return { patch: { stage: "assembling", shots: settled, product_verdict: verdict, expires_at: null }, value: "cut" };
  });
  if (!moved.ok) return "busy";
  return moved.value === "cut" ? "cut" : "waiting";
}

/** The shot's take n, from a campaign (for the service's decisions). */
export function takeFor(row: Pick<CampaignRow, "shots">, shot: number, n: number): Take | null {
  const s = shotOf(row.shots, shot);
  return s ? takeOf(s, n) : null;
}

export type { ShotState };
