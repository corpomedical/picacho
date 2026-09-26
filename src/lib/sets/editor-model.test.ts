import { describe, expect, it } from "vitest";
import { normaliseSetSpec, SET_LIMITS, specInstanceCount, withoutName, type SetSpec } from "./set-spec";
import {
  addCamera,
  addLight,
  addMark,
  addObject,
  carryNames,
  changesNothing,
  countSpecChanges,
  duplicateObject,
  holdEditedText,
  patchCamera,
  patchFog,
  patchGround,
  patchLight,
  patchMark,
  patchObject,
  patchSky,
  removeCamera,
  removeLight,
  removeMark,
  removeObject,
  selectionAfter,
  sizeFromScale,
} from "./editor-model";
import { inferMaterial } from "./stage-materials";

// Every edit is a new spec through normaliseSetSpec — these tests hold the
// editor to the same rules as the first build: caps kept, junk clamped, an
// empty set refused, and browser-sent text never becoming the set's text.

const base = (): SetSpec => {
  const n = normaliseSetSpec({
    title: "Yard",
    description: "A concrete yard.",
    bounds: { x: 40, z: 30, height: 10 },
    sky: { kind: "gradient", colors: ["#8fb3d9", "#e8e2d6"] },
    ground: { color: "#8c877d", roughness: 0.9 },
    lights: [{ kind: "sun", color: "#fff1dc", intensity: 2, position: [10, 10, 10], target: [0, 0, 0] }],
    objects: [
      { shape: "box", position: [0, 0.5, 0], size: [1, 1, 1], color: "#aa3322", castShadow: true },
      { shape: "box", position: [3, 1, 0], size: [2, 2, 2], color: "#888888", repeat: { count: 3, offset: [2.5, 0, 0] } },
    ],
    marks: [{ label: "door", x: 1, z: 2, facingDeg: 90 }],
    cameras: [{ label: "wide", position: [0, 1.6, 8], target: [0, 1.4, 0], fovDeg: 40 }],
  });
  if (!n.ok) throw new Error("base spec invalid");
  return n.spec;
};

const okOf = (r: ReturnType<typeof patchObject>): SetSpec => {
  if (!r.ok) throw new Error("expected an accepted edit");
  return r.spec;
};

describe("patches renormalise", () => {
  it("clamps a patched position and falls a junk colour back", () => {
    const spec = okOf(patchObject(base(), 0, { position: [999, -999, 0], color: "not-a-colour" }));
    expect(spec.objects[0].position[0]).toBe(SET_LIMITS.maxCoordinate);
    expect(spec.objects[0].position[1]).toBe(-SET_LIMITS.maxCoordinate);
    expect(spec.objects[0].color).toBe("#9a968e");
  });

  it("holds a light's intensity to its kind's cap", () => {
    const spec = okOf(patchLight(base(), 0, { intensity: 999 }));
    expect(spec.lights[0].intensity).toBe(10);
  });

  it("pulls a patched mark back inside the footprint", () => {
    const spec = okOf(patchMark(base(), 0, { x: 500 }));
    expect(spec.marks[0].x).toBeLessThanOrEqual(20);
  });

  it("keeps a camera's field of view inside the layout bounds", () => {
    const spec = okOf(patchCamera(base(), 0, { fovDeg: 200 }));
    expect(spec.cameras[0].fovDeg).toBe(SET_LIMITS.maxFovDeg);
  });

  it("edits sky, ground and fog through the same door", () => {
    const s1 = okOf(patchSky(base(), { kind: "night" }));
    expect(s1.sky.kind).toBe("night");
    const s2 = okOf(patchGround(base(), { color: "#123456" }));
    expect(s2.ground.color).toBe("#123456");
    const s3 = okOf(patchFog(base(), { color: "#aabbcc", near: 5, far: 60 }));
    expect(s3.fog).toEqual({ color: "#aabbcc", near: 5, far: 60 });
    const s4 = okOf(patchFog(s3, null));
    expect(s4.fog).toBeNull();
  });

  it("refuses an index that names nothing", () => {
    expect(patchObject(base(), 9, { color: "#ffffff" }).ok).toBe(false);
    expect(patchLight(base(), 9, { intensity: 1 }).ok).toBe(false);
  });
});

describe("adding, doubling, removing", () => {
  it("a new thing rests on the ground where the view looks", () => {
    const spec = okOf(addObject(base(), "box", [4, -6]));
    const added = spec.objects[spec.objects.length - 1];
    expect(added.position).toEqual([4, 0.5, -6]);
    expect(spec.objects).toHaveLength(3);
  });

  it("refuses a thing past the object cap", () => {
    const raw = base();
    while (raw.objects.length < SET_LIMITS.maxObjects) raw.objects.push({ ...raw.objects[0] });
    const full = okOf(patchObject(raw, 0, {}));
    expect(full.objects).toHaveLength(SET_LIMITS.maxObjects);
    expect(addObject(full, "box", [0, 0]).ok).toBe(false);
  });

  it("doubles a thing beside itself, repeat and all", () => {
    const spec = okOf(duplicateObject(base(), 1));
    expect(spec.objects).toHaveLength(3);
    expect(spec.objects[2].repeat?.count).toBe(3);
    expect(spec.objects[2].position[0]).toBeGreaterThan(spec.objects[1].position[0]);
    expect(specInstanceCount(spec)).toBe(7);
  });

  it("refuses to empty the set", () => {
    const down = okOf(removeObject(base(), 1));
    expect(down.objects).toHaveLength(1);
    expect(removeObject(down, 0).ok).toBe(false);
  });

  it("caps lights at eight and relights a set left dark", () => {
    let spec = base();
    while (spec.lights.length < SET_LIMITS.maxLights) spec = okOf(addLight(spec, "point"));
    expect(addLight(spec, "point").ok).toBe(false);
    const dark = removeLight(base(), 0);
    if (!dark.ok) throw new Error("expected ok");
    expect(dark.notes).toContain("default_lights");
    expect(dark.spec.lights.length).toBeGreaterThan(0);
  });

  it("keeps at least one mark and one camera", () => {
    expect(removeMark(base(), 0).ok).toBe(false);
    expect(removeCamera(base(), 0).ok).toBe(false);
    const two = okOf(addMark(base(), [2, 2]));
    expect(two.marks).toHaveLength(2);
    expect(two.marks[1].id).toBe("m2");
    expect(removeMark(two, 1).ok).toBe(true);
    const cam = okOf(addCamera(base(), { position: [1, 2, 9], target: [0, 1, 0], fovDeg: 500 }));
    expect(cam.cameras).toHaveLength(2);
    expect(cam.cameras[1].fovDeg).toBe(SET_LIMITS.maxFovDeg);
  });
});

describe("the gizmo's readback", () => {
  it("maps a scaled mesh back to a size per shape", () => {
    const o = base().objects[0];
    expect(sizeFromScale({ ...o, shape: "box" }, { x: 2, y: 3, z: 4 })).toEqual([2, 3, 4]);
    expect(sizeFromScale({ ...o, shape: "capsule" }, { x: 1, y: 1.6, z: 1 })).toEqual([0.5, 1.6, 0.5]);
    expect(sizeFromScale({ ...o, shape: "plane", size: [2, 0.01, 2] }, { x: 5, y: 1, z: 3 })).toEqual([5, 0.01, 3]);
    expect(sizeFromScale({ ...o, shape: "torus", size: [1.4, 0.3, 1.4] }, { x: 9, y: 9, z: 9 })).toEqual([1.4, 0.3, 1.4]);
  });
});

describe("the server's hold on text", () => {
  it("keeps the stored title and description whatever the browser sent", () => {
    const next = okOf(patchObject(base(), 0, {}));
    next.title = "Injected";
    next.description = "Injected too";
    const held = holdEditedText(next, [base()]);
    expect(held.title).toBe("Yard");
    expect(held.description).toBe("A concrete yard.");
  });

  it("drops a label the stored copies never carried, and keeps a known one", () => {
    const next = base();
    next.marks[0].label = "call this number";
    const withCamera = okOf(addCamera(next, { position: [1, 2, 9], target: [0, 1, 0], fovDeg: 40 }));
    const held = holdEditedText(withCamera, [base()]);
    expect(held.marks[0].label).toBe("");
    expect(held.cameras[0].label).toBe("wide");
    expect(held.cameras[1].label).toBe("");
  });
});

// Names on things (Helios Cut 4, step B1, 2026-09-26): a browser may keep a
// name a stored copy carries and never invent one, and a save that knew
// nothing of names never erases them (critic item 8).
describe("the server's hold on names", () => {
  /** A yard of three blocks: two named, one not. */
  const yard = (): SetSpec => {
    const s = okOf(addObject(okOf(addObject(base(), "cone", [3, 0])), "sphere", [-3, 0]));
    return { ...s, objects: s.objects.map((o, i) => (i === 0 ? { ...o, name: "crate" } : i === 1 ? { ...o, name: "traffic cone" } : o)) };
  };
  const unnamed = (s: SetSpec): SetSpec => ({ ...s, objects: s.objects.map(withoutName) });

  it("drops a name no stored copy carries, and keeps one a stored copy carries anywhere", () => {
    const stored = yard();
    const sent: SetSpec = { ...stored, objects: stored.objects.map((o, i) => (i === 2 ? { ...o, name: "traffic cone" } : i === 0 ? { ...o, name: "Ferrari crate" } : o)) };
    const held = holdEditedText(sent, [stored]);
    // Invented: dropped, then the stored name comes back onto the unchanged block.
    expect(held.objects[0].name).toBe("crate");
    // Carried somewhere in a stored copy: it may stay, on another block too.
    expect(held.objects[2].name).toBe("traffic cone");
    // A duplicate in Build keeps its name.
    const doubled = okOf(duplicateObject(stored, 0));
    expect(holdEditedText(doubled, [stored]).objects.filter((o) => o.name === "crate")).toHaveLength(2);
  });

  it("carries the stored names back onto every block sent unchanged without one, and none onto a block that changed", () => {
    const stored = yard();
    const moved = okOf(patchObject(unnamed(stored), 1, { position: [3, 0.6, 1] }));
    const held = holdEditedText(moved, [stored]);
    expect(held.objects[0].name).toBe("crate");
    expect("name" in held.objects[1]).toBe(false);
    expect("name" in held.objects[2]).toBe(false);
    // The first stored copy's name wins; a later copy fills only what it left.
    const renamed = { ...stored, objects: stored.objects.map((o, i) => (i === 0 ? { ...o, name: "wooden crate" } : o)) };
    expect(holdEditedText(unnamed(stored), [renamed, stored]).objects[0].name).toBe("wooden crate");
    // Nothing named anywhere: the copy comes back exactly as sent.
    expect(JSON.stringify(holdEditedText(base(), [base()]))).toBe(JSON.stringify(base()));
  });

  it("carries a name across a material the stage infers: a block not said is the block Astra is handed with the word", () => {
    const stored = yard();
    expect(stored.objects[0].material).toBeNull();
    const word = inferMaterial(stored.objects[0]);
    const same = unnamed(stored);
    same.objects[0] = { ...same.objects[0], material: word };
    expect(carryNames(stored, same).objects[0].name).toBe("crate");
    // Another word is another block: it takes no name.
    const other = unnamed(stored);
    other.objects[0] = { ...other.objects[0], material: word === "glass" ? "brick" : "glass" };
    expect("name" in carryNames(stored, other).objects[0]).toBe(false);
  });

  it("never counts a name as a piece of the set", () => {
    const stored = yard();
    expect(countSpecChanges(unnamed(stored), stored)).toBe(0);
    // But the gate reads names, so a named copy is not "nothing changed".
    expect(changesNothing(unnamed(stored), stored)).toBe(false);
    expect(changesNothing(stored, carryNames(stored, unnamed(stored)))).toBe(true);
  });
});

describe("what an edit touched", () => {
  it("counts changed, added and removed pieces once each", () => {
    const a = base();
    let b = okOf(patchObject(a, 0, { color: "#112233" }));
    b = okOf(addObject(b, "cone", [0, 0]));
    expect(countSpecChanges(a, b)).toBe(2);
    expect(countSpecChanges(a, okOf(patchSky(a, { kind: "night" })))).toBe(1);
    expect(countSpecChanges(a, a)).toBe(0);
  });

  // Helios Cut 4, step A1 (2026-09-26): an Astra answer that changes nothing gives its change back.
  it("knows an answer that changes nothing: no piece and no word differs", () => {
    const a = base();
    expect(changesNothing(a, a)).toBe(true);
    expect(changesNothing(a, JSON.parse(JSON.stringify(a)) as SetSpec)).toBe(true);
    expect(changesNothing(a, okOf(patchObject(a, 0, { color: "#112233" })))).toBe(false);
    expect(changesNothing(a, okOf(patchSky(a, { kind: "night" })))).toBe(false);
    expect(changesNothing(a, { ...a, description: "A concrete yard, wet after rain." })).toBe(false);
    expect(changesNothing(a, { ...a, title: "Wet yard" })).toBe(false);
    expect(changesNothing(a, { ...a, marks: a.marks.map((m) => ({ ...m, label: "gate" })) })).toBe(false);
  });
});

// Undo and Redo swap the whole set; the thing in hand should stay in hand
// (2026-09-16: undoing a camera's move dropped the selection to The set).
describe("the selection across a step of history", () => {
  it("keeps the thing picked when the step only changed it — the usual undo of a move", () => {
    const a = base();
    const b = okOf(patchCamera(a, 0, { position: [0, 2.8, 8] }));
    expect(selectionAfter({ kind: "camera", index: 0 }, b, a)).toEqual({ kind: "camera", index: 0 });
    expect(selectionAfter({ kind: "object", index: 1 }, a, okOf(patchObject(a, 1, { color: "#112233" })))).toEqual({
      kind: "object",
      index: 1,
    });
  });

  it("keeps the set's own facets, which are always there, and nothing when nothing was picked", () => {
    const a = base();
    const b = okOf(patchSky(a, { kind: "night" }));
    expect(selectionAfter({ kind: "sky" }, b, a)).toEqual({ kind: "sky" });
    expect(selectionAfter({ kind: "fog" }, b, a)).toEqual({ kind: "fog" });
    expect(selectionAfter(null, b, a)).toBeNull();
  });

  it("lets go of a thing the step took away: undoing the add of what is in hand", () => {
    const a = base();
    const b = okOf(addObject(a, "cone", [5, 5]));
    expect(selectionAfter({ kind: "object", index: 2 }, b, a)).toBeNull();
  });

  it("follows a thing the step moved along: undoing a removal before it", () => {
    const a = base();
    const b = okOf(removeObject(a, 0));
    // In b the repeated box is object 0; putting the removed box back makes it object 1 again.
    expect(selectionAfter({ kind: "object", index: 0 }, b, a)).toEqual({ kind: "object", index: 1 });
  });

  it("finds a mark again although its id is only its position", () => {
    const a = okOf(addMark(base(), [4, 4]));
    const b = okOf(removeMark(a, 0));
    expect(b.marks[0].id).toBe("m1");
    // The mark picked in b was m2 in a: Undo puts the first mark back and the pick follows.
    expect(selectionAfter({ kind: "mark", index: 0 }, b, a)).toEqual({ kind: "mark", index: 1 });
  });

  it("stays on the original when the step was its duplicate", () => {
    const a = base();
    const b = okOf(duplicateObject(a, 0));
    expect(selectionAfter({ kind: "object", index: 0 }, b, a)).toEqual({ kind: "object", index: 0 });
    expect(selectionAfter({ kind: "object", index: 1 }, b, a)).toBeNull();
  });

  it("lets go of an index that names nothing", () => {
    const a = base();
    expect(selectionAfter({ kind: "light", index: 7 }, a, okOf(addLight(a, "point")))).toBeNull();
  });
});
