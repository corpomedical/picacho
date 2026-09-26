// The campaign engine's real providers, wired (server-only). Every decision
// lives in the alias-free modules (campaign-service.ts, campaign-machine.ts,
// paint.ts, planner.ts, quote.ts), which take their providers as
// dependencies and are tested with fakes; this file is the one place they
// are the real ones. The "use server" door (campaign-actions.ts) and the
// cron (app/api/cron/press) both build their dependencies here, so a kick
// after a press and the cron's minute run exactly the same machine.
//
//   planner      providers/anthropic.ts directScene (Cinema Studio's plan
//                plumbing), content-policy.ts assertPromptAllowed,
//                brand-rules/classify.ts classifyProhibitions, and the
//                endorsement rubric through providers/openai.ts
//                reviewWithOpenAI (temperature 0, a fixed seed)
//   money        core.ts checkGenerationAllowance and the guarded bonus and
//                purchased spends, bound to the person's own client;
//                job-runner.ts refundGenerationCosts
//   stills       providers/image.ts generateImage on the GPT lane at `high`,
//                1024x1536, identity and product photos in one list; kept in
//                generated-images through core.ts persistImageBytes; the
//                output gate (output-policy.ts judgeRender, strict lane)
//   checks       lib/product-lock (check.ts checkStill with live.ts's real
//                readers, the words of EVERY photo the person chose as the
//                corpus: PT-04); it writes its own product_frame_checks rows
//   framing      product-lock/judge.ts locateFraming: the face and the
//                product on the 2:3 still, so the 9:16 crop keeps both (PT-10)
//   machine      claim_press_campaigns, notifyAdmins, the identity gate's
//                bar, and a paid retry through the person's own allowance
//                (v2 #11: paint.ts reservePaidRetry, service role)
//   filming      (Cut 4, film.ts) fal.ts submitVideoJob on the film lane
//                (openingFrame, generateNativeAudio false, 9:16), its queue
//                verbs, model-health.ts (the busy check, the breaker's
//                record), output-policy.ts judgeRender on the take (strict
//                lane), core.ts persistVideo with the sound taken out; the
//                checks through product-lock check.ts checkMoments (the
//                ffmpeg sampler and the face scorer)
//   the cut      (Cut 4, cut.ts) ffmpeg-static (cut-encode.ts), the private
//                press-kit bucket, the brand kit's logo, the signing seam
//                (sign.ts: no C2PA library is installed, so renditions are
//                delivered unsigned and say why), the finished ad's copy in
//                generated-videos for History, and the adReady / adFailed
//                pushes as soon as lib/push knows those keys

import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyProhibitions } from "@/lib/brand-rules/classify";
import type { BrandRule } from "@/lib/brand-rules/types";
import { assertPromptAllowed, ContentPolicyRefusal } from "@/lib/generations/content-policy";
import {
  checkGenerationAllowance,
  consumeBonusCredits,
  consumePurchasedCredits,
  getMonthlyUsageWith,
  persistImageBytes,
  persistVideo,
} from "@/lib/generations/core";
import { readIdentityThreshold } from "@/lib/generations/face-lock";
import { getUnavailableModels, recordModelFailure, recordModelSuccess } from "@/lib/generations/model-health";
import { cancelQueuedJob, checkQueuedJob, fetchQueuedVideoUrl, submitVideoJob } from "@/lib/generations/providers/fal";
import { VIDEO_MODELS } from "@/lib/generations/providers/video-models";
import { PREF_FOR_KEY } from "@/lib/push/prefs";
import { notifyUser, type PushMessage } from "@/lib/push/send";
import { refundGenerationCosts } from "@/lib/generations/job-runner";
import { judgeRender, OutputPolicyRefusal } from "@/lib/generations/output-policy";
import { directScene } from "@/lib/generations/providers/anthropic";
import { generateImage, newProviderBudget } from "@/lib/generations/providers/image";
import { OPENAI_IMAGE_TIMEOUT_MS } from "@/lib/generations/providers/openai-images";
import { reviewWithOpenAI } from "@/lib/generations/providers/openai";
import { providerMediaOrigin } from "@/lib/generations/providers/provider-url";
import { absolutizeMediaUrl, mediaUrl } from "@/lib/media/url";
import { PLAN_LIMITS, spendableCredits, type PlanId } from "@/lib/plans";
import { CHECK_BUDGET_MS, checkMoments, checkStill } from "@/lib/product-lock/check";
import { MAX_SHOT_BYTES } from "@/lib/product-lock/frames";
import { prepareFrame } from "@/lib/product-lock/crop";
import { locateFraming } from "@/lib/product-lock/judge";
import { productCheckDeps } from "@/lib/product-lock/live";
import { notifyAdmins } from "@/lib/push/web-push";
import { hashedRateKey, rateLimited } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/server";
import { PRESS_KIT_BUCKET } from "./card-service";
import { driveCampaign, kickBudgetMs, stillOf, type CampaignRow, type MachineDeps } from "./campaign-machine";
import type { CampaignCaller, CampaignDeps, FilmDoorDeps } from "./campaign-service";
import { assembleStep, lateCuts, signStep, type AdNoticeKey, type CutDeps } from "./cut";
import { loadCutFont } from "./cut-encode";
import { checkShotsStep, filmRowPayload, filmStep, readFilmOpening, takeCheckFrom, type FilmDeps, type TakeCheckInput, type TakeCheckOutcome } from "./film";
import { c2paSigner } from "./sign";
import { BRAND_KIT_COLUMNS, brandKitFromRow } from "./types";
import {
  STILL_BUCKET,
  STILL_RENDER,
  endStillRow,
  paintKeyframe,
  productReferencePaths,
  reserveHouseRow,
  reserveHouseRowWith,
  reservePaidRetry,
  reservePaidRetryWith,
  type GateAnswer,
  type MoneyDeps,
  type PaintDeps,
  type StillChecker,
} from "./paint";
import type { PlannerDeps, PolicyRule } from "./planner";
import { STILL_LANE } from "./quote";

/** The press-tour page's function limit (app/app/press-tour/page.tsx maxDuration): a kick runs inside it, in after(). */
export const KICK_FUNCTION_MS = 300_000;
/** Room for the gates, the readers and the writes around the picture lane and the checks. */
export const STEP_MARGIN_MS = 15_000;
/**
 * The longest one paint step may take: the picture lane's own timeout, the
 * check's budget, and the margin around them (M2).
 */
export const WORST_STEP_MS = OPENAI_IMAGE_TIMEOUT_MS + CHECK_BUDGET_MS + STEP_MARGIN_MS;
/**
 * A kick starts a step only while a WHOLE step still fits in the function
 * (M2, PT-07: campaign-machine.ts kickBudgetMs): a step started at 190 s
 * used to be killed mid-render at 300 s, its paid picture lost and its lease
 * held for 6 minutes. In practice the kick paints the first still and the
 * cron's minute carries on from there.
 */
export const KICK_BUDGET_MS = kickBudgetMs({
  functionMs: KICK_FUNCTION_MS,
  laneTimeoutMs: OPENAI_IMAGE_TIMEOUT_MS,
  checkBudgetMs: CHECK_BUDGET_MS,
  marginMs: STEP_MARGIN_MS,
});
/** Signed links handed to a provider live this long. */
const SIGNED_SECONDS = 10 * 60;
/** The rubric's fixed seed (content-policy.ts's reason: a verdict should not change between two identical runs). */
const RUBRIC_SEED = 20260926;

// ---------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------

async function download(db: SupabaseClient, bucket: string, path: string): Promise<Buffer | null> {
  try {
    const { data, error } = await db.storage.from(bucket).download(path);
    if (error || !data || data.size > 20 * 1024 * 1024) return null;
    return Buffer.from(await data.arrayBuffer());
  } catch {
    return null;
  }
}

/** The person's spendable credits now: the plan's remainder (only while in good standing), bonus and purchased. */
export async function spendableNow(db: SupabaseClient, userId: string): Promise<number> {
  const { data } = await db
    .from("profiles")
    .select("plan, plan_status, bonus_credits, purchased_credits, current_period_start")
    .eq("id", userId)
    .maybeSingle();
  const p = (data ?? {}) as { plan?: string; plan_status?: string | null; bonus_credits?: number; purchased_credits?: number; current_period_start?: string | null };
  const plan = (p.plan ?? "none") as PlanId;
  const active = (p.plan_status ?? null) === null || p.plan_status === "active";
  const used = await getMonthlyUsageWith(db, userId, p.current_period_start ?? null);
  return spendableCredits({
    monthlyLimit: active ? (PLAN_LIMITS[plan] ?? 0) : 0,
    used,
    bonus: p.bonus_credits ?? 0,
    purchased: p.purchased_credits ?? 0,
  });
}

/** The person's own active brand rules, whatever brand_rules_enforcement says (the ad policy step runs them beside the packs). */
export async function ownBrandRules(db: SupabaseClient, userId: string): Promise<PolicyRule[]> {
  const { data } = await db
    .from("brand_rules")
    .select("id, kind, label, value, applies_to, severity, active")
    .eq("user_id", userId)
    .eq("active", true)
    .limit(60);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    kind: r.kind === "require" ? "require" : "forbid",
    label: String(r.label ?? ""),
    value: String(r.value ?? ""),
    appliesTo: r.applies_to === "image" || r.applies_to === "video" ? r.applies_to : "all",
    severity: r.severity === "warn" ? "warn" : "block",
    active: r.active === true,
  }));
}

// ---------------------------------------------------------------------------
// The planner
// ---------------------------------------------------------------------------

export function plannerDeps(): PlannerDeps {
  return {
    direct: (instructions) => directScene(instructions),
    assertPromptAllowed: (input) => assertPromptAllowed(input),
    classify: (prompt, rules, opts) => classifyProhibitions(prompt, rules as BrandRule[], opts),
    review: rubricReview,
  };
}

/** The endorsement rubric's reader: temperature 0 and a fixed seed, the same verdict for the same words. */
const rubricReview = (instructions: string) => reviewWithOpenAI(instructions, { temperature: 0, maxTokens: 2000, seed: RUBRIC_SEED });

// ---------------------------------------------------------------------------
// The stills
// ---------------------------------------------------------------------------

/** lib/product-lock's checkStill, adapted to the campaign's StillCheck. */
const stillChecker = (db: SupabaseClient): StillChecker => async (input) => {
  // The readers see the first 3 references (front, logo, one more angle);
  // the words of EVERY photo the person chose make the corpus a still's
  // words are compared with (v2 #7, PT-04): a side panel's line is the
  // product's own, never a conflict.
  const textPaths = input.product.photos.length > 0 ? input.product.photos : input.productPhotoPaths;
  const [references, textPhotos, identity, owner] = await Promise.all([
    Promise.all(input.productPhotoPaths.slice(0, 3).map((p) => download(db, PRESS_KIT_BUCKET, p))),
    Promise.all(textPaths.slice(0, 6).map((p) => download(db, PRESS_KIT_BUCKET, p))),
    input.star ? download(db, "character-references", input.star.identityPath) : Promise.resolve(null),
    db.from("profiles").select("role").eq("id", input.userId).maybeSingle(),
  ]);
  const result = await checkStill(
    {
      image: input.still.bytes,
      visibility: input.productVisibility,
      card: {
        productId: input.product.id,
        name: input.product.name || null,
        labelStrings: input.product.labelStrings,
        noReadableText: input.product.noReadableText,
        dna: input.product.dna,
        palette: input.product.palette,
        references: references.filter((b): b is Buffer => b !== null),
        referenceText: null,
        textPhotos,
      },
      // A star whose photo could not be opened is "not checked", never a miss.
      face: input.star ? (identity ? { identity, traitSummary: input.star.traitSummary, threshold: input.identityThreshold } : undefined) : null,
      escalationsLeft: input.escalationsLeft,
      record: {
        userId: input.userId,
        productId: input.product.id,
        campaignId: input.campaignId,
        generationId: input.generationId,
        shot: input.shot,
        source: "still",
        lane: STILL_LANE.modelId,
        // Only an admin's own frames keep their picture (synthesis v2 #32).
        keepFrames: (owner.data as { role?: string } | null)?.role === "admin",
      },
    },
    productCheckDeps(),
  );
  return {
    face: result.face ?? (input.star ? "not_checked" : "no_one_in_shot"),
    product: result.product,
    reason: result.reason,
    faceScore: result.signals.faceLowest,
    usd: result.signals.usd,
    escalations: result.signals.escalationsUsed,
  };
};

export function paintDeps(): PaintDeps {
  const db = createAdminClient();
  return {
    db,
    generateStill: async ({ prompt, identityUrl, productUrls }) => {
      let captured = "";
      let usd = 0;
      await generateImage(
        STILL_LANE.modelId,
        prompt,
        identityUrl,
        async (base64) => {
          captured = base64;
          return "captured";
        },
        undefined,
        // One paid call per still; a failure is the machine's to retry, once, on the house.
        newProviderBudget(1),
        null,
        null,
        null,
        null,
        (usage) => {
          usd += usage.usd;
        },
        STILL_RENDER.size,
        null,
        productUrls,
        null,
        null,
        STILL_LANE.quality,
      );
      if (!captured) throw new Error("The picture lane returned no picture.");
      return { base64: captured, usd };
    },
    // The face AND the product, so the crop can keep both (v2 #2, PT-10).
    // Boxes are shares of the picture, so the readers' smaller JPEGs place
    // them on the full still as they are.
    locate: async ({ png, productPhotoPaths }) => {
      const [frame, ...refs] = await Promise.all([
        prepareFrame(png),
        ...productPhotoPaths.slice(0, 3).map(async (p) => {
          const bytes = await download(db, PRESS_KIT_BUCKET, p);
          return bytes ? prepareFrame(bytes, 1024) : null;
        }),
      ]);
      if (!frame) return null;
      const references = refs.filter((r): r is NonNullable<typeof r> => r !== null).map((r) => r.bytes);
      const answer = await locateFraming({ frame: frame.bytes, references });
      return answer.ok ? answer.value : null;
    },
    storeStill: (userId, path, bytes) => persistImageBytes(userId, path, bytes, "image/png"),
    removeStill: async (path) => {
      await db.storage.from(STILL_BUCKET).remove([path]);
    },
    absolutize: (stored) => absolutizeMediaUrl(stored, providerMediaOrigin()),
    signCharacterPhoto: async (path) => {
      const { data } = await db.storage.from("character-references").createSignedUrl(path, SIGNED_SECONDS);
      return data?.signedUrl ?? null;
    },
    signProductPhotos: async (paths) => {
      const out: Record<string, string> = {};
      if (paths.length === 0) return out;
      const { data } = await db.storage.from(PRESS_KIT_BUCKET).createSignedUrls(paths, SIGNED_SECONDS);
      for (const item of data ?? []) if (item?.path && item.signedUrl) out[item.path] = item.signedUrl;
      return out;
    },
    promptGate: async ({ prompt, hasRealPersonReference }): Promise<GateAnswer> => {
      try {
        const scores = await assertPromptAllowed({ prompt, hasRealPersonReference });
        return { ok: true, scores };
      } catch (err) {
        if (err instanceof ContentPolicyRefusal) {
          return { ok: false, reason: err.reason === "unavailable" ? "unavailable" : "refused", message: err.userMessage };
        }
        return { ok: false, reason: "unavailable", message: "The safety check could not run." };
      }
    },
    classify: (prompt, rules, opts) => classifyProhibitions(prompt, rules as BrandRule[], opts),
    review: rubricReview,
    outputGate: async ({ url, promptScores }): Promise<GateAnswer> => {
      try {
        await judgeRender({ url, kind: "image", promptScores: (promptScores ?? null) as never, strictLane: true });
        return { ok: true };
      } catch (err) {
        if (err instanceof OutputPolicyRefusal) {
          return { ok: false, reason: err.reason === "unavailable" ? "unavailable" : "refused", message: err.userMessage };
        }
        return { ok: false, reason: "unavailable", message: "The picture check could not run." };
      }
    },
    checkStill: stillChecker(db),
    identityThreshold: () => readIdentityThreshold(db),
    ownRules: (userId) => ownBrandRules(db, userId),
    refund: (rowId, opts) => refundGenerationCosts(rowId, opts),
  };
}

// ---------------------------------------------------------------------------
// The machine
// ---------------------------------------------------------------------------

export function machineDeps(): MachineDeps {
  const db = createAdminClient();
  const painter = paintDeps();
  return {
    db,
    film: filmDeps(db),
    cut: cutDeps(db),
    stages: { animating: filmStep, checking_shots: checkShotsStep, assembling: assembleStep, signing: signStep, late: lateCuts },
    settleRow: ({ userId, rowId, credits, reason }) =>
      endStillRow({ db, refund: (id, opts) => refundGenerationCosts(id, opts) }, { userId, rowId, credits, detail: reason, force: false }),
    paint: (input) => paintKeyframe(painter, input),
    reserveHouse: async ({ campaign, shot, kind, rowId }: { campaign: CampaignRow; shot: number; kind: "house" | "retry"; rowId: string }) => {
      const planned = campaign.plan?.shots.find((s) => s.shot === shot);
      const still = stillOf(campaign.stills, shot);
      if (!planned || !still) return false;
      return reserveHouseRow(db, campaign.userId, {
        id: rowId,
        campaignId: campaign.id,
        shot,
        role: planned.role,
        kind,
        attempt: still.attempts.length + 1,
        credits: 0,
        characterIds: planned.star ? campaign.characterIds : [],
        label: `Press Tour · ${campaign.plan?.angle ?? "Ad"} · shot ${shot}${kind === "house" ? " repainted free" : " retried"}`,
        trialId: campaign.trialId,
      });
    },
    // v2 #11: the person's own allowance, read with the service role (the
    // cron has no session), for exactly the failed still's price.
    reservePaid: async ({ campaign, shot, rowId, credits, failedReservedAt }) => {
      const planned = campaign.plan?.shots.find((s) => s.shot === shot);
      const still = stillOf(campaign.stills, shot);
      if (!planned || !still) return "refused";
      const money: MoneyDeps = {
        db,
        allowance: (n) => checkGenerationAllowance(db, campaign.userId, n, { skipCooldown: true }),
        spendBonus: (userId, amount) => consumeBonusCredits(db, userId, amount),
        spendPurchased: (userId, amount) => consumePurchasedCredits(db, userId, amount),
        refund: (id, opts) => refundGenerationCosts(id, opts),
      };
      return reservePaidRetry(
        money,
        campaign.userId,
        {
          id: rowId,
          campaignId: campaign.id,
          shot,
          role: planned.role,
          kind: "retry",
          attempt: still.attempts.length + 1,
          credits,
          characterIds: planned.star ? campaign.characterIds : [],
          label: `Press Tour · ${campaign.plan?.angle ?? "Ad"} · shot ${shot} retried`,
          trialId: campaign.trialId,
        },
        failedReservedAt,
      );
    },
    releaseRow: ({ userId, rowId, credits, reason }) =>
      endStillRow({ db, refund: (id, opts) => refundGenerationCosts(id, opts) }, { userId, rowId, credits, detail: reason, force: true }),
    faceGateOn: async () => (await readIdentityThreshold(db)) > 0,
    notifyAdmins: (message) => notifyAdmins(message),
  };
}

// ---------------------------------------------------------------------------
// A person's press
// ---------------------------------------------------------------------------

/**
 * Everything campaign-service.ts needs for one person's press: the service
 * role for press_campaigns, their own client for the allowance, and a kick
 * that drives the machine after the answer is sent.
 */
export function campaignDeps(caller: CampaignCaller, personal: SupabaseClient): CampaignDeps {
  const db = createAdminClient();
  const money: MoneyDeps = {
    db,
    allowance: (credits) => checkGenerationAllowance(personal, caller.userId, credits),
    spendBonus: (userId, amount) => consumeBonusCredits(personal, userId, amount),
    spendPurchased: (userId, amount) => consumePurchasedCredits(personal, userId, amount),
    refund: (rowId, opts) => refundGenerationCosts(rowId, opts),
  };
  return {
    db,
    money,
    planner: plannerDeps(),
    ownRules: (userId) => ownBrandRules(db, userId),
    balance: (userId) => spendableNow(db, userId),
    rateLimited,
    hashKey: hashedRateKey,
    kick: (campaignId) => {
      after(async () => {
        try {
          await driveCampaign(machineDeps(), campaignId, { budgetMs: KICK_BUDGET_MS });
        } catch (err) {
          console.error(`[press-tour] kick ${campaignId} failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
    },
    imageUrl: (path) => mediaUrl(STILL_BUCKET, path),
    filmDoor: filmDoorDeps(db),
  };
}

// ---------------------------------------------------------------------------
// Cut 4: filming, the checks on shots, the cut
// ---------------------------------------------------------------------------

/** A finished file's link lives this long (press-kit is private; the door asks again when it reopens). */
const RENDITION_URL_SECONDS = 60 * 60;
/** Downloading a take or a cut file waits at most this long. */
const VIDEO_READ_MS = 60_000;

const MEDIA_ROUTE = /^\/api\/media\/([^/]+)\/([^?]+)/;

/** Bytes from storage, up to `max` (the still reader's 20 MB is too small for a video). */
async function downloadVideo(db: SupabaseClient, bucket: string, path: string, max = MAX_SHOT_BYTES): Promise<Buffer | null> {
  try {
    const { data, error } = await db.storage.from(bucket).download(path);
    if (error || !data || data.size > max) return null;
    return Buffer.from(await data.arrayBuffer());
  } catch {
    return null;
  }
}

/** A kept take's bytes: our media route (generated-videos), or the provider's https link when keeping it failed. */
async function readVideoBytes(db: SupabaseClient, stored: string): Promise<Buffer | null> {
  const m = MEDIA_ROUTE.exec(stored);
  if (m) {
    if (m[1] !== "generated-videos") return null;
    let path: string;
    try {
      path = m[2].split("/").map(decodeURIComponent).join("/");
    } catch {
      return null;
    }
    if (path.includes("..")) return null;
    return downloadVideo(db, "generated-videos", path);
  }
  if (!stored.startsWith("https://")) return null;
  try {
    const res = await fetch(stored, { signal: AbortSignal.timeout(VIDEO_READ_MS) });
    if (!res.ok) return null;
    if (Number(res.headers.get("content-length") ?? "0") > MAX_SHOT_BYTES) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.length > 0 && bytes.length <= MAX_SHOT_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

/** Whether the film lane is out of service right now (model-health.ts; the breaker never swaps it here). */
async function laneBusy(modelId: string): Promise<boolean> {
  return (await getUnavailableModels()).has(modelId);
}

/**
 * adReady / adFailed / adFailedRefunded to the person's devices (lib/push
 * send.ts PushMessage, prefs.ts PREF_FOR_KEY, text.ts, the catalogs); a key
 * PREF_FOR_KEY doesn't name is never sent (never a push with no words).
 * English: film-messages.ts AD_READY_PUSH / AD_FAILED_PUSH /
 * AD_FAILED_REFUNDED_PUSH.
 */
async function pushAdNotice(input: { userId: string; key: AdNoticeKey; path: string }): Promise<void> {
  if (!Object.prototype.hasOwnProperty.call(PREF_FOR_KEY, input.key)) {
    console.info(`[press-tour] ${input.key} not pushed: lib/push doesn't know the key yet`);
    return;
  }
  await notifyUser(input.userId, { message: { key: input.key as unknown as PushMessage["key"] }, path: input.path });
}

function filmDoorDeps(db: SupabaseClient): FilmDoorDeps {
  return {
    opening: () => readFilmOpening(db),
    laneBusy,
    // A kept take is stored as our media route's own link (or, rarely, the provider's): shown as it is.
    videoUrl: (stored) => stored,
    renditionUrl: async (path) => {
      const { data } = await db.storage.from(PRESS_KIT_BUCKET).createSignedUrl(path, RENDITION_URL_SECONDS);
      return data?.signedUrl ?? null;
    },
  };
}

/** lib/product-lock checkMoments on one filmed take, adapted to the campaign's TakeCheckOutcome. */
const takeChecker =
  (db: SupabaseClient) =>
  async (input: TakeCheckInput): Promise<TakeCheckOutcome> => {
    const ctx = { productExpected: input.productVisibility !== "absent", star: input.star !== null };
    const refPaths = productReferencePaths(input.product);
    const textPaths = input.product.photos.length > 0 ? input.product.photos : refPaths;
    const [video, references, textPhotos, identity, owner, threshold] = await Promise.all([
      readVideoBytes(db, input.video),
      Promise.all(refPaths.slice(0, 3).map((p) => download(db, PRESS_KIT_BUCKET, p))),
      Promise.all(textPaths.slice(0, 6).map((p) => download(db, PRESS_KIT_BUCKET, p))),
      input.star ? download(db, "character-references", input.star.identityPath) : Promise.resolve(null),
      db.from("profiles").select("role").eq("id", input.userId).maybeSingle(),
      readIdentityThreshold(db).catch(() => 0),
    ]);
    const notChecked: TakeCheckOutcome = {
      check: { face: ctx.star ? "not_checked" : "no_one_in_shot", product: "not_checked", reason: null, moments: [], escalations: 0, corner: null },
      usd: 0,
    };
    if (!video) return notChecked;
    const result = await checkMoments(
      {
        video,
        seconds: input.seconds,
        packshot: input.packshot,
        visibility: input.productVisibility,
        card: {
          productId: input.product.id,
          name: input.product.name || null,
          labelStrings: input.product.labelStrings,
          noReadableText: input.product.noReadableText,
          dna: input.product.dna,
          palette: input.product.palette,
          references: references.filter((b): b is Buffer => b !== null),
          referenceText: null,
          textPhotos,
        },
        // A star whose photo could not be opened is "not checked", never a miss.
        face: input.star ? (identity ? { identity, traitSummary: input.star.traitSummary, threshold } : undefined) : null,
        escalationsLeft: input.escalationsLeft,
        record: {
          userId: input.userId,
          productId: input.product.id,
          campaignId: input.campaignId,
          generationId: input.generationId,
          shot: input.shot,
          source: "moment",
          lane: input.lane,
          // Only an admin's own frames keep their picture (synthesis v2 #32).
          keepFrames: (owner.data as { role?: string } | null)?.role === "admin",
        },
      },
      productCheckDeps(),
    );
    return { check: takeCheckFrom(result, ctx, threshold), usd: result.signals.usd };
  };

function filmDeps(db: SupabaseClient): FilmDeps {
  const moneyFor = (userId: string): MoneyDeps => ({
    db,
    allowance: (n) => checkGenerationAllowance(db, userId, n, { skipCooldown: true }),
    spendBonus: (u, amount) => consumeBonusCredits(db, u, amount),
    spendPurchased: (u, amount) => consumePurchasedCredits(db, u, amount),
    refund: (id, opts) => refundGenerationCosts(id, opts),
  });
  const painter = paintDeps();
  return {
    lane: async () => (await readFilmOpening(db)).lane,
    laneBusy,
    submit: async ({ modelId, prompt, stillUrl, seconds }) => {
      // The still IS the first frame, already 9:16: never reframed; no sound (critique #18).
      const job = await submitVideoJob(prompt, modelId, {
        characterAnchorImageUrl: stillUrl,
        openingFrame: true,
        generateNativeAudio: false,
        durationSeconds: seconds,
        aspectRatio: "9:16",
      });
      return { requestId: job.requestId, statusUrl: job.statusUrl, responseUrl: job.responseUrl, cancelUrl: job.cancelUrl, label: job.label };
    },
    poll: async (job) => {
      const state = await checkQueuedJob(job);
      return state.state === "failed" ? { state: "failed", error: state.error } : state.state === "completed" ? { state: "completed" } : { state: "pending" };
    },
    result: (job) => fetchQueuedVideoUrl(job),
    cancel: (job) => cancelQueuedJob(job),
    outputGate: async ({ url }): Promise<GateAnswer> => {
      try {
        await judgeRender({ url, kind: "video", strictLane: true });
        return { ok: true };
      } catch (err) {
        if (err instanceof OutputPolicyRefusal) {
          return { ok: false, reason: err.reason === "unavailable" ? "unavailable" : "refused", message: err.userMessage };
        }
        return { ok: false, reason: "unavailable", message: "The picture check could not run." };
      }
    },
    keep: async ({ userId, providerUrl }) => (await persistVideo(db, userId, providerUrl, { dropSound: true }))?.url ?? null,
    // A capability link that never expires: the lane may start the take minutes after it was sent.
    stillUrl: (path) => absolutizeMediaUrl(mediaUrl(STILL_BUCKET, path), providerMediaOrigin()),
    promptGate: painter.promptGate,
    classify: painter.classify,
    review: painter.review,
    ownRules: (userId) => ownBrandRules(db, userId),
    refund: (id, opts) => refundGenerationCosts(id, opts),
    reservePaid: ({ campaign, spec, failedReservedAt }) =>
      reservePaidRetryWith(moneyFor(campaign.userId), campaign.userId, spec, failedReservedAt, filmRowPayload),
    reserveHouse: ({ campaign, spec }) => reserveHouseRowWith(db, campaign.userId, spec, filmRowPayload),
    healthSuccess: (modelId) => recordModelSuccess(modelId, "video"),
    healthFailure: (modelId, detail, userId) => recordModelFailure(modelId, "video", detail, userId),
    checkTake: takeChecker(db),
    // The row's own booked price (video-models.ts costPerSecondUsd: $0.112/s for kling-o3, its WITH-audio
    // figure; audio-off is expected lower, and the bake-off's invoice line settles it). A ceiling, never a guess.
    usdPerSecond: (modelId) => VIDEO_MODELS.find((m) => m.id === modelId)?.costPerSecondUsd ?? 0,
  };
}

function cutDeps(db: SupabaseClient): CutDeps {
  return {
    readVideo: (stored) => readVideoBytes(db, stored),
    readKit: (path) => downloadVideo(db, PRESS_KIT_BUCKET, path, 100 * 1024 * 1024),
    writeKit: async (path, bytes) => {
      const { error } = await db.storage.from(PRESS_KIT_BUCKET).upload(path, bytes, { contentType: "video/mp4", upsert: true });
      if (error) console.error(`[press-tour] press-kit upload ${path} failed: ${error.message}`);
      return !error;
    },
    removeKit: async (paths) => {
      await db.storage.from(PRESS_KIT_BUCKET).remove(paths);
    },
    // History serves videos from generated-videos: the finished ad is copied there, under the owner's folder.
    keepMaster: async ({ userId, campaignId, sha256, bytes }) => {
      const path = `${userId}/press/${campaignId}/cut-${sha256.slice(0, 16)}.mp4`;
      const { error } = await db.storage.from("generated-videos").upload(path, bytes, { contentType: "video/mp4", upsert: true });
      return error ? null : mediaUrl("generated-videos", path);
    },
    // No maintained C2PA library is installed (package.json): unsigned, and why (sign.ts).
    signer: c2paSigner(process.env, null),
    brand: async ({ userId, brandKitId }) => {
      const { data, error } = await db.from("brand_kits").select(BRAND_KIT_COLUMNS).eq("id", brandKitId).eq("user_id", userId).is("deleted_at", null).maybeSingle();
      if (error) throw new Error(`the brand kit couldn't be read: ${error.message}`);
      const kit = brandKitFromRow(data);
      // Only a confirmed kit's logo (its ownership answer given) goes on an ad.
      if (!kit || kit.status !== "confirmed" || !kit.logoPath || !kit.logoPath.startsWith(`${userId}/`)) return null;
      const logo = await downloadVideo(db, PRESS_KIT_BUCKET, kit.logoPath, 12 * 1024 * 1024);
      if (!logo) throw new Error("the brand logo couldn't be read");
      return { logo, background: kit.palette[0] ?? null };
    },
    font: () => loadCutFont(),
    notify: pushAdNotice,
    refund: (id, opts) => refundGenerationCosts(id, opts),
  };
}
