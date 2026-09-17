import { describe, expect, it } from "vitest";
import { KIT_KINDS, kitObjects, kitSize } from "./kit";
import { addKit } from "./editor-model";
import { normaliseSetSpec, SET_LIMITS, SET_MATERIALS } from "./set-spec";
import { checkSet } from "./set-check";
import showroom from "./fixtures-showroom-open.json";

// The kit (cut 5): real-sized props from the seven primitives, with words.

describe("kitObjects", () => {
  it("builds every kind from ordinary objects, each with a material word, standing on the ground", () => {
    for (const kind of KIT_KINDS) {
      const objects = kitObjects(kind, [3, -2]);
      expect(objects.length).toBe(kitSize(kind));
      for (const o of objects) {
        expect(SET_MATERIALS).toContain(o.material);
        // A part turned on its side stands as tall as its width.
        const tall = Math.abs(o.rotation[2]) === 90 ? o.size[0] : o.size[1];
        expect(o.position[1] - tall / 2).toBeGreaterThanOrEqual(-0.01);
        expect(o.repeat).toBeNull();
      }
    }
    expect(kitObjects("car", [0, 0]).filter((o) => o.shape === "cylinder")).toHaveLength(8);
  });

  it("turns to face where it is asked: a car facing +X has its length along X", () => {
    const facingZ = kitObjects("car", [0, 0], 0);
    const facingX = kitObjects("car", [0, 0], 90);
    const body = (list: typeof facingZ) => list[0];
    expect(body(facingZ).rotation[1]).toBe(0);
    expect(body(facingX).rotation[1]).toBe(90);
    // The headlamps sit forward: +Z when facing +Z, +X when facing +X.
    const lampZ = facingZ.find((o) => o.emissive === "#e8f5ff")!;
    const lampX = facingX.find((o) => o.emissive === "#e8f5ff")!;
    expect(lampZ.position[2]).toBeGreaterThan(2);
    expect(lampX.position[0]).toBeGreaterThan(2);
  });

  it("is placed by the editor, normalised, and reads clean in the set check", () => {
    const r = normaliseSetSpec(showroom);
    if (!r.ok) throw new Error("fixture");
    const before = r.spec.objects.length;
    const added = addKit(r.spec, "bench", [6, 2], 180);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.spec.objects.length).toBe(before + kitSize("bench"));
    expect(checkSet(added.spec).filter((f) => f.kind === "through")).toEqual([]);
    const full = { ...r.spec, objects: Array.from({ length: SET_LIMITS.maxObjects - 1 }, () => r.spec.objects[0]) };
    expect(addKit(full, "car", [0, 0]).ok).toBe(false);
  });
});
