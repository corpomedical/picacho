import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseRecastEngine,
  parseRecastSourcePath,
  RECAST_COST_BASIS_USD_PER_CREDIT,
  RECAST_ENGINE_ORDER,
  RECAST_ENGINES,
  RECAST_JOB_ORDER,
  RECAST_MODEL_IDS,
  recastBilledSeconds,
  recastClipProblem,
  recastContainerOf,
  recastCreditCost,
  recastEngineFits,
  recastEngineFor,
  recastEngineLabel,
  recastEngineOfModel,
  recastEnginesOf,
  recastLumaDuration,
  recastNeedsCharacter,
  recastProviderCostUsd,
  recastRequestBody,
  RECAST_WORLD_EDIT_STRENGTH,
  recastSourcePath,
  type RecastClip,
} from "./recast";

// The recast lane's contract, audited against the prices read from fal's
// model pages on 2026-09-17/18 and the ledger rows of the day's probes.
// Change a price and its test together.

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
    expect(RECAST_ENGINES["wan-scene-720"].usdPerBilledSecond).toBe(0.08);
    expect(RECAST_ENGINES["wan-scene-480"].usdPerBilledSecond).toBe(0.04);
    // Luma is sold in 5 s and 10 s slots: $1.08 and $2.16 at 720p, $0.72
    // and $1.44 at 540p — the same per-second number either way.
    expect(RECAST_ENGINES["luma-720"].usdPerBilledSecond * 5).toBeCloseTo(1.08, 6);
    expect(RECAST_ENGINES["luma-720"].usdPerBilledSecond * 10).toBeCloseTo(2.16, 6);
    expect(RECAST_ENGINES["luma-540"].usdPerBilledSecond * 5).toBeCloseTo(0.72, 6);
    expect(RECAST_ENGINES["luma-540"].usdPerBilledSecond * 10).toBeCloseTo(1.44, 6);
  });

  it("are three jobs, each offering only engines that were proven on it", () => {
    expect(RECAST_JOB_ORDER).toEqual(["scene", "motion", "world"]);
    // Into the clip is Kling O3 Edit alone since 2026-09-19: it held the
    // character through the operator's turn-away clip where Wan dissolved
    // them, and Happy Horse — the other engine that held — bills double its
    // page (recast.ts THE DISSOLVE).
    expect(recastEnginesOf("scene")).toEqual(["kling-edit"]);
    expect(recastEnginesOf("motion").map((e) => RECAST_ENGINES[e].tier)).toEqual(["full", "lite"]);
    expect(recastEnginesOf("world").map((e) => RECAST_ENGINES[e].tier)).toEqual(["full", "lite"]);
    for (const job of RECAST_JOB_ORDER) {
      expect(RECAST_ENGINES[recastEngineFor(job, "full")].job).toBe(job);
      // A job with one engine answers "lite" with that engine, never another job's.
      expect(RECAST_ENGINES[recastEngineFor(job, "lite")].job).toBe(job);
    }
    // Only the world job recasts nobody.
    expect(recastNeedsCharacter("scene")).toBe(true);
    expect(recastNeedsCharacter("motion")).toBe(true);
    expect(recastNeedsCharacter("world")).toBe(false);
  });

  it("record model ids that never carry the door's name", () => {
    // Every id ever recorded, retired ones too, so old takes still list.
    expect(new Set(RECAST_MODEL_IDS).size).toBe(Object.keys(RECAST_ENGINES).length);
    expect(RECAST_MODEL_IDS).toContain("recast-wan-720");
    expect(RECAST_MODEL_IDS).toContain("recast-kling-edit");
    for (const id of RECAST_MODEL_IDS) {
      expect(id).toMatch(/^recast-/);
      expect(id).not.toMatch(/mystique/i);
    }
    expect(recastEngineOfModel("recast-wan-720")).toBe("wan-scene-720");
    expect(recastEngineOfModel("kling")).toBeNull();
    expect(recastEngineLabel("recast-kling-pro")).toBe("Kling V3 Motion Control Pro");
    expect(recastEngineLabel(null)).toBeNull();
  });

  it("parse only their own names", () => {
    expect(parseRecastEngine("kling-edit")).toBe("kling-edit");
    // A retired engine is read back for History, but no new take starts on it.
    expect(parseRecastEngine("wan-scene-720")).toBeNull();
    expect(parseRecastEngine("wan-scene-480")).toBeNull();
    expect(recastEngineOfModel("recast-wan-480")).toBe("wan-scene-480");
    expect(parseRecastEngine("toString")).toBeNull();
    expect(parseRecastEngine("__proto__")).toBeNull();
    expect(parseRecastEngine(7)).toBeNull();
  });

  it("use the catalogue's cost basis", () => {
    const catalogue = readFileSync(join(__dirname, "..", "generations", "providers", "video-models.ts"), "utf8");
    expect(catalogue).toContain(`export const COST_BASIS_USD_PER_CREDIT = ${RECAST_COST_BASIS_USD_PER_CREDIT};`);
  });

  it("only promise direction and extra photos where the engine takes them", () => {
    // Read from the schemas 2026-09-17/18: Wan's endpoints have no prompt
    // field at all, and only Kling's motion control has `elements`.
    for (const e of ["kling-pro", "kling-std"] as const) {
      expect(RECAST_ENGINES[e].takesDirection, e).toBe(true);
      expect(RECAST_ENGINES[e].takesMorePhotos, e).toBe(true);
    }
    expect(RECAST_ENGINES["luma-720"].takesDirection).toBe(true);
    expect(RECAST_ENGINES["luma-720"].takesMorePhotos).toBe(false);
    for (const e of ["wan-scene-720", "wan-scene-480"] as const) {
      expect(RECAST_ENGINES[e].takesDirection, e).toBe(false);
      expect(RECAST_ENGINES[e].takesMorePhotos, e).toBe(false);
    }
  });
});

describe("what a take costs", () => {
  it("matches the ledger for the probe's clip: 3.0 s, 24 fps, 72 frames", () => {
    const probe = { seconds: 3, frames: 72 };
    // fal billed 3 units (Kling) and 4.5 units (Wan) for exactly this clip.
    expect(recastBilledSeconds("kling-pro", probe)).toBe(3);
    expect(recastBilledSeconds("wan-scene-720", probe)).toBe(4.5);
    expect(recastProviderCostUsd("kling-pro", probe)).toBeCloseTo(0.504, 6);
    expect(recastProviderCostUsd("wan-scene-720", probe)).toBeCloseTo(0.36, 6);
    expect(recastCreditCost("kling-pro", probe)).toBe(2);
    expect(recastCreditCost("wan-scene-720", probe)).toBe(2);
    expect(recastCreditCost("wan-scene-480", probe)).toBe(1);
    expect(recastCreditCost("kling-std", probe)).toBe(2);
  });

  it("prices Wan on frames, so 30 fps footage costs more than its seconds say", () => {
    const phone = { seconds: 10, frames: 300 };
    expect(recastBilledSeconds("wan-scene-720", phone)).toBe(18.75);
    expect(recastCreditCost("wan-scene-720", phone)).toBe(6);
    expect(recastCreditCost("wan-scene-480", phone)).toBe(3);
    expect(recastCreditCost("kling-pro", phone)).toBe(6);
    expect(recastCreditCost("kling-std", phone)).toBe(5);
  });

  it("prices the world job by its slot, not by the clip's length", () => {
    expect(recastLumaDuration({ seconds: 3 })).toBe("5s");
    expect(recastLumaDuration({ seconds: 5 })).toBe("5s");
    expect(recastLumaDuration({ seconds: 6 })).toBe("10s");
    // A 3 s clip still buys the 5 s slot, so it costs the same as a 5 s one.
    expect(recastCreditCost("luma-720", { seconds: 3, frames: 72 })).toBe(recastCreditCost("luma-720", { seconds: 5, frames: 120 }));
    expect(recastProviderCostUsd("luma-720", { seconds: 3, frames: 72 })).toBeCloseTo(1.08, 6);
    expect(recastCreditCost("luma-720", { seconds: 3, frames: 72 })).toBe(4);
    expect(recastCreditCost("luma-540", { seconds: 8, frames: 240 })).toBe(6);
  });

  it("prices an unreadable frame count at 60 fps — never under", () => {
    expect(recastBilledSeconds("wan-scene-720", { seconds: 4, frames: null })).toBe(15);
    expect(recastCreditCost("wan-scene-720", { seconds: 4, frames: null })).toBeGreaterThanOrEqual(
      recastCreditCost("wan-scene-720", { seconds: 4, frames: 120 }),
    );
  });

  it("bills a phone's 2.97 s as three seconds, and never less than a credit", () => {
    expect(recastBilledSeconds("kling-pro", { seconds: 2.97, frames: 89 })).toBe(3);
    expect(recastBilledSeconds("kling-pro", { seconds: 3.04, frames: 91 })).toBe(3);
    expect(recastBilledSeconds("kling-pro", { seconds: 3.4, frames: 102 })).toBe(4);
    expect(recastCreditCost("wan-scene-480", { seconds: 3, frames: 48 })).toBe(1);
  });

  it("never sells a take under its provider cost", () => {
    for (const engine of RECAST_ENGINE_ORDER) {
      for (const c of [clip({ seconds: 3, frames: 72 }), clip(), clip({ seconds: 30, frames: 1800 })]) {
        expect(recastCreditCost(engine, c) * RECAST_COST_BASIS_USD_PER_CREDIT + 1e-9, engine).toBeGreaterThanOrEqual(
          recastProviderCostUsd(engine, c),
        );
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

  it("gives each job its own ceiling", () => {
    // Kling O3 Edit's own limit, 3–15.05 s.
    expect(recastEngineFits("kling-edit", { seconds: 15.02 })).toBe(true);
    expect(recastEngineFits("kling-edit", { seconds: 16 })).toBe(false);
    expect(recastEngineFits("luma-720", { seconds: 12 })).toBe(false);
    expect(recastEngineFits("kling-pro", { seconds: 30 })).toBe(true);
    expect(recastEngineFits("kling-std", { seconds: 30 })).toBe(true);
  });
});

describe("the source clip's path", () => {
  it("is a clip id under the owner's folder, and reads back", () => {
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
  const base = { clipUrl: "https://x/clip.mp4", characterImageUrl: "https://x/face.jpg" };

  it("is the probe's Kling body, with the brief and the extra angles bound", () => {
    expect(recastRequestBody("kling-pro", base)).toEqual({
      image_url: base.characterImageUrl,
      video_url: base.clipUrl,
      character_orientation: "video",
      keep_original_sound: true,
    });
    const rich = recastRequestBody("kling-pro", {
      ...base,
      brief: "TASK\nReplace…",
      morePhotoUrls: ["https://x/a.jpg", "https://x/b.jpg", "https://x/c.jpg", "https://x/d.jpg"],
    });
    expect(rich.prompt).toBe("TASK\nReplace…");
    // One element, at most three extra angles — the schema's own limits.
    expect(rich.elements).toEqual([
      { frontal_image_url: base.characterImageUrl, reference_image_urls: ["https://x/a.jpg", "https://x/b.jpg", "https://x/c.jpg"] },
    ]);
  });

  it("binds no element when there is only the one photo to bind", () => {
    expect(recastRequestBody("kling-pro", { ...base, morePhotoUrls: [] })).not.toHaveProperty("elements");
  });

  it("is the probe's Kling O3 Edit body: the brief, the sound, and the character bound to several photos", () => {
    const more = ["https://x/a.jpg", "https://x/b.jpg", "https://x/c.jpg", "https://x/d.jpg"];
    const body = recastRequestBody("kling-edit", { ...base, morePhotoUrls: more, brief: "TASK\nReplace Person A in @Video1 with @Element1." });
    expect(body).toEqual({
      video_url: base.clipUrl,
      prompt: "TASK\nReplace Person A in @Video1 with @Element1.",
      keep_audio: true,
      // One element: the front photo plus at most three more angles — the
      // schema's own limit, and what held Eva through the turn (2026-09-19).
      elements: [{ frontal_image_url: base.characterImageUrl, reference_image_urls: more.slice(0, 3) }],
    });
  });

  it("gives a one-photo character to Kling O3 Edit as an image, because an element needs a second angle", () => {
    const body = recastRequestBody("kling-edit", { ...base, morePhotoUrls: [], brief: "Replace Person A in @Video1 with @Image1." });
    expect(body).not.toHaveProperty("elements");
    expect(body.image_urls).toEqual([base.characterImageUrl]);
  });

  it("is the probe's Wan body, which has nowhere to put a prompt", () => {
    expect(recastRequestBody("wan-scene-720", base)).toEqual({ image_url: base.characterImageUrl, video_url: base.clipUrl, resolution: "720p" });
    expect(recastRequestBody("wan-scene-480", base)).toEqual({ image_url: base.characterImageUrl, video_url: base.clipUrl, resolution: "480p" });
    for (const e of ["wan-scene-720", "wan-scene-480"] as const) {
      expect(recastRequestBody(e, { ...base, brief: "words" }), e).not.toHaveProperty("prompt");
    }
  });

  it("is the probe's Luma body: the brief as the world, and no character at all", () => {
    const body = recastRequestBody("luma-720", { clipUrl: base.clipUrl, brief: "Rain and neon", clip: { seconds: 8 } });
    expect(body).toEqual({
      video_url: base.clipUrl,
      prompt: "Rain and neon",
      resolution: "720p",
      duration: "10s",
      edit_strength: RECAST_WORLD_EDIT_STRENGTH,
    });
    expect(body).not.toHaveProperty("image_url");
    // fal refuses the pair outright ("auto_controls=true cannot be combined
    // with edit_strength"), which the 2026-09-18 probe learned the hard way.
    expect(body).not.toHaveProperty("auto_controls");
    // And it must ADHERE: at flex_2 the same request rewrote the performer
    // as well as the street, which is the one thing this job may not do.
    expect(RECAST_WORLD_EDIT_STRENGTH.startsWith("adhere")).toBe(true);
  });
});
