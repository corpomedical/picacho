import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HUNYUAN_USD,
  MESHY_USD,
  MODEL_DEFAULT_OPTIONS,
  MODEL_ENGINES,
  TRELLIS_USD,
  TRIPO_USD,
  modelBuildPrice,
  modelBuildRequest,
  modelBuildUsd,
  modelChoices,
  modelEngine,
  modelHandleAllowed,
  modelInputProblem,
  modelResultGlb,
  normaliseModelOptions,
  queueUrlPattern,
  readModelHandle,
  usdText,
  type ModelBuildOptions,
  type ModelEngineId,
} from "./model-engines";
import { THING_BUILD_USD } from "./thing-build";

// The prompt bar's 3D Model engines (2026-10-01, operator: "Finalizing the UI to look and work like this"): every
// price is fal's own page's sentence, read that day; every option maps to the engine's own parameter.

const e = (id: ModelEngineId) => modelEngine(id)!;
const o = (x: Partial<ModelBuildOptions> = {}): ModelBuildOptions => ({ ...MODEL_DEFAULT_OPTIONS, ...x });
const SRC = readFileSync(join(__dirname, "model-engines.ts"), "utf8");
const IMG = "data:image/jpeg;base64,/9j/";

describe("the prices, as fal's pages say them (read 2026-10-01)", () => {
  it("quotes each page's sentence beside its constant", () => {
    expect(SRC).toContain('"Your request will cost 0.25 $ for 512p resolution, 0.3 $ for 1024p resolution\n * and 0.35 $ for 1536p resolution."');
    expect(SRC).toContain("Your\n * request will cost $0.375 per generation. For $1.00, you can run this model 2 times. Enabling PBR materials adds\n * $0.15. Using multi-view images adds $0.15. Custom face count adds $0.15.");
    expect(SRC).toContain("Your request will cost $0.2\n * (without textures), $0.3 (with standard textures), or $0.4 (with HD textures), plus an additional $0.05 each for\n * Style and quad options if selected.");
    expect(SRC).toContain("A base model\n * without textures costs $0.80. Adding textures brings the total to $1.20. Optional auto-rigging adds $0.20");
    expect(TRELLIS_USD).toEqual({ 512: 0.25, 1024: 0.3, 1536: 0.35 });
    expect(TRELLIS_USD[1024]).toBe(THING_BUILD_USD);
    expect(HUNYUAN_USD).toEqual({ base: 0.375, pbr: 0.15, multiView: 0.15, faceCount: 0.15 });
    expect(TRIPO_USD).toEqual({ none: 0.2, standard: 0.3, hd: 0.4, quad: 0.05 });
    expect(MESHY_USD).toEqual({ untextured: 0.8, textured: 1.2, rig: 0.2 });
  });

  it("Hunyuan 3D v3.1 Pro: $0.375, + $0.15 for PBR, for multi-view, and for a custom face count", () => {
    const h = e("hunyuan-3.1-pro");
    expect(modelBuildUsd(h, "text", o())).toBe(0.375);
    expect(modelBuildUsd(h, "image", o())).toBe(0.375);
    expect(modelBuildUsd(h, "image", o({ pbr: true }))).toBe(0.525);
    expect(modelBuildUsd(h, "multi", o())).toBe(0.525);
    expect(modelBuildUsd(h, "multi", o({ pbr: true }))).toBe(0.675);
    expect(modelBuildUsd(h, "multi", o({ pbr: true, polycount: 200_000 }))).toBe(0.825);
    // Geometry only is the same per generation (the page names no discount); PBR needs textures.
    expect(modelBuildUsd(h, "image", normaliseModelOptions(h, { textures: "none", pbr: true }))).toBe(0.375);
  });

  it("Tripo v2.5: $0.20 / $0.30 / $0.40 by textures, + $0.05 for quads; multi-view the same", () => {
    const t = e("tripo-2.5");
    expect(modelBuildUsd(t, "image", o({ textures: "none" }))).toBe(0.2);
    expect(modelBuildUsd(t, "image", o())).toBe(0.3);
    expect(modelBuildUsd(t, "image", o({ textures: "hd" }))).toBe(0.4);
    expect(modelBuildUsd(t, "multi", o({ textures: "hd", quad: true }))).toBe(0.45);
    expect(modelBuildUsd(t, "image", o({ polycount: 20_000 }))).toBe(0.3);
  });

  it("Meshy 7.1: $0.80 untextured, $1.20 textured, + $0.20 auto-rigging; text, photo and multi-image alike", () => {
    const m = e("meshy-7.1");
    for (const k of ["text", "image", "multi"] as const) {
      expect(modelBuildUsd(m, k, o({ textures: "none" }))).toBe(0.8);
      expect(modelBuildUsd(m, k, o())).toBe(1.2);
      expect(modelBuildUsd(m, k, o({ rig: true }))).toBe(1.4);
      expect(modelBuildUsd(m, k, o({ rig: true, quad: true, polycount: 50_000 }))).toBe(1.4);
    }
  });

  it("TRELLIS.2: by its resolution, one photo only (its multi-view page names no unit)", () => {
    const t = e("trellis-2");
    expect(modelBuildUsd(t, "image", o({ detail: 512 }))).toBe(0.25);
    expect(modelBuildUsd(t, "image", o())).toBe(0.3);
    expect(modelBuildUsd(t, "image", o({ detail: 1536 }))).toBe(0.35);
    expect(t.endpoints.multi).toBeUndefined();
    expect(t.endpoints.text).toBeUndefined();
  });

  it("an option an engine doesn't price is never sent to it (and never charged)", () => {
    expect(normaliseModelOptions(e("tripo-2.5"), { pbr: true, rig: true })).toMatchObject({ pbr: false, rig: false });
    expect(normaliseModelOptions(e("hunyuan-3.1-pro"), { quad: true, rig: true })).toMatchObject({ quad: false, rig: false });
    expect(normaliseModelOptions(e("meshy-7.1"), { pbr: true, textures: "hd" })).toMatchObject({ pbr: false, textures: "standard" });
    expect(normaliseModelOptions(e("hunyuan-3.1-pro"), { polycount: 5 }).polycount).toBe(40_000);
    expect(normaliseModelOptions(e("meshy-7.1"), { polycount: 9e9 }).polycount).toBe(300_000);
  });

  it("lists the price line by line, and writes dollars as fal does", () => {
    expect(modelBuildPrice(e("hunyuan-3.1-pro"), "multi", o({ pbr: true })).map((l) => l.what)).toEqual(["Hunyuan 3D v3.1 Pro", "PBR materials", "Multi-view images"]);
    expect([usdText(0.375), usdText(0.675), usdText(1.4), usdText(0.3)]).toEqual(["$0.375", "$0.675", "$1.40", "$0.30"]);
  });

  it("the picker groups Text, Image and Multi-view, and lists only engines with a read price", () => {
    expect(modelChoices().map((g) => [g.kind, g.engines.map((x) => x.id)])).toEqual([
      ["text", ["hunyuan-3.1-pro", "meshy-7.1"]],
      ["image", ["hunyuan-3.1-pro", "meshy-7.1", "tripo-2.5", "trellis-2"]],
      ["multi", ["hunyuan-3.1-pro", "meshy-7.1", "tripo-2.5"]],
    ]);
    expect(MODEL_ENGINES.map((x) => x.id).sort()).toEqual(["hunyuan-3.1-pro", "meshy-7.1", "trellis-2", "tripo-2.5"]);
  });
});

describe("what each engine is sent (its own API schema, read 2026-10-01)", () => {
  it("Hunyuan: prompt or front photo, back/left/right views, PBR, Geometry, face_count", () => {
    expect(modelBuildRequest(e("hunyuan-3.1-pro"), { kind: "text", prompt: " a knight ", images: {}, options: o() })).toEqual({
      endpoint: "fal-ai/hunyuan-3d/v3.1/pro/text-to-3d",
      body: { generate_type: "Normal", enable_pbr: false, prompt: "a knight" },
    });
    expect(modelBuildRequest(e("hunyuan-3.1-pro"), { kind: "multi", prompt: "", images: { front: IMG, back: "B", left: "L", right: "R" }, options: o({ pbr: true, polycount: 100_000 }) })).toEqual({
      endpoint: "fal-ai/hunyuan-3d/v3.1/pro/image-to-3d",
      body: { generate_type: "Normal", enable_pbr: true, face_count: 100_000, input_image_url: IMG, back_image_url: "B", left_image_url: "L", right_image_url: "R" },
    });
    expect(modelBuildRequest(e("hunyuan-3.1-pro"), { kind: "image", prompt: "", images: { front: IMG, back: "B" }, options: o({ textures: "none" }) }).body).toEqual({ generate_type: "Geometry", enable_pbr: false, input_image_url: IMG });
  });

  it("Tripo: texture no/standard/HD, quad, face_limit; multi-view by named views", () => {
    expect(modelBuildRequest(e("tripo-2.5"), { kind: "image", prompt: "", images: { front: IMG }, options: o({ textures: "hd", quad: true }) })).toEqual({
      endpoint: "tripo3d/tripo/v2.5/image-to-3d",
      body: { texture: "HD", quad: true, image_url: IMG },
    });
    expect(modelBuildRequest(e("tripo-2.5"), { kind: "multi", prompt: "", images: { front: IMG, left: "L" }, options: o({ textures: "none", polycount: 20_000 }) })).toEqual({
      endpoint: "tripo3d/tripo/v2.5/multiview-to-3d",
      body: { texture: "no", quad: false, face_limit: 20_000, front_image_url: IMG, left_image_url: "L" },
    });
  });

  it("Meshy: topology, rigging (A-pose), no animation, textures, image_urls in view order", () => {
    expect(modelBuildRequest(e("meshy-7.1"), { kind: "multi", prompt: "", images: { right: "R", front: IMG, back: "B" }, options: o({ rig: true, quad: true }) })).toEqual({
      endpoint: "meshy/v7.1/multi-image-to-3d",
      body: { topology: "quad", enable_rigging: true, enable_animation: false, enable_pbr: false, pose_mode: "a-pose", should_texture: true, image_urls: [IMG, "B", "R"] },
    });
    expect(modelBuildRequest(e("meshy-7.1"), { kind: "text", prompt: "a robot", images: {}, options: o({ textures: "none", polycount: 30_000 }) })).toEqual({
      endpoint: "meshy/v7.1/text-to-3d",
      body: { topology: "triangle", enable_rigging: false, enable_animation: false, enable_pbr: false, target_polycount: 30_000, prompt: "a robot", mode: "preview" },
    });
  });

  it("TRELLIS.2: the set page's own request, at the chosen resolution", () => {
    expect(modelBuildRequest(e("trellis-2"), { kind: "image", prompt: "", images: { front: IMG }, options: o({ detail: 1536 }) })).toEqual({
      endpoint: "fal-ai/trellis-2",
      body: { image_url: IMG, resolution: 1536, decimation_target: 100_000, texture_size: 2048, remesh: true },
    });
  });

  it("refuses what an engine can't build, before anything is sent", () => {
    expect(modelInputProblem(e("tripo-2.5"), { kind: "text", prompt: "x", images: {}, options: o() })).toBe("Tripo v2.5 doesn't build from words.");
    expect(modelInputProblem(e("meshy-7.1"), { kind: "text", prompt: "  ", images: {}, options: o() })).toBe("Describe the model first.");
    expect(modelInputProblem(e("meshy-7.1"), { kind: "text", prompt: "x".repeat(601), images: {}, options: o() })).toBe("Keep the description under 600 characters.");
    expect(modelInputProblem(e("hunyuan-3.1-pro"), { kind: "image", prompt: "", images: {}, options: o() })).toBe("Add a photo first.");
    expect(modelInputProblem(e("hunyuan-3.1-pro"), { kind: "multi", prompt: "", images: { back: "B" }, options: o() })).toBe("Add the front view first.");
    expect(modelInputProblem(e("hunyuan-3.1-pro"), { kind: "multi", prompt: "", images: { front: IMG }, options: o() })).toMatch(/at least one more view/);
    expect(() => modelBuildRequest(e("trellis-2"), { kind: "multi", prompt: "", images: { front: IMG, back: "B" }, options: o() })).toThrow();
  });
});

describe("fal's queue, only for these endpoints, and the .glb in each answer", () => {
  const R = "764cabcf-b745-4b3e-ae38-1200304cf45b";
  it("takes the app's own queue host (and the endpoint's full path), nothing else", () => {
    const re = queueUrlPattern("fal-ai/hunyuan-3d/v3.1/pro/image-to-3d");
    expect(re.test(`https://queue.fal.run/fal-ai/hunyuan-3d/requests/${R}/status`)).toBe(true);
    expect(re.test(`https://queue.fal.run/fal-ai/hunyuan-3d/v3.1/pro/image-to-3d/requests/${R}`)).toBe(true);
    expect(re.test(`https://queue.fal.run/fal-ai/trellis-2/requests/${R}`)).toBe(false);
    expect(re.test(`https://evil.example/fal-ai/hunyuan-3d/requests/${R}`)).toBe(false);
    expect(queueUrlPattern("tripo3d/tripo/v2.5/image-to-3d").test(`https://queue.fal.run/tripo3d/tripo/requests/${R}`)).toBe(true);
    expect(queueUrlPattern("meshy/v7.1/text-to-3d").test(`https://queue.fal.run/meshy/v7.1/requests/${R}/status`)).toBe(true);
    const job = { request_id: R, status_url: `https://queue.fal.run/meshy/v7.1/requests/${R}/status`, response_url: `https://queue.fal.run/meshy/v7.1/requests/${R}` };
    expect(readModelHandle("meshy/v7.1/image-to-3d", job)).toEqual({ requestId: R, statusUrl: job.status_url, responseUrl: job.response_url });
    expect(readModelHandle("tripo3d/tripo/v2.5/image-to-3d", job)).toBeNull();
    expect(modelHandleAllowed("meshy/v7.1/image-to-3d", { ...readModelHandle("meshy/v7.1/image-to-3d", job), requestId: "other-request-id" })).toBe(false);
  });

  it("reads each engine's own answer: model_glb, Meshy's rigged character first, Tripo's model_mesh", () => {
    const glb = (n: string) => ({ url: `https://v3b.fal.media/files/b/x/${n}.glb`, file_size: 10 });
    expect(modelResultGlb(e("hunyuan-3.1-pro"), false, { model_glb: glb("h") })?.url).toMatch(/h\.glb$/);
    expect(modelResultGlb(e("meshy-7.1"), true, { model_glb: glb("m"), rigged_character_glb: glb("r") })?.url).toMatch(/r\.glb$/);
    expect(modelResultGlb(e("meshy-7.1"), true, { model_glb: glb("m"), rigged_character_glb: null })?.url).toMatch(/m\.glb$/);
    expect(modelResultGlb(e("tripo-2.5"), false, { model_mesh: { url: "https://v3.fal.media/files/zebra/t.glb" } })?.url).toMatch(/t\.glb$/);
    expect(modelResultGlb(e("hunyuan-3.1-pro"), false, { model_glb: { url: "https://evil.example/x.glb" } })).toBeNull();
  });
});
