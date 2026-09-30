import { describe, expect, it } from "vitest";
import {
  actionCredits,
  ACTION_COST_USD,
  CREDIT_COST_USD,
  creditsFor,
  dialogueCostUsd,
  pictureCostUsd,
  priceSend,
  videoCostUsd,
  type PricedAction,
} from "./credit-prices";
import {
  CREDIT_PACKS,
  largestSafePlan,
  PACK_FLOOR,
  PAID_PLANS,
  PLAN_CREDITS,
  PLAN_FLOORS,
  PLAN_PRICES,
  worstMargin,
  worstPackMargin,
} from "./credit-plans";
import { PRICING_TIERS } from "./pricing";
import { VIDEO_MODELS } from "./generations/providers/video-models";
import { videoResolutionOffers } from "./generations/providers/video-resolution";
import { imageQualityOffers, imageResolutionOffers } from "./generations/providers/image-resolution";
import { SELECTABLE_IMAGE_MODEL_IDS } from "./generations/providers/image-models";

// The one-balance price list's two promises (2026-10-01, operator: "Adopt the
// one-balance pricing plan at 30%"): no credit can cost us more than
// CREDIT_COST_USD, whatever it is spent on, and no plan can lose its floor
// when every credit is spent. The build fails the day either stops being true.

const video = (modelId: string, seconds: number, extra: Partial<Parameters<typeof priceSend>[0]> = {}) =>
  priceSend({
    contentType: "video",
    videoModelId: modelId,
    videoDurationSeconds: seconds,
    videoResolution: null,
    storyboardTotalSeconds: null,
    referencePhotoCount: 0,
    framePicked: false,
    continuationSourceSeconds: null,
    dialoguePresent: false,
    renderCount: 1,
    characters: 1,
    ...extra,
  });

const picture = (modelId: string, extra: Partial<Parameters<typeof priceSend>[0]> = {}) =>
  priceSend({
    contentType: "image",
    imageModelId: modelId,
    videoModelId: "kling",
    videoDurationSeconds: 5,
    videoResolution: null,
    storyboardTotalSeconds: null,
    referencePhotoCount: 0,
    framePicked: false,
    continuationSourceSeconds: null,
    dialoguePresent: false,
    renderCount: 1,
    characters: 1,
    ...extra,
  });

describe("a price is its full cost over two cents, rounded up", () => {
  it("rounds up, keeps exact multiples, and never charges less than one credit", () => {
    expect(creditsFor(0.02)).toBe(1);
    expect(creditsFor(0.0201)).toBe(2);
    expect(creditsFor(0.2)).toBe(10);
    expect(creditsFor(0.001)).toBe(1);
    expect(creditsFor(0)).toBe(1);
  });

  it("every clip, at every length, priced resolution, frame, dialogue and cast, costs no more than its credits carry", () => {
    for (const model of VIDEO_MODELS) {
      const resolutions = [null, ...videoResolutionOffers(model.id).filter((o) => o.costPerSecondUsd).map((o) => o.value)];
      for (const { seconds } of model.durations) {
        for (const resolution of resolutions) {
          for (const characters of [0, 1, 2, 4]) {
            for (const framePicked of [false, true]) {
              const input = { videoResolution: resolution, characters, framePicked };
              const price = video(model.id, seconds, { ...input, dialoguePresent: true });
              const cost =
                videoCostUsd({
                  modelId: model.id,
                  seconds,
                  resolution,
                  storyboardTotalSeconds: null,
                  framePicked,
                  referencePhotoCount: 0,
                  continuationSourceSeconds: null,
                  characters,
                }) + dialogueCostUsd(seconds);
              expect(price.totalCredits * CREDIT_COST_USD, `${model.id} ${seconds}s ${resolution} ${characters} ${framePicked}`).toBeGreaterThanOrEqual(cost - 1e-9);
            }
          }
        }
      }
    }
  });

  it("every picture, on every lane, size and quality, with or without a character, costs no more than its credits carry", () => {
    for (const modelId of [...SELECTABLE_IMAGE_MODEL_IDS, "flux"]) {
      const sizes = imageResolutionOffers(modelId).map((o) => o.value);
      const qualities = [null, ...imageQualityOffers(modelId).map((o) => o.value)];
      for (const resolution of sizes) {
        for (const quality of qualities) {
          for (const character of [false, true]) {
            const price = picture(modelId, { imageResolution: resolution, imageQuality: quality, characters: character ? 1 : 0 });
            const cost = pictureCostUsd({ modelId, resolution, quality, character });
            expect(price.totalCredits * CREDIT_COST_USD, `${modelId} ${resolution} ${quality} ${character}`).toBeGreaterThanOrEqual(cost - 1e-9);
          }
        }
      }
    }
  });

  it("a fan-out is one price per render, and dialogue rides only a single video send", () => {
    const one = video("kling", 5);
    const six = video("kling", 5, { renderCount: 6, dialoguePresent: true });
    expect(six.totalCredits).toBe(6 * one.perRenderCredits);
    expect(video("kling", 5, { dialoguePresent: true }).totalCredits).toBeGreaterThan(one.totalCredits);
  });

  it("everything else paid from the balance is priced by the same rule", () => {
    for (const action of Object.keys(ACTION_COST_USD) as PricedAction[]) {
      expect(actionCredits(action) * CREDIT_COST_USD, action).toBeGreaterThanOrEqual(ACTION_COST_USD[action] - 1e-9);
    }
  });
});

describe("the price list the operator adopted (pinned: a change here is a price change)", () => {
  it("renders", () => {
    expect(video("wan-turbo", 5).totalCredits).toBe(15);
    expect(video("kling", 5).totalCredits).toBe(26);
    expect(video("kling", 5, { characters: 0 }).totalCredits).toBe(19);
    expect(video("minimax-h3", 5).totalCredits).toBe(27);
    expect(video("kling-2.5", 5).totalCredits).toBe(30);
    expect(video("kling-o3", 5).totalCredits).toBe(41);
    expect(video("gemini-omni", 8).totalCredits).toBe(55);
    expect(video("seedance", 5).totalCredits).toBe(144);
    expect(video("veo", 8).totalCredits).toBe(191);
    expect(picture("gpt-image").totalCredits).toBe(14);
    expect(picture("gpt-image", { characters: 0 }).totalCredits).toBe(8);
  });

  it("the rest", () => {
    expect(actionCredits("alyMessage")).toBe(1);
    expect(actionCredits("characterPhoto")).toBe(4);
    expect(actionCredits("heliosBuild")).toBe(58);
    expect(actionCredits("heliosEdit")).toBe(32);
    expect(actionCredits("promptAssist")).toBe(1);
  });
});

describe("no plan loses money, whatever it is spent on", () => {
  it("keeps its floor with every credit spent, billed monthly or yearly, at 27% VAT and a premium card", () => {
    for (const plan of PAID_PLANS) {
      expect(worstMargin(plan, "yearly"), `${plan} yearly`).toBeGreaterThanOrEqual(PLAN_FLOORS[plan]);
      expect(worstMargin(plan, "monthly"), `${plan} monthly`).toBeGreaterThanOrEqual(PLAN_FLOORS[plan]);
      expect(PLAN_CREDITS[plan], plan).toBeLessThanOrEqual(largestSafePlan(plan));
    }
  });

  it("the top plans' floor is the 30% the operator chose; the smaller ones keep a little more", () => {
    expect(PLAN_FLOORS.studio).toBe(0.3);
    expect(PLAN_FLOORS.elite).toBe(0.3);
    for (const plan of PAID_PLANS) expect(PLAN_FLOORS[plan]).toBeGreaterThanOrEqual(0.3);
  });

  it("a bigger plan is always the better price per credit", () => {
    const perCredit = PAID_PLANS.map((p) => PLAN_PRICES[p].monthly / PLAN_CREDITS[p]);
    for (let i = 1; i < perCredit.length; i++) expect(perCredit[i], PAID_PLANS[i]).toBeLessThan(perCredit[i - 1]);
  });

  it("sells at today's monthly prices; yearly stays 15% off, which moves Elite's from $399 to $424", () => {
    for (const plan of PAID_PLANS) {
      const tier = PRICING_TIERS.find((t) => t.id === plan)!;
      expect(PLAN_PRICES[plan].monthly, plan).toBe(tier.price);
      if (plan !== "elite") expect(PLAN_PRICES[plan].yearly, plan).toBe(tier.annualPrice);
    }
    expect(PLAN_PRICES.elite.yearly).toBe(Math.round(PLAN_PRICES.elite.monthly * 0.85));
  });

  it("a top-up pack keeps its own floor and is always dearer per credit than any plan", () => {
    const dearestPlan = Math.max(...PAID_PLANS.map((p) => PLAN_PRICES[p].monthly / PLAN_CREDITS[p]));
    for (const pack of CREDIT_PACKS) {
      expect(worstPackMargin(pack), `$${pack.usd}`).toBeGreaterThanOrEqual(PACK_FLOOR);
      expect(pack.usd / pack.credits, `$${pack.usd}`).toBeGreaterThan(dearestPlan);
    }
  });
});
