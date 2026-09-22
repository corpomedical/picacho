import { describe, expect, it } from "vitest";
import { buildSetShotPrompt, stripSetShotScaffold } from "./set-shot-prompt";
import { DEFAULT_SET_RIG, RIG_FORMAT_ORDER, normaliseSetRig, rigSentences } from "./rig";
import { gazeWords } from "./people";
import type { SetLayout } from "./set-spec";

// The whole config space of a still's prompt, stripped clean (2026-09-19,
// the launch-day failed-render hunt): the brand-rule check reads a set shot
// with Picacho's scaffold taken out, and a sentence the strip does not know
// hands the classifier Picacho's words as the person's. The blades sentence
// leaked exactly this way on every shot with a stop and blades set. This
// sweep builds every combination the page can send and asserts nothing but
// Astra's description and the person's direction survives.

const DESC = "A rain-dark racing circuit at golden hour.";
const spec = { objects: [{ shape: "box", size: [1.9, 0.5, 3.7] }] } as never;
const mark = { x: 0, z: 0, facingDeg: 0 };
const CAM = { position: [0, 1.6, 5] as [number, number, number], target: [0, 1, 0] as [number, number, number], fovDeg: 40 };

describe("the strip, across every prompt the page can build", () => {
  it("leaves Astra's description and the person's direction, and nothing else", () => {
    const gazes = ["", gazeWords({ at: "camera" }, spec, mark), gazeWords({ at: "object", index: 0 }, spec, mark), gazeWords({ at: "point", x: 5, z: 0 }, spec, mark)];
    const layouts: (Pick<SetLayout, "mark" | "camera"> | null)[] = [
      null,
      { mark: { x: 0, z: 0, facingDeg: 180 }, camera: CAM },
      { mark: { x: 0, z: 0, facingDeg: 90 }, camera: CAM },
      { mark: { x: 0, z: 0, facingDeg: 0 }, camera: CAM },
    ];
    let runs = 0;
    const leaks: string[] = [];
    // Of the outer loops, the builder is handed only the band, the rig's
    // sentences and whether the rig lights and the sketch is lifted. Half of
    // their 48 settings hand it exactly what another already did (with the
    // rig off, both squeezes and the four banded formats say the same), so
    // they would build and strip the same 128 prompts again: each setting
    // the builder can tell apart is swept once: the same 3,072 prompts. All
    // 6,144 combinations, half of them repeats, took 0.2–1.0 s alone and up
    // to 8.5 s with three full suites running at once (2026-09-22); the
    // sweep now takes 60 ms warm.
    const swept = new Set<string>();
    const ctx = { distanceM: 5.2, fovDeg: 40, cameraBearingDeg: 0, push: [] };
    for (const format of RIG_FORMAT_ORDER)
      for (const squeeze of [1, 2])
        for (const lifted of [false, true])
          for (const rigOn of [false, true]) {
            const rig = normaliseSetRig({
              ...DEFAULT_SET_RIG,
              format,
              squeeze,
              lens: "anamorphic",
              stop: rigOn ? 2 : null,
              blades: rigOn ? 11 : null,
              light: rigOn ? { scheme: "golden-hour", bearingDeg: 40, heightDeg: 20 } : null,
              palette: rigOn ? "amber-hour" : null,
              stock: rigOn ? "film35" : null,
            });
            const sentences = rigOn ? rigSentences(rig, ctx) : [];
            const band = format === "square" ? null : format === "vertical" ? ("columns" as const) : ("rows" as const);
            const handed = JSON.stringify([band, sentences, rigOn, lifted]);
            if (swept.has(handed)) continue;
            swept.add(handed);
            for (const look of [null, {}])
              for (const sourcePhoto of [false, true])
                for (const gaze of gazes)
                  for (const layout of layouts)
                    for (const direction of ["", "she leans on the car"]) {
                      const prompt = buildSetShotPrompt({
                        description: DESC,
                        direction,
                        lifted,
                        layout,
                        look,
                        sourcePhoto,
                        rig: sentences,
                        rigLight: rigOn,
                        band,
                        gaze,
                      });
                      const left = stripSetShotScaffold(prompt);
                      const expected = direction ? `${DESC} In this frame: ${direction}.` : DESC;
                      runs++;
                      if (left !== expected && leaks.length < 3) leaks.push(left.slice(0, 200));
                    }
          }
    // 3,072 prompts, every one of them different.
    expect(runs).toBeGreaterThan(3000);
    expect(leaks, leaks.join("\n---\n")).toEqual([]);
  });

  it("strips each blade count's own sentence", () => {
    for (const n of [5, 7, 9, 11]) {
      const rig = normaliseSetRig({ ...DEFAULT_SET_RIG, stop: 2, blades: n });
      const prompt = buildSetShotPrompt({ description: DESC, direction: "", rig: rigSentences(rig, { distanceM: 5.2, fovDeg: 40, cameraBearingDeg: 0, push: [] }), rigLight: false });
      expect(prompt).toContain(`The iris has ${n} blades`);
      expect(stripSetShotScaffold(prompt)).toBe(DESC);
    }
  });
});
