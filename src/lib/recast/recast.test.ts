import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CHAIN_LOOK_PLACEHOLDER } from "../generations/chain";
import {
  recastChainFits,
  recastCrowdSharesTake,
  parseRecastEngine,
  parseRecastSourcePath,
  parseRecastUploadPath,
  RECAST_COST_BASIS_USD_PER_CREDIT,
  RECAST_UPLOAD_ACCEPT,
  RECAST_UPLOAD_TYPES,
  recastFormatConverts,
  recastUploadFormatOf,
  recastUploadPath,
  RECAST_ENGINE_ORDER,
  RECAST_ENGINES,
  RECAST_JOB_ORDER,
  RECAST_MODEL_IDS,
  recastBilledSeconds,
  recastClipProblem,
  recastCodecSends,
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
  recastCastsTogether,
  recastRestageImageRoom,
  recastFitPrompt,
  RECAST_PROMPT_MAX_CHARS,
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

  it("starts a take on an MP4 or a MOV only — a file never converted cannot reach an engine", () => {
    expect(parseRecastSourcePath(`${USER}/${TAKE}.webm`)).toBeNull();
    expect(parseRecastSourcePath(`${USER}/${TAKE}.avi`)).toBeNull();
    expect(parseRecastSourcePath(`${USER}/${TAKE}.mp4`)).toEqual({ userId: USER, takeId: TAKE, container: "mp4" });
  });
});

// 2026-09-25, operator: "Tried uploading a video to recast and it failed
// because of file formats."
describe("what a person may upload", () => {
  const file = (name: string, type = "") => ({ name, type });

  it("knows MP4 and MOV as the takes' own, and does not convert them", () => {
    expect(recastUploadFormatOf(file("a.mp4", "video/mp4"))).toEqual({ format: "mp4", contentType: "video/mp4" });
    expect(recastUploadFormatOf(file("a.mov", "video/quicktime"))).toEqual({ format: "mov", contentType: "video/quicktime" });
    expect(recastFormatConverts("mp4")).toBe(false);
    expect(recastFormatConverts("mov")).toBe(false);
  });

  it("takes every common video format, and converts it", () => {
    const cases: [string, string, string][] = [
      ["clip.webm", "video/webm", "webm"],
      ["obs.mkv", "video/x-matroska", "mkv"],
      ["old.avi", "video/x-msvideo", "avi"],
      ["win.wmv", "video/x-ms-wmv", "wmv"],
      ["flash.flv", "video/x-flv", "flv"],
      ["phone.3gp", "video/3gpp", "3gp"],
      ["dvd.mpg", "video/mpeg", "mpg"],
      ["cam.ts", "video/mp2t", "ts"],
      ["clip.ogv", "video/ogg", "ogv"],
    ];
    for (const [name, type, format] of cases) {
      const got = recastUploadFormatOf(file(name, type));
      expect(got?.format, name).toBe(format);
      expect(recastFormatConverts(got!.format), name).toBe(true);
    }
  });

  it("knows a file by its name when the browser gives it no type, or a wrong one", () => {
    // Chrome on Windows and macOS gives an .mkv no type at all; others say octet-stream.
    expect(recastUploadFormatOf(file("Recording 2026-09-25.mkv"))).toEqual({ format: "mkv", contentType: "video/x-matroska" });
    expect(recastUploadFormatOf(file("GOPR0001.AVI", "application/octet-stream"))?.format).toBe("avi");
    // Windows' own names for camcorder files.
    expect(recastUploadFormatOf(file("00001.MTS", "model/vnd.mts"))?.format).toBe("ts");
    expect(recastUploadFormatOf(file("00002.m2ts", "video/vnd.dlna.mpeg-tts"))?.format).toBe("ts");
    // An .m4v is an MP4 by another name.
    expect(recastUploadFormatOf(file("export.m4v", "video/x-m4v"))).toEqual({ format: "mp4", contentType: "video/mp4" });
    expect(recastUploadFormatOf(file("clip.MOV"))).toEqual({ format: "mov", contentType: "video/quicktime" });
    // A type with parameters still reads.
    expect(recastUploadFormatOf(file("x", "video/webm;codecs=vp9"))?.format).toBe("webm");
  });

  it("still refuses what is not a video", () => {
    for (const f of [file("photo.jpg", "image/jpeg"), file("song.mp3", "audio/mpeg"), file("notes.txt", "text/plain"), file("noext"), file("")]) {
      expect(recastUploadFormatOf(f), f.name).toBeNull();
    }
  });

  it("uploads each format under one type, and the bucket admits exactly those", () => {
    // The browser's own name for the file never reaches storage.
    expect(recastUploadFormatOf(file("a.mkv", "video/matroska"))?.contentType).toBe("video/x-matroska");
    expect(new Set(RECAST_UPLOAD_TYPES).size).toBe(RECAST_UPLOAD_TYPES.length);
    // The SQL that admits them: pending until it runs, then filed under applied/<date>/.
    const root = join(__dirname, "../../../supabase");
    const candidates = [join(root, "pending/recast-formats.sql"), ...readdirSync(join(root, "applied")).map((d) => join(root, "applied", d, "recast-formats.sql"))];
    const sqlPath = candidates.find((p) => existsSync(p));
    expect(sqlPath, "recast-formats.sql").toBeDefined();
    const sql = readFileSync(sqlPath!, "utf8");
    const listed = [...sql.slice(sql.indexOf("array[")).matchAll(/'(video\/[^']+)'/g)].map((m) => m[1]);
    expect(listed.sort()).toEqual([...RECAST_UPLOAD_TYPES].sort());
  });

  it("offers every format in the file picker", () => {
    expect(RECAST_UPLOAD_ACCEPT.split(",")).toEqual(expect.arrayContaining(["video/*", ".mkv", ".avi", ".mts", ".m4v", ".webm"]));
  });

  it("reads back an upload's path in any format, and nothing that is not one of ours", () => {
    expect(recastUploadPath(USER, TAKE, "mkv")).toBe(`${USER}/${TAKE}.mkv`);
    expect(parseRecastUploadPath(`${USER}/${TAKE}.mkv`)).toEqual({ userId: USER, takeId: TAKE, format: "mkv" });
    expect(parseRecastUploadPath(`${USER}/${TAKE}.mp4`)).toEqual({ userId: USER, takeId: TAKE, format: "mp4" });
    for (const bad of [`${USER}/../${TAKE}.mkv`, `${USER}/${TAKE}.exe`, `${USER}/${TAKE}.mkv/x`, `${TAKE}.webm`, ""]) {
      expect(parseRecastUploadPath(bad), bad).toBeNull();
    }
  });

  it("sends H.264 and HEVC as they are, and converts any other picture inside an MP4 or MOV", () => {
    for (const c of ["avc1", "avc3", "hvc1", "hev1"]) expect(recastCodecSends(c), c).toBe(true);
    for (const c of ["jpeg", "mp4v", "apch", "s263", "av01"]) expect(recastCodecSends(c), c).toBe(false);
    // A codec the probe cannot name goes as it always went.
    expect(recastCodecSends(null)).toBe(true);
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

// ONE REPLACEMENT PER TAKE (2026-09-23). Measured with real money on one 15 s
// stretch of a school courtyard: replacing the man in front of the class held
// end to end when it was the only thing asked for, and asking for the man AND
// the forty boys behind him in the same take came back with the character
// twice over and the boys back as themselves before the end.
describe("a whole group and somebody else in one take", () => {
  const crowd = new Set(["B"]);

  it("is refused where a group is replaced beside somebody else", () => {
    expect(recastCrowdSharesTake("scene", ["A", "B"], crowd)).toBe(true);
    expect(recastCrowdSharesTake("scene", ["B", "A"], crowd)).toBe(true);
    expect(recastCrowdSharesTake("scene", ["A", "B", "C"], crowd)).toBe(true);
  });

  it("leaves a group cast on its own alone — the take that was proved", () => {
    expect(recastCrowdSharesTake("scene", ["B"], crowd)).toBe(false);
    // One take each: every take casts the one person the door named, so the
    // group is never sharing with anybody.
    expect(recastCrowdSharesTake("scene", [null], crowd)).toBe(false);
  });

  // 2026-09-23, changed from the first cut of this rule, which refused this
  // too. A character with no tag is PUT INTO the clip by the words; they take
  // nobody's place, so the take still makes one replacement — and the sentence
  // the person is shown for this refusal ("your character turns up twice, once
  // in their place and once in the crowd") describes nobody in such a take.
  // The money was spent on two replacements; this is not one of them.
  it("says nothing about a character the words merely put in beside the group", () => {
    expect(recastCrowdSharesTake("scene", ["B", null], crowd)).toBe(false);
    expect(recastCrowdSharesTake("scene", [null, "B"], crowd)).toBe(false);
  });

  // Every measured render behind this rule is Into the clip's own engine,
  // editing the person's own footage. Restage casts from reference pictures
  // instead, and two characters in ONE Restage take were built on purpose
  // (2026-09-21) — so it is not refused on evidence from another engine.
  it("is asked of a scene take only", () => {
    expect(recastCrowdSharesTake("restage", ["A", "B"], crowd)).toBe(false);
    expect(recastCrowdSharesTake("motion", ["A", "B"], crowd)).toBe(false);
    expect(recastCrowdSharesTake("world", ["A", "B"], crowd)).toBe(false);
  });

  it("says nothing about two ordinary characters, or about a clip with no group in it", () => {
    expect(recastCrowdSharesTake("scene", ["A", "C"], crowd)).toBe(false);
    expect(recastCrowdSharesTake("scene", ["A", null], crowd)).toBe(false);
    expect(recastCrowdSharesTake("scene", ["A", "B", "C"], new Set<string>())).toBe(false);
    expect(recastCrowdSharesTake("scene", [], crowd)).toBe(false);
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

  it("puts several characters in ONE take, like Into the clip", () => {
    // 2026-09-21: "Still when selecting two characters in Restage it gives me 2 takes".
    expect(recastCastsTogether("restage")).toBe(true);
    expect(recastCastsTogether("scene")).toBe(true);
    // Photo to life builds the frame from one picture; Restyle casts nobody.
    expect(recastCastsTogether("motion")).toBe(false);
    expect(recastCastsTogether("world")).toBe(false);
  });

  it("leaves added images the room the cast's photos leave, out of nine", () => {
    expect(recastRestageImageRoom([])).toBe(3);
    expect(recastRestageImageRoom([4])).toBe(3);
    // Two characters with four photos each: eight of the nine are theirs.
    expect(recastRestageImageRoom([4, 4])).toBe(1);
    expect(recastRestageImageRoom([4, 4, 1])).toBe(0);
    expect(recastRestageImageRoom([4, 4, 4])).toBe(0);
    // A character is never counted as less than their one identity photo.
    expect(recastRestageImageRoom([0, 0])).toBe(3);
  });

  it("sends everyone in a shared take, each one's photos together, then the added images", () => {
    const body = recastRequestBody("h3-768", {
      clipUrl,
      ensemble: [
        { front: "https://x/eva1.jpg", more: ["https://x/eva2.jpg", "https://x/eva3.jpg", "https://x/eva4.jpg"] },
        { front: "https://x/anubis1.jpg", more: [] },
      ],
      imageUrls: ["https://x/gown.jpg"],
      brief: "Video 1 is the scene to build on.",
      clip: { seconds: 14.9 },
    });
    expect(body.reference_image_urls).toEqual([
      "https://x/eva1.jpg",
      "https://x/eva2.jpg",
      "https://x/eva3.jpg",
      "https://x/eva4.jpg",
      "https://x/anubis1.jpg",
      "https://x/gown.jpg",
    ]);
    expect(body.duration).toBe(15);
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

// A LONG TAKE'S LATER PARTS GET EVERY PICTURE THEY ARE TOLD ABOUT (2026-09-22).
describe("a long take's cast", () => {
  it("carries up to three characters, so every later part has room for its still", () => {
    expect(recastChainFits(0)).toBe(true);
    expect(recastChainFits(1)).toBe(true);
    expect(recastChainFits(2)).toBe(true);
    expect(recastChainFits(3)).toBe(true);
    expect(recastChainFits(4)).toBe(false);
  });

  it("refuses to send a part without the still its words point at, rather than drop it without a word", () => {
    const clipUrl = "chain:clip";
    const person = (i: number, more: number) => ({ front: `https://x/${i}.jpg`, more: Array.from({ length: more }, (_, k) => `https://x/${i}-${k}.jpg`) });
    // Four characters: no room left for the still, whatever their photos.
    for (const more of [0, 3]) {
      expect(() =>
        recastRequestBody("kling-edit", { clipUrl, ensemble: [person(1, more), person(2, more), person(3, more), person(4, more)], imageUrls: [CHAIN_LOOK_PLACEHOLDER], brief: "x" }),
      ).toThrow(/no room left for the finished frame/);
    }
    // Three images beside a character and the still: the still would be the fourth image.
    expect(() =>
      recastRequestBody("kling-edit", { clipUrl, characterImageUrl: "https://x/f.jpg", imageUrls: ["a", "b", "c", CHAIN_LOOK_PLACEHOLDER], brief: "x" }),
    ).toThrow(/no room left for the finished frame/);
    // Three characters and the still fit, and the still rides last.
    const body = recastRequestBody("kling-edit", { clipUrl, ensemble: [person(1, 3), person(2, 0), person(3, 3)], imageUrls: [CHAIN_LOOK_PLACEHOLDER], brief: "x" });
    expect(body.image_urls).toEqual(["https://x/2.jpg", CHAIN_LOOK_PLACEHOLDER]);
    // NOBODY CAST, three added images and the still — the room the action
    // gives such a take (recastImageRoom(0, true) = 3, so 3 + 1 = the four
    // references exactly). Capping the images and the still TOGETHER at
    // RECAST_MAX_IMAGES dropped the still here and failed the take after its
    // credits were spent (review, 2026-09-22).
    const nobody = recastRequestBody("kling-edit", { clipUrl, imageUrls: ["a", "b", "c", CHAIN_LOOK_PLACEHOLDER], brief: "x" });
    expect(nobody.image_urls).toEqual(["a", "b", "c", CHAIN_LOOK_PLACEHOLDER]);
    // A body without a still is sliced to its room exactly as before.
    expect(() => recastRequestBody("kling-edit", { clipUrl, ensemble: [person(1, 0), person(2, 0), person(3, 0), person(4, 0)], imageUrls: ["a"], brief: "x" })).not.toThrow();
  });
});

// EVERY WORD REACHES THE TAKE (2026-09-22): each engine's own prompt limit,
// read from fal's schemas that day, and a body that never cuts the words the
// brief was composed to fit.
describe("how long a brief each engine is sent", () => {
  it("is each engine's own limit — Kling's 2,500, Luma's 6,000, and 6,000 of H3's 50,000", () => {
    expect(RECAST_ENGINES["kling-edit"].promptMax).toBe(2500);
    expect(RECAST_ENGINES["kling-pro"].promptMax).toBe(2500);
    expect(RECAST_ENGINES["kling-std"].promptMax).toBe(2500);
    expect(RECAST_ENGINES["luma-720"].promptMax).toBe(6000);
    expect(RECAST_ENGINES["luma-540"].promptMax).toBe(6000);
    expect(RECAST_ENGINES["h3-768"].promptMax).toBe(6000);
    expect(RECAST_ENGINES["h3-480"].promptMax).toBe(6000);
    expect(RECAST_PROMPT_MAX_CHARS).toBe(6000);
  });

  it("counts characters the way the engines do, so a brief that fits is never cut in the body", () => {
    // 2,500 characters of which the last are emoji: 2,510 UTF-16 halves.
    const brief = `${"x".repeat(2490)}${"🙂".repeat(10)}`;
    expect(Array.from(brief).length).toBe(2500);
    const clipUrl = "https://x/clip.mp4";
    expect(recastRequestBody("kling-edit", { clipUrl, brief }).prompt).toBe(brief);
    expect(recastRequestBody("kling-pro", { clipUrl, characterImageUrl: "https://x/f.jpg", brief }).prompt).toBe(brief);
    // Past its limit, only the engine's own number is kept — never more.
    expect(Array.from(String(recastRequestBody("luma-720", { clipUrl, brief: "y".repeat(7000) }).prompt)).length).toBe(6000);
    expect(Array.from(String(recastRequestBody("h3-768", { clipUrl, brief: "y".repeat(7000), clip: { seconds: 5 } }).prompt)).length).toBe(6000);
    expect(recastFitPrompt("abc", 2)).toBe("ab");
    expect(recastFitPrompt("🙂🙂🙂", 2)).toBe("🙂🙂");
  });

  it("keeps Restage's own rewrite of the words switched on, as the take that came back right was sent", () => {
    expect(recastRequestBody("h3-768", { clipUrl: "https://x/c.mp4", brief: "x", clip: { seconds: 5 } }).prompt_expansion_mode).toBe("balanced");
  });
});
