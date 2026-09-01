import { describe, expect, it } from "vitest";
import {
  buildDirectorInstructions,
  fanoutCreditCost,
  MAX_SCENE_SHOTS,
  MAX_SHOT_PROMPT_CHARS,
  MIN_SCENE_SHOTS,
  normaliseScenePlan,
  scenePlanCreditCost,
  scenePlanSeconds,
  sceneVocabulary,
  shotPresetIds,
  type ScenePlan,
} from "./scene-plan";
import { getCinemaPreset } from "./cinema-presets";

// Cinema Studio's shot list (2026-09-01).
//
// Everything here is about one boundary: a language model returns JSON, and
// that JSON becomes N paid renders. The tests are therefore mostly about what
// happens when the director model returns something wrong — invented preset
// ids, a duration the endpoint would reject, twenty shots, the wrong types.
// None of it may reach a render, and none of it may throw.

const OPTS = { allowedSeconds: [5, 10, 15] as const, defaultSeconds: 5 };

const good = {
  title: "Rooftop confrontation",
  lookPresetId: "noir",
  shots: [
    { prompt: "She steps out of the stairwell door onto the wet rooftop.", movePresetId: "crane-reveal", seconds: 5 },
    { prompt: "Close on her face as she recognises him across the roof.", movePresetId: "crash-zoom", seconds: 5 },
    { prompt: "The two of them circle each other near the ledge.", movePresetId: "orbit", seconds: 10 },
  ],
};

describe("sceneVocabulary", () => {
  it("offers only proven presets, split by category", () => {
    const { moves, looks } = sceneVocabulary();
    expect(moves.length).toBeGreaterThan(0);
    expect(looks.length).toBeGreaterThan(0);
    for (const p of [...moves, ...looks]) {
      expect(p.proven, `${p.id} is a hidden draft`).not.toBe(false);
      // Everything offered must survive the resolver the render path uses.
      expect(getCinemaPreset(p.id)).not.toBeNull();
    }
    expect(moves.every((p) => p.category === "move")).toBe(true);
    expect(looks.every((p) => p.category === "look")).toBe(true);
  });

  it("REGRESSION: never offers a drafted preset the renderer would refuse", () => {
    // getCinemaPreset returns null for proven:false, so a director told about
    // one would produce shots that silently lose their look.
    const ids = [...sceneVocabulary().moves, ...sceneVocabulary().looks].map((p) => p.id);
    expect(ids).not.toContain("fx-explosion");
    expect(ids).not.toContain("candlelight");
  });
});

describe("normaliseScenePlan", () => {
  it("accepts a well-formed plan", () => {
    const plan = normaliseScenePlan(good, OPTS)!;
    expect(plan.title).toBe("Rooftop confrontation");
    expect(plan.lookPresetId).toBe("noir");
    expect(plan.shots).toHaveLength(3);
    expect(plan.shots[2].seconds).toBe(10);
  });

  it("MONEY: caps the shot count, however many the director returns", () => {
    const many = { ...good, shots: Array.from({ length: 40 }, () => good.shots[0]) };
    expect(normaliseScenePlan(many, OPTS)!.shots).toHaveLength(MAX_SCENE_SHOTS);
  });

  it("MONEY: refuses a duration the model cannot render", () => {
    // A length the endpoint would reject costs a full round trip and a 422.
    // Anything not in the allowed list falls back to the default.
    const odd = { ...good, shots: [{ ...good.shots[0], seconds: 7 }, { ...good.shots[1], seconds: 999 }] };
    const plan = normaliseScenePlan(odd, OPTS)!;
    expect(plan.shots.map((s) => s.seconds)).toEqual([5, 5]);
  });

  it("MONEY: drops a shot with no prompt rather than rendering an empty one", () => {
    const empty = {
      ...good,
      shots: [good.shots[0], { prompt: "   ", movePresetId: "orbit", seconds: 5 }, good.shots[2]],
    };
    expect(normaliseScenePlan(empty, OPTS)!.shots).toHaveLength(2);
  });

  it("drops invented preset ids instead of passing them through", () => {
    const invented = {
      ...good,
      lookPresetId: "kubrick-zoom",
      shots: [
        { ...good.shots[0], movePresetId: "not-a-real-preset" },
        { ...good.shots[1], movePresetId: "orbit" },
      ],
    };
    const plan = normaliseScenePlan(invented, OPTS)!;
    expect(plan.lookPresetId).toBeNull();
    expect(plan.shots[0].movePresetId).toBeNull();
    expect(plan.shots[1].movePresetId).toBe("orbit");
  });

  it("REGRESSION: refuses a look in the move slot", () => {
    // resolvePresetBlocks keeps one preset PER CATEGORY, so a look sitting in
    // the move slot would be de-duplicated against the scene look and the
    // shot would end up with no camera direction at all — a silent quality
    // loss with no error anywhere.
    const swapped = { ...good, shots: [{ ...good.shots[0], movePresetId: "noir" }, good.shots[1]] };
    expect(normaliseScenePlan(swapped, OPTS)!.shots[0].movePresetId).toBeNull();
  });

  it("refuses a move in the look slot for the same reason", () => {
    const swapped = { ...good, lookPresetId: "crash-zoom" };
    expect(normaliseScenePlan(swapped, OPTS)!.lookPresetId).toBeNull();
  });

  it("refuses anything that is not a scene", () => {
    for (const junk of [null, undefined, 42, "a scene", [], {}, { shots: "three" }]) {
      expect(normaliseScenePlan(junk, OPTS), String(junk)).toBeNull();
    }
    // One shot is the ordinary product, not a scene.
    expect(normaliseScenePlan({ ...good, shots: [good.shots[0]] }, OPTS)).toBeNull();
    expect(MIN_SCENE_SHOTS).toBe(2);
  });

  it("survives malformed shot entries without throwing", () => {
    const nasty = {
      title: 123,
      lookPresetId: { id: "noir" },
      shots: [null, "shot two", 7, good.shots[0], { prompt: 5 }, good.shots[1]],
    };
    const plan = normaliseScenePlan(nasty, OPTS)!;
    expect(plan.shots).toHaveLength(2);
    expect(plan.title).toBe("Untitled scene");
    expect(plan.lookPresetId).toBeNull();
  });

  it("caps a runaway prompt", () => {
    const huge = { ...good, shots: [{ ...good.shots[0], prompt: "x".repeat(5000) }, good.shots[1]] };
    expect(normaliseScenePlan(huge, OPTS)!.shots[0].prompt.length).toBe(MAX_SHOT_PROMPT_CHARS);
  });
});

describe("shotPresetIds", () => {
  it("sends the shot's move and the scene's look together", () => {
    const plan = normaliseScenePlan(good, OPTS)!;
    expect(shotPresetIds(plan, plan.shots[0])).toEqual(["crane-reveal", "noir"]);
  });

  it("holds ONE look across every shot — the consistency rule", () => {
    // A scene that re-graded itself every shot would read as a showreel.
    const plan = normaliseScenePlan(good, OPTS)!;
    const looks = plan.shots.map((s) => shotPresetIds(plan, s)[1]);
    expect(new Set(looks).size).toBe(1);
  });

  it("omits what the director didn't choose", () => {
    const plan: ScenePlan = {
      title: "t",
      lookPresetId: null,
      shots: [{ prompt: "p", movePresetId: null, seconds: 5 }],
    };
    expect(shotPresetIds(plan, plan.shots[0])).toEqual([]);
  });
});

describe("cost", () => {
  it("charges every shot, through the same function the composer quotes", () => {
    const plan = normaliseScenePlan(good, OPTS)!;
    // Seedance 2.0's real ladder: 9 credits at 5s, 17 at 10s.
    const weight = (s: number) => (s === 5 ? 9 : s === 10 ? 17 : 26);
    expect(scenePlanCreditCost(plan, weight)).toBe(9 + 9 + 17);
    expect(scenePlanSeconds(plan)).toBe(20);
  });

  it("MONEY: the worst case a single click can reach is bounded and knowable", () => {
    const many = { ...good, shots: Array.from({ length: 99 }, () => ({ ...good.shots[0], seconds: 15 })) };
    const plan = normaliseScenePlan(many, OPTS)!;
    // Six shots, never more — whatever the director asked for.
    expect(plan.shots).toHaveLength(MAX_SCENE_SHOTS);
    expect(scenePlanCreditCost(plan, () => 26)).toBe(MAX_SCENE_SHOTS * 26);
  });
});

describe("buildDirectorInstructions", () => {
  it("offers only ids the renderer will accept", () => {
    const brief = buildDirectorInstructions({
      idea: "she finds the letter",
      characterName: "Eva",
      shotCount: 3,
      allowedSeconds: [5, 10],
    });
    // Every id named in the brief must resolve — otherwise the director is
    // being invited to pick something getCinemaPreset refuses.
    const ids = [...sceneVocabulary().moves, ...sceneVocabulary().looks].map((p) => p.id);
    for (const id of ids) expect(brief).toContain(id);
    expect(brief).not.toContain("fx-explosion");
    expect(brief).not.toContain("candlelight");
    expect(brief).toContain("Eva");
    expect(brief).toContain("exactly 3 shots");
  });

  it("MONEY: clamps the shot count inside the brief itself", () => {
    // Defence in depth: normaliseScenePlan caps the RESULT, and the brief
    // never asks for more than the cap in the first place.
    const big = buildDirectorInstructions({ idea: "x", characterName: null, shotCount: 99, allowedSeconds: [5] });
    expect(big).toContain(`exactly ${MAX_SCENE_SHOTS} shots`);
    const small = buildDirectorInstructions({ idea: "x", characterName: null, shotCount: 0, allowedSeconds: [5] });
    expect(small).toContain(`exactly ${MIN_SCENE_SHOTS} shots`);
  });

  it("names the subject generically when no character is cast", () => {
    const brief = buildDirectorInstructions({ idea: "x", characterName: null, shotCount: 2, allowedSeconds: [5] });
    expect(brief).toContain("the subject");
  });
});

describe("fanoutCreditCost", () => {
  it("charges every render in the fan-out", () => {
    expect(fanoutCreditCost(9, 5)).toBe(45);
    expect(fanoutCreditCost(1, 3)).toBe(3);
  });

  it("REGRESSION: a fan-out is never quoted at one render's price", () => {
    // The live defect this exists to kill: the composer showed
    // selectedCreditCost (one render) while the server charged
    // angleIds.length * creditWeight.
    expect(fanoutCreditCost(9, 5)).not.toBe(9);
  });

  it("survives junk without inventing a charge", () => {
    for (const bad of [NaN, Infinity, -1, -0.5]) {
      expect(fanoutCreditCost(bad, 5), String(bad)).toBe(0);
      expect(fanoutCreditCost(9, bad), String(bad)).toBe(0);
    }
    expect(fanoutCreditCost(9.7, 3)).toBe(27);
  });

  it("agrees with the per-shot sum when every shot is the same length", () => {
    // scenePlanCreditCost sums per-shot weights; for a uniform scene the two
    // must produce the same number, or the composer and server disagree.
    const plan = normaliseScenePlan(
      { ...good, shots: [good.shots[0], good.shots[1]] },
      { allowedSeconds: [5], defaultSeconds: 5 },
    )!;
    expect(scenePlanCreditCost(plan, () => 9)).toBe(fanoutCreditCost(9, plan.shots.length));
  });
});
