import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { keysAround, rowInterp, segmentInterp } from "./studio-keyframes";
import { validateStudioPlan } from "./studio-astra";

// Astra's camera keys (2026-09-30, live: "Apply 6 steps" — keys at 1 and 120, constant at 40 and 80, Track To kept on
// the stand-in — and the camera at frames 20/60/101 looked unchanged). Constant was set on the WHOLE camera, so it
// held frame 1's place until frame 40; and a key given a place without a mode was keyed where the camera stood.

const f = (frame: number) => (frame - 1) / 24;
const K = (frame: number, x: number, ip?: string) => ({ t: f(frame), p: [x, 0, 0], ...(ip ? { ip } : {}) });
const xAt = (keys: ReturnType<typeof K>[], frame: number, objectInterp = "bezier") => {
  const r = keysAround(keys, f(frame), objectInterp)!;
  return r.a.p[0] + (r.b.p[0] - r.a.p[0]) * r.u;
};

describe("each key's own interpolation (Blender's)", () => {
  const keys = [K(1, 0), K(40, 10, "constant"), K(80, 20, "constant"), K(120, 30)];
  it("constant at 40 and 80 holds those keys until the next — and only those", () => {
    expect(xAt(keys, 20)).toBeGreaterThan(0); // 1 → 40 still eases: the camera moves by frame 20
    expect(xAt(keys, 20)).toBeLessThan(10);
    expect(xAt(keys, 40)).toBe(10); // on its key's frame, the key's place
    expect(xAt(keys, 60)).toBe(10); // held: a cut at 40
    expect(xAt(keys, 79)).toBe(10);
    expect(xAt(keys, 80)).toBe(20);
    expect(xAt(keys, 101)).toBe(20); // held: a cut at 80
    expect(xAt(keys, 120)).toBe(30);
    expect(xAt(keys, 200)).toBe(30);
  });
  it("a key without its own follows the object's (every scene saved before), and the row says mixed", () => {
    const plain = [K(1, 0), K(40, 10), K(80, 20)];
    expect(xAt(plain, 20, "constant")).toBe(0);
    expect(xAt(plain, 20, "linear")).toBeCloseTo((19 / 39) * 10, 6);
    expect(segmentInterp({ ip: "bogus" }, "linear")).toBe("linear");
    expect(rowInterp(keys, "bezier")).toBe("mixed");
    expect(rowInterp(plain, "linear")).toBe("linear");
  });
});

describe("Astra's key steps", () => {
  const known = { ids: new Map([["o5", "Shot camera"], ["o6", "Stand-in"]]), camera: "o5" };
  const key = (o: Record<string, unknown>) =>
    validateStudioPlan({ reply: "", question: "", options: [], steps: [{ say: "Key the camera", op: "key", targets: ["camera"], kind: "", mode: "", x: null, y: null, z: null, value: 1, ...o }] }, known).steps[0];
  it("a key given a place is keyed THERE, even with no mode", () => {
    expect(key({ x: -3, y: -9, z: 1.6 })).toMatchObject({ op: "key", targets: ["o5"], frame: 1, mode: "to", v: { x: -3, y: -9, z: 1.6 } });
    expect(key({})).toMatchObject({ mode: null, v: null });
    expect(key({ value: 40, kind: "constant" })).toMatchObject({ frame: 40, interp: "constant" });
  });
});

describe("the engine (source)", () => {
  const engine = readFileSync(join(__dirname, "../../components/studio/studio-engine.ts"), "utf8");
  it("evaluates by each key's interpolation, and Astra's interpolation goes on its key", () => {
    expect(engine).toContain("const { a, b, u } = keysAround(ks, t, it.interp);");
    expect(engine).toContain("keyAtCmd(it, t, () => { if (s.mode && s.v) moveBy(it, s.mode, s.v); }, s.interp || null);");
    expect(engine).toContain("if (ip) { const k = it.keys.find((x) => near(x.t, t)); if (k) k.ip = ip; }");
  });
  it("a camera is placed by its own origin (the lens), not the bottom of its body", () => {
    expect(engine).toContain('const b = worldBox(it), origin = ["camera", "light", "empty"].includes(it.kind);');
  });
  it("the timeline shows the rows of what Astra keyed", () => {
    expect(engine).toContain("const keyed = keep.find((t) => t.keys.length || t.poseKeys?.length);");
  });
});
