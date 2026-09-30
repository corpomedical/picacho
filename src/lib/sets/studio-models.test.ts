import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  STUDIO_PHOTO_SIDE,
  cropInPixels,
  cropOut,
  dominantColour,
  ownStudioModelPath,
  studioBuildLabel,
  studioModelFiles,
  studioModelPath,
  studioModelRef,
  studioPhotoPayload,
  studioViewSuggestion,
} from "./studio-models";
import { THING_BUILD_USD } from "./thing-build";
import { SET_PHOTO_MAX_ASPECT, SET_PHOTO_MAX_SIDE_PX, SET_PHOTO_MIN_SIDE_PX, photoFit } from "./set-config";
import { STUDIO_SCENE_MAX_BYTES, normaliseStudioScene } from "./studio-scene";

// Real models in Helios Studio (2026-09-30, operator: "Apply this look for the car." · "I also want to see it
// rendered in 3d."): the reference a scene keeps, the build's price label, and the crop that is sent.

const U = "11111111-1111-4111-8111-111111111111";
const S = "22222222-2222-4222-8222-222222222222";
const read = (p: string) => readFileSync(join(__dirname, p), "utf8");

describe("the files the Studio keeps", () => {
  it("live in the owner's sets folder under the set, never a thing model's name, and only theirs pass", () => {
    const path = studioModelPath(U, S, 1_727_700_000_000, "0123456789abcdef");
    expect(path).toBe(`${U}/sets/${S}.studio-model.${(1_727_700_000_000).toString(36)}.0123456789abcdef.glb`);
    expect(path).not.toContain(".model.c_");
    expect(ownStudioModelPath(U, S, path)).toBe(true);
    expect(ownStudioModelPath("33333333-3333-4333-8333-333333333333", S, path)).toBe(false);
    expect(ownStudioModelPath(U, "44444444-4444-4444-8444-444444444444", path)).toBe(false);
    expect(ownStudioModelPath(U, S, path.replace(".glb", ".png"))).toBe(false);
    expect(ownStudioModelPath(U, S, `${U}/sets/${S}.studio-model.x/../../other.glb`)).toBe(false);
    expect(ownStudioModelPath(U, S, 42)).toBe(false);
  });
});

describe("the model reference a saved scene keeps", () => {
  it("is a thing's key or a Studio file's path, with the photo's colour — never a data or blob address", () => {
    const file = studioModelPath(U, S, 1, "0123456789abcdef");
    expect(studioModelRef({ thing: "c_1a2b3c4d_12_-40", colour: "#F2C500" })).toEqual({ thing: "c_1a2b3c4d_12_-40", colour: "#f2c500" });
    expect(studioModelRef({ thing: "c_1a2b3c4d_12_-40", flip: true })).toEqual({ thing: "c_1a2b3c4d_12_-40", flip: true });
    expect(studioModelRef({ file })).toEqual({ file });
    expect(studioModelRef({ file: "data:model/gltf-binary;base64,Z2xURg==" })).toBeNull();
    expect(studioModelRef({ file: "blob:https://picacho.ai/1234" })).toBeNull();
    expect(studioModelRef({ url: "/api/media/generated-videos/x.glb" })).toBeNull();
    expect(studioModelRef({ thing: "car 1" })).toBeNull();
    expect(studioModelRef(null)).toBeNull();
  });

  it("round-trips through the account's scene, small, and the page signs exactly the files it names", () => {
    const file = studioModelPath(U, S, 7, "fedcba9876543210");
    // What the engine's snapshot() writes for a car drawn from its built model, an imported file, and a block.
    const scene = {
      v: 1,
      items: [
        { key: "el:c_1a2b3c4d_12_-40", add: null, model: { thing: "c_1a2b3c4d_12_-40", colour: "#f2c500" }, name: "Car 1", t: { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }, keys: [] },
        { key: null, add: null, model: { file, colour: "#aa3322" }, name: "Lamp", t: { p: [3, 0, 1], r: [0, 0.5, 0], s: [2, 2, 2] }, keys: [{ t: 1, p: [3, 0, 1], r: [0, 0, 0], s: [1, 1, 1] }] },
        { key: "place", add: null, name: "The place", t: { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }, keys: [] },
      ],
    };
    const kept = normaliseStudioScene(JSON.parse(JSON.stringify(scene)));
    expect(kept.ok).toBe(true);
    if (!kept.ok) return;
    const items = kept.scene.items as { model?: unknown; name: string }[];
    expect(items.map((i) => studioModelRef(i.model))).toEqual([{ thing: "c_1a2b3c4d_12_-40", colour: "#f2c500" }, { file, colour: "#aa3322" }, null]);
    expect(studioModelFiles(kept.scene)).toEqual([file]);
    expect(new TextEncoder().encode(JSON.stringify(kept.scene)).byteLength).toBeLessThan(STUDIO_SCENE_MAX_BYTES / 100);
  });

  it("is what the engine writes and reads back (source)", () => {
    const engine = read("../../components/studio/studio-engine.ts");
    expect(engine).toContain("items: items.filter((i) => i.kind !== \"sun\" && (i.saveKey || i.addKind || modelRefOf(i))).map((i) => ({ key: i.saveKey || null, add: i.addKind || null, model: modelRefOf(i) || undefined,");
    expect(engine).toContain("function modelRefOf(it) { const m = it.model; if (!m || it.modelState === \"blocks\" || it.modelState === \"missing\") return null; return studioModelRef(m); }");
    expect(engine).toContain("const ref = studioModelRef(s.model);");
    expect(engine).toContain("s.add ? addKind(s.add) : ref ? addModelItem(s.name, s.coll, ref) : null;");
    // The page signs the saved scene's files; the rest are asked for when the Studio opens.
    const data = read("data.ts");
    expect(data).toContain("studioModelFiles(savedScene)");
    expect(data).toContain(".filter((f) => ownStudioModelPath(access.userId, setId, f))");
  });
});

describe("the build's button", () => {
  it("says the price from the build's own constant", () => {
    expect(THING_BUILD_USD).toBe(0.3);
    expect(studioBuildLabel()).toBe("Build the 3D model · about $0.30");
    expect(studioBuildLabel(0.35)).toBe("Build the 3D model · about $0.35");
    expect(read("../../components/studio/helios-studio.tsx")).toContain("usd: THING_BUILD_USD,");
    expect(read("../../components/studio/studio-engine.ts")).toContain("const mpLabel = () => studioBuildLabel(MD && MD.build ? MD.build.usd : undefined);");
  });
});

describe("one view of a sheet", () => {
  // His sheet's layout: side (long and low), front, top (long and wide), back.
  const side = { x: 40, y: 40, w: 700, h: 200, area: 100_000 };
  const front = { x: 800, y: 40, w: 320, h: 200, area: 50_000 };
  const top = { x: 40, y: 300, w: 700, h: 330, area: 160_000 };
  const back = { x: 800, y: 300, w: 320, h: 200, area: 50_000 };

  it("suggests the side view — the longest and lowest — and a three-quarter view when the sheet has one", () => {
    expect(studioViewSuggestion([top, side, front, back])).toEqual({ x: 40, y: 40, w: 700, h: 200 });
    const quarter = { x: 1200, y: 40, w: 520, h: 330, area: 150_000 };
    expect(studioViewSuggestion([top, side, front, back, quarter])).toEqual({ x: 1200, y: 40, w: 520, h: 330 });
    expect(studioViewSuggestion([])).toBeNull();
  });

  it("turns the box drawn on the shown photo into its own pixels, inside it and never tiny", () => {
    expect(cropInPixels({ x: 20, y: 10, w: 350, h: 100 }, 600, 400, 1200, 800)).toEqual({ x: 40, y: 20, w: 700, h: 200 });
    expect(cropInPixels({ x: -50, y: 390, w: 2000, h: 5 }, 600, 400, 1200, 800)).toEqual({ x: 0, y: 776, w: 1200, h: 24 });
  });

  it("sends the view with white round it, as a JPEG onto the thing — or to a new object's build", () => {
    // A square-ish view: 1024 px on its long side, as TRELLIS.2 builds.
    const sq = cropOut({ x: 40, y: 40, w: 1400, h: 1100 });
    expect(Math.max(sq.width, sq.height)).toBe(STUDIO_PHOTO_SIDE);
    // A long side view (3.5 : 1): white above and below until it is no wider than the photo rule allows, 640 px high.
    const out = cropOut({ x: 40, y: 40, w: 1400, h: 400 });
    expect(out.width / out.height).toBeLessThanOrEqual(SET_PHOTO_MAX_ASPECT);
    expect(Math.min(out.width, out.height)).toBe(SET_PHOTO_MIN_SIDE_PX);
    expect(out.draw.x).toBeGreaterThan(0);
    expect(out.draw.x + out.draw.w).toBeLessThanOrEqual(out.width);
    expect(out.draw.y + out.draw.h).toBeLessThanOrEqual(out.height);
    expect(photoFit(out.width, out.height).ok).toBe(true);
    // A small crop is never enlarged (the server then says it's too small, as it should).
    expect(cropOut({ x: 0, y: 0, w: 300, h: 100 })).toEqual({ width: 336, height: 147, draw: { x: 18, y: 24, w: 300, h: 100 } });
    const jpeg = "data:image/jpeg;base64,/9j/4AAQ";
    expect(studioPhotoPayload({ key: "c_1a2b3c4d_12_-40" }, jpeg)).toEqual({ kind: "thing", element: "c_1a2b3c4d_12_-40", photoDataUri: jpeg });
    expect(studioPhotoPayload({ new: true }, jpeg)).toEqual({ kind: "new", photoDataUri: jpeg });
    expect(studioPhotoPayload({ key: "Car 1" }, jpeg)).toBeNull();
    expect(studioPhotoPayload({ new: true }, "data:image/png;base64,iVBOR")).toBeNull();
  });
});

describe("a wide single view is never too small (2026-09-30: his 2320 × 1010 side view was refused live)", () => {
  it("keeps the short side at 640 px or more, within the shape and size the server takes", () => {
    const out = cropOut({ x: 0, y: 0, w: 2320, h: 1010 });
    expect(Math.min(out.width, out.height)).toBeGreaterThanOrEqual(SET_PHOTO_MIN_SIDE_PX);
    expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(SET_PHOTO_MAX_SIDE_PX);
    expect(out.width / out.height).toBeLessThanOrEqual(SET_PHOTO_MAX_ASPECT);
    expect(photoFit(out.width, out.height)).toEqual({ ok: true, width: out.width, height: out.height });
    // The view itself is drawn whole, inside the white, and not smaller than 640 px on its short side either way round.
    expect(out.draw.x + out.draw.w).toBeLessThanOrEqual(out.width);
    expect(out.draw.y + out.draw.h).toBeLessThanOrEqual(out.height);
    const tall = cropOut({ x: 0, y: 0, w: 1010, h: 2320 });
    expect(Math.min(tall.width, tall.height)).toBeGreaterThanOrEqual(SET_PHOTO_MIN_SIDE_PX);
    // A crop already under 640 on its short side is sent at its own size, never enlarged.
    const small = cropOut({ x: 0, y: 0, w: 900, h: 420 });
    expect(small.draw.w).toBe(900);
  });
});

describe("the photo's main colour", () => {
  const picture = (w: number, h: number, at: (x: number, y: number) => [number, number, number]) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set([...at(x, y), 255], (y * w + x) * 4);
    return d;
  };
  it("is the paint, not the sheet's white, the tyres' black or the glass's grey", () => {
    // A yellow car body on white, with black wheels and a grey window.
    const px = picture(100, 60, (x, y) => (y < 10 || y > 50 || x < 5 || x > 95 ? [255, 255, 255] : y > 42 && (x < 30 || x > 70) ? [15, 15, 15] : y < 22 && x > 35 && x < 65 ? [90, 95, 100] : [242, 197, 0]));
    const hex = dominantColour(px, 100, 60)!;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(220);
    expect(g).toBeGreaterThan(170);
    expect(b).toBeLessThan(40);
  });
  it("falls back to the average of what stands off the background when nothing is coloured", () => {
    expect(dominantColour(picture(20, 20, (x) => (x < 2 || x > 17 ? [255, 255, 255] : [60, 60, 60])), 20, 20)).toBe("#3c3c3c");
    expect(dominantColour(picture(4, 4, () => [255, 255, 255]), 4, 4)).toBeNull();
  });
});
