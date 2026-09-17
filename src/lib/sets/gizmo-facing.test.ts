import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";

// The Turn gizmo and a mark's facing (found reviewing Helios, 2026-09-17).
// TransformControls turns the object by its quaternion; three then re-reads
// that quaternion as an XYZ euler, which keeps Y within ±90° and moves the
// rest into X and Z. The editor saved the euler's Y as the mark's facing,
// so every mark facing between 90° and 270° was saved facing somewhere
// else — 135° came back as 45°, and even a 1 px jitter on the ring did it,
// because the snap turns a tiny drag into no turn at all while three still
// rewrites the rotation. The way the figure points is the facing.

const DEG = Math.PI / 180;
const facingFromForward = (q: THREE.Quaternion) => {
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  return (((Math.atan2(forward.x, forward.z) / DEG) % 360) + 360) % 360;
};

describe("a mark's facing after a turn", () => {
  it("is the way it points, for every quarter of the compass", () => {
    for (const facing of [0, 30, 45, 90, 135, 180, 225, 270, 315, 359]) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, facing * DEG, 0));
      expect(Math.round(facingFromForward(q)), `facing ${facing}`).toBe(facing);
    }
  });

  it("is not the euler's Y once the turn passes a quarter turn", () => {
    // What the editor used to save: three's XYZ euler for the same rotation.
    const wrong = (facing: number) => {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, facing * DEG, 0));
      const euler = new THREE.Euler().setFromQuaternion(q, "XYZ");
      return Math.round((((euler.y / DEG) % 360) + 360) % 360);
    };
    expect(wrong(135)).toBe(45);
    expect(wrong(180)).toBe(0);
    expect(wrong(225)).toBe(315);
    // …while the way it points is right at each of them.
    for (const facing of [135, 180, 225]) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, facing * DEG, 0));
      expect(Math.round(facingFromForward(q))).toBe(facing);
    }
  });

  it("the editor reads it that way", () => {
    const editor = readFileSync(join(__dirname, "../../components/sets/set-editor.tsx"), "utf8");
    expect(editor).toContain('const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(obj.quaternion);');
    expect(editor).toContain("change.facingDeg = ((Math.atan2(forward.x, forward.z) / DEG) % 360 + 360) % 360;");
    expect(editor).toContain("if (change.facingDeg !== undefined) patch.facingDeg = Math.round(change.facingDeg) % 360;");
    expect(editor).not.toContain("patch.facingDeg = Math.round(((change.rotationDeg[1] % 360) + 360) % 360);");
  });
});
