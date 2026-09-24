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

  it("is lit on a stage with no sky light of its own, or its metal paint draws black", () => {
    const light = fnOf(view, "        const lightModel = async (model", "        /** The models flat for the sketch");
    expect(light).toContain("if (scene.environment) return;");
    expect(light).toContain("roomLight = gen.fromScene(new RoomEnvironment(), 0.04).texture;");
    const load = fnOf(view, "          async setThingModels(models) {", "          placeThings(placements) {");
    expect(load.indexOf("await lightModel(model);")).toBeLessThan(load.indexOf("skinRoot.add(group);"));
  });

  it("moves with its thing, and a tap on it opens its thing", () => {
    const place = fnOf(view, "          placeThings(placements) {", "\n          },\n");
    expect(place).toContain("for (const key of skins.keys()) placeSkin(key);");
    expect(view).toContain("...raycaster.intersectObject(skinRoot, true).flatMap((h): StageHit[] => {");
  });
});

describe("a model kept with the set", () => {
  const actions = read("model-actions.ts");
  const store = read("thing-model-store.ts");

  it("never passes through our own server: the page sends the file to an address made for it", () => {
    expect(actions).toContain(".createSignedUploadUrl(path);");
    const load = fnOf(view, "  async function loadThingModel(", "  /** Turned round on the stage at once");
    expect(load.indexOf("reserveThingModel(setId,")).toBeLessThan(load.indexOf(".uploadToSignedUrl(place.path, place.token, file"));
    expect(load.indexOf(".uploadToSignedUrl(")).toBeLessThan(load.indexOf("keepThingModel(setId,"));
    // Shown at once from the file itself; drawn from storage once kept.
    expect(load.indexOf("URL.createObjectURL(file)")).toBeLessThan(load.indexOf("reserveThingModel("));
    expect(load).toContain('patchModel(key, { url: kept.model.url, storedKey: kept.model.key, kept: "saved", note: null });');
  });

  it("is kept only when the stored file is a model, one per thing, and only by an admin on their own set", () => {
    const keep = fnOf(actions, "export async function keepThingModel(", "/** Turned round, kept turned round");
    expect(keep).toContain("glbHeaderOk(head, blob.size)");
    expect(keep.indexOf("glbHeaderOk(")).toBeLessThan(keep.indexOf("removeOthers("));
    expect(keep).toContain("await admin.storage.from(THING_MODEL_BUCKET).remove([path]);");
    expect(actions).toContain("if (!access.isAdmin) return { error: THING_MODEL_ADMINS_ONLY };");
    expect(actions).toContain('.eq("user_id", access.userId)');
    // A path is only ever this person's, this set's, a model's.
    expect(actions).toContain("if (typeof path !== \"string\" || !path.startsWith(`${userId}/sets/`)) return null;");
    expect(fnOf(actions, "export async function reserveThingModel(", "/** Step 2")).toContain("if (size > THING_MODEL_MAX_BYTES) return { error: THING_MODEL_TOO_BIG };");
  });

  it("comes back with the set for admins, and goes with the set when it is deleted", () => {
    expect(read("data.ts")).toContain('thingModels: status === "ready" && access.isAdmin ? await listThingModels(createAdminClient(), access.userId, row.id as string) : [],');
    expect(read("actions.ts")).toContain("await removeSetThingModels(admin, userId, setId);");
    expect(store).toContain("if (seen.has(f.key)) continue;");
    expect(view).toContain("const key = modelHome(m.key, at);");
  });
});

describe("who may put one on", () => {
  it("is an admin, and the file never leaves the page", () => {
    expect(read("data.ts")).toContain("modelsOn: access.isAdmin,");
    expect(view).toContain("modelsOn && thingKey");
    expect(view).toContain("const local = URL.createObjectURL(file);");
    for (const hook of ["data-el-model", "data-el-model-state", "data-el-model-input", "data-el-model-file", "data-el-model-flip", "data-el-model-remove"]) {
      expect(card, hook).toContain(hook);
    }
  });

  it("is told in every language", () => {
    const keys = ["modelTitle", "modelLoad", "modelLoading", "modelReady", "modelFailed", "modelFlip", "modelRemove", "modelHint", "modelSaving", "modelSaved", "modelUnsaved"] as const;
    for (const m of [en, es, pt, itMsgs]) {
      for (const key of keys) {
        expect(m.sets.cast[key], key).toBeTruthy();
        for (const ph of en.sets.cast[key].match(/\{\w+\}/g) ?? []) expect(m.sets.cast[key], `${key} ${ph}`).toContain(ph);
      }
    }
  });
});
