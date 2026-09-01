import { describe, expect, it } from "vitest";
import {
  COST_BASIS_USD_PER_CREDIT,
  FEATURED_VIDEO_MODEL_IDS,
  getDefaultDurationSeconds,
  getVideoModel,
  pricingAudit,
  VIDEO_MODELS,
} from "./providers/video-models";
import { resolutionCreditWeight, videoResolutionOffers } from "./providers/video-resolution";

// The composer's model picker (2026-09-01: four featured lanes, was three).
//
// The defect this guards against is specific and cheap to cause: a featured
// model shows a hand-written plain-language JOB LINE instead of its own
// description, and that line comes from a per-model i18n key. Add a model to
// FEATURED_VIDEO_MODEL_IDS without adding its key to all four locales and
// the picker renders an empty subtitle under the model's name — in that
// language only, so it survives every English-language check.
//
// Nothing else in the codebase ties those two lists together, which is
// exactly why this file does.

const LOCALES = ["en", "es", "pt", "it"] as const;

describe("featured video models", () => {
  it("is the four lanes the picker expects", () => {
    expect(FEATURED_VIDEO_MODEL_IDS).toHaveLength(4);
    expect(FEATURED_VIDEO_MODEL_IDS).toContain("gemini-omni");
  });

  it("features only models that actually exist in the catalogue", () => {
    // getVideoModel falls back to the recommended model for an unknown id,
    // so a typo here would silently feature Kling 1.6 twice rather than
    // throwing anywhere.
    for (const id of FEATURED_VIDEO_MODEL_IDS) {
      expect(
        VIDEO_MODELS.some((m) => m.id === id),
        `featured id "${id}" is not in VIDEO_MODELS`,
      ).toBe(true);
    }
  });

  it("has one job line per featured lane, in every language", async () => {
    // Counted rather than mapped: the id -> key mapping lives in
    // generate-form.tsx, which a no-config vitest run cannot import. The
    // count and the key SET are the parts that actually break.
    for (const loc of LOCALES) {
      const messages = (await import(`../i18n/messages/${loc}`)).default as {
        generate: Record<string, unknown>;
      };
      const jobKeys = Object.keys(messages.generate)
        .filter((k) => k.startsWith("modelJob"))
        .sort();
      expect(jobKeys, `${loc} has the wrong number of model job lines`).toHaveLength(
        FEATURED_VIDEO_MODEL_IDS.length,
      );
      for (const key of jobKeys) {
        const value = messages.generate[key];
        expect(typeof value, `${loc}.${key} is not a string`).toBe("string");
        expect((value as string).trim().length, `${loc}.${key} is empty`).toBeGreaterThan(0);
      }
    }
  });

  it("uses the same job keys in every language", async () => {
    // A key present in en but missing in pt is the real-world shape of this
    // bug — the English reviewer never sees it.
    const perLocale = await Promise.all(
      LOCALES.map(async (loc) => {
        const messages = (await import(`../i18n/messages/${loc}`)).default as {
          generate: Record<string, unknown>;
        };
        return Object.keys(messages.generate)
          .filter((k) => k.startsWith("modelJob"))
          .sort()
          .join(",");
      }),
    );
    expect(new Set(perLocale).size, `job keys differ between locales: ${perLocale}`).toBe(1);
  });
});

describe("gemini-omni", () => {
  const model = getVideoModel("gemini-omni");

  it("is in the catalogue under its own id", () => {
    expect(model.id).toBe("gemini-omni");
  });

  it("points at Google's namespace on fal, not fal-ai/", () => {
    expect(model.falEndpoint).toBe("google/gemini-omni-flash/v1.1/text-to-video");
  });

  it("defaults to the duration fal itself defaults to", () => {
    // The catalogue's rule: the entry marked default must match the
    // endpoint's own default, which fal's schema gives as 8.
    expect(getDefaultDurationSeconds(model)).toBe(8);
  });

  it("stays inside fal's 3-10 second range", () => {
    // The shortest ceiling in the catalogue. actions.ts refuses any
    // duration this list does not carry, so a 15s request cannot reach an
    // endpoint that would reject it.
    for (const d of model.durations) {
      expect(d.seconds).toBeGreaterThanOrEqual(3);
      expect(d.seconds).toBeLessThanOrEqual(10);
    }
  });

  it("weighs every duration at ceil(cost / $0.28) on the 720p rate", () => {
    for (const d of model.durations) {
      expect(d.creditWeight).toBe(
        Math.ceil((0.1 * d.seconds) / COST_BASIS_USD_PER_CREDIT),
      );
    }
    expect(model.durations.map((d) => [d.seconds, d.creditWeight])).toEqual([
      [5, 2],
      [8, 3],
      [10, 4],
    ]);
  });

  it("prices 1080p and 4K off their own per-second rates", () => {
    expect(videoResolutionOffers("gemini-omni").map((o) => o.value)).toEqual(["1080p", "4k"]);
    for (const seconds of [5, 8, 10]) {
      expect(resolutionCreditWeight("gemini-omni", "1080p", seconds)).toBe(
        Math.ceil((0.15 * seconds) / COST_BASIS_USD_PER_CREDIT),
      );
      expect(resolutionCreditWeight("gemini-omni", "4k", seconds)).toBe(
        Math.ceil((0.3 * seconds) / COST_BASIS_USD_PER_CREDIT),
      );
    }
  });

  it("undercuts Veo, which is the reason it is featured", () => {
    expect(model.costPerSecondUsd).toBeLessThan(getVideoModel("veo").costPerSecondUsd);
  });

  it("leaves the whole catalogue loss-free", () => {
    expect(pricingAudit()).toEqual([]);
  });
});

describe("gemini-omni identity lane", () => {
  it("binds identity by citation, not by first frame", async () => {
    // The reason this model routes to reference-to-video rather than its
    // equally-priced image-to-video sibling: a first-frame lane opens the
    // clip frozen in the photographed pose, which fal.ts can only soften.
    // If this ever flips back to "first-frame", the branch and this row
    // have drifted apart.
    const { MODEL_CAPABILITIES } = await import("./send-plan");
    expect(MODEL_CAPABILITIES["gemini-omni"].identity.mechanism).toBe("citation");
    expect(MODEL_CAPABILITIES["gemini-omni"].identity.required).toBe(false);
  });

  it("takes several photos, so baselineIdentityReferences does not decline it", async () => {
    // max > 1 is the switch that makes a multi-photo character send all its
    // references instead of just the anchor.
    const { baselineIdentityReferences } = await import("./send-plan");
    const gallery = ["a.jpg", "b.jpg", "c.jpg", "d.jpg", "e.jpg", "f.jpg"];
    expect(baselineIdentityReferences("gemini-omni", gallery)).toHaveLength(4);
  });
});
