import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseRecastEngine,
  parseRecastSourcePath,
  RECAST_COST_BASIS_USD_PER_CREDIT,
  RECAST_ENGINE_ORDER,
  RECAST_ENGINES,
  RECAST_MODEL_IDS,
  recastBilledSeconds,
  recastClipProblem,
  recastContainerOf,
  recastCreditCost,
  recastEngineFits,
  recastEngineLabel,
  recastEngineOfModel,
  recastEnginesOf,
  recastProviderCostUsd,
  recastRequestBody,
  recastSourcePath,
  type RecastClip,
} from "./recast";

// The recast lane's contract, audited against the prices read from fal's
// model pages on 2026-09-17 and the ledger rows of the day's probe. Change
// a price and its test together.

const USER = "11111111-2222-3333-4444-555555555555";
const TAKE = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const clip = (over: Partial<RecastClip> = {}): RecastClip => ({
  seconds: 8,
  frames: 240,
  width: 1080,
  height: 1920,
  bytes: 12_000_000,
  ...over,
});

describe("the engines", () => {
  it("carry the prices read at source", () => {
    expect(RECAST_ENGINES["kling-pro"].usdPerBilledSecond).toBe(0.168);
    expect(RECAST_ENGINES["kling-std"].usdPerBilledSecond).toBe(0.126);
    expect(RECAST_ENGINES["wan-720"].usdPerBilledSecond).toBe(0.08);
    expect(RECAST_ENGINES["wan-480"].usdPerBilledSecond).toBe(0.04);
  });

  it("are two jobs with two engines each, the full one first", () => {
    expect(recastEnginesOf("scene")).toEqual(["wan-720", "wan-480"]);
    expect(recastEnginesOf("motion")).toEqual(["kling-pro", "kling-std"]);
    for (const mode of ["scene", "motion"] as const) {
      expect(recastEnginesOf(mode).map((e) => RECAST_ENGINES[e].tier)).toEqual(["full", "lite"]);
    }
  });

  it("record model ids that never carry the door's name", () => {
    expect(new Set(RECAST_MODEL_IDS).size).toBe(RECAST_ENGINE_ORDER.length);
    for (const id of RECAST_MODEL_IDS) {
      expect(id).toMatch(/^recast-/);
      expect(id).not.toMatch(/mystique/i);
    }
    expect(recastEngineOfModel("recast-wan-720")).toBe("wan-720");
    expect(recastEngineOfModel("kling")).toBeNull();
    expect(recastEngineLabel("recast-kling-pro")).toBe("Kling V3 Motion Control Pro");
    expect(recastEngineLabel(null)).toBeNull();
  });

  it("parse only their own names", () => {
    expect(parseRecastEngine("wan-480")).toBe("wan-480");
    expect(parseRecastEngine("toString")).toBeNull();
    expect(parseRecastEngine("__proto__")).toBeNull();
    expect(parseRecastEngine(7)).toBeNull();
  });

  it("use the catalogue's cost basis", () => {
    const catalogue = readFileSync(join(__dirname, "..", "generations", "providers", "video-models.ts"), "utf8");
    expect(catalogue).toContain(`export const COST_BASIS_USD_PER_CREDIT = ${RECAST_COST_BASIS_USD_PER_CREDIT};`);
  });
});

describe("what a take costs", () => {
  it("matches the ledger for the probe's clip: 3.0 s, 24 fps, 72 frames", () => {
    const probe = { seconds: 3, frames: 72 };
    // fal billed 3 units (Kling) and 4.5 units (Wan) for exactly this clip.
    expect(recastBilledSeconds("kling-pro", probe)).toBe(3);
    expect(recastBilledSeconds("wan-720", probe)).toBe(4.5);
    expect(recastProviderCostUsd("kling-pro", probe)).toBeCloseTo(0.504, 6);
    expect(recastProviderCostUsd("wan-720", probe)).toBeCloseTo(0.36, 6);
    expect(recastCreditCost("kling-pro", probe)).toBe(2);
    expect(recastCreditCost("wan-720", probe)).toBe(2);
    expect(recastCreditCost("wan-480", probe)).toBe(1);
  });

  it("prices Wan on frames, so 30 fps footage costs more than its seconds say", () => {
    const phone = { seconds: 10, frames: 300 };
    expect(recastBilledSeconds("wan-720", phone)).toBe(18.75);
    // 18.75 × $0.08 = $1.50 → 6 credits; Kling Pro 10 × $0.168 = $1.68 → 6.
    expect(recastCreditCost("wan-720", phone)).toBe(6);
    expect(recastCreditCost("wan-480", phone)).toBe(3);
    expect(recastCreditCost("kling-pro", phone)).toBe(6);
    expect(recastCreditCost("kling-std", phone)).toBe(5);
  });

  it("prices an unreadable frame count at 60 fps — never under", () => {
    expect(recastBilledSeconds("wan-720", { seconds: 4, frames: null })).toBe(15);
    expect(recastCreditCost("wan-720", { seconds: 4, frames: null })).toBeGreaterThanOrEqual(recastCreditCost("wan-720", { seconds: 4, frames: 120 }));
  });

  it("bills a phone's 2.97 s as three seconds, and never less than a credit", () => {
    expect(recastBilledSeconds("kling-std", { seconds: 2.97, frames: 89 })).toBe(3);
    expect(recastBilledSeconds("kling-std", { seconds: 3.04, frames: 91 })).toBe(3);
    expect(recastBilledSeconds("kling-std", { seconds: 3.4, frames: 102 })).toBe(4);
    expect(recastCreditCost("wan-480", { seconds: 3, frames: 48 })).toBe(1);
  });

  it("never sells a take under its provider cost", () => {
    for (const engine of RECAST_ENGINE_ORDER) {
      for (const c of [clip({ seconds: 3, frames: 72 }), clip(), clip({ seconds: 30, frames: 1800 })]) {
        expect(recastCreditCost(engine, c) * RECAST_COST_BASIS_USD_PER_CREDIT + 1e-9).toBeGreaterThanOrEqual(recastProviderCostUsd(engine, c));
      }
    }
  });
});

describe("the clip's limits", () => {
  it("takes 3–30 s, 340–3850 px, up to 50 MB", () => {
    expect(recastClipProblem(clip())).toBeNull();
    expect(recastClipProblem(clip({ seconds: 2.97 }))).toBeNull();
    expect(recastClipProblem(clip({ seconds: 2.5 }))).toBe("too-short");
    expect(recastClipProblem(clip({ seconds: 30.04 }))).toBeNull();
    expect(recastClipProblem(clip({ seconds: 31 }))).toBe("too-long");
    expect(recastClipProblem(clip({ bytes: 50 * 1024 * 1024 + 1 }))).toBe("too-big");
    expect(recastClipProblem(clip({ bytes: 0 }))).toBe("too-big");
    expect(recastClipProblem(clip({ width: 320, height: 568 }))).toBe("too-small");
    expect(recastClipProblem(clip({ width: 3840, height: 2160 }))).toBeNull();
    expect(recastClipProblem(clip({ width: 4096, height: 2160 }))).toBe("too-large");
    expect(recastClipProblem(clip({ seconds: NaN }))).toBe("too-short");
  });

  it("stops a scene take at 10 s and lets a motion take run to 30", () => {
    expect(recastEngineFits("wan-720", { seconds: 10.02 })).toBe(true);
    expect(recastEngineFits("wan-480", { seconds: 12 })).toBe(false);
    expect(recastEngineFits("kling-pro", { seconds: 30 })).toBe(true);
  });
});

describe("the source clip's path", () => {
  it("is the take's own id under the owner's folder, and reads back", () => {
    const path = recastSourcePath(USER, TAKE, "mov");
    expect(path).toBe(`${USER}/${TAKE}.mov`);
    expect(parseRecastSourcePath(path)).toEqual({ userId: USER, takeId: TAKE, container: "mov" });
  });

  it("refuses anything that is not exactly one of ours", () => {
    for (const bad of [
      `${USER}/../${TAKE}.mp4`,
      `${USER}/${TAKE}.webm`,
      `${USER}/${TAKE}.mp4/extra`,
      `/${USER}/${TAKE}.mp4`,
      `${USER}/nested/${TAKE}.mp4`,
      `${TAKE}.mp4`,
      "",
    ]) {
      expect(parseRecastSourcePath(bad), bad).toBeNull();
    }
  });

  it("knows MP4 and MOV and nothing else", () => {
    expect(recastContainerOf("video/mp4")).toBe("mp4");
    expect(recastContainerOf("video/quicktime")).toBe("mov");
    expect(recastContainerOf("video/webm")).toBeNull();
    expect(recastContainerOf("")).toBeNull();
  });
});

describe("the request each engine receives", () => {
  const input = { characterImageUrl: "https://x/face.jpg", clipUrl: "https://x/clip.mp4" };

  it("is the probe's Kling body: the clip's orientation, the clip's sound", () => {
    expect(recastRequestBody("kling-pro", input)).toEqual({
      image_url: input.characterImageUrl,
      video_url: input.clipUrl,
      character_orientation: "video",
      keep_original_sound: true,
    });
    expect(recastRequestBody("kling-std", input)).toEqual(recastRequestBody("kling-pro", input));
  });

  it("is the probe's Wan body, at the engine's own size", () => {
    expect(recastRequestBody("wan-720", input)).toEqual({ image_url: input.characterImageUrl, video_url: input.clipUrl, resolution: "720p" });
    expect(recastRequestBody("wan-480", input)).toEqual({ image_url: input.characterImageUrl, video_url: input.clipUrl, resolution: "480p" });
  });

  it("sends no prompt — there is no text here to gate", () => {
    for (const engine of RECAST_ENGINE_ORDER) expect(recastRequestBody(engine, input)).not.toHaveProperty("prompt");
  });
});
