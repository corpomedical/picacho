import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { blocksOf, holderForThing, keepStudioImport, pressModelBuild, showModel, type ModelBuildDoors } from "./studio-model";
import { fitThingModel } from "../../lib/sets/thing-model";

// The Studio's load path for a thing with a model (2026-09-30): the model where the blocks stood, the set page's
// fit, and the blocks kept when it can't load. Then the photo → build press and the import's keep, doors faked.

/** A thing's group as the engine builds it: at the blocks' centre on the ground, two block meshes, and a lamp parented to it. */
function thing() {
  const g = new THREE.Group();
  g.position.set(10, 0, -4);
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1, 1.9), new THREE.MeshStandardMaterial());
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2, 0.5, 1.6), new THREE.MeshStandardMaterial());
  const lamp = new THREE.Group();
  lamp.userData.isItem = true;
  g.add(body, cab, lamp);
  return { g, body, cab, lamp };
}
const el = { min: [7.8, 0, -4.95], max: [12.2, 1.4, -3.05] };
/** A "built" model: a 1 m long car-ish box lying nose to camera (along z), its middle off-centre, as TRELLIS answers. */
const built = () => {
  const s = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.3, 1), new THREE.MeshStandardMaterial({ color: 0xf2c500 }));
  m.position.set(0.1, 0.2, 0.05);
  s.add(m);
  return { scene: s };
};
const URL_OK = "/api/media/generated-videos/u/sets/s.model.c_1a2b3c4d_12_-40.abc.n.glb?v=sig";

describe("a thing drawn from its model", () => {
  it("replaces the blocks with the model, fitted the set page's way, and keeps what is parented to it", async () => {
    const { g, body, cab, lamp } = thing();
    const kept = { blocks: null as THREE.Object3D[] | null };
    const r = await showModel({ THREE, load: async () => built(), obj: g, url: URL_OK, kept, place: (root) => holderForThing(THREE, root, el, false, [10, 0, -4]) });
    expect(r).toBe("model");
    expect(g.children).toContain(lamp);
    expect(g.children).not.toContain(body);
    expect(g.children).not.toContain(cab);
    expect(kept.blocks).toEqual([body, cab]);
    const holder = g.children.find((c) => c.userData.modelHolder)!;
    // The model's world box: the blocks' length (4.4 m along x, turned a quarter), on the ground, on the blocks' middle.
    g.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(holder);
    expect(b.max.x - b.min.x).toBeCloseTo(4.4, 3);
    expect(b.min.y).toBeCloseTo(0, 4);
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(10, 3);
    expect((b.min.z + b.max.z) / 2).toBeCloseTo(-4, 3);
    // …which is thing-model.ts's own fit.
    const fit = fitThingModel({ min: [-0.115, 0.05, -0.45], max: [0.315, 0.35, 0.55] }, { min: el.min as never, max: el.max as never });
    expect(fit.turnDeg).toBe(90);
    expect(holder.children[0].rotation.y).toBeCloseTo(Math.PI / 2, 6);
  });

  it("falls back to the blocks when the model won't load, holds nothing, or isn't an address we serve", async () => {
    for (const [load, url] of [
      [async () => Promise.reject(new Error("404")), URL_OK],
      [async () => ({ scene: new THREE.Group() }), URL_OK],
      [async () => built(), "https://evil.example/car.glb"],
    ] as const) {
      const { g, body, cab } = thing();
      const kept = { blocks: null as THREE.Object3D[] | null };
      const errors: unknown[] = [];
      const r = await showModel({ THREE, load, obj: g, url, kept, place: (root) => holderForThing(THREE, root, el, false, [10, 0, -4]), onError: (e) => errors.push(e) });
      expect(r).toBe("blocks");
      expect(blocksOf(g)).toEqual([body, cab]);
      expect(g.children.some((c) => c.userData.modelHolder)).toBe(false);
      expect(kept.blocks).toBeNull();
      expect(errors).toHaveLength(1);
    }
  });

  it("a second model replaces the first, and the blocks stay kept once", async () => {
    const { g, body, cab } = thing();
    const kept = { blocks: null as THREE.Object3D[] | null };
    const place = (root: THREE.Object3D) => holderForThing(THREE, root, el, false, [10, 0, -4]);
    await showModel({ THREE, load: async () => built(), obj: g, url: URL_OK, kept, place });
    await showModel({ THREE, load: async () => built(), obj: g, url: URL_OK.replace("abc", "abd"), kept, place });
    expect(g.children.filter((c) => c.userData.modelHolder)).toHaveLength(1);
    expect(kept.blocks).toEqual([body, cab]);
  });
});

describe("Model from a photo, pressed", () => {
  const JPEG = "data:image/jpeg;base64,/9j/4AAQ";
  const H = { requestId: "req-12345678", statusUrl: "https://queue.fal.run/fal-ai/trellis-2/requests/req-12345678/status", responseUrl: "https://queue.fal.run/fal-ai/trellis-2/requests/req-12345678" };
  const doors = (over: Partial<ModelBuildDoors> = {}) => {
    const calls: string[] = [];
    let t = 0;
    let polls = 0;
    const d: ModelBuildDoors = {
      addPhoto: async (setId, input) => (calls.push(`addPhoto ${input.element} ${input.photoDataUri === JPEG}`), { error: null, photo: { refId: "33333333-3333-4333-8333-333333333333" } }),
      startThing: async (setId, key, input) => (calls.push(`startThing ${key} ${input?.refId}`), { error: null, key, handle: H }),
      pollThing: async (setId, input) => (calls.push(`pollThing ${input.key}`), ++polls < 3 ? { error: null, state: "working" } : { error: null, state: "done", model: { key: input.key, url: "/api/media/x.glb?v=1", flip: false } }),
      startNew: async () => (calls.push("startNew"), { error: null, handle: H }),
      pollNew: async () => (calls.push("pollNew"), { error: null, state: "done", file: "u/sets/s.studio-model.1.0123456789abcdef.glb", url: "/api/media/y.glb?v=2" }),
      alive: () => true,
      sleep: async (ms) => void (t += ms),
      now: () => t,
      waitMs: 60_000,
      pollMs: 4_000,
      failed: "failed",
      unreachable: "unreachable",
      ...over,
    };
    return { d, calls };
  };

  it("puts the crop on the thing, builds from THAT photo only, asks until done — and sends nothing twice", async () => {
    const { d, calls } = doors();
    const phases: string[] = [];
    const r = await pressModelBuild(d, "set", { key: "c_1a2b3c4d_12_-40" }, JPEG, (p) => phases.push(p));
    expect(r).toEqual({ error: null, thing: { key: "c_1a2b3c4d_12_-40", url: "/api/media/x.glb?v=1", flip: false } });
    expect(calls).toEqual(["addPhoto c_1a2b3c4d_12_-40 true", "startThing c_1a2b3c4d_12_-40 33333333-3333-4333-8333-333333333333", "pollThing c_1a2b3c4d_12_-40", "pollThing c_1a2b3c4d_12_-40", "pollThing c_1a2b3c4d_12_-40"]);
    expect(phases).toEqual(["photo", "building", "placing"]);
  });

  it("a new object's photo goes to its own build and comes back as a Studio file", async () => {
    const { d, calls } = doors();
    expect(await pressModelBuild(d, "set", { new: true }, JPEG, () => {})).toEqual({ error: null, file: { file: "u/sets/s.studio-model.1.0123456789abcdef.glb", url: "/api/media/y.glb?v=2" } });
    expect(calls).toEqual(["startNew", "pollNew"]);
  });

  it("says the server's refusal, the wait running out, and a lost connection — and never starts a build on a refused photo", async () => {
    const refused = doors({ addPhoto: async () => ({ error: "This photo can't be used." }) });
    expect(await pressModelBuild(refused.d, "set", { key: "c_1a2b3c4d_12_-40" }, JPEG, () => {})).toEqual({ error: "This photo can't be used." });
    expect(refused.calls).toEqual([]);
    const slow = doors({ pollThing: async () => ({ error: null, state: "working" }) });
    expect(await pressModelBuild(slow.d, "set", { key: "c_1a2b3c4d_12_-40" }, JPEG, () => {})).toEqual({ error: "failed" });
    const lost = doors({ startThing: async () => Promise.reject(new Error("network")) });
    expect(await pressModelBuild(lost.d, "set", { key: "c_1a2b3c4d_12_-40" }, JPEG, () => {})).toEqual({ error: "unreachable" });
    expect(await pressModelBuild(doors().d, "set", { key: "c_1a2b3c4d_12_-40" }, "data:image/png;base64,x", () => {})).toEqual({ error: "failed" });
  });
});

describe("an imported model, kept", () => {
  it("goes to the address made for it, then is kept — or says why not", async () => {
    const seen: string[] = [];
    const file = new Blob([new Uint8Array(100)]);
    const ok = await keepStudioImport(
      {
        reserve: async (_s, i) => (seen.push(`reserve ${i.size}`), { error: null, path: "p.glb", token: "tok" }),
        upload: async (path, token) => (seen.push(`upload ${path} ${token}`), { error: null }),
        keep: async (_s, i) => (seen.push(`keep ${i.path}`), { error: null, file: i.path, url: "/api/media/p.glb?v=1" }),
        failed: "failed",
      },
      "set",
      file,
    );
    expect(ok).toEqual({ error: null, file: "p.glb", url: "/api/media/p.glb?v=1" });
    expect(seen).toEqual(["reserve 100", "upload p.glb tok", "keep p.glb"]);
    const up = await keepStudioImport({ reserve: async () => ({ error: null, path: "p", token: "t" }), upload: async () => ({ error: new Error("x") }), keep: async () => ({ error: "never" }), failed: "failed" }, "set", file);
    expect(up).toEqual({ error: "failed" });
  });
});
