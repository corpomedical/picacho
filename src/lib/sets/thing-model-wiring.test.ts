import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import itMsgs from "../i18n/messages/it";

// A real model on a thing (thing-model.ts, 2026-09-24), on the page: the
// stage draws it in place of the blocks, keeps it through a rebuild, moves
// it with its thing, draws it flat in the sketch the image model reads, and
// a tap on it is a tap on the thing. Admins only while our own model
// builder is proved. Read as source, like the page's other tests.

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const view = read("../../components/sets/set-view.tsx");
const card = read("../../components/sets/element-card.tsx");

const fnOf = (source: string, head: string, next: string) => {
  const a = source.indexOf(head);
  expect(a, head).toBeGreaterThan(-1);
  const b = source.indexOf(next, a + head.length);
  expect(b, next).toBeGreaterThan(a);
  return source.slice(a, b);
};

describe("a model on the stage", () => {
  it("stands in a group of its own, so a rebuild never takes it, and its blocks are hidden again after one", () => {
    expect(view).toContain("const skinRoot = new THREE.Group();");
    expect(view).toContain("scene.add(skinRoot);");
    expect(view).not.toMatch(/built\.root\.add\(skinRoot\)/);
    const rebuild = fnOf(view, "          rebuild(next) {", "\n          },\n");
    expect(rebuild.indexOf("meshOfCopy = indexBlocks();")).toBeLessThan(rebuild.indexOf("hideBlocks();"));
  });

  it("loads only our own media or a file picked on the page, fitted where the blocks stand", () => {
    const load = fnOf(view, "          async setThingModels(models) {", "          placeThings(placements) {");
    expect(load).toContain("models.filter((m) => modelUrlAllowed(m.url))");
    expect(load).toContain("{ min: el.min, max: el.max },");
    expect(load).toContain("model.rotation.y = fit.turnDeg * (Math.PI / 180);");
    expect(load).toContain("model.scale.setScalar(fit.scale);");
    // A file that is not a model says so; it never breaks the stage.
    expect(load).toContain("results.push({ key, ok: false });");
  });

  it("is drawn flat in the sketch the image model reads, and put back after", () => {
    const sketch = fnOf(view, "        const drawSketch = (", "        let recording:");
    expect(sketch.indexOf("skinSketch(true);")).toBeLessThan(sketch.indexOf("renderer.render(scene, cam);"));
    expect(sketch.indexOf("skinSketch(false);")).toBeGreaterThan(sketch.indexOf("renderer.render(scene, cam);"));
    expect(view).toContain("...SKETCH_MODEL_MATERIAL,");
  });

  it("moves with its thing, and a tap on it opens its thing", () => {
    const place = fnOf(view, "          placeThings(placements) {", "\n          },\n");
    expect(place).toContain("for (const key of skins.keys()) placeSkin(key);");
    expect(view).toContain("...raycaster.intersectObject(skinRoot, true).flatMap((h): StageHit[] => {");
  });
});

describe("who may put one on", () => {
  it("is an admin, and the file never leaves the page", () => {
    expect(read("data.ts")).toContain("modelsOn: access.isAdmin,");
    expect(view).toContain("modelsOn && thingKey");
    expect(view).toContain("const url = URL.createObjectURL(file);");
    for (const hook of ["data-el-model", "data-el-model-state", "data-el-model-input", "data-el-model-file", "data-el-model-flip", "data-el-model-remove"]) {
      expect(card, hook).toContain(hook);
    }
  });

  it("is told in every language", () => {
    const keys = ["modelTitle", "modelLoad", "modelLoading", "modelReady", "modelFailed", "modelFlip", "modelRemove", "modelHint"] as const;
    for (const m of [en, es, pt, itMsgs]) {
      for (const key of keys) {
        expect(m.sets.cast[key], key).toBeTruthy();
        for (const ph of en.sets.cast[key].match(/\{\w+\}/g) ?? []) expect(m.sets.cast[key], `${key} ${ph}`).toContain(ph);
      }
    }
  });
});
