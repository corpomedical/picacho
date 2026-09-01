import { describe, expect, it } from "vitest";

// Cinema Studio's copy, in every language (2026-09-01).
//
// The composer reads these unconditionally — a key missing from one locale
// renders `undefined` in that language only, which is exactly the class of
// bug an English-speaking reviewer never sees. The same guard the featured
// model job lines got, for the same reason.

const LOCALES = ["en", "es", "pt", "it"] as const;

const SCENE_KEYS = [
  "sceneIdeaLabel",
  "sceneShotsLabel",
  "scenePlanAction",
  "scenePlanning",
  "sceneReplan",
  "sceneRender",
  "sceneCost",
  "sceneModeOnTitle",
  "sceneModeOffTitle",
] as const;

describe("scene copy", () => {
  it("exists, non-empty, in all four languages", async () => {
    for (const loc of LOCALES) {
      const messages = (await import(`../i18n/messages/${loc}`)).default as {
        generate: Record<string, unknown>;
      };
      for (const key of SCENE_KEYS) {
        const value = messages.generate[key];
        expect(typeof value, `${loc}.${key} is missing`).toBe("string");
        expect((value as string).trim().length, `${loc}.${key} is empty`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps every placeholder the composer substitutes", async () => {
    // formatMsg replaces {n}, {shots}, {seconds}, {credits}. A translation
    // that drops one renders the literal token — or silently loses the
    // price, which is the one number this panel exists to show.
    const required: Record<string, string[]> = {
      sceneRender: ["{n}"],
      sceneCost: ["{shots}", "{seconds}", "{credits}"],
    };
    for (const loc of LOCALES) {
      const messages = (await import(`../i18n/messages/${loc}`)).default as {
        generate: Record<string, string>;
      };
      for (const [key, tokens] of Object.entries(required)) {
        for (const token of tokens) {
          expect(messages.generate[key], `${loc}.${key} lost ${token}`).toContain(token);
        }
      }
    }
  });
});
