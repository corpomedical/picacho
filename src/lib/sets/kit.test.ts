import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { KIT_KINDS, kitObjects, kitSize, turnedRotation } from "./kit";
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

describe("a kit part's turn", () => {
  it("is the same rotation three would build: the facing about the world's Y, then the part's own tilt", () => {
    // Adding the facing to the Y of an XYZ euler is not that turn once the
    // part is tilted about anything else — a bench's backrest leaned over
    // its seat at 180° (found reviewing Helios, 2026-09-17).
    const DEG = Math.PI / 180;
    for (const tilt of [[-8, 0, 0], [0, 0, 12], [-8, 20, 12], [0, 35, 0]] as const) {
      for (const facing of [0, 45, 90, 135, 180, 225, 270, 315]) {
        const want = new THREE.Matrix4()
          .makeRotationY(facing * DEG)
          .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(tilt[0] * DEG, tilt[1] * DEG, tilt[2] * DEG, "XYZ")));
        const got = new THREE.Matrix4().makeRotationFromEuler(
          new THREE.Euler(...(turnedRotation([...tilt] as [number, number, number], facing).map((d) => d * DEG) as [number, number, number]), "XYZ"),
        );
        for (let i = 0; i < 16; i++) expect(got.elements[i], `${tilt} at ${facing}`).toBeCloseTo(want.elements[i], 4);
      }
    }
  });

  it("keeps a plain turn plain", () => {
    expect(turnedRotation([0, 10, 0], 180)).toEqual([0, 190, 0]);
    expect(turnedRotation([0, 0, 0], 270)).toEqual([0, 270, 0]);
  });
});
