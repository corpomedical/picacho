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
  recastImageRoom,
  recastReferenceCostUsd,
  recastRestageSeconds,
  RECAST_JOB_MAX_SECONDS,
  recastImageSendsAsIs,
  recastImageUsable,
  recastMissing,
  RECAST_MAX_IMAGES,
  recastProviderCostUsd,
  recastRequestBody,
  RECAST_WORLD_EDIT_STRENGTH,
  recastSourcePath,
  recastTakesCast,
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

  it("are four jobs, each offering only engines that were proven on it", () => {
    expect(RECAST_JOB_ORDER).toEqual(["scene", "restage", "motion", "world"]);
    expect(recastEnginesOf("restage").map((e) => RECAST_ENGINES[e].tier)).toEqual(["full", "lite"]);
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
    // Only Restyle takes neither characters nor images: its look is words.
    expect(recastTakesCast("scene")).toBe(true);
    expect(recastTakesCast("motion")).toBe(true);
    expect(recastTakesCast("world")).toBe(false);
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
    // Kling O3 Edit's own limit is 3–15.05 s; past it the take is rendered in
    // chained parts (lib/generations/chain.ts) up to the chain's 30 s.
    expect(recastEngineFits("kling-edit", { seconds: 15.02 })).toBe(true);
    expect(recastEngineFits("kling-edit", { seconds: 16 })).toBe(true);
    expect(recastEngineFits("kling-edit", { seconds: 30.04 })).toBe(true);
    expect(recastEngineFits("kling-edit", { seconds: 31 })).toBe(false);
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

// NOT LOCKED TO CHARACTERS (2026-09-19, the operator: "make it that the user
// can upload an image and that they can only use prompt to change whatever
// they want. Do not lock it just on characters").
describe("what a take must be given", () => {
  const none = { characters: 0, images: 0, words: false };

  it("takes Into the clip on a character OR on words alone — images ride with either", () => {
    expect(recastMissing("scene", { ...none, characters: 1 })).toBeNull();
    expect(recastMissing("scene", { ...none, words: true })).toBeNull();
    expect(recastMissing("scene", { ...none, images: 2, words: true })).toBeNull();
    // An image says nothing about what to do with it; words or a character must.
    expect(recastMissing("scene", { ...none, images: 1 })).toBe("words");
    expect(recastMissing("scene", none)).toBe("words");
  });

  it("brings a picture to life: a character's photo or one of the person's own images", () => {
    expect(recastMissing("motion", { ...none, characters: 1 })).toBeNull();
    expect(recastMissing("motion", { ...none, images: 1 })).toBeNull();
    // Words cannot become a picture.
    expect(recastMissing("motion", { ...none, words: true })).toBe("picture");
  });

  it("leaves Restyle as it was: its look is words, with a default of its own", () => {
    expect(recastMissing("world", none)).toBeNull();
  });
});

// RESTAGE (2026-09-20, "the engine we are using is 100% not fit for the job"
// → "Build restage into mystique"). The clip is a reference, not a canvas:
// the camera and the staging are directed, the performance is not kept.
describe("restage", () => {
  const clipUrl = "https://x/clip.mp4";

  it("is priced at its own seconds AND its references — fal's own table", () => {
    // "$0.08 per second at 768p"; references: 4,096 tokens free, then $0.02
    // per 1,000; a 16:9 reference video is 102,816 tokens at 15 s / 768p and
    // an image at its dearest shape 1,824.
    expect(RECAST_ENGINES["h3-768"].usdPerBilledSecond).toBe(0.08);
    expect(RECAST_ENGINES["h3-480"].usdPerBilledSecond).toBe(0.05);
    // Nothing to pay while the references fit in the allowance.
    expect(recastReferenceCostUsd({ seconds: 0, resolution: "720p", images: 2 })).toBe(0);
    // Five seconds at 768p with four photos: over the published $0.56 for the
    // clip alone, and never under it.
    const five = recastReferenceCostUsd({ seconds: 5, resolution: "720p", images: 4 });
    expect(five).toBeGreaterThan(0.56);
    expect(five).toBeLessThan(0.8);
    // The whole take, quoted: 5 s at 768p with four photos ≈ $0.40 + $0.70.
    expect(recastProviderCostUsd("h3-768", { seconds: 5, frames: 120 }, 4)).toBeCloseTo(0.4 + five, 6);
    expect(recastCreditCost("h3-768", { seconds: 5, frames: 120 }, 4)).toBe(5);
    // The 2026-09-20 probe on the operator's own window billed about $1.07 for
    // exactly this shape; the quote takes the worst per-second reference rate
    // in the table, so it sits just above what was billed and never under it.
    const quoted = recastProviderCostUsd("h3-768", { seconds: 5, frames: 120 }, 4);
    expect(quoted).toBeGreaterThan(1.07);
    expect(quoted).toBeLessThan(1.25);
  });

  it("renders its own 5–15 whole seconds, whatever the window is", () => {
    expect(recastRestageSeconds(3)).toBe(5);
    expect(recastRestageSeconds(7.4)).toBe(7);
    expect(recastRestageSeconds(30)).toBe(15);
    expect(RECAST_JOB_MAX_SECONDS.restage).toBe(15);
  });

  it("sends the clip as Video 1 and every photo as an Image, and keeps no sound", () => {
    const body = recastRequestBody("h3-768", {
      clipUrl,
      characterImageUrl: "https://x/eva1.jpg",
      morePhotoUrls: ["https://x/eva2.jpg", "https://x/eva3.jpg"],
      imageUrls: ["https://x/coat.jpg"],
      brief: "Video 1 is the scene to build on.",
      clip: { seconds: 12.2 },
    });
    expect(body).toEqual({
      prompt: "Video 1 is the scene to build on.",
      prompt_expansion_mode: "balanced",
      reference_video_urls: [clipUrl],
      reference_image_urls: ["https://x/eva1.jpg", "https://x/eva2.jpg", "https://x/eva3.jpg", "https://x/coat.jpg"],
      duration: 12,
      resolution: "768P",
      aspect_ratio: "adaptive",
    });
    expect(RECAST_ENGINES["h3-768"].keepsSound).toBe(false);
    expect(recastRequestBody("h3-480", { clipUrl, brief: "x", clip: { seconds: 5 } }).resolution).toBe("480P");
  });

  it("never sends more references than the engine takes", () => {
    const many = Array.from({ length: 12 }, (_, i) => `https://x/${i}.jpg`);
    const body = recastRequestBody("h3-768", { clipUrl, imageUrls: many, brief: "x", clip: { seconds: 5 } });
    expect((body.reference_image_urls as string[]).length).toBeLessThanOrEqual(9);
  });

  it("asks for the same as Into the clip: someone in it, or words", () => {
    expect(recastMissing("restage", { characters: 1, images: 0, words: false })).toBeNull();
    expect(recastMissing("restage", { characters: 0, images: 0, words: true })).toBeNull();
    expect(recastMissing("restage", { characters: 0, images: 0, words: false })).toBe("words");
  });
});

describe("the images a person adds", () => {
  it("fits inside the four references Kling O3 Edit takes with a character cast", () => {
    // Its schema: "Maximum 4 total (elements + reference images) when using video".
    expect(RECAST_MAX_IMAGES + 1).toBeLessThanOrEqual(4);
  });

  it("takes any shape both engines take, and nothing redrawing could not fix", () => {
    expect(recastImageUsable({ width: 1080, height: 1350 })).toBe(true);
    expect(recastImageUsable({ width: 340, height: 340 })).toBe(true);
    // Under 340 px on a side (V3 Motion Control's floor; O3 Edit's is 300).
    expect(recastImageUsable({ width: 339, height: 800 })).toBe(false);
    // 0.4–2.5 wide for its height, both engines' own bounds.
    expect(recastImageUsable({ width: 2500, height: 1000 })).toBe(true);
    expect(recastImageUsable({ width: 2600, height: 1000 })).toBe(false);
    expect(recastImageUsable({ width: 400, height: 1001 })).toBe(false);
    expect(recastImageUsable({ width: 0, height: 0 })).toBe(false);
  });

  it("sends an upright JPEG or PNG as it is, and redraws everything else", () => {
    const photo = { format: "jpeg", bytes: 2_000_000, width: 1200, height: 1600, orientation: 1 };
    expect(recastImageSendsAsIs(photo)).toBe(true);
    expect(recastImageSendsAsIs({ ...photo, format: "png" })).toBe(true);
    // A WebP, a phone photo stored sideways, a file over 10 MB, a side over 3850 px.
    expect(recastImageSendsAsIs({ ...photo, format: "webp" })).toBe(false);
    expect(recastImageSendsAsIs({ ...photo, orientation: 6 })).toBe(false);
    expect(recastImageSendsAsIs({ ...photo, bytes: 11 * 1024 * 1024 })).toBe(false);
    expect(recastImageSendsAsIs({ ...photo, width: 4000, height: 3000 })).toBe(false);
  });
});

describe("the request, with images and without anyone", () => {
  const clipUrl = "https://x/clip.mp4";
  const face = "https://x/face.jpg";
  const more = ["https://x/a.jpg", "https://x/b.jpg", "https://x/c.jpg"];
  const added = ["https://x/one.jpg", "https://x/two.jpg", "https://x/three.jpg"];

  it("is the clip and the words alone when nobody and nothing is cast — a plain edit", () => {
    const body = recastRequestBody("kling-edit", { clipUrl, brief: "Change @Video1 exactly as the direction below says." });
    expect(body).toEqual({ video_url: clipUrl, prompt: "Change @Video1 exactly as the direction below says.", keep_audio: true });
  });

  it("carries the person's images as @Image1… when no character is cast", () => {
    expect(recastRequestBody("kling-edit", { clipUrl, imageUrls: added, brief: "x" }).image_urls).toEqual(added);
  });

  it("puts the images after a one-photo character's own, and after an element, inside four in all", () => {
    const onePhoto = recastRequestBody("kling-edit", { clipUrl, characterImageUrl: face, imageUrls: added, brief: "x" });
    expect(onePhoto.image_urls).toEqual([face, ...added]);
    expect(onePhoto).not.toHaveProperty("elements");
    const bound = recastRequestBody("kling-edit", { clipUrl, characterImageUrl: face, morePhotoUrls: more, imageUrls: added, brief: "x" });
    expect(bound.elements).toEqual([{ frontal_image_url: face, reference_image_urls: more }]);
    expect(bound.image_urls).toEqual(added);
    // Never more than four references: one element plus three images at most.
    expect((bound.image_urls as string[]).length + (bound.elements as unknown[]).length).toBeLessThanOrEqual(4);
  });

  it("brings the person's own image to life in Photo to life", () => {
    const body = recastRequestBody("kling-pro", { clipUrl, characterImageUrl: added[0] });
    expect(body.image_url).toBe(added[0]);
    expect(body).not.toHaveProperty("image_urls");
  });

  it("binds several characters in ONE take, each to their own photos, in cast order", () => {
    // 2026-09-19: "Selecting two characters still makes two videos separately".
    const eva = { front: "https://x/eva.jpg", more: ["https://x/eva2.jpg", "https://x/eva3.jpg"] };
    const anubis = { front: "https://x/anubis.jpg", more: [] };
    const kai = { front: "https://x/kai.jpg", more: ["https://x/kai2.jpg"] };
    const body = recastRequestBody("kling-edit", { clipUrl, ensemble: [eva, anubis, kai], imageUrls: added, brief: "x" });
    // @Element1 Eva, @Element2 Kai — the ones with more angles, in order.
    expect(body.elements).toEqual([
      { frontal_image_url: eva.front, reference_image_urls: eva.more },
      { frontal_image_url: kai.front, reference_image_urls: kai.more },
    ]);
    // @Image1 Anubis (one photo), then the added images in the room that is left.
    expect(body.image_urls).toEqual([anubis.front, added[0]]);
    expect((body.elements as unknown[]).length + (body.image_urls as string[]).length).toBe(4);
  });

  it("leaves images the room the characters in a take do not take", () => {
    expect(recastImageRoom(0)).toBe(3);
    expect(recastImageRoom(1)).toBe(3);
    expect(recastImageRoom(2)).toBe(2);
    expect(recastImageRoom(3)).toBe(1);
    expect(recastImageRoom(4)).toBe(0);
  });

  it("gives Restyle no images, whatever is passed", () => {
    expect(recastRequestBody("luma-720", { clipUrl, imageUrls: added, brief: "Rain" })).not.toHaveProperty("image_urls");
  });
});
