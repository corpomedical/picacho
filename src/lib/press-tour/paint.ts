// Press Tour's stills: reserving them, and painting and checking one
// (spec §1.5-§1.6 as corrected by v2: synthesis §3.1 items 1, 2, 9, 11, 15,
// 17, 22; operator 2026-09-26).
//
// THE RECAST PATTERN, NOT runGeneration. A still is its own generations row
// under the campaign, id made from a press (campaign-machine.ts), reserved
// through reserve_generations, and filled here with every gate called
// EXPLICITLY, in this order (v2 #1):
//   1. the row is still reserved, the product card is confirmed and the
//      person's own, and the star has photos and the AD-USE ATTESTATION for
//      exactly those photos: who is in them (the likeness answer) and that
//      they may appear in ads for products the person sells
//      (character_ad_consents, v2 #9; starReadiness);
//   2. the prompt gate (content-policy.ts assertPromptAllowed);
//   3. the ad policy step (planner.ts adPolicyCheck: the ad packs plus the
//      person's own rules, on meaning, whatever brand_rules_enforcement says);
//   4. the picture lane, with the identity photo and the product photos in
//      ONE reference list, at 2:3 (1024x1536);
//   5. the crop to 9:16 (864x1536) with sharp, keeping the face and the
//      product when a locator says where they are (v2 #2);
//   6. the output gate on the cropped still;
//   7. the row is delivered ("succeeded", the still's link) as soon as the
//      output gate passes, so a step killed during the checks never loses
//      a paid painting: the next step adopts it (M2);
//   8. the checks on the cropped still: the face and the product
//      (lib/product-lock checkStill, behind deps.checkStill), written onto
//      the row beside it.
// A repaint that carries the person's note is also judged by the
// endorsement rubric (planner.ts endorsementCheck, PT-SEC-2) before the
// picture lane is called.
// The built-in image identity gate is NOT run (v2 #17): the campaign's face
// check is the only one. No circuit-breaker substitution ever: the lane is
// named here and nothing swaps it.
//
// MONEY. A paid still is 1 credit (quote.ts), reserved in the person's own
// press (reserveStillRows, the Recast shape: allowance, then one atomic
// reserve_generations, then the guarded bonus and purchased spends). It
// NEVER spends the daily free slot (a free-tier answer is refused). A house
// row (the checker's repaint, a retry after a provider failure whose charge
// stayed) is reserved at 0 credits with free_generation_used false and never
// touches the refund authority (v2 #22). A still that will never be
// delivered is refunded: FORCED only when it failed before the picture lane
// was called (nothing was spent: a gate, a signing, a read); through the
// ordinary refund rules (the automatic_refunds switch and the daily cap)
// once the lane was called, since the render may already be billed
// (PT-06). The machine then follows v2 #11 on the retry: a still whose
// charge went back is retried at its price (reservePaidRetry), one whose
// charge stayed is retried on the house (campaign-machine.ts paintStep).
// The refund comes FIRST and the row is ended only when it went through: a
// row whose refund failed stays "generating" for the orphan reaper
// (job-runner.ts reapStaleJobs) to end and settle (M3).
//
// Alias-free (vitest has no "@/"): paint.test.ts imports it as it is.

import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { photosHash } from "../characters/likeness";
import { readLikeness } from "../characters/likeness-store";
import { currentStarAnswer } from "./star-consent";
import { MAX_ESCALATIONS_PER_AD } from "../product-lock/product-lock";
import type { ShotRole, Verdict } from "./campaign-types";
import {
  AD_CONSENT_NEEDED,
  CHARACTER_NEEDS_PHOTO,
  PAINT_COULDNT_START,
  PAINT_FREE_SLOT,
  PAINT_OUT_OF_CREDITS,
  PRODUCT_NOT_CONFIRMED,
  STILL_REFUSED,
} from "./campaign-messages";
import { escalationsUsed, readCampaign, stillOf, type AttemptKind, type PaintOutcome } from "./campaign-machine";
import {
  adPolicyCheck,
  endorsementCheck,
  type PlannedShot,
  type PlannerDeps,
  type PolicyRule,
  type ProductVisibility,
  type StarKind,
} from "./planner";
import { STILL_LANE } from "./quote";
import { PRODUCT_CARD_COLUMNS, cleanText, productCardFromRow, type ProductCard } from "./types";

// ---------------------------------------------------------------------------
// The shape of a still
// ---------------------------------------------------------------------------

/** The picture lane's frame: 2:3 portrait (the GPT lane's own tall size). */
export const STILL_RENDER = { width: 1024, height: 1536, size: "1024x1536" } as const;
/** The ad's frame. */
export const STILL_ASPECT = 9 / 16;
/** Where stills are kept: the composer's image bucket, so History and the media route serve them as they are. */
export const STILL_BUCKET = "generated-images";

/** A still's place: under the owner's folder, named after its row (a row is painted once). */
export function stillPath(userId: string, campaignId: string, rowId: string): string {
  return `${userId}/press/${campaignId}/${rowId}.png`;
}

/** Where something sits on the uncropped still, each 0..1 of it. */
export type Box = { x: number; y: number; w: number; h: number };

function validBox(b: Box | null | undefined): Box | null {
  if (!b) return null;
  const ok = [b.x, b.y, b.w, b.h].every((n) => typeof n === "number" && Number.isFinite(n)) && b.w > 0 && b.h > 0;
  if (!ok) return null;
  const x = Math.max(0, Math.min(1, b.x));
  const y = Math.max(0, Math.min(1, b.y));
  return { x, y, w: Math.max(0, Math.min(1 - x, b.w)), h: Math.max(0, Math.min(1 - y, b.h)) };
}

export type CropWindow = { left: number; top: number; width: number; height: number; fits: boolean | null };

/**
 * The 9:16 window cut from a still (v2 #2). The frame keeps its full
 * height (or width, for a still already narrower than 9:16) and slides
 * along the other axis to keep the face and the product inside it. `fits`
 * is false when both cannot fit (the product wins the frame), null when
 * nobody located them (the window is centred).
 */
export function cropWindow(width: number, height: number, boxes?: { face?: Box | null; product?: Box | null } | null): CropWindow {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const wide = w / h > STILL_ASPECT;
  // The side that is cut, in pixels.
  const full = wide ? w : h;
  const keep = wide ? Math.min(w, Math.round((h * 9) / 16)) : Math.min(h, Math.round((w * 16) / 9));
  const face = validBox(boxes?.face);
  const product = validBox(boxes?.product);
  const span = (b: Box): [number, number] => (wide ? [b.x * w, (b.x + b.w) * w] : [b.y * h, (b.y + b.h) * h]);
  const place = (start: number) => {
    const s = Math.round(Math.max(0, Math.min(full - keep, start)));
    return wide ? { left: s, top: 0, width: keep, height: h } : { left: 0, top: s, width: w, height: keep };
  };
  const boxes2 = [face, product].filter((b): b is Box => b !== null);
  if (boxes2.length === 0) return { ...place((full - keep) / 2), fits: null };
  const lo = Math.min(...boxes2.map((b) => span(b)[0]));
  const hi = Math.max(...boxes2.map((b) => span(b)[1]));
  if (hi - lo <= keep) {
    return { ...place((lo + hi) / 2 - keep / 2), fits: true };
  }
  const main = product ?? face!;
  const [a, b] = span(main);
  return { ...place((a + b) / 2 - keep / 2), fits: false };
}

/**
 * The product's reference photos, as the picture lane gets them: the front
 * first (its label readable, spec §1.1), then the logo crop, then other
 * angles; at most 4, the card's own paths only.
 */
export function productReferencePaths(card: Pick<ProductCard, "angles" | "photos" | "logoPath">): string[] {
  const out: string[] = [];
  const add = (p: string | null | undefined) => {
    if (p && !out.includes(p) && out.length < 4) out.push(p);
  };
  add(card.angles.find((a) => a.view === "front")?.path);
  add(card.logoPath);
  for (const view of ["three_quarter", "side", "in_use", "detail", "top", "back"] as const) {
    add(card.angles.find((a) => a.view === view)?.path);
  }
  for (const p of card.photos) add(p);
  return out;
}

/** Shots whose product must be clearly in view get the same direction every time (spec §1.4). */
const PRODUCT_DIRECTION: Record<ProductVisibility, string> = {
  required_label:
    "The product is large in the frame with its label turned to the camera, fully in view, sharp and readable, never covered by a hand.",
  required_shape: "The product is clearly in view and recognisable, not cut off by the edge of the frame.",
  absent: "",
};

/**
 * The words the picture lane is given for one still. The label words are
 * the person's confirmed strings (quoted, cleaned); everything else is the
 * plan's still, which already passed every gate when it was planned and is
 * judged again here as a whole.
 */
export function stillPrompt(input: {
  shot: Pick<PlannedShot, "still" | "productVisibility" | "star" | "camera">;
  product: Pick<ProductCard, "name" | "labelStrings" | "noReadableText">;
  productRefs: number;
  house: boolean;
  note: string | null;
}): string {
  const { shot, product } = input;
  const lines: string[] = [
    "A photorealistic still from a short vertical video ad, in a tall portrait frame, natural light, no text overlays.",
    shot.still,
  ];
  if (shot.camera) lines.push(`Framing: ${shot.camera}.`);
  const first = shot.star ? 2 : 1;
  if (shot.star) {
    lines.push("Image 1 is the person in this ad: keep their face, hair and features exactly as in Image 1.");
  }
  if (input.productRefs > 0) {
    const refs =
      input.productRefs === 1 ? `Image ${first} is a photo of the product` : `Images ${first} to ${first + input.productRefs - 1} are photos of the product`;
    lines.push(`${refs}${product.name ? ` (${cleanText(product.name, 120)})` : ""}: reproduce it exactly, its shape, colours, label and logo.`);
  }
  if (shot.productVisibility !== "absent" && !product.noReadableText && product.labelStrings.length > 0) {
    const words = product.labelStrings.map((s) => `"${(cleanText(s, 80) ?? "").replace(/"/g, "'")}"`).join(", ");
    lines.push(`The label's printed words, spelled exactly: ${words}.`);
  }
  if (PRODUCT_DIRECTION[shot.productVisibility]) lines.push(PRODUCT_DIRECTION[shot.productVisibility]);
  lines.push("Keep the person's face and the product well inside the centre of the frame, away from its left and right edges.");
  if (input.house) {
    lines.push("Keep the product exactly as in its photos and the person exactly as in Image 1; compose so both sit comfortably in the centre.");
  }
  const note = cleanText(input.note, 200);
  if (note) lines.push(`The advertiser asks for this change: ${note}`);
  lines.push("No other text, signs, captions, watermarks or logos anywhere in the picture.");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// The star: photos, who is in them, and may they appear in ads
// ---------------------------------------------------------------------------

export type Star = {
  id: string;
  name: string;
  photos: string[];
  identityPath: string;
  traitSummary: string;
  kind: StarKind;
};

/**
 * The ad-use answer that holds for a character's photos NOW: the newest row
 * given for exactly these photos (star-consent.ts currentStarAnswer, the
 * door's own reading rule, over character_ad_consents, which star-consent.ts
 * writes), or null. A missing table (SQL 03 not run yet) is no answer.
 */
export async function readStarAnswer(
  db: SupabaseClient,
  userId: string,
  characterId: string,
  photos: readonly string[],
): Promise<StarKind | null> {
  try {
    const { data, error } = await db
      .from("character_ad_consents")
      .select("answer, photos_hash, ads_ok")
      .eq("user_id", userId)
      .eq("character_id", characterId)
      .order("consented_at", { ascending: false })
      .limit(50);
    if (error || !Array.isArray(data)) return null;
    return currentStarAnswer(photos, data as { answer?: unknown; photos_hash?: unknown; ads_ok?: unknown }[]);
  } catch {
    return null;
  }
}

/**
 * Whether a character can star in an ad right now: the person's own, with
 * photos, and the ad-use attestation for exactly these photos. That answer
 * is a likeness answer too (who is in the photos: me, someone who gave
 * permission, or no real person; the character_likeness_consents shape,
 * for the same photos_hash), so it is the one question the door asks. When
 * the character page's own likeness answer for these photos says a real
 * person is in them, the star is treated as a real person whatever the ad
 * answer said (the stricter of the two). The sentence says what is missing.
 */
export async function starReadiness(
  db: SupabaseClient,
  userId: string,
  characterId: string,
): Promise<{ ok: true; star: Star } | { ok: false; error: string; missing: "character" | "photos" | "adConsent" | "unavailable" }> {
  type CharacterRow = { id?: unknown; name?: unknown; reference_image_urls?: unknown; traits?: unknown };
  let row: CharacterRow | null = null;
  try {
    const { data, error } = await db
      .from("character_profiles")
      .select("id, name, reference_image_urls, traits")
      .eq("id", characterId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return { ok: false, error: PAINT_COULDNT_START, missing: "unavailable" };
    row = (data as CharacterRow | null) ?? null;
  } catch {
    return { ok: false, error: PAINT_COULDNT_START, missing: "unavailable" };
  }
  if (!row) return { ok: false, error: CHARACTER_NEEDS_PHOTO, missing: "character" };
  // Every photo counts for the answer (the hash the door wrote it under);
  // only one under the owner's own folder is ever sent anywhere.
  const photos = Array.isArray(row.reference_image_urls)
    ? row.reference_image_urls.filter((p): p is string => typeof p === "string" && p.length > 0)
    : [];
  const identityPath = photos.find((p) => p.startsWith(`${userId}/`) && !p.includes(".."));
  if (!identityPath) return { ok: false, error: CHARACTER_NEEDS_PHOTO, missing: "photos" };
  const answer = await readStarAnswer(db, userId, characterId, photos);
  if (!answer) return { ok: false, error: AD_CONSENT_NEEDED, missing: "adConsent" };
  const hash = photosHash(photos);
  const { records } = await readLikeness(db, userId, [characterId]);
  const likeness = records.get(characterId);
  const kind: StarKind =
    answer === "not_a_person" && likeness && likeness.photosHash === hash && likeness.answer !== "not_a_person" ? likeness.answer : answer;
  const traits = (row.traits && typeof row.traits === "object" ? row.traits : {}) as { hair?: unknown; distinguishing_features?: unknown };
  const traitSummary = [
    typeof traits.hair === "string" && traits.hair ? `hair: ${traits.hair}` : null,
    typeof traits.distinguishing_features === "string" && traits.distinguishing_features
      ? `distinguishing features: ${traits.distinguishing_features}`
      : null,
  ]
    .filter(Boolean)
    .join("; ")
    .slice(0, 400);
  return {
    ok: true,
    star: {
      id: characterId,
      name: typeof row.name === "string" ? row.name : "",
      photos,
      identityPath,
      traitSummary,
      kind,
    },
  };
}

/** A confirmed product card, the person's own; null when it is not one. */
export async function readConfirmedCard(db: SupabaseClient, userId: string, productId: string): Promise<ProductCard | null | "unavailable"> {
  try {
    const { data, error } = await db
      .from("products")
      .select(PRODUCT_CARD_COLUMNS)
      .eq("id", productId)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) return "unavailable";
    const card = productCardFromRow(data);
    return card && card.status === "confirmed" ? card : null;
  } catch {
    return "unavailable";
  }
}

// ---------------------------------------------------------------------------
// Reserving rows
// ---------------------------------------------------------------------------

export type PressRowSpec = {
  id: string;
  campaignId: string;
  shot: number;
  role: ShotRole;
  kind: AttemptKind;
  attempt: number;
  credits: number;
  characterIds: string[];
  /** What History shows as the row's words. */
  label: string;
  trialId: string | null;
};

/** The generations row reserve_generations writes for one still. */
export function pressRowPayload(spec: PressRowSpec, spend: { purchased: number; bonus: number } = { purchased: 0, bonus: 0 }) {
  return {
    id: spec.id,
    character_profile_id: spec.characterIds[0] ?? null,
    character_profile_ids: spec.characterIds,
    prompt_input: (cleanText(spec.label, 200) ?? "Press Tour still").slice(0, 200),
    content_type: "image",
    status: "generating",
    attempts: 0,
    result_url: null,
    pipeline_log: [],
    model_id: STILL_LANE.modelId,
    video_model_id: null,
    credits_used: spec.credits,
    purchased_credits_used: spend.purchased,
    bonus_credits_used: spend.bonus,
    // Never the daily free slot (v2 #1, #22), whatever else the row is.
    free_generation_used: false,
    press_tour: {
      campaign_id: spec.campaignId,
      shot: spec.shot,
      role: spec.role,
      kind: "still",
      attempt: spec.attempt,
      house: spec.credits === 0,
      trial_id: spec.trialId,
    },
  };
}

/** checkGenerationAllowance's answer, as the reservation reads it. */
export type AllowanceAnswer = {
  error: string | null;
  isAdmin: boolean;
  consumePurchased?: number;
  consumeBonus?: number;
  consumeFree?: boolean;
  monthlyLimit?: number;
  periodStartIso?: string;
};

export interface MoneyDeps {
  /** The service-role client. */
  db: SupabaseClient;
  /** core.ts checkGenerationAllowance for the person asking, for this many credits. */
  allowance: (credits: number) => Promise<AllowanceAnswer>;
  /** core.ts consumeBonusCredits / consumePurchasedCredits: guarded, true when spent. */
  spendBonus: (userId: string, amount: number) => Promise<boolean>;
  spendPurchased: (userId: string, amount: number) => Promise<boolean>;
  /** job-runner.ts refundGenerationCosts. */
  refund: (rowId: string, opts: { force?: boolean }) => Promise<boolean>;
}

export type Reserved =
  | { ok: true; ids: string[]; credits: number }
  | { ok: false; code: "repeat" | "allowance" | "credits" | "failed"; error: string };

function spread(total: number, n: number, i: number): number {
  return Math.floor(total / n) + (i < total % n ? 1 : 0);
}

/**
 * The person's own press pays for these stills: the allowance decided
 * fresh, ONE atomic reserve_generations for all of them (the rows' ids are
 * made from the press, so a second delivery meets the first one's rows and
 * answers "repeat"), then the guarded bonus and purchased spends. Losing the
 * spend race releases every row, with anything already taken given back.
 */
export async function reserveStillRows(deps: MoneyDeps, userId: string, specs: readonly PressRowSpec[]): Promise<Reserved> {
  if (specs.length === 0) return { ok: false, code: "failed", error: PAINT_COULDNT_START };
  const total = specs.reduce((sum, s) => sum + s.credits, 0);
  let allowance: AllowanceAnswer;
  try {
    allowance = await deps.allowance(total);
  } catch {
    return { ok: false, code: "failed", error: PAINT_COULDNT_START };
  }
  return reserveWith(deps, userId, specs, total, allowance);
}

/**
 * v2 #11: a paid still whose charge went back after a provider failure is
 * retried AT ITS PRICE, reserved against the person's own allowance under an
 * id made from the failed row (paidRetryRowId), and only while the billing
 * window is the one the failed still was reserved in. "window": the window
 * moved since, and the retry is the house's; "refused": the person cannot
 * pay for it now (the still is not retried by this door). A repeat is the
 * same retry, reserved by a step that died before writing it down.
 */
export async function reservePaidRetry(
  deps: MoneyDeps,
  userId: string,
  spec: PressRowSpec,
  failedReservedAt: string,
): Promise<"reserved" | "window" | "refused"> {
  if (spec.credits <= 0) return "refused";
  let allowance: AllowanceAnswer;
  try {
    allowance = await deps.allowance(spec.credits);
  } catch {
    return "refused";
  }
  if (allowance.error || allowance.consumeFree) return "refused";
  if (allowance.periodStartIso && failedReservedAt && failedReservedAt < allowance.periodStartIso) return "window";
  const reserved = await reserveWith(deps, userId, [spec], spec.credits, allowance);
  return reserved.ok || reserved.code === "repeat" ? "reserved" : "refused";
}

async function reserveWith(
  deps: MoneyDeps,
  userId: string,
  specs: readonly PressRowSpec[],
  total: number,
  allowance: AllowanceAnswer,
): Promise<Reserved> {
  if (allowance.error) return { ok: false, code: "allowance", error: allowance.error };
  if (allowance.consumeFree) return { ok: false, code: "allowance", error: PAINT_FREE_SLOT };
  const purchased = allowance.consumePurchased ?? 0;
  const bonus = allowance.consumeBonus ?? 0;
  const monthlyPortion = allowance.isAdmin ? 0 : Math.max(0, total - purchased - bonus);
  const rows = specs.map((s, i) => pressRowPayload(s, { purchased: spread(purchased, specs.length, i), bonus: spread(bonus, specs.length, i) }));

  let ids: string[] = [];
  try {
    const { data, error } = await deps.db.rpc("reserve_generations", {
      p_user_id: userId,
      p_monthly_portion: monthlyPortion,
      p_limit: allowance.monthlyLimit ?? 0,
      p_since: allowance.periodStartIso ?? new Date(0).toISOString(),
      p_rows: rows,
    });
    if (error) {
      const repeat = (error as { code?: string }).code === "23505" || /duplicate key/i.test(error.message ?? "");
      return repeat ? { ok: false, code: "repeat", error: PAINT_COULDNT_START } : { ok: false, code: "failed", error: PAINT_COULDNT_START };
    }
    ids = Array.isArray(data) ? (data as string[]) : [];
  } catch {
    return { ok: false, code: "failed", error: PAINT_COULDNT_START };
  }
  if (ids.length === 0) return { ok: false, code: "credits", error: PAINT_OUT_OF_CREDITS };

  // Bonus first (a gift goes before money), then purchased: core.ts's order.
  const bonusOk = await deps.spendBonus(userId, bonus).catch(() => false);
  if (!bonusOk) {
    // Nothing was taken: the rows simply stop holding anything.
    await deps.db
      .from("generations")
      .update({ status: "failed", credits_used: 0, purchased_credits_used: 0, bonus_credits_used: 0, progress_stage: null })
      .in("id", ids)
      .eq("user_id", userId);
    return { ok: false, code: "credits", error: PAINT_OUT_OF_CREDITS };
  }
  const purchasedOk = await deps.spendPurchased(userId, purchased).catch(() => false);
  if (!purchasedOk) {
    // The bonus was taken: the rows keep what they took and are refunded
    // (forced: nothing was delivered), which gives it back; each is ended
    // only once its refund went through (M3), else the reaper settles it.
    await deps.db.from("generations").update({ purchased_credits_used: 0 }).in("id", ids).eq("user_id", userId);
    for (const id of ids) {
      const credits = specs.find((s) => s.id === id)?.credits ?? 0;
      await endStillRow(deps, { userId, rowId: id, credits, detail: "Another press took the last credits first.", force: true });
    }
    return { ok: false, code: "credits", error: PAINT_OUT_OF_CREDITS };
  }
  return { ok: true, ids, credits: total };
}

/** A house row (0 credits): the checker's repaint or a retry. True when it exists afterwards (a repeat included). */
export async function reserveHouseRow(db: SupabaseClient, userId: string, spec: PressRowSpec): Promise<boolean> {
  if (spec.credits !== 0) return false;
  try {
    const { data, error } = await db.rpc("reserve_generations", {
      p_user_id: userId,
      p_monthly_portion: 0,
      p_limit: 0,
      p_since: new Date(0).toISOString(),
      p_rows: [pressRowPayload(spec)],
    });
    if (error) return (error as { code?: string }).code === "23505" || /duplicate key/i.test(error.message ?? "");
    return Array.isArray(data) && data.length === 1;
  } catch {
    return false;
  }
}

/**
 * End a still's row that will not be delivered: its credits back when it
 * held any (forced only when nothing was spent on it; the ordinary rules
 * otherwise), THEN failed with the reason in its log. A row whose refund
 * did not go through is left "generating" (M3): the orphan reaper
 * (job-runner.ts reapStaleJobs) ends it within the hour and settles it by
 * the ordinary rules, so a charge is never stranded on a failed row nobody
 * revisits. House rows never reach the refund authority. True when credits
 * went back.
 */
export async function endStillRow(
  deps: { db: SupabaseClient; refund: MoneyDeps["refund"] },
  input: { userId: string; rowId: string; credits: number; detail: string; force: boolean },
): Promise<boolean> {
  let refunded = false;
  if (input.credits > 0) {
    refunded = await deps.refund(input.rowId, { force: input.force }).catch(() => false);
    if (!refunded) return false;
  }
  try {
    await deps.db
      .from("generations")
      .update({
        status: "failed",
        progress_stage: null,
        pipeline_log: [{ attempt: 1, passed: false, issues: [], compiledPrompt: "", steps: [{ step: "generate", detail: input.detail.slice(0, 300) }] }],
      })
      .eq("id", input.rowId)
      .eq("user_id", input.userId)
      .eq("status", "generating");
  } catch {
    /* the reaper ends it */
  }
  return refunded;
}

// ---------------------------------------------------------------------------
// Painting and checking one still
// ---------------------------------------------------------------------------

/** A gate's answer, from the runtime's adapter around the real gate. */
export type GateAnswer = { ok: true; scores?: unknown } | { ok: false; reason: "refused" | "unavailable"; message: string };

export type StillCheckInput = {
  userId: string;
  campaignId: string;
  /** The still's own row. */
  generationId: string;
  shot: number;
  /** The cropped still: a link readers can fetch, and its bytes. */
  still: { url: string; bytes: Buffer; width: number; height: number };
  /** The star to read the face against, or null for a packshot (no one is meant to be in it). */
  star: { identityPath: string; identityUrl: string; traitSummary: string } | null;
  /** The identity gate's bar (0 = off; the verdict then uses the default bar). */
  identityThreshold: number;
  productVisibility: ProductVisibility;
  product: ProductCard;
  /** The product's reference photos (press-kit paths, the front first) and fetchable links to them. */
  productPhotoPaths: string[];
  productPhotoUrls: string[];
  /** Second product readings the ad may still spend (lib/product-lock MAX_ESCALATIONS_PER_AD across the ad). */
  escalationsLeft: number;
};

/**
 * The checker's answer, as the campaign keeps it. The runtime adapts
 * lib/product-lock checkStill ({face, product, reason, signals}) to this;
 * the checker writes its own per-frame rows to product_frame_checks.
 */
export type StillCheck = {
  face: Verdict;
  product: Verdict;
  reason: string | null;
  /** The face scorer's number (the lowest read), or null. Never shown. */
  faceScore: number | null;
  /** What the check cost us. */
  usd: number;
  /** Second readings it spent. */
  escalations: number;
};
export type StillChecker = (input: StillCheckInput) => Promise<StillCheck>;

export interface PaintDeps {
  /** The service-role client. */
  db: SupabaseClient;
  /** The picture lane: the prompt and the reference photos in; a 2:3 PNG (base64) and what it cost out. */
  generateStill: (input: { prompt: string; identityUrl: string | null; productUrls: string[] }) => Promise<{ base64: string; usd: number }>;
  /** Where the face and the product sit on the uncropped still, when a locator is available (product-lock/judge.ts locateFraming). */
  locate?: (input: { png: Buffer; productPhotoPaths: string[] }) => Promise<{ face: Box | null; product: Box | null } | null>;
  /** Keep the finished still at `path` in STILL_BUCKET; returns its stored (relative media) link. */
  storeStill: (userId: string, path: string, bytes: Buffer) => Promise<string>;
  removeStill: (path: string) => Promise<void>;
  /** A stored link as one a reader outside the app can fetch. */
  absolutize: (stored: string) => string;
  /** Short-lived fetchable links: the character's photo, the product's photos (by path). */
  signCharacterPhoto: (path: string) => Promise<string | null>;
  signProductPhotos: (paths: string[]) => Promise<Record<string, string>>;
  /** content-policy.ts assertPromptAllowed, adapted. */
  promptGate: (input: { prompt: string; hasRealPersonReference: boolean }) => Promise<GateAnswer>;
  /** brand-rules/classify.ts classifyProhibitions. */
  classify: PlannerDeps["classify"];
  /** The endorsement rubric's reader (planner.ts endorsementCheck), for a repaint that carries the person's note. */
  review: PlannerDeps["review"];
  /** output-policy.ts judgeRender on the still, adapted. */
  outputGate: (input: { url: string; promptScores: unknown }) => Promise<GateAnswer>;
  checkStill: StillChecker;
  /** face-lock.ts readIdentityThreshold. */
  identityThreshold: () => Promise<number>;
  /** The person's own active brand rules (the ad policy step runs them beside the packs). */
  ownRules: (userId: string) => Promise<PolicyRule[]>;
  refund: MoneyDeps["refund"];
  now?: () => Date;
}

const num = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null;

const verdictOr = (raw: unknown, fallback: Verdict): Verdict =>
  typeof raw === "string" && ["match", "didnt_match", "not_readable", "product_missing", "not_checked", "no_one_in_shot"].includes(raw)
    ? (raw as Verdict)
    : fallback;

/**
 * A still's row already delivered for this very attempt (M2, PT-07): a step
 * killed after the row was marked "succeeded" left the painting and, when
 * the checks finished, their verdicts on the row (press_tour.check). The
 * next step adopts it instead of painting it again. Null when the row is not
 * this attempt's delivered still.
 */
export function adoptedOutcome(
  row: { status?: unknown; result_url?: unknown; press_tour?: unknown },
  expect: { path: string; star: boolean },
): Extract<PaintOutcome, { kind: "painted" }> | null {
  if (row.status !== "succeeded" || typeof row.result_url !== "string" || !row.result_url.includes(expect.path)) return null;
  const pt = (row.press_tour && typeof row.press_tour === "object" ? row.press_tour : {}) as { painted?: { fits?: unknown }; check?: Record<string, unknown> };
  const check = pt.check && typeof pt.check === "object" ? pt.check : null;
  const fits = typeof check?.fits === "boolean" ? check.fits : typeof pt.painted?.fits === "boolean" ? pt.painted.fits : null;
  const faceFallback: Verdict = expect.star ? "not_checked" : "no_one_in_shot";
  return {
    kind: "painted",
    path: expect.path,
    face: expect.star ? (check ? verdictOr(check.face, faceFallback) : faceFallback) : "no_one_in_shot",
    product: check ? verdictOr(check.product, "not_checked") : "not_checked",
    reason: check && typeof check.reason === "string" ? check.reason.slice(0, 300) : null,
    fits,
    faceScore: check ? num(check.faceScore, 0, 100) : null,
    escalations: check && typeof check.escalations === "number" && Number.isInteger(check.escalations) && check.escalations >= 0 ? check.escalations : 0,
    usd: 0,
  };
}

/**
 * Paint and check one reserved still: attempt `attempt` of shot `shot` of
 * the person's campaign. Never throws; writes the generations row, never
 * the campaign (the machine writes the outcome under its lease).
 */
export async function paintKeyframe(
  deps: PaintDeps,
  input: { userId: string; campaignId: string; shot: number; attempt: number },
): Promise<PaintOutcome> {
  const { userId, campaignId, shot } = input;
  let usd = 0;

  const row = await readCampaign(deps.db, campaignId, userId);
  // A read that failed spent nothing: this attempt is tried again on the next step.
  if (row === "unavailable") return { kind: "later" };
  const still = row ? stillOf(row.stills, shot) : null;
  const attempt = still?.attempts.find((a) => a.n === input.attempt);
  const planned = row?.plan?.shots.find((s) => s.shot === shot);
  // Nothing to do: the campaign closed, or this attempt was already written.
  if (!row || !attempt || attempt.status !== "reserved" || !planned) return { kind: "skipped" };
  const path = stillPath(userId, campaignId, attempt.rowId);

  /**
   * `when`: "before" the picture lane was called (nothing was spent: the
   * refund is forced), or "after" (the render may be billed: the ordinary
   * refund rules decide, PT-06).
   */
  const fail = async (cause: "provider" | "gone" | "refused" | "gate", error: string, detail: string, when: "before" | "after"): Promise<PaintOutcome> => {
    const refunded = await endStillRow(deps, { userId, rowId: attempt.rowId, credits: attempt.credits, detail, force: when === "before" });
    return { kind: "failed", cause, error, usd, refunded };
  };

  // 1. The row is still ours to fill. (The orphan reaper ends a row left an
  //    hour; its own terminal write already settled it. A row this attempt
  //    already delivered, by a step that was stopped, is adopted.)
  let pressTour: Record<string, unknown> = {};
  try {
    const { data, error } = await deps.db
      .from("generations")
      .select("id, status, credits_used, result_url, press_tour")
      .eq("id", attempt.rowId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return { kind: "later" };
    const r = (data ?? null) as { status?: unknown; credits_used?: unknown; result_url?: unknown; press_tour?: unknown } | null;
    if (r) {
      const adopted = adoptedOutcome(r, { path, star: planned.star });
      if (adopted) return adopted;
    }
    if (!r || r.status !== "generating") {
      // Settled elsewhere: its charge went back when the row now holds none (v2 #11 reads this).
      const held = r && typeof r.credits_used === "number" ? r.credits_used : 0;
      return { kind: "failed", cause: "gone", error: "the still's row is no longer reserved", usd, refunded: attempt.credits > 0 && held === 0 };
    }
    if (r.press_tour && typeof r.press_tour === "object" && !Array.isArray(r.press_tour)) pressTour = r.press_tour as Record<string, unknown>;
  } catch {
    return { kind: "later" };
  }

  const card = await readConfirmedCard(deps.db, userId, row.productId);
  if (card === "unavailable") return fail("provider", "product unreadable", "We couldn't read your product just now.", "before");
  if (!card) return fail("gate", PRODUCT_NOT_CONFIRMED, PRODUCT_NOT_CONFIRMED, "before");

  let star: Star | null = null;
  if (planned.star) {
    const characterId = row.characterIds[0];
    const ready = characterId ? await starReadiness(deps.db, userId, characterId) : null;
    if (!ready) return fail("gate", CHARACTER_NEEDS_PHOTO, CHARACTER_NEEDS_PHOTO, "before");
    if (!ready.ok) return ready.missing === "unavailable" ? fail("provider", ready.error, ready.error, "before") : fail("gate", ready.error, ready.error, "before");
    star = ready.star;
  }

  const refPaths = productReferencePaths(card);
  const prompt = stillPrompt({
    shot: planned,
    product: card,
    productRefs: refPaths.length,
    house: attempt.kind === "house",
    note: attempt.note,
  });

  // 2. The prompt gate.
  const gate = await deps.promptGate({ prompt, hasRealPersonReference: star !== null && star.kind !== "not_a_person" }).catch(
    (): GateAnswer => ({ ok: false, reason: "unavailable", message: PAINT_COULDNT_START }),
  );
  if (!gate.ok) {
    return gate.reason === "refused" ? fail("refused", gate.message, gate.message, "before") : fail("provider", gate.message, "The safety check couldn't run.", "before");
  }

  // 3. The ad policy step.
  const own = await deps.ownRules(userId).catch(() => [] as PolicyRule[]);
  const policy = await adPolicyCheck(deps, prompt, own);
  if (!policy.ok) {
    return policy.code === "refused" ? fail("refused", policy.error, policy.error, "before") : fail("provider", policy.error, "The ad check couldn't run.", "before");
  }

  // 3b. A repaint with the person's own words: the endorsement rubric on
  //     the still's whole prompt (PT-SEC-2). A packshot's star is judged as
  //     a real person who agreed to appear (the stricter reading).
  if (attempt.note) {
    const endorsement = await endorsementCheck(deps, prompt, star?.kind ?? "permission");
    if (!endorsement.ok) {
      return endorsement.code === "refused"
        ? fail("refused", endorsement.error, endorsement.error, "before")
        : fail("provider", endorsement.error, "The ad check couldn't run.", "before");
    }
  }

  // 4. The picture lane: identity first, then the product, one list.
  const identityUrl = star ? await deps.signCharacterPhoto(star.identityPath).catch(() => null) : null;
  if (star && !identityUrl) return fail("provider", "identity photo unsigned", "We couldn't open your character's photo.", "before");
  const signed = await deps.signProductPhotos(refPaths).catch(() => ({}) as Record<string, string>);
  const productUrls = refPaths.map((p) => signed[p]).filter((u): u is string => typeof u === "string" && u.length > 0);
  if (productUrls.length === 0) return fail("provider", "product photos unsigned", "We couldn't open your product's photos.", "before");

  let png: Buffer;
  try {
    const made = await deps.generateStill({ prompt, identityUrl, productUrls });
    usd += Number.isFinite(made.usd) ? made.usd : 0;
    png = Buffer.from(made.base64, "base64");
  } catch (err) {
    // A picture lane's own safety refusal is final for this still, never re-tried elsewhere.
    const e = err as { name?: string; message?: string; beforeRender?: boolean };
    if (e?.name === "ImageSafetyRejection") {
      const message = typeof e.message === "string" && e.message ? e.message : STILL_REFUSED;
      return fail("refused", message, message, e.beforeRender !== false ? "before" : "after");
    }
    // The lane was called: it may have rendered and billed before failing.
    return fail("provider", "the picture lane failed", "The picture couldn't be painted this time.", "after");
  }

  // 5. The 9:16 crop, keeping the face and the product (v2 #2).
  let cropped: Buffer;
  let crop: CropWindow;
  try {
    const meta = await sharp(png, { limitInputPixels: 50_000_000 }).metadata();
    const located = deps.locate ? await deps.locate({ png, productPhotoPaths: refPaths }).catch(() => null) : null;
    crop = cropWindow(meta.width ?? STILL_RENDER.width, meta.height ?? STILL_RENDER.height, located);
    cropped = await sharp(png, { limitInputPixels: 50_000_000 })
      .extract({ left: crop.left, top: crop.top, width: crop.width, height: crop.height })
      .png()
      .toBuffer();
  } catch {
    return fail("provider", "the still could not be cropped", "The picture couldn't be framed this time.", "after");
  }

  // 6. Keep it, then the output gate on exactly what is kept.
  let stored: string;
  try {
    stored = await deps.storeStill(userId, path, cropped);
  } catch {
    return fail("provider", "the still could not be stored", "The picture couldn't be saved this time.", "after");
  }
  const url = deps.absolutize(stored);
  const judged = await deps.outputGate({ url, promptScores: gate.scores ?? null }).catch(
    (): GateAnswer => ({ ok: false, reason: "unavailable", message: PAINT_COULDNT_START }),
  );
  if (!judged.ok) {
    await deps.removeStill(path).catch(() => undefined);
    // A drawn still: the ordinary refund rules decide, refused or not.
    return judged.reason === "refused"
      ? fail("refused", STILL_REFUSED, judged.message, "after")
      : fail("provider", "the picture check couldn't run", "The picture check couldn't run.", "after");
  }

  // 7. Delivered now: a step stopped during the checks leaves a row the next
  //    step adopts, never a paid painting to paint again (M2).
  const detail =
    attempt.kind === "house"
      ? `Repainted shot ${shot}'s still once, free, after the check.`
      : attempt.kind === "repaint"
        ? `Repainted shot ${shot}'s still.`
        : `Painted shot ${shot}'s still.`;
  const delivered = async (extra: Record<string, unknown>, steps: { step: string; detail: string }[], tour: Record<string, unknown>): Promise<boolean> => {
    try {
      const { error } = await deps.db
        .from("generations")
        .update({
          status: "succeeded",
          result_url: stored,
          progress_stage: null,
          press_tour: tour,
          pipeline_log: [{ attempt: 1, passed: true, issues: [], compiledPrompt: prompt.slice(0, 4000), steps }],
          ...extra,
        })
        .eq("id", attempt.rowId)
        .eq("user_id", userId);
      return !error;
    } catch {
      return false;
    }
  };
  const painted = { ...pressTour, painted: { fits: crop.fits } };
  const early = await delivered({}, [{ step: "generate", detail }], painted);

  // 8. The checks, on the cropped still.
  const threshold = await deps.identityThreshold().catch(() => 0);
  let check: StillCheck;
  try {
    check = await deps.checkStill({
      userId,
      campaignId,
      generationId: attempt.rowId,
      shot,
      still: { url, bytes: cropped, width: crop.width, height: crop.height },
      star: star && identityUrl ? { identityPath: star.identityPath, identityUrl, traitSummary: star.traitSummary } : null,
      identityThreshold: threshold,
      productVisibility: planned.productVisibility,
      product: card,
      productPhotoPaths: refPaths,
      productPhotoUrls: productUrls,
      escalationsLeft: Math.max(0, MAX_ESCALATIONS_PER_AD - escalationsUsed(row.stills)),
    });
  } catch {
    check = { face: star ? "not_checked" : "no_one_in_shot", product: "not_checked", reason: null, faceScore: null, usd: 0, escalations: 0 };
  }
  const face: Verdict = star ? (check.face === "no_one_in_shot" ? "not_checked" : check.face) : "no_one_in_shot";
  const product: Verdict = check.product === "no_one_in_shot" ? "not_checked" : check.product;
  const faceScore = num(check.faceScore, 0, 100);
  const escalations = Math.max(0, Math.round(check.escalations || 0));
  usd += num(check.usd, 0, 10) ?? 0;
  const reason = typeof check.reason === "string" ? check.reason.slice(0, 300) : null;

  // The verdict word rides beside the delivered row (History shows it).
  const checked = await delivered(
    {
      match_score: faceScore === null ? null : Math.round(faceScore),
      product_verdict: product,
      product_retries: attempt.kind === "house" ? 1 : null,
    },
    [
      { step: "generate", detail },
      { step: "validate", detail: `Face: ${face}. Product: ${product}.` },
    ],
    { ...painted, check: { face, product, reason, fits: crop.fits, faceScore, escalations } },
  );
  if (!early && !checked) {
    // Neither write reached the row: it stays "generating" and the orphan
    // reaper settles it; the still itself is kept and shown.
    console.error(`[press-tour] still ${attempt.rowId} painted but its row could not be marked delivered`);
  }

  return {
    kind: "painted",
    path,
    face,
    product,
    reason,
    fits: crop.fits,
    faceScore,
    escalations,
    usd,
  };
}
