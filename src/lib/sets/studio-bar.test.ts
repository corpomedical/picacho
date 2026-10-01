import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ANIM_CHIPS,
  BAR_MODEL_DEFAULT,
  BAR_MODES,
  CAMERA_PRESETS,
  aimRotation,
  barAvoid,
  barModelPayload,
  cameraMoveKeys,
  clampBarOffset,
  engineForKind,
  normaliseCameraForm,
  type BarModelState,
} from "./studio-bar";

// Helios Studio's prompt bar (2026-10-01, operator: "Finalizing the UI to look and work like this"): the payload each
// mode sends, the camera moves' keys, and where the bar may stand.

const IMG = "data:image/jpeg;base64,/9j/";
const m = (x: Partial<BarModelState>): BarModelState => ({ ...BAR_MODEL_DEFAULT, images: {}, ...x });
const ENGINE = readFileSync(join(__dirname, "../../components/studio/studio-engine.ts"), "utf8");
const bar = ENGINE.slice(ENGINE.indexOf("// ================= the prompt bar"), ENGINE.indexOf("// ================= loop ================="));

describe("the bar's modes", () => {
  it("has the add-on's seven tabs, in its order", () => {
    expect(BAR_MODES.map((x) => x.label)).toEqual(["Scene builder", "3D Model", "Animation", "Image", "Video", "Camera", "Assets"]);
  });
});

describe("3D Model: what the press sends", () => {
  it("text: the words, no pictures, a new object; priced from the engine's constants", () => {
    const p = barModelPayload(m({ engine: "hunyuan-3.1-pro", kind: "text", prompt: "  a knight  ", images: { front: IMG } }));
    expect(p).toEqual({ error: null, usd: 0.375, input: { engine: "hunyuan-3.1-pro", kind: "text", prompt: "a knight", images: {}, options: { ...BAR_MODEL_DEFAULT.options }, target: { new: true } } });
  });

  it("one photo: only the front picture; onto a thing when one is picked", () => {
    const p = barModelPayload(m({ engine: "tripo-2.5", kind: "image", images: { front: IMG, back: "B" }, target: "el:c_1234abcd_0_0", options: { ...BAR_MODEL_DEFAULT.options, textures: "hd", quad: true } }));
    expect(p.error).toBeNull();
    if (p.error === null) {
      expect(p.input.images).toEqual({ front: IMG });
      expect(p.input.target).toEqual({ key: "c_1234abcd_0_0" });
      expect(p.usd).toBe(0.45);
    }
  });

  it("multi-view: the four views; Hunyuan's multi-view and PBR priced in", () => {
    const p = barModelPayload(m({ engine: "hunyuan-3.1-pro", kind: "multi", images: { front: IMG, back: "B", left: "L", right: "R" }, options: { ...BAR_MODEL_DEFAULT.options, pbr: true } }));
    expect(p.error === null && p.input.images).toEqual({ front: IMG, back: "B", left: "L", right: "R" });
    expect(p.error === null && p.usd).toBe(0.675);
  });

  it("says why it can't go yet, and keeps an engine that builds from the kind", () => {
    expect(barModelPayload(m({ kind: "image" }))).toEqual({ error: "Add a photo first." });
    expect(barModelPayload(m({ engine: "trellis-2", kind: "text", prompt: "x" }))).toEqual({ error: "Pick an engine that builds from this." });
    expect(engineForKind("trellis-2", "text")).toBe("hunyuan-3.1-pro");
    expect(engineForKind("meshy-7.1", "multi")).toBe("meshy-7.1");
  });

  it("the engine's press takes a press id before anything is sent, once per press", () => {
    const go = bar.slice(bar.indexOf("async function barModelGo()"), bar.indexOf("// ---- Image and Video"));
    expect(go.indexOf("const pressId = newPressId();")).toBeLessThan(go.indexOf("MD.engines.run(pressId, pay.input"));
    expect(go).toContain("if (pb.busy) return;");
    expect(go).toContain("placeBuilt(r, colour, pb.modelSize)");
  });
});

describe("Image and Video: the same presses as their windows, reported in the bar", () => {
  it("Image takes the frame, the bar's words, the window's character, look, outfit and trace, then castGo", () => {
    const img = bar.slice(bar.indexOf("function barImageGo()"), bar.indexOf("function barVideoGo()"));
    expect(img).toContain("cast.frame = castFrame();");
    expect(img).toContain("cast.words = typed.slice(0, SET_DIRECTION_MAX_CHARS)");
    expect(img.indexOf("cast.bar = true; cast.result = null;")).toBeLessThan(img.indexOf("void castGo();"));
  });
  it("Video measures the range and figure as its window does, then rcGo", () => {
    const vid = bar.slice(bar.indexOf("function barVideoGo()"), bar.indexOf("// ---- Camera"));
    expect(vid).toContain("rcMeasure();");
    expect(vid.indexOf("rc.bar = true;")).toBeLessThan(vid.indexOf("void rcGo();"));
  });
  it("a window opened from the Render menu shows the press itself", () => {
    expect(ENGINE).toMatch(/function openCast\(\) \{\n  const R = opts\.render;\n[^\n]*\n  cast\.bar = false;/);
    expect(ENGINE).toMatch(/function openRecast\(\) \{\n  const R = opts\.recast;\n[^\n]*\n  rc\.bar = false;/);
    expect(ENGINE).toContain("if ((!open || $(\"dlg\").hidden) && cast.bar) { barRefresh(); return; }");
    expect(ENGINE).toContain("if ((!open || $(\"dlg\").hidden) && rc.bar) { barRefresh(); return; }");
  });
  it("Scene builder and the sidebar are one conversation: the bar sends through sendAstra and draws the same log", () => {
    expect(bar).toContain("sendAstra(t);");
    expect(bar).toContain("res.appendChild(astraMsgEl(astraLog[i], i))");
    expect(ENGINE).toMatch(/function renderThread\(\) \{\n[^\n]*\n  barAstraSync\(\);/);
  });
});

describe("Camera: presets written as the shot camera's keys", () => {
  const look: [number, number, number] = [0, 1, 0];
  const from: [number, number, number] = [0, 1.6, 6];
  const form = normaliseCameraForm({ distance: 6, height: 1.6, start: 1, end: 121 }, 240);
  const aimsAt = (k: { p: number[]; r: number[] }, l: number[]) => {
    const o = new THREE.Object3D(); o.rotation.set(k.r[0], k.r[1], k.r[2]);
    const fwd = new THREE.Vector3(0, 0, 1).applyEuler(o.rotation);
    const to = new THREE.Vector3(l[0] - k.p[0], l[1] - k.p[1], l[2] - k.p[2]).normalize();
    return fwd.dot(to);
  };

  it("Orbit: a full circle at the set distance and height, linear keys, each aimed at the subject", () => {
    const ks = cameraMoveKeys("orbit", form, look, from);
    expect(ks[0].frame).toBe(1); expect(ks[ks.length - 1].frame).toBe(121);
    expect(ks.length).toBeGreaterThanOrEqual(13);
    for (const k of ks) {
      expect(Math.hypot(k.p[0], k.p[2])).toBeCloseTo(6, 5);
      expect(k.p[1]).toBe(1.6);
      expect(k.ip).toBe("linear");
      expect(aimsAt(k, look)).toBeGreaterThan(0.999);
    }
    // It starts on the camera's own side, and the angles never jump a whole turn between keys.
    expect(ks[0].p[2]).toBeCloseTo(6, 5);
    for (let i = 1; i < ks.length; i++) expect(Math.abs(ks[i].r[1] - ks[i - 1].r[1])).toBeLessThan(1);
  });

  it("Push in / Pull out: two eased keys, nearer and farther", () => {
    const push = cameraMoveKeys("push", form, look, from), pull = cameraMoveKeys("pull", form, look, from);
    expect(push.map((k) => [k.frame, k.ip, Math.round(Math.hypot(k.p[0], k.p[2]) * 100) / 100])).toEqual([[1, "bezier", 6], [121, "bezier", 2.7]]);
    expect(pull.map((k) => Math.round(Math.hypot(k.p[0], k.p[2]) * 100) / 100)).toEqual([2.7, 6]);
  });

  it("Crane up rises while it aims at the subject", () => {
    const ks = cameraMoveKeys("crane", form, look, from);
    expect(ks[1].p[1]).toBeCloseTo(1.6 + 3.6, 5);
    for (const k of ks) expect(aimsAt(k, look)).toBeGreaterThan(0.999);
  });

  it("Follow keeps its offset from where the subject is on each key", () => {
    const at = (f: number): [number, number, number] => [f / 10, 1, 0];
    const ks = cameraMoveKeys("follow", form, look, from, at);
    for (const k of ks) { expect(k.p[0]).toBeCloseTo(k.frame / 10, 5); expect(k.p[2]).toBeCloseTo(6, 5); expect(aimsAt(k, at(k.frame))).toBeGreaterThan(0.999); }
    expect(new Set(ks.map((k) => k.ip))).toEqual(new Set(["linear"]));
  });

  it("Cuts: three constant keys a third of the range apart, three different angles", () => {
    const ks = cameraMoveKeys("cuts", form, look, from);
    expect(ks.map((k) => [k.frame, k.ip])).toEqual([[1, "constant"], [41, "constant"], [81, "constant"]]);
    expect(new Set(ks.map((k) => k.p.map((v) => v.toFixed(2)).join())).size).toBe(3);
  });

  it("the form stays inside the timeline and the stage; aimRotation picks the triple nearest the key before", () => {
    expect(normaliseCameraForm({ distance: 0, height: 999, start: 300, end: -4 }, 240)).toEqual({ distance: 0.5, height: 60, start: 239, end: 240 });
    const a = aimRotation([0, 1.6, -6], [0, 1, 0], null), b = aimRotation([0, 1.6, -6], [0, 1, 0], [a[0] + 2 * Math.PI, a[1], a[2]]);
    expect(b[0]).toBeCloseTo(a[0] + 2 * Math.PI, 5);
    expect(CAMERA_PRESETS.map((p) => p.id)).toEqual(["orbit", "push", "pull", "crane", "follow", "cuts"]);
  });

  it("the engine writes them as one undo step, removes a Track To that would turn it elsewhere, and keys each key's own interpolation", () => {
    const go = bar.slice(bar.indexOf("function barCameraGo()"), bar.indexOf("// ---- Assets"));
    expect(go).toContain("group(`Camera · ${label}`");
    expect(go).toContain("if (shot.obj.userData.track) setTrack(shot, null);");
    expect(go).toContain("if (kk) kk.ip = k.ip;");
  });
});

describe("Animation's chips", () => {
  it("are the Studio's own moves and poses", () => {
    expect(ANIM_CHIPS.map((c) => c.id)).toEqual(["walkCam", "walkTo", "runTo", "walkPoint", "path", "turnCam", "turnTo", "lookCam", "sitOn", "leanOn"]);
    for (const fn of ["goTo(it, shot, gait)", "turnTo(it, shot)", "lookAtCmd(it, shot)", "startPathDraw(it, true)", "sitOn(it, tgt)", "leanOn(it, tgt)"]) expect(bar).toContain(fn);
    expect(bar).toContain("presetCmd(pb.anim.who || who(), po.dataset.pbpose)");
  });
});

describe("where the bar stands", () => {
  const view = { left: 0, top: 0, width: 1200, height: 800 };
  const barAt = { left: 200, top: 560, width: 800, height: 226 };
  it("leaves the gizmo free: docks at the top of the viewport first", () => {
    expect(barAvoid(barAt, { x: 600, y: 650 }, view)).toEqual({ x: 0, y: 40 - 560 });
    expect(barAvoid(barAt, { x: 600, y: 300 }, view)).toEqual({ x: 0, y: 0 });
    expect(barAvoid(barAt, null, view)).toEqual({ x: 0, y: 0 });
  });
  it("just above the gizmo when the top is taken by it, below it next, and never off-screen", () => {
    // A bar dragged to the top with the gizmo under it: below the gizmo.
    expect(barAvoid({ left: 200, top: 40, width: 800, height: 200 }, { x: 600, y: 100 }, view)).toEqual({ x: 0, y: 100 + 72 - 40 });
    const tall = { left: 200, top: 40, width: 800, height: 700 };
    expect(barAvoid(tall, { x: 600, y: 400 }, view)).toEqual({ x: 0, y: 0 });
  });
  it("a dragged bar stays inside the viewport", () => {
    expect(clampBarOffset({ x: -999, y: 999 }, barAt, view)).toEqual({ x: -194, y: 8 });
    expect(clampBarOffset({ x: 20, y: -100 }, barAt, view)).toEqual({ x: 20, y: -100 });
  });
  it("never moves from under the pointer or a field being typed in, and always comes back inside the viewport", () => {
    expect(bar).toContain('pbEl.matches(":hover")');
    expect(bar).toContain("pbKeep();");
  });
});
