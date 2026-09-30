/* eslint-disable */
// @ts-nocheck
// Helios Studio (2026-09-26, operator: "Build Helios first, and in stage 2
// build the physics"): the Blender-style workspace from the approved draft
// (artifact 3wkvd9QEst8BkSsjxSgYgC v6), running on the set's own spec. Kept
// as the draft's plain DOM code so what he approved is what runs; stage 1 is
// admins-only (HELIOS_STUDIO_FOR_ALL) and saves in the browser.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import * as CANNON from "cannon-es";
import { setElements } from "@/lib/sets/elements";
import { letterbox } from "@/lib/sets/rig";
import { SET_DIRECTION_MAX_CHARS } from "@/lib/sets/set-config";
import { studioShotInput } from "@/lib/sets/studio-shot";
import { CYCLES_DEFAULT_SAMPLES, CYCLES_EDGES, CYCLES_MAX_FRAMES, CYCLES_MAX_SAMPLES_ANIMATION, CYCLES_MAX_SAMPLES_STILL, CYCLES_MAX_SECONDS, CYCLES_TOO_LONG, HELIOS_CYCLES_GPU, cyclesDollars, cyclesDuration, cyclesSize, estimateCycles } from "@/lib/sets/cycles";
import { watchStudioText } from "./studio-i18n";
import { studioCastInput } from "./studio-cast";
import { boneOfMesh, makeFigure } from "./studio-figure";
import { BONE, BONE_NAMES, LIMBS, POSE_PRESETS, PRESET_LABELS, SEAT_DROP_M, applyPose, applyPreset, clampLoc, clampRot, clonePose, eulerNumbers, findSkeleton, groundFeet, lookRot, normalisePose, normalisePoseKeys, poseAt, poseSentence, poseWords, presetBones, presetPose, setPoseKey, solveLimb, standPoseOf, thingWords } from "@/lib/sets/studio-pose";
import { newPressId } from "@/lib/sets/press-follow";
import { ENV_H, ENV_W, SKY_DIFFUSE_SHARE, TRACE_MAX_SAMPLES, TRACE_PRESETS, TRACE_SCALES, TRACE_SLOW_SECONDS, TRACE_SPEED_KEY, envAddSplit, envAddSun, envUpIrradiance, loadOidn, luminance, meterExposure, oidnDenoise, physicalSunIrradiance, traceDuration, traceEstimate, traceSamples, traceSize } from "./studio-trace";
import { MATERIAL_RECIPES, hslOf, materialOf } from "@/lib/sets/stage-materials";
import { GRIP_TAP_PX, LONG_PRESS_MS, LONG_PRESS_SLOP_PX, STUDIO_COMPACT_QUERY, nextSheet, sheetDragHeight, sheetHeights, sheetSnap } from "@/lib/sets/studio-sheets";
import {
  STUDIO_ADD_KINDS,
  STUDIO_ASTRA_NOTHING,
  STUDIO_ASTRA_TOP_LINE,
  STUDIO_FORMATS,
  STUDIO_TURNS_MAX,
  besidePosition,
  clearNote,
  clearSpot,
  knownOf,
  normaliseStudioSummary,
  planActs,
  sideDirection,
  sizeFactors,
  toThreeAxes,
  toThreeSizes,
  validateStudioPlan,
} from "@/lib/sets/studio-astra";

export type StudioOptions = {
  setId: string;
  title: string;
  spec: any;
  backHref: string;
  /** The scene kept on the account (stage 3), or null. */
  savedScene?: any;
  /** Keeps the scene on the account; answers { error: null } when it did. */
  saveScene?: (scene: unknown) => Promise<{ error: string | null }>;
  /**
   * "Photo with your character" (stage 3): the set page's Shoot, handed in
   * (helios-studio.tsx → studio-press.ts → shootInSet). Absent, the Render
   * menu says it works inside Picacho.
   */
  render?: {
    credits: number;
    characters: { id: string; name: string; likenessNeeded: boolean }[];
    setHref: string;
    historyHref: (generationId: string) => string;
    /** What to say when the press itself could not be sent. */
    unreachable: string;
    shoot: (input: any, onPhase: (phase: "sent" | "checking" | "rendering") => void) => Promise<any>;
  };
  /**
   * Astra for any request (stage 4): the Studio's words, scene summary and
   * last turns go to askStudioAstra (helios-studio.tsx); the answer is a plan
   * ({ plan, answer }) or { error } in plain words. Absent, only the scripted
   * examples run.
   */
  /**
   * The person's language (stage 7) and its translator (studio-i18n.ts
   * studioTranslator). The engine writes English; everything it draws is
   * translated as it appears. Absent, English.
   */
  locale?: string;
  t?: (text: string) => string;
  /**
   * Blender (Cycles) renders on a cloud GPU (2026-09-29): the scene file and
   * the job go to studio-cycles.ts pressCycles (helios-studio.tsx). Absent or
   * null, the Render menu's two entries stay hidden.
   */
  cycles?: {
    unreachable: string;
    run: (glb: Blob, job: unknown, onUpdate: (u: any) => void) => Promise<any>;
  } | null;
  astra?: {
    unreachable: string;
    ask: (text: string, summary: unknown, turns: { who: "person" | "astra"; text: string }[]) => Promise<any>;
  };
};

export function startStudio(opts: StudioOptions): () => void {
const ac = new AbortController();
const withSig = (o) => (typeof o === "object" && o !== null ? { ...o, signal: ac.signal } : { capture: !!o, signal: ac.signal });
const wOn = (t, f, o) => window.addEventListener(t, f, withSig(o));
const dOn = (t, f, o) => document.addEventListener(t, f, withSig(o));
let stopped = false, raf = 0;
// The person's language (stage 7): T() for text the engine puts in a field
// or sends on; everything drawn is translated by watchStudioText below.
const T = (s) => (opts.t ? opts.t(s) : s);
const $ = (id) => document.getElementById(id);
const DUR = 10, FPS = 24, FRAMES = DUR * FPS;
const view = $("view"), canvas = $("c");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ================= scene =================
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
const fog = new THREE.Fog(0x9fb7cf, 45, 150); scene.fog = fog;
const editorCam = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
editorCam.position.set(15, 8.5, 17);
const orbit = new OrbitControls(editorCam, canvas);
orbit.target.set(0, 1, 0); orbit.enableDamping = true;
const hemi = new THREE.HemisphereLight(0xdfe8f5, 0x3b3a36, 0.9); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.6);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 140 });
sun.shadow.bias = -0.0004; scene.add(sun, sun.target);
const helpers = new THREE.Group(); scene.add(helpers);
const overlays = new THREE.Group(); helpers.add(overlays);
const grid = new THREE.GridHelper(120, 120, 0x55575d, 0x3c3e43); grid.material.transparent = true; grid.material.opacity = 0.55; grid.position.y = 0.004; overlays.add(grid);
const axLine = (a, b, c) => new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: c }));
overlays.add(axLine(new THREE.Vector3(-60, 0.006, 0), new THREE.Vector3(60, 0.006, 0), 0xff3352), axLine(new THREE.Vector3(0, 0.006, -60), new THREE.Vector3(0, 0.006, 60), 0x8bdc00));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), new THREE.MeshStandardMaterial({ color: 0x4a4b4f, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

// ================= objects =================
let nextId = 1, astraMaking = false, skyObj = null, physCache = null;
const MODE_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/></svg>`;
const items = [];
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...o });
function mesh(geo, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m; }
function makeCar(color = 0xc0282d) {
  const g = new THREE.Group(), paint = std(color, { metalness: 0.45, roughness: 0.3 });
  g.add(mesh(new THREE.BoxGeometry(4.4, 0.62, 1.9), paint, 0, 0.62, 0));
  g.add(mesh(new THREE.BoxGeometry(2.1, 0.5, 1.62), std(0x1b2230, { metalness: 0.6, roughness: 0.15 }), -0.35, 1.18, 0));
  g.add(mesh(new THREE.BoxGeometry(0.5, 0.08, 1.9), paint, -2.05, 1.15, 0));
  const tyre = std(0x121212, { roughness: 0.9 });
  for (const [x, z] of [[1.4, 0.95], [1.4, -0.95], [-1.4, 0.95], [-1.4, -0.95]]) { const w = mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.3, 24), tyre, x, 0.38, z); w.rotation.x = Math.PI / 2; g.add(w); }
  const head = std(0xffffff, { emissive: 0xfff3d6, emissiveIntensity: 1.2 }), tail = std(0x550000, { emissive: 0xff2020, emissiveIntensity: 1.1 });
  for (const z of [0.62, -0.62]) { g.add(mesh(new THREE.BoxGeometry(0.06, 0.12, 0.36), head, 2.21, 0.72, z)); g.add(mesh(new THREE.BoxGeometry(0.06, 0.1, 0.5), tail, -2.21, 0.74, z)); }
  g.userData.paint = [paint]; return g;
}
function makePerson() {
  // Helios Studio people (2026-09-30): the grey capsule became a posable mannequin (studio-figure.ts, rig in studio-pose.ts).
  return makeFigure(std(0xd9d1c5, { roughness: 0.62 }));
}
function makeLamp() {
  const g = new THREE.Group(), metal = std(0x2c2f35, { metalness: 0.6 });
  g.add(mesh(new THREE.CylinderGeometry(0.07, 0.1, 4.2, 12), metal, 0, 2.1, 0), mesh(new THREE.BoxGeometry(0.9, 0.08, 0.18), metal, 0.35, 4.2, 0), mesh(new THREE.BoxGeometry(0.34, 0.1, 0.22), std(0xfff2cf, { emissive: 0xffd28a, emissiveIntensity: 2 }), 0.7, 4.12, 0));
  const l = new THREE.PointLight(0xffd28a, 12, 14, 1.6); l.position.set(0.7, 3.95, 0); g.add(l);
  g.userData.paint = [metal]; return g;
}
function makeShotCamera() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.34, 0.26, 0.48), std(0x2d3139, { metalness: 0.4 }), 0, 0, -0.12));
  const lens = mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.22, 16), std(0x111111), 0, 0, 0.2); lens.rotation.x = Math.PI / 2; g.add(lens);
  // The lens looks along the group's +Z, so lookAt() on the group aims it (three turns a plain object's +Z to the target).
  const cam = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 400); cam.rotation.y = Math.PI; g.add(cam);
  g.userData.cam = cam; g.userData.lensMm = 35; g.userData.focus = 7; g.userData.fstop = 2.8; g.userData.paint = [];
  return g;
}
const building = (w, h, d, c) => { const b = mesh(new THREE.BoxGeometry(w, h, d), std(c, { roughness: 0.9 }), 0, h / 2, 0); const g = new THREE.Group(); g.add(b); g.userData.paint = [b.material]; return g; };
const lensToFov = (mm) => THREE.MathUtils.radToDeg(2 * Math.atan(12 / mm));

function tagIds(obj, id) { const walk = (o) => { o.userData.itemId = id; for (const c of o.children) if (!c.userData.isItem) walk(c); }; walk(obj); }
function addItem(obj, name, kind, coll) {
  obj.name = name; obj.userData.isItem = true;
  const item = { id: nextId++, name, kind, obj, keys: [], hidden: false, interp: "bezier", coll: coll || (kind === "camera" ? "Cameras" : kind === "light" ? "Lights" : "Set") };
  if (astraMaking) item.byAstra = true;
  if (obj.userData.figure) initFigure(item);
  tagIds(obj, item.id); scene.add(obj); items.push(item); return item;
}
function detachItem(item) { const i = items.indexOf(item); item.parentObj = item.obj.parent; item.obj.parent?.remove(item.obj); if (i >= 0) items.splice(i, 1); return i; }
function reattachItem(item, idx) { (item.parentObj || scene).add(item.obj); items.splice(idx < 0 ? items.length : idx, 0, item); }
const byId = (id) => items.find((i) => i.id === id);
const itemOf = (obj) => items.find((i) => i.obj === obj);

// ---- the set, built from its own spec: every thing is its own object ----
function objMesh(o, copy) {
  const [w, h, d] = o.size; let geo;
  switch (o.shape) {
    case "cylinder": geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 28); break;
    case "cone": geo = new THREE.ConeGeometry(0.5, 1, 28); break;
    case "sphere": geo = new THREE.SphereGeometry(0.5, 28, 18); break;
    case "capsule": geo = new THREE.CapsuleGeometry(0.5, 1, 6, 16); break;
    case "torus": geo = new THREE.TorusGeometry(0.4, 0.1, 12, 32); geo.rotateX(Math.PI / 2); break;
    default: geo = new THREE.BoxGeometry(1, 1, 1);
  }
  const mat = new THREE.MeshStandardMaterial({ color: o.color, roughness: o.roughness ?? 0.6, metalness: o.metalness ?? 0, ...(o.emissive ? { emissive: o.emissive, emissiveIntensity: o.emissiveIntensity ?? 1 } : {}) });
  const m = mesh(geo, mat);
  m.scale.set(Math.max(w, 0.01), Math.max(h, 0.01) / (o.shape === "capsule" ? 2 : 1), Math.max(d, 0.01));
  const off = o.repeat ? o.repeat.offset : [0, 0, 0];
  m.position.set(o.position[0] + off[0] * copy, o.position[1] + off[1] * copy, o.position[2] + off[2] * copy);
  m.rotation.set(THREE.MathUtils.degToRad(o.rotation[0]), THREE.MathUtils.degToRad(o.rotation[1]), THREE.MathUtils.degToRad(o.rotation[2]));
  m.castShadow = o.castShadow !== false;
  m.userData.word = materialOf(o); // the set's material word: the path tracer adds its physical layers (glass, sheen…)
  return m;
}
const SPEC = opts.spec;
const els = setElements(SPEC);
const inThing = new Set(); els.forEach((el) => el.members.forEach(([o, c]) => inThing.add(o + ":" + c)));
const placeGroup = new THREE.Group();
SPEC.objects.forEach((o, oi) => { const n = o.repeat ? o.repeat.count : 1; for (let c = 0; c < n; c++) if (!inThing.has(oi + ":" + c)) placeGroup.add(objMesh(o, c)); });
placeGroup.userData.paint = [];
const place = addItem(placeGroup, "The place", "mesh", "Set"); place.saveKey = "place";
let firstCar = null;
els.forEach((el) => {
  const g = new THREE.Group(); g.position.set(el.centre[0], 0, el.centre[2]); let big = null, bv = 0;
  el.members.forEach(([oi, c]) => { const o = SPEC.objects[oi], m = objMesh(o, c); m.position.sub(g.position); g.add(m); const v = o.size[0] * o.size[1] * o.size[2]; if (v > bv) { bv = v; big = m.material; } });
  g.userData.paint = big ? [big] : [];
  const named = el.members.map(([oi]) => SPEC.objects[oi].name).find(Boolean);
  const nm = named ? named[0].toUpperCase() + named.slice(1) : el.kind === "car" ? `Car ${el.ordinal}` : `Object ${el.ordinal}`;
  const it = addItem(g, nm, "mesh", "Cast"); it.saveKey = "el:" + el.key;
  if (el.kind === "car" && !firstCar) firstCar = it;
});
const person = addItem(makePerson(), "Stand-in", "mesh", "Cast"); person.saveKey = "person";
const mark0 = SPEC.marks[0]; if (mark0) { person.obj.position.set(mark0.x, 0, mark0.z); person.obj.rotation.y = THREE.MathUtils.degToRad(mark0.facingDeg); }
const shot = addItem(makeShotCamera(), "Shot camera", "camera"); shot.saveKey = "shot";
const cam0 = SPEC.cameras[0];
if (cam0) { shot.obj.position.set(...cam0.position); shot.obj.lookAt(new THREE.Vector3(...cam0.target)); } else { shot.obj.position.set(8, 1.5, 8); shot.obj.lookAt(0, 1, 0); }
const initLens = cam0 ? Math.max(12, Math.min(200, Math.round(12 / Math.tan(THREE.MathUtils.degToRad(cam0.fovDeg) / 2)))) : 35;
const car = firstCar || place;
const sunItem = { id: nextId++, name: "Sun", kind: "sun", obj: sun, keys: [], hidden: false, coll: "Lights", interp: "bezier" };
items.push(sunItem);
ground.position.y = -0.02;

// ================= keyframes =================
const trs = (o) => ({ p: o.position.toArray(), r: [o.rotation.x, o.rotation.y, o.rotation.z], s: o.scale.toArray() });
function applyTRS(o, k) { o.position.fromArray(k.p); o.rotation.set(k.r[0], k.r[1], k.r[2]); o.scale.fromArray(k.s); }
const clone = (x) => JSON.parse(JSON.stringify(x));
const near = (a, b) => Math.abs(a - b) < 0.5 / FPS;
function setKey(item, t, k = trs(item.obj)) {
  const at = item.keys.findIndex((x) => near(x.t, t)); const key = { t, ...clone(k) };
  if (at >= 0) item.keys[at] = key; else { item.keys.push(key); item.keys.sort((a, b) => a.t - b.t); }
}
const lerp = (a, b, u) => a.map((v, i) => v + (b[i] - v) * u);
function evaluate(t) {
  for (const it of items) {
    if (it.rig && it.poseKeys.length) { it.pose = poseAt(it.poseKeys, t, it.interp, it.pose); applyPose(it.rig, it.pose); }
    const ks = it.keys; if (!ks.length) continue;
    if (t <= ks[0].t) { applyTRS(it.obj, ks[0]); continue; }
    if (t >= ks[ks.length - 1].t) { applyTRS(it.obj, ks[ks.length - 1]); continue; }
    let i = 0; while (ks[i + 1].t < t) i++;
    const a = ks[i], b = ks[i + 1];
    let u = (t - a.t) / (b.t - a.t);
    if (it.interp === "bezier") u = u * u * (3 - 2 * u); else if (it.interp === "constant") u = 0;
    applyTRS(it.obj, { p: lerp(a.p, b.p, u), r: lerp(a.r, b.r, u), s: lerp(a.s, b.s, u) });
  }
  if (physCache) applyPhys(t);
  if (typeof applyConstraints === "function") applyConstraints();
}
let time = 0; evaluate(time);

// ================= undo (with grouped steps) =================
const undoStack = [], redoStack = []; let txn = null;
function push(c) { if (physCache && !c.keepPhys) physCache = null; if (txn) { txn.push(c); return; } undoStack.push(c); redoStack.length = 0; }
function group(label, fn) { const outer = txn; txn = []; let out; try { out = fn(); } finally { const list = txn; txn = outer; if (list.length) push({ label, undo() { [...list].reverse().forEach((c) => c.undo()); }, redo() { list.forEach((c) => c.redo()); } }); } return out; }
function undo() { const c = undoStack.pop(); if (!c) return toast("Nothing to undo"); c.undo(); redoStack.push(c); settle(); info("Undo · " + c.label); }
function redo() { const c = redoStack.pop(); if (!c) return toast("Nothing to redo"); c.redo(); undoStack.push(c); settle(); info("Redo · " + c.label); }
function settle() { for (const i of [...selection]) if (!items.includes(i)) selection.delete(i); if (active && !items.includes(active)) active = null; evaluate(time); refreshSel(); }

// ================= selection & gizmo =================
const selection = new Set(); let active = null; let tool = "translate";
let poseMode = false, poseItem = null, poseBone = null; // Pose Mode (people, 2026-09-30)
const tc = new TransformControls(editorCam, canvas); tc.setSize(0.85);
const tcHelper = tc.getHelper ? tc.getHelper() : tc; helpers.add(tcHelper);
const pivot = new THREE.Object3D(); scene.add(pivot);
const outlines = new THREE.Group(); helpers.add(outlines);
const movable = () => [...selection].filter((i) => i.kind !== "sun");
function refreshOutlines() {
  outlines.clear();
  for (const it of movable()) { const b = new THREE.BoxHelper(it.obj, it === active ? 0xf3c48c : 0xb07a45); outlines.add(b); }
}
function attachGizmo() {
  const sel = movable();
  if (tool === "select" || tool === "measure" || editMode || poseMode || !sel.length) { tc.detach(); return; }
  if (sel.length === 1) { tc.attach(sel[0].obj); return; }
  const c = new THREE.Vector3(); sel.forEach((i) => c.add(i.obj.getWorldPosition(new THREE.Vector3()))); c.divideScalar(sel.length);
  pivot.position.copy(c); pivot.rotation.set(0, 0, 0); pivot.scale.set(1, 1, 1); pivot.updateMatrixWorld(); tc.attach(pivot);
}
function refreshSel() { attachGizmo(); refreshOutlines(); renderAll(); }
function select(item, add = false) {
  if (item && item.hidden) item = null;
  if (!add) selection.clear();
  if (item) { if (add && selection.has(item) && active === item) { selection.delete(item); active = [...selection].pop() || null; } else { selection.add(item); active = item; } }
  else if (!add) active = null;
  if (poseMode && active !== poseItem) { if (active?.rig) { poseItem = active; poseBone = null; buildBoneViz(); } else { exitPose(); return; } }
  refreshSel();
}
let drag = null;
tc.addEventListener("dragging-changed", (e) => {
  orbit.enabled = !e.value;
  const sel = movable(); if (!sel.length) return;
  if (e.value) {
    drag = { before: sel.map((i) => ({ i, t: trs(i.obj), keys: clone(i.keys) })), pivotInv: pivot.matrixWorld.clone().invert(), starts: sel.map((i) => ({ i, m: i.obj.matrixWorld.clone() })) };
  } else if (drag) { commitMany(drag.before, "Transform"); drag = null; }
});
tc.addEventListener("objectChange", () => {
  if (tc.object === pivot && drag) {
    pivot.updateMatrixWorld();
    const delta = pivot.matrixWorld.clone().multiply(drag.pivotInv);
    for (const s of drag.starts) {
      const world = delta.clone().multiply(s.m), parentInv = s.i.obj.parent.matrixWorld.clone().invert(), local = parentInv.multiply(world);
      local.decompose(s.i.obj.position, s.i.obj.quaternion, s.i.obj.scale);
    }
  }
  refreshOutlines(); propsSoon();
});
function commitMany(before, label) {
  for (const b of before) if (autoKey) setKey(b.i, time);
  const after = before.map((b) => ({ i: b.i, t: trs(b.i.obj), keys: clone(b.i.keys) }));
  push({ label, undo() { before.forEach((b) => { b.i.keys = clone(b.keys); applyTRS(b.i.obj, b.t); }); }, redo() { after.forEach((a) => { a.i.keys = clone(a.keys); applyTRS(a.i.obj, a.t); }); } });
  if (!autoKey && before.some((b) => b.i.keys.length)) toast("Auto keying is off: the timeline will move it back. Press I to key it.");
  info(label + (autoKey ? ` · keyed at frame ${frameNo()}` : ""));
  refreshSel();
}
const ray = new THREE.Raycaster(); let downAt = null;
function pickAt(cx, cy) {
  const r = canvas.getBoundingClientRect();
  const v = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(v, camView ? shot.obj.userData.cam : editorCam);
  const roots = items.filter((i) => i.kind !== "sun" && !i.hidden).map((i) => i.obj);
  const hit = ray.intersectObjects(roots, true).find((h) => h.object.userData.itemId && !h.object.isLight);
  return hit ? byId(hit.object.userData.itemId) : null;
}
canvas.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY, e.button]; });
canvas.addEventListener("pointerup", (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4 || tc.dragging) return;
  if (downAt[2] === 2) return;
  if (tool === "measure") return;
  if (poseMode) { pickBone(e.clientX, e.clientY); return; }
  if (editMode) { pickVertex(e.clientX, e.clientY, e.shiftKey); return; }
  select(pickAt(e.clientX, e.clientY), e.shiftKey);
});
canvas.addEventListener("contextmenu", (e) => { e.preventDefault(); if (e.shiftKey) { const p = hitPoint(e.clientX, e.clientY); if (p) { setCursor(p); info("3D cursor placed · new objects appear here"); } return; } if (editMode) return; const it = pickAt(e.clientX, e.clientY); if (it && !selection.has(it)) select(it); openContext(e.clientX, e.clientY); });
let mouse = [0, 0]; wOn("pointermove", (e) => { mouse = [e.clientX, e.clientY]; });

// ================= actions (each undoable) =================
function del(list = movable()) {
  list = list.filter((i) => i !== shot);
  if (!list.length) return toast(selection.has(shot) ? "The shot camera stays; hide it with H" : "Select something to delete");
  group("Delete " + (list.length === 1 ? list[0].name : list.length + " objects"), () => {
    for (const it of list) {
      const kids = items.filter((k) => k.obj.parent === it.obj);
      kids.forEach((k) => unparentOne(k));
      const idx = detachItem(it);
      push({ label: "delete", undo() { reattachItem(it, idx); }, redo() { detachItem(it); } });
    }
  });
  selection.clear(); active = null; refreshSel(); info("Deleted · ⌘Z brings it back");
}
function dupItem(src, offset = new THREE.Vector3(2.5, 0, 0), name) {
  const obj = src.obj.clone(true), paint = [];
  obj.traverse((o) => { if (o.isMesh) { const old = o.material; o.material = old.clone(); if (src.obj.userData.paint?.includes(old)) paint.push(o.material); } });
  obj.children.filter((c) => c.userData.isItem).forEach((c) => obj.remove(c));
  obj.userData.paint = paint; obj.userData.array = src.obj.userData.array ? { ...src.obj.userData.array } : undefined;
  obj.position.add(offset);
  const it = addItem(obj, name || nextName(src.name), src.kind, src.coll);
  if (src.rig && it.rig) { it.pose = clonePose(src.pose); it.poseKeys = clone(src.poseKeys); applyPose(it.rig, it.pose); }
  tagIds(obj, it.id); applyArray(it);
  const idx = items.indexOf(it);
  push({ label: "duplicate", undo() { detachItem(it); }, redo() { reattachItem(it, idx); } });
  return it;
}
const nextName = (n) => { const m = n.match(/^(.*)\.(\d{3})$/); const base = m ? m[1] : n; let k = 1; while (items.some((i) => i.name === `${base}.${String(k).padStart(3, "0")}`)) k++; return `${base}.${String(k).padStart(3, "0")}`; };
function duplicate() {
  const list = movable().filter((i) => i !== shot); if (!list.length) return toast("Select an object to duplicate");
  const made = group("Duplicate", () => list.map((s) => dupItem(s)));
  selection.clear(); made.forEach((m) => selection.add(m)); active = made[made.length - 1]; setTool("translate"); refreshSel(); info("Duplicated · drag the arrows to place it");
}
function setHidden(it, v) { const b = it.hidden; it.hidden = v; it.obj.visible = !v; push({ label: v ? "Hide" : "Show", undo() { it.hidden = b; it.obj.visible = !b; }, redo() { it.hidden = v; it.obj.visible = !v; } }); }
function toggleHide(list = movable()) { if (!list.length) return; group("Hide", () => list.forEach((i) => setHidden(i, !i.hidden))); selection.clear(); active = null; refreshSel(); }
function showAll() { group("Show all", () => items.filter((i) => i.hidden).forEach((i) => setHidden(i, false))); refreshSel(); }
function frameObj(obj) {
  const b = new THREE.Box3().setFromObject(obj), c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3()).length();
  const dir = editorCam.position.clone().sub(orbit.target).normalize(); orbit.target.copy(c); editorCam.position.copy(c.clone().add(dir.multiplyScalar(Math.max(4, s * 1.4))));
}
function frameAll() { const b = new THREE.Box3(); items.filter((i) => i.kind !== "sun" && !i.hidden).forEach((i) => b.expandByObject(i.obj)); if (b.isEmpty()) return; const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3()).length(); orbit.target.copy(c); editorCam.position.copy(c.clone().add(new THREE.Vector3(0.55, 0.45, 0.7).normalize().multiplyScalar(Math.max(8, s * 0.75)))); toggleCam(false); }
function viewAlong(v) { const d = Math.max(12, editorCam.position.distanceTo(orbit.target)); editorCam.position.copy(orbit.target.clone().add(v.clone().multiplyScalar(d))); if (Math.abs(v.y) > 0.99) editorCam.position.z += 0.001; toggleCam(false); }
function keyItems(list = movable()) {
  if (!list.length) return toast("Select an object to key");
  // A person's key holds its pose too (people, 2026-09-30).
  group("Insert keyframe", () => list.forEach((it) => { const b = clone(it.keys), bp = it.rig ? clone(it.poseKeys) : null; setKey(it, time); if (it.rig) it.poseKeys = setPoseKey(it.poseKeys, time, it.pose, null, 0.5 / FPS); const a = clone(it.keys), ap = it.rig ? clone(it.poseKeys) : null; push({ label: "key", undo() { it.keys = clone(b); if (bp) it.poseKeys = clone(bp); }, redo() { it.keys = clone(a); if (ap) it.poseKeys = clone(ap); } }); }));
  renderAll(); info(`Keyframe inserted · frame ${frameNo()}`);
}
function delKey(list = movable()) {
  let n = 0;
  group("Delete keyframe", () => list.forEach((it) => {
    const i = it.keys.findIndex((k) => near(k.t, time)), j = it.rig ? it.poseKeys.findIndex((k) => near(k.t, time)) : -1; if (i < 0 && j < 0) return; n++;
    const b = [clone(it.keys), it.rig ? clone(it.poseKeys) : null]; if (i >= 0) it.keys.splice(i, 1); if (j >= 0) it.poseKeys.splice(j, 1); const a = [clone(it.keys), it.rig ? clone(it.poseKeys) : null];
    push({ label: "del key", undo() { it.keys = clone(b[0]); if (b[1]) it.poseKeys = clone(b[1]); }, redo() { it.keys = clone(a[0]); if (a[1]) it.poseKeys = clone(a[1]); } });
  }));
  if (!n) return toast("No keyframe on frame " + frameNo());
  evaluate(time); renderAll();
}
function setInterp(mode) {
  const list = movable(); if (!list.length) return toast("Select an animated object");
  group("Interpolation", () => list.forEach((it) => { const b = it.interp; it.interp = mode; push({ label: "interp", undo() { it.interp = b; }, redo() { it.interp = mode; } }); }));
  evaluate(time); renderAll(); info("Interpolation · " + mode);
}
function parentTo() {
  const kids = movable().filter((i) => i !== active);
  if (!active || !kids.length) return toast("Select the children, then Shift-click the parent last");
  group("Parent", () => kids.forEach((k) => { const was = k.obj.parent, w = trs(k.obj), kk = clone(k.keys); active.obj.attach(k.obj); const now = trs(k.obj); k.keys = []; push({ label: "parent", undo() { was.attach(k.obj); applyTRS(k.obj, w); k.keys = clone(kk); }, redo() { active.obj.attach(k.obj); applyTRS(k.obj, now); k.keys = []; } }); }));
  refreshSel(); info(`Parented ${kids.length} to ${active.name} · they now move with it`);
}
function unparentOne(k) { const was = k.obj.parent; if (was === scene) return; const w = trs(k.obj); scene.attach(k.obj); const now = trs(k.obj); push({ label: "unparent", undo() { was.attach(k.obj); applyTRS(k.obj, w); }, redo() { scene.attach(k.obj); applyTRS(k.obj, now); } }); }
function clearParent() { const list = movable().filter((i) => i.obj.parent !== scene); if (!list.length) return toast("Nothing selected has a parent"); group("Clear parent", () => list.forEach(unparentOne)); refreshSel(); }
function setPaint(it, hex) { const paint = it.obj.userData.paint || []; if (!paint.length) return; const b = "#" + paint[0].color.getHexString(); paint.forEach((m) => m.color.set(hex)); push({ label: "colour", undo() { paint.forEach((m) => m.color.set(b)); }, redo() { paint.forEach((m) => m.color.set(hex)); } }); }
function rename(it, n) { const b = it.name; it.name = n; it.obj.name = n; push({ label: "rename", undo() { it.name = b; it.obj.name = b; }, redo() { it.name = n; it.obj.name = n; } }); }
function setHourCmd(h) { const b = hour; setHour(h); push({ label: "time of day", undo() { setHour(b); }, redo() { setHour(h); } }); }
function setLensCmd(mm) { const b = shot.obj.userData.lensMm; setLens(mm); push({ label: "lens", undo() { setLens(b); }, redo() { setLens(mm); } }); }
function moveCmd(it, fn) { const b = { t: trs(it.obj), keys: clone(it.keys) }; fn(it.obj); if (autoKey) setKey(it, time); const a = { t: trs(it.obj), keys: clone(it.keys) }; push({ label: "move", undo() { it.keys = clone(b.keys); applyTRS(it.obj, b.t); }, redo() { it.keys = clone(a.keys); applyTRS(it.obj, a.t); } }); }
function keyAtCmd(it, t, fn) { const b = { t: trs(it.obj), keys: clone(it.keys) }; evaluate(t); fn(it.obj); setKey(it, t); const a = clone(it.keys); push({ label: "keyframe", undo() { it.keys = clone(b.keys); applyTRS(it.obj, b.t); }, redo() { it.keys = clone(a); } }); evaluate(time); }
function camToView() { moveCmd(shot, (o) => { const d = new THREE.Vector3(); editorCam.getWorldDirection(d); o.position.copy(editorCam.position); o.lookAt(editorCam.position.clone().add(d)); }); toggleCam(true); info("Shot camera aligned to the view"); }

// ---- Add ----
const ADD = {
  car: { l: "Sports car", h: "Things", f: () => [makeCar(0x2b6fd6), "Blue sports car", "mesh", "Cast"] },
  person: { l: "Person", h: "Things", f: () => [makePerson(), "Person", "mesh", "Cast"] },
  lamp: { l: "Street lamp", h: "Things", f: () => [makeLamp(), "Street lamp", "light", "Lights"] },
  box: { l: "Cube", h: "Mesh", f: () => { const g = new THREE.Group(); const m = mesh(new THREE.BoxGeometry(2, 2, 2), std(0xb9b4ac), 0, 1, 0); g.add(m); g.userData.paint = [m.material]; return [g, "Cube", "mesh"]; } },
  sphere: { l: "UV sphere", h: "Mesh", f: () => { const g = new THREE.Group(); const m = mesh(new THREE.SphereGeometry(1, 32, 20), std(0xb9b4ac), 0, 1, 0); g.add(m); g.userData.paint = [m.material]; return [g, "Sphere", "mesh"]; } },
  cyl: { l: "Cylinder", h: "Mesh", f: () => { const g = new THREE.Group(); const m = mesh(new THREE.CylinderGeometry(0.8, 0.8, 2, 28), std(0xb9b4ac), 0, 1, 0); g.add(m); g.userData.paint = [m.material]; return [g, "Cylinder", "mesh"]; } },
  plane: { l: "Plane", h: "Mesh", f: () => { const g = new THREE.Group(); const m = mesh(new THREE.BoxGeometry(4, 0.02, 4), std(0xb9b4ac), 0, 0.01, 0); g.add(m); g.userData.paint = [m.material]; return [g, "Plane", "mesh"]; } },
  spot: { l: "Spot light", h: "Light", f: () => { const g = new THREE.Group(); const s = new THREE.SpotLight(0xfff0dd, 60, 30, 0.5, 0.4, 1.4); s.castShadow = true; s.target.position.set(0, -4, 0); g.add(s, s.target, mesh(new THREE.ConeGeometry(0.2, 0.35, 16), std(0x222222), 0, 0.1, 0)); g.userData.paint = []; g.userData.lift = 5; return [g, "Spot", "light", "Lights"]; } },
  torus: { l: "Torus", h: "Mesh", f: () => { const g = new THREE.Group(); const m = mesh(new THREE.TorusGeometry(0.9, 0.3, 16, 40), std(0xb9b4ac), 0, 1.2, 0); g.add(m); g.userData.paint = [m.material]; return [g, "Torus", "mesh"]; } },
  cone: { l: "Cone", h: "Mesh", f: () => { const g = new THREE.Group(); const m = mesh(new THREE.ConeGeometry(1, 2, 32), std(0xb9b4ac), 0, 1, 0); g.add(m); g.userData.paint = [m.material]; return [g, "Cone", "mesh"]; } },
  ico: { l: "Ico sphere", h: "Mesh", f: () => { const g = new THREE.Group(); const m = mesh(new THREE.IcosahedronGeometry(1, 1), std(0xb9b4ac, { flatShading: true }), 0, 1, 0); g.add(m); g.userData.paint = [m.material]; return [g, "Icosphere", "mesh"]; } },
  empty: { l: "Empty · plain axes", h: "Empty", f: () => { const g = new THREE.Group(); g.add(new THREE.AxesHelper(1)); g.userData.paint = []; g.userData.lift = 1; return [g, "Empty", "empty", "Set"]; } },
  point: { l: "Point light", h: "Light", f: () => { const g = new THREE.Group(); const p = new THREE.PointLight(0xffe2b8, 30, 20, 1.5); g.add(p, mesh(new THREE.SphereGeometry(0.12, 16, 10), std(0xffffff, { emissive: 0xffe2b8, emissiveIntensity: 2 }))); g.userData.paint = []; g.userData.lift = 3; return [g, "Point", "light", "Lights"]; } },
};
function addKind(kind, at, name) {
  const d = ADD[kind]; if (!d) return null;
  const [obj, nm, k, coll] = d.f(); const c = at || cursor3d.position;
  obj.position.set(c.x, obj.userData.lift ?? (at ? at.y : 0), c.z);
  const it = addItem(obj, name || nm, k, coll); it.addKind = kind; const idx = items.indexOf(it);
  push({ label: "Add " + it.name, undo() { detachItem(it); }, redo() { reattachItem(it, idx); } });
  return it;
}
function addUI(kind) { const it = addKind(kind); if (!it) return; setTool("translate"); select(it); info("Added " + it.name); }
function addMenuHTML() {
  let h = "", last = "";
  for (const [k, d] of Object.entries(ADD)) { if (d.h !== last) { h += `<h4>${d.h}</h4>`; last = d.h; } h += `<button data-add="${k}"><span>${d.l}</span></button>`; }
  h += `<div class="sep"></div><button data-act="import"><span>Import 3D model…</span><small>.glb</small></button><button data-act="astraModel"><span>Model from a photo</span><small>Astra</small></button>`;
  return h;
}
document.querySelector('[data-list="add"]').innerHTML = addMenuHTML();

// ---- Array modifier ----
function setArray(it, next) { const b = it.obj.userData.array ? { ...it.obj.userData.array } : undefined; it.obj.userData.array = next; applyArray(it); push({ label: "Array", undo() { it.obj.userData.array = b; applyArray(it); }, redo() { it.obj.userData.array = next; applyArray(it); } }); refreshOutlines(); }

// ---- import ----
const loader = new GLTFLoader();
const fileIn = Object.assign(document.createElement("input"), { type: "file", accept: ".glb,.gltf" });
fileIn.addEventListener("change", async () => {
  const file = fileIn.files?.[0]; if (!file) return; const buf = await file.arrayBuffer(); fileIn.value = "";
  loader.parse(buf, "", (gltf) => {
    const g = new THREE.Group(), root = gltf.scene; g.add(root);
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const b = new THREE.Box3().setFromObject(root), s = b.getSize(new THREE.Vector3()), m = Math.max(s.x, s.y, s.z);
    if (m > 30 || (m > 0 && m < 0.2)) root.scale.setScalar(4.5 / m);
    const b2 = new THREE.Box3().setFromObject(root), c2 = b2.getCenter(new THREE.Vector3()); root.position.x -= c2.x; root.position.z -= c2.z; root.position.y -= b2.min.y;
    g.position.set(orbit.target.x, 0, orbit.target.z); g.userData.paint = [];
    const it = addItem(g, file.name.replace(/\.(glb|gltf)$/i, ""), "mesh", "Cast"); const idx = items.indexOf(it);
    push({ label: "Import", undo() { detachItem(it); }, redo() { reattachItem(it, idx); } });
    select(it); frameObj(it.obj); info("Imported " + file.name);
  }, (err) => toast("That file couldn't be read as a 3D model: " + (err?.message || "unknown error")));
});

// ================= world, camera, shading =================
let hour = 15.8, skyColor = new THREE.Color();
function setHour(h) {
  hour = h;
  const u = (h - 6) / 14, elev = Math.sin(Math.PI * Math.min(Math.max(u, 0), 1)), az = -1.2 + u * 2.4;
  sun.position.set(Math.sin(az) * 40, 4 + elev * 45, Math.cos(az) * 30);
  const warm = 1 - elev; sun.color.setHSL(0.08, 0.5 * warm + 0.05, 0.58 + elev * 0.32); sun.intensity = 0.35 + elev * 2.6;
  const sky = new THREE.Color().setHSL(0.58 - warm * 0.5, 0.36, 0.17 + elev * 0.5); if (h < 6.6 || h > 19.3) sky.setHSL(0.66, 0.35, 0.07);
  skyColor = sky; fog.color.copy(sky); hemi.intensity = 0.22 + elev * 0.78; if (skyObj) skyObj.material.uniforms.sunPosition.value.copy(sun.position).normalize();
}
setHour(hour);
const hourText = (h = hour) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60) % 60).padStart(2, "0")}`;
let camView = false;
const FORMATS = { "16:9 · HD": 16 / 9, "2.39:1 · Scope": 2.39, "9:16 · Vertical": 9 / 16, "1:1 · Square": 1, "4:5 · Portrait": 0.8 };
let format = "16:9 · HD";
function setLens(mm) { shot.obj.userData.lensMm = mm; const c = shot.obj.userData.cam; c.fov = lensToFov(mm); c.updateProjectionMatrix(); }
setLens(initLens);
function toggleCam(v = !camView) { camView = v; $("frame").hidden = !camView; $("navCam").classList.toggle("on", camView); $("shelfCam").classList.toggle("on", camView); renderVText(); }
const clay = new THREE.MeshStandardMaterial({ color: 0xbdb9b2, roughness: 0.85 }), wire = new THREE.MeshBasicMaterial({ color: 0xd0d6e0, wireframe: true });
let shade = "lit";
function setShade(s) { shade = s; scene.overrideMaterial = s === "clay" ? clay : s === "wire" ? wire : null; document.querySelectorAll("[data-shade]").forEach((b) => b.classList.toggle("on", b.dataset.shade === s)); }
function setTool(t) { tool = t; orbit.mouseButtons.LEFT = t === "select" || t === "measure" ? -1 : THREE.MOUSE.ROTATE; if (t !== "measure") clearMeasure(); document.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("on", b.dataset.tool === t)); if (["translate", "rotate", "scale"].includes(t)) tc.setMode(t); attachGizmo(); }
let autoKey = true, snapOn = true;
function applySnap() { tc.setTranslationSnap(snapOn ? 0.25 : null); tc.setRotationSnap(snapOn ? THREE.MathUtils.degToRad(15) : null); tc.setScaleSnap(snapOn ? 0.1 : null); $("snapBtn").classList.toggle("on", snapOn); }
applySnap();

// ================= fields & panels =================
function field(value, { step = 0.1, unit = "", dec = 2, min = -Infinity, max = Infinity, cls = "", onLive, onCommit, onStart }) {
  const el = document.createElement("div"); el.className = "fld " + cls; el.tabIndex = 0;
  const show = (v) => { el.textContent = (+v).toFixed(dec) + unit; }; show(value);
  let v = value;
  el.addEventListener("pointerdown", (e) => {
    if (el.querySelector("input")) return;
    const sx = e.clientX, start = v; let moved = false; el.setPointerCapture(e.pointerId); let begun = false;
    const move = (ev) => { const dx = ev.clientX - sx; if (Math.abs(dx) > 2) moved = true; if (!moved) return; if (!begun) { begun = true; onStart?.(); } v = Math.min(max, Math.max(min, start + dx * step * (ev.shiftKey ? 0.1 : 1))); show(v); onLive?.(v); };
    const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); if (moved) onCommit?.(v); else edit(); };
    el.addEventListener("pointermove", move); el.addEventListener("pointerup", up);
  });
  el.addEventListener("keydown", (e) => { if (e.key === "Enter") edit(); });
  function edit() {
    const inp = document.createElement("input"); inp.value = (+v).toFixed(dec); el.appendChild(inp); inp.focus(); inp.select();
    let fin = false;
    const done = (ok) => { if (fin) return; fin = true; if (ok) { const n = parseFloat(inp.value.replace(",", ".")); if (!Number.isNaN(n)) { onStart?.(); v = Math.min(max, Math.max(min, n)); show(v); onLive?.(v); onCommit?.(v); } } inp.remove(); show(v); };
    inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") done(true); if (e.key === "Escape") done(false); });
    inp.addEventListener("blur", () => done(true));
  }
  return el;
}
const ro = (text) => Object.assign(document.createElement("div"), { className: "fld ro", textContent: text });
function fr(label, control) { const d = document.createElement("div"); d.className = "fr"; const l = document.createElement("label"); l.textContent = label; d.append(l, control); return d; }
function panel(title, open = true, extra) { const p = document.createElement("div"); p.className = "panel" + (open ? "" : " closed"); const h = document.createElement("h5"); h.innerHTML = `<i>${open ? "▼" : "▶"}</i><span>${title}</span><span class="grow"></span>`; if (extra) h.appendChild(extra); const b = document.createElement("div"); b.className = "pb"; h.onclick = (e) => { if (e.target.closest("button")) return; p.classList.toggle("closed"); h.querySelector("i").textContent = p.classList.contains("closed") ? "▶" : "▼"; }; p.append(h, b); return [p, b]; }
const deg = THREE.MathUtils.radToDeg, rad = THREE.MathUtils.degToRad;
const keyState = (it) => (!it.keys.length ? "" : it.keys.some((k) => near(k.t, time)) ? "keyed" : "anim");
function transformStack(host, it) {
  const o = it.obj, ks = keyState(it); let b = null;
  const start = () => { b = [{ i: it, t: trs(o), keys: clone(it.keys) }]; };
  const done = () => commitMany(b, "Transform");
  const group3 = (label, vals, conv, set) => { const st = document.createElement("div"); st.className = "stack"; ["X", "Y", "Z"].forEach((ax, i) => st.appendChild(fr(i === 0 ? `${label} ${ax}` : ax, field(vals[i], { ...conv, cls: ks, onStart: start, onLive: (v) => { set(i, v); refreshOutlines(); }, onCommit: done })))); host.appendChild(st); };
  group3("Location", [o.position.x, -o.position.z, o.position.y], { step: 0.02, unit: " m" }, (i, v) => { if (i === 0) o.position.x = v; else if (i === 1) o.position.z = -v; else o.position.y = v; });
  group3("Rotation", [deg(o.rotation.x), deg(-o.rotation.z), deg(o.rotation.y)], { step: 0.5, unit: "°", dec: 1 }, (i, v) => { if (i === 0) o.rotation.x = rad(v); else if (i === 1) o.rotation.z = -rad(v); else o.rotation.y = rad(v); });
  group3("Scale", [o.scale.x, o.scale.z, o.scale.y], { step: 0.01, dec: 3, min: 0.01 }, (i, v) => { if (i === 0) o.scale.x = v; else if (i === 1) o.scale.z = v; else o.scale.y = v; });
}

// ================= properties editor =================
let ptab = "object";
function renderProps() {
  const p = $("props"); p.innerHTML = "";
  document.querySelectorAll("[data-pt]").forEach((b) => b.classList.toggle("on", b.dataset.pt === ptab));
  const it = active && active.kind !== "sun" ? active : null;
  const none = (t) => { p.innerHTML = `<p class="hint">${t}</p>`; };
  if (ptab === "object") {
    if (!it) return none("Select an object on the stage or in the Outliner.");
    const t = document.createElement("div"); t.className = "ptitle"; t.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2" fill="#e0a468"/></svg>`;
    const nm = document.createElement("input"); nm.id = "objName"; nm.value = it.name; nm.setAttribute("aria-label", "Object name");
    nm.addEventListener("change", () => { rename(it, nm.value || it.name); renderAll(); }); t.appendChild(nm); p.appendChild(t);
    const [tp, tb] = panel("Transform"); transformStack(tb, it); p.appendChild(tp);
    if (it.rig) posePanel(p, it);
    const [rp, rb] = panel("Relations", false);
    rb.appendChild(fr("Parent", ro(it.obj.parent === scene ? "—" : itemOf(it.obj.parent)?.name || "—")));
    rb.appendChild(fr("Collection", ro(it.coll)));
    const r3 = document.createElement("div"); r3.className = "row-btns"; r3.innerHTML = `<button class="pbtn" id="pPar">Parent to active</button><button class="pbtn" id="pUnpar">Clear parent</button>`; rb.appendChild(r3); p.appendChild(rp);
    r3.querySelector("#pPar").onclick = parentTo; r3.querySelector("#pUnpar").onclick = clearParent;
    const [ap, ab] = panel("Animation");
    ab.innerHTML = `<p class="hint" style="margin-top:0">${it.keys.length ? `${it.keys.length} keyframes · frames ${it.keys.map((k) => Math.round(k.t * FPS) + 1).join(", ")} · ${it.interp}` : "Not animated. Move it, then insert a keyframe (I)."}</p>`;
    const r = document.createElement("div"); r.className = "row-btns"; r.innerHTML = `<button class="pbtn accent" id="pKey">Insert keyframe</button><button class="pbtn" id="pDelKey">Delete keyframe</button>`;
    r.insertAdjacentHTML("beforeend", `<button class="pbtn" id="pPath">${pathOn ? "Hide" : "Show"} motion path</button>`);
    ab.appendChild(r); p.appendChild(ap); r.querySelector("#pKey").onclick = () => keyItems(); r.querySelector("#pDelKey").onclick = () => delKey(); r.querySelector("#pPath").onclick = togglePath;
    const [vp, vb] = panel("Visibility", false); const r2 = document.createElement("div"); r2.className = "row-btns";
    r2.innerHTML = `<button class="pbtn" id="pDup">Duplicate</button><button class="pbtn" id="pHide">Hide</button><button class="pbtn" id="pDel">Delete</button>`; vb.appendChild(r2); p.appendChild(vp);
    r2.querySelector("#pDup").onclick = duplicate; r2.querySelector("#pHide").onclick = () => toggleHide(); r2.querySelector("#pDel").onclick = () => del();
  } else if (ptab === "modifiers") {
    if (!it || it.kind === "camera") return none("Select an object to add modifiers to it.");
    const a = it.obj.userData.array;
    const add = document.createElement("div"); add.className = "row-btns";
    const mi = it.obj.userData.mirror;
    add.innerHTML = `<button class="pbtn" id="addArr" ${a ? "disabled" : ""}>Add ▾ Array</button><button class="pbtn" id="addMir" ${mi ? "disabled" : ""}>Add ▾ Mirror</button>`; p.appendChild(add);
    add.querySelector("#addMir").onclick = () => { setMirror(it, { axis: "x" }); renderProps(); info("Mirror added"); };
    if (mi) {
      const rm2 = document.createElement("button"); rm2.className = "x"; rm2.textContent = "✕"; rm2.title = "Remove modifier"; rm2.onclick = () => { setMirror(it, undefined); renderProps(); };
      const [mp2, mb2] = panel(`<span style="color:#7fb3ff">⧉</span> Mirror`, true, rm2);
      const g = document.createElement("div"); g.className = "grp"; g.style.width = "max-content";
      ["x", "y", "z"].forEach((ax) => { const b = document.createElement("button"); b.textContent = ax.toUpperCase(); b.className = mi.axis === ax ? "on" : ""; b.onclick = () => { setMirror(it, { axis: ax }); renderProps(); }; g.appendChild(b); });
      mb2.appendChild(fr("Axis", g)); mb2.insertAdjacentHTML("beforeend", `<p class="hint">A mirrored copy across the object's own origin: build half, get both sides.</p>`); p.appendChild(mp2);
    }
    add.querySelector("#addArr").onclick = () => { setArray(it, { count: 4, x: 3, y: 0, z: 0 }); renderProps(); info("Array added"); };
    if (a) {
      const rm = document.createElement("button"); rm.className = "x"; rm.textContent = "✕"; rm.title = "Remove modifier"; rm.onclick = () => { setArray(it, undefined); renderProps(); };
      const [mp, mb] = panel(`<span style="color:#7fb3ff">▦</span> Array`, true, rm);
      const upd = (patch) => { setArray(it, { ...it.obj.userData.array, ...patch }); };
      mb.appendChild(fr("Count", field(a.count, { step: 0.08, dec: 0, min: 1, max: 30, onCommit: (v) => upd({ count: Math.round(v) }) })));
      const st = document.createElement("div"); st.className = "stack";
      st.appendChild(fr("Offset X", field(a.x, { step: 0.05, unit: " m", onCommit: (v) => upd({ x: v }) })));
      st.appendChild(fr("Y", field(-a.z, { step: 0.05, unit: " m", onCommit: (v) => upd({ z: -v }) })));
      st.appendChild(fr("Z", field(a.y, { step: 0.05, unit: " m", onCommit: (v) => upd({ y: v }) })));
      mb.appendChild(st); p.appendChild(mp);
      p.insertAdjacentHTML("beforeend", `<p class="hint">A row of copies that stay one object: a fence, lamps along a street, a parking row.</p>`);
    }
  } else if (ptab === "constraints") {
    if (!it) return none("Select an object to add a constraint to it.");
    const tid = it.obj.userData.track;
    if (!tid) {
      const add = document.createElement("div"); add.className = "row-btns"; add.innerHTML = `<button class="pbtn" id="addTrack">Add Object Constraint ▾ Track To</button>`; p.appendChild(add);
      add.querySelector("#addTrack").onclick = () => { const t = items.find((i) => i !== it && i.kind === "mesh" && /car/i.test(i.name)) || items.find((i) => i !== it && i.kind === "mesh"); if (t) setTrack(it, t.id); renderProps(); };
      p.insertAdjacentHTML("beforeend", `<p class="hint">Track To keeps this object's front (the camera's lens) aimed at a target, however either of them moves.</p>`);
    } else {
      const rm = document.createElement("button"); rm.className = "x"; rm.textContent = "✕"; rm.title = "Remove constraint"; rm.onclick = () => { setTrack(it, null); renderProps(); };
      const [cp, cb] = panel(`<span style="color:#7fb3ff">⛓</span> Track To`, true, rm);
      const sel = document.createElement("select"); sel.className = "sel2"; sel.id = "trackTarget"; sel.setAttribute("aria-label", "Target");
      items.filter((i) => i !== it && i.kind !== "sun").forEach((i) => sel.add(new Option(i.name, i.id, false, i.id === tid)));
      sel.onchange = () => { setTrack(it, +sel.value); renderAll(); };
      cb.appendChild(fr("Target", sel)); cb.appendChild(fr("Track Axis", ro("+Z (front)"))); cb.appendChild(fr("Up", ro("Z")));
      p.appendChild(cp);
    }
  } else if (ptab === "physics") {
    renderPhysics(p, it);
  } else if (ptab === "material") {
    const paint = it?.obj.userData.paint || [];
    if (!it || !paint.length) return none("Select an object with a surface to change its material.");
    const m = paint[0]; const [mp, mb] = panel("Surface");
    const col = document.createElement("input"); col.type = "color"; col.className = "color"; col.id = "baseColor"; col.value = "#" + m.color.getHexString(); col.setAttribute("aria-label", "Base colour");
    let before = null; col.addEventListener("focus", () => (before = "#" + m.color.getHexString()));
    col.addEventListener("input", () => paint.forEach((pm) => pm.color.set(col.value)));
    col.addEventListener("change", () => { const hex = col.value; paint.forEach((pm) => pm.color.set(before || hex)); setPaint(it, hex); });
    mb.appendChild(fr("Base Color", col));
    mb.appendChild(fr("Metallic", field(m.metalness, { step: 0.01, dec: 3, min: 0, max: 1, onLive: (v) => paint.forEach((pm) => (pm.metalness = v)) })));
    mb.appendChild(fr("Roughness", field(m.roughness, { step: 0.01, dec: 3, min: 0, max: 1, onLive: (v) => paint.forEach((pm) => (pm.roughness = v)) })));
    mb.appendChild(fr("Emission", colorInput("emisColor", "#" + m.emissive.getHexString(), "Emission colour", () => "#" + m.emissive.getHexString(), (v) => paint.forEach((pm) => pm.emissive.set(v)))));
    mb.appendChild(fr("Strength", liveField(m.emissiveIntensity, "Emission strength", () => m.emissiveIntensity, (v) => paint.forEach((pm) => (pm.emissiveIntensity = v)), { step: 0.02, dec: 2, min: 0, max: 20 })));
    mb.appendChild(fr("Alpha", liveField(m.opacity, "Alpha", () => m.opacity, (v) => paint.forEach((pm) => { pm.opacity = v; pm.transparent = v < 1; pm.needsUpdate = true; }), { step: 0.01, dec: 2, min: 0.05, max: 1 })));
    p.appendChild(mp);
    const [tp2, tb2] = panel("Image Texture");
    const r = document.createElement("div"); r.className = "row-btns";
    r.innerHTML = `<button class="pbtn" id="texAdd">${m.map ? "Replace image…" : "Add image…"}</button>${m.map ? `<button class="pbtn" id="texDel">Remove</button>` : ""}`;
    tb2.appendChild(r); tb2.insertAdjacentHTML("beforeend", `<p class="hint">A poster, a sign, a screen or a wall: the picture is wrapped on the surface.</p>`); p.appendChild(tp2);
    const setMap = (tex) => paint.forEach((pm) => { pm.map = tex; pm.needsUpdate = true; });
    r.querySelector("#texAdd").onclick = () => { const fi = Object.assign(document.createElement("input"), { type: "file", accept: "image/*" }); fi.onchange = () => { const f = fi.files?.[0]; if (!f) return; const img = new Image(); img.onload = () => { const tex = new THREE.Texture(img); tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true; const b = m.map || null; group("Image texture", () => { if (m.color.getHex() !== 0xffffff) propCmd("Base colour", () => "#" + m.color.getHexString(), (v) => paint.forEach((pm) => pm.color.set(v)), "#ffffff"); setMap(tex); push({ label: "texture", undo() { setMap(b); }, redo() { setMap(tex); } }); }); renderProps(); info("Image texture applied"); }; img.src = URL.createObjectURL(f); }; fi.click(); };
    r.querySelector("#texDel")?.addEventListener("click", () => { const b = m.map; setMap(null); push({ label: "Remove texture", undo() { setMap(b); }, redo() { setMap(null); } }); renderProps(); });
  } else if (ptab === "camera") {
    const [cp, cb] = panel("Lens"); const u = shot.obj.userData;
    cb.appendChild(fr("Focal Length", field(u.lensMm, { step: 0.4, unit: " mm", dec: 0, min: 12, max: 200, onLive: (v) => { setLens(Math.round(v)); renderVText(); } })));
    p.appendChild(cp);
    const [dp, db] = panel("Depth of Field");
    db.appendChild(fr("Focus Distance", field(u.focus, { step: 0.05, unit: " m", min: 0.3, onLive: (v) => (u.focus = v) })));
    db.appendChild(fr("F-Stop", field(u.fstop, { step: 0.02, dec: 1, min: 1, max: 22, onLive: (v) => (u.fstop = v) })));
    db.insertAdjacentHTML("beforeend", `<p class="hint">Passed to the final render: what is sharp and how soft the rest falls off.</p>`); p.appendChild(dp);
    db.appendChild(fr("Sensor", ro("36 mm full frame")));
    const [gp, gb] = panel("Composition Guides");
    for (const [k, n] of [["thirds", "Thirds"], ["golden", "Golden ratio"], ["center", "Center"], ["safe", "Safe areas"]]) { const l = document.createElement("label"); l.className = "check"; l.innerHTML = `<input type="checkbox" ${guides[k] ? "checked" : ""}> ${n}`; l.querySelector("input").onchange = (e) => { guides[k] = e.target.checked; drawGuides(); }; gb.appendChild(fr("", l)); }
    gb.insertAdjacentHTML("beforeend", `<p class="hint">Shown over the camera view (press 0).</p>`); p.appendChild(gp);
    const bt = document.createElement("div"); bt.className = "row-btns";
    bt.innerHTML = `<button class="pbtn accent" id="cView">${camView ? "Back to the stage" : "Look through camera"}</button><button class="pbtn" id="cAlign">Camera to view</button>`;
    p.appendChild(bt); bt.querySelector("#cView").onclick = () => { toggleCam(); renderProps(); }; bt.querySelector("#cAlign").onclick = camToView;
  } else if (ptab === "output") {
    const [cp, cb] = panel("Format");
    const sel = document.createElement("select"); sel.className = "sel2"; sel.id = "format"; sel.setAttribute("aria-label", "Frame shape");
    for (const k of Object.keys(FORMATS)) sel.add(new Option(k, k, false, k === format)); sel.onchange = () => { format = sel.value; renderVText(); };
    cb.appendChild(fr("Frame", sel)); cb.appendChild(fr("Frame Rate", ro(FPS + " fps"))); cb.appendChild(fr("Frame Range", ro(`1 – ${FRAMES}`))); p.appendChild(cp);
  } else if (ptab === "light") {
    const L = active?.kind === "sun" ? sun : active?.obj.children.find((c) => c.isLight) || null;
    if (!L) return none("Select a light (the Sun, a street lamp, a spot or point light) to see its settings.");
    const [lp, lb] = panel(L.isDirectionalLight ? "Sun" : L.isSpotLight ? "Spot" : "Point");
    lb.appendChild(fr("Color", colorInput("lightColor", "#" + L.color.getHexString(), "Light colour", () => "#" + L.color.getHexString(), (v) => L.color.set(v))));
    lb.appendChild(fr(L.isDirectionalLight ? "Strength" : "Power", liveField(L.intensity, "Light power", () => L.intensity, (v) => (L.intensity = v), { step: L.isDirectionalLight ? 0.02 : 0.3, dec: 1, min: 0, max: 400 })));
    if (L.isSpotLight) { lb.appendChild(fr("Spot Size", liveField(deg(L.angle * 2), "Spot size", () => deg(L.angle * 2), (v) => (L.angle = rad(v / 2)), { step: 0.5, unit: "°", dec: 0, min: 5, max: 170 }))); lb.appendChild(fr("Blend", liveField(L.penumbra, "Spot blend", () => L.penumbra, (v) => (L.penumbra = v), { step: 0.01, dec: 2, min: 0, max: 1 }))); }
    if (!L.isDirectionalLight) lb.appendChild(fr("Radius", liveField(L.distance, "Light radius", () => L.distance, (v) => (L.distance = v), { step: 0.1, unit: " m", dec: 1, min: 1, max: 100 })));
    const sh = document.createElement("label"); sh.className = "check"; sh.innerHTML = `<input type="checkbox" ${L.castShadow ? "checked" : ""}> Cast shadows`; sh.querySelector("input").onchange = (e) => { L.castShadow = e.target.checked; }; lb.appendChild(fr("Shadow", sh));
    if (L.isDirectionalLight) lb.insertAdjacentHTML("beforeend", `<p class="hint">The sun's height and direction follow the time of day (World tab).</p>`);
    p.appendChild(lp);
  } else if (ptab === "world") {
    const [wp, wb] = panel("Sun & Sky");
    wb.appendChild(fr("Time of Day", field(hour, { step: 0.02, dec: 2, min: 5.5, max: 20.5, onLive: (v) => setHour(v), onStart: () => (wb.dataset.h = hour), onCommit: (v) => { setHour(+wb.dataset.h); setHourCmd(v); renderVText(); } })));
    const fc = document.createElement("label"); fc.className = "check"; fc.innerHTML = `<input type="checkbox" id="fogOn" ${scene.fog ? "checked" : ""}> Haze`;
    fc.querySelector("input").onchange = (e) => { scene.fog = e.target.checked ? fog : null; }; wb.appendChild(fr("Atmosphere", fc));
    const sm = document.createElement("select"); sm.className = "sel2"; sm.id = "skyMode"; sm.setAttribute("aria-label", "Sky");
    [["simple", "Simple sky colour"], ["physical", "Physical sky"], ["studio", "Studio lighting"]].forEach(([v, n]) => sm.add(new Option(n, v, false, v === skyMode)));
    sm.onchange = () => { setSkyMode(sm.value); info("World · " + sm.options[sm.selectedIndex].text); }; wb.insertBefore(fr("Sky", sm), wb.firstChild); p.appendChild(wp);
    p.insertAdjacentHTML("beforeend", `<p class="hint">Physical sky scatters sunlight like a real atmosphere; Studio lights everything evenly from soft boxes, for products and cars.</p>`);
  } else if (ptab === "render") {
    const [rp, rb] = panel("Render"); const r = document.createElement("div"); r.className = "row-btns";
    r.innerHTML = `<button class="pbtn accent" id="rStill">Render still</button><button class="pbtn" id="rVideo">Render animation</button>`; const r2 = document.createElement("div"); r2.className = "row-btns"; r2.innerHTML = `<button class="pbtn" id="rTStill">Path traced still</button><button class="pbtn" id="rTVideo">Path traced animation</button>`; rb.append(r, r2); p.appendChild(rp);
    r2.querySelector("#rTStill").onclick = renderTracedStill; r2.querySelector("#rTVideo").onclick = renderTracedVideo;
    r.querySelector("#rStill").onclick = renderStill; r.querySelector("#rVideo").onclick = renderVideo;
    if (opts.render) { const r3 = document.createElement("div"); r3.className = "row-btns"; r3.innerHTML = `<button class="pbtn accent" id="rCast">${esc(castLabel())}</button>`; rb.append(r3); r3.querySelector("#rCast").onclick = openCast; }
    const [ep, eb] = panel("Engine"); eb.append(fr("Draft", ro("Helios viewport")), fr("Final", ro(opts.render ? "AI photo · " + credits(opts.render.credits) : "AI render · in Picacho")));
    eb.insertAdjacentHTML("beforeend", `<p class="hint">The final render paints your character and your models onto this exact layout and motion.</p>`); p.appendChild(ep);
  }
}
let pSoon = 0; function propsSoon() { if (pSoon) return; pSoon = requestAnimationFrame(() => { pSoon = 0; if (!document.activeElement?.closest?.("#props,#nbody")) { renderProps(); if (ntab === "item") renderN(); } }); }

// ================= N sidebar =================
let ntab = "astra", nOpen = true;
function toggleN(v = !nOpen) { nOpen = v; $("npanel").hidden = !nOpen; $("nBtn").classList.toggle("on", nOpen); $("nhint").hidden = nOpen; resize(); }
function renderN() {
  document.querySelectorAll("[data-nt]").forEach((b) => b.classList.toggle("on", b.dataset.nt === ntab));
  const nb = $("nbody");
  if (ntab === "astra") { if (!nb.querySelector(".astra")) buildAstra(); else renderAstraSees(); return; }
  nb.innerHTML = ""; const sc = document.createElement("div"); sc.className = "nscroll"; nb.appendChild(sc);
  if (ntab === "item") {
    const it = active && active.kind !== "sun" ? active : null;
    if (!it) { sc.innerHTML = `<p class="hint">Nothing selected.</p>`; return; }
    const [tp, tb] = panel("Transform"); transformStack(tb, it); sc.appendChild(tp);
    const size = new THREE.Box3().setFromObject(it.obj).getSize(new THREE.Vector3());
    const [dp, db] = panel("Dimensions"); const st = document.createElement("div"); st.className = "stack";
    st.append(fr("X", ro(size.x.toFixed(2) + " m")), fr("Y", ro(size.z.toFixed(2) + " m")), fr("Z", ro(size.y.toFixed(2) + " m"))); db.appendChild(st); sc.appendChild(dp);
  } else if (ntab === "view") {
    const [vp, vb] = panel("View");
    vb.appendChild(fr("Focal Length", field(18 / Math.tan(rad(editorCam.fov) / 2) / 1.5, { step: 0.3, unit: " mm", dec: 0, min: 10, max: 200, onLive: (v) => { editorCam.fov = deg(2 * Math.atan(18 / 1.5 / v)); editorCam.updateProjectionMatrix(); } })));
    vb.appendChild(fr("Clip End", ro("500 m")));
    const r = document.createElement("div"); r.className = "row-btns"; r.innerHTML = `<button class="pbtn" id="vAlign">Camera to view</button><button class="pbtn" id="vAll">Frame all</button>`;
    vb.appendChild(r); sc.appendChild(vp); r.querySelector("#vAlign").onclick = camToView; r.querySelector("#vAll").onclick = frameAll;
  }
}

// ================= Astra =================
// Blender's AI assistants live in this N sidebar: they read the scene, say
// what they will do, run each step as an operation you can see, and undo.
// In this draft the example requests run; in Picacho Astra (GPT-6) turns
// any request, in any words, into these same steps.
const P = (x, y, z) => `(${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`;
const bl = (v) => P(v.x, -v.z, v.y);
const V3 = THREE.Vector3;
const cars = () => items.filter((i) => i.kind === "mesh" && /car/i.test(i.name));
const S = (tx, code, act) => ({ tx, code, act });
const PLANS = [
  {
    ask: "Add three street lamps along the pavement, 8 m apart",
    say: "I'll stand three lamps on the near pavement, 8 m apart, heads over the street.",
    next: ["Golden hour, low warm sun", "Put the camera low behind the car at 24 mm, looking at Anubis"],
    steps() {
      return [-8, 0, 8].map((x) => { const pos = new V3(x, 0.16, 5.6); return S(`Add a street lamp at ${bl(pos)}`, `helios.ops.object.add(type=<s>"STREET_LAMP"</s>, location=${bl(pos)}, rotation_z=<k>90</k>)`, () => { const it = addKind("lamp", pos, nextName("Street lamp")); it.obj.rotation.y = Math.PI / 2; return it; }); });
    },
  },
  {
    ask: "Paint the car red",
    say: "Repainting it red.",
    next: ["Make the red car blue and have it drive out of shot by frame 240"],
    steps(ctx) {
      const cs = cars(); if (!cs.length) return { fail: "There's no car in this scene." };
      const c = ctx.pick || (active && cs.includes(active) ? active : cs.length === 1 ? cs[0] : null);
      if (!c) return { question: `There are ${cs.length} cars. Which one?`, options: cs };
      return [S(`Set "${c.name}" base colour to #C0282D`, `helios.data.objects[<s>"${c.name}"</s>].material.base_color = <s>"#C0282D"</s>`, () => { setPaint(c, "#c0282d"); return c; })];
    },
  },
  {
    ask: "Make the red car blue and have it drive out of shot by frame 240",
    say: "I'll repaint the car blue and add a last keyframe on frame 240 that takes it 28 m down the street, out of the camera's view.",
    next: ["Park a silver car behind the red one", "Put the camera low behind the car at 24 mm, looking at Anubis"],
    steps() {
      const c = cars().find((i) => /red/i.test(i.name)) || null; if (!c) return { fail: "I can't find a red car in this scene. Select a car and ask me to paint it instead." };
      return [
        S(`Set "${c.name}" base colour to #2B6FD6 and name it "Blue sports car"`, `obj = helios.data.objects[<s>"${c.name}"</s>]\nobj.material.base_color = <s>"#2B6FD6"</s>\nobj.name = <s>"Blue sports car"</s>`, () => { setPaint(c, "#2b6fd6"); rename(c, "Blue sports car"); return c; }),
        S("Keyframe on frame 240 at (28.0, -0.8, 0.0)", `obj.location = (28.0, -0.8, 0.0)\nobj.keyframe_insert(<s>"location"</s>, frame=<k>240</k>)`, () => { keyAtCmd(c, DUR, (o) => { o.position.set(28, 0, 0.8); o.rotation.y = 0; }); return c; }),
      ];
    },
  },
  {
    ask: "Stand this on the ground and turn it to face the camera",
    say: "Setting it down on the ground and turning its front to the shot camera.",
    next: ["Put the camera low behind the car at 24 mm, looking at Anubis"],
    steps() {
      const it = active && active.kind !== "sun" && active !== shot ? active : null;
      if (!it) return { fail: "Select the object you mean first (click it on the stage), then send this again." };
      return [
        S(`Set "${it.name}" on the ground`, `obj = helios.data.objects[<s>"${it.name}"</s>]\nobj.location.z -= obj.bound_box.min.z`, () => { moveCmd(it, (o) => { o.updateMatrixWorld(); const b = new THREE.Box3().setFromObject(o); o.position.y -= b.min.y; }); return it; }),
        S(`Turn it to face "Shot camera"`, `obj.rotation_euler.z = helios.math.heading(obj, <s>"Shot camera"</s>)`, () => { moveCmd(it, (o) => { const cp = shot.obj.getWorldPosition(new V3()), p = o.getWorldPosition(new V3()); o.rotation.set(0, Math.atan2(cp.x - p.x, cp.z - p.z), 0); }); return it; }),
      ];
    },
  },
  {
    ask: "Golden hour, low warm sun",
    say: "Setting the sun to 18:24: low in the west, warm light, long shadows.",
    next: ["Add three street lamps along the pavement, 8 m apart"],
    steps() { return [S("World · time of day 18:24", `helios.world.sun.time_of_day = <s>"18:24"</s>`, () => { setHourCmd(18.4); return null; })]; },
  },
  {
    ask: "Put the camera low behind the car at 24 mm, looking at Anubis",
    say: "I'll put the shot camera 6 m behind the car at knee height, 24 mm, aimed at Anubis, keyed on this frame.",
    next: ["Make the camera follow the car", "Delete the buildings on the left of the frame"],
    steps() {
      const c = cars()[0], p = person; if (!c || !items.includes(p)) return { fail: "I need a car and Anubis in the scene for that." };
      const target = p.obj.getWorldPosition(new V3()).add(new V3(0, 1.4, 0)), pos = c.obj.getWorldPosition(new V3()).add(new V3(-6, 0.7, 1.6));
      return [
        S(`Move "Shot camera" to ${bl(pos)} and aim at "${p.name}"`, `cam = helios.data.objects[<s>"Shot camera"</s>]\ncam.location = ${bl(pos)}\ncam.look_at(<s>"${p.name}"</s>, offset_z=<k>1.4</k>)`, () => { moveCmd(shot, (o) => { o.position.copy(pos); o.lookAt(target); }); return shot; }),
        S("Lens 24 mm", `cam.data.lens = <k>24</k>`, () => { setLensCmd(24); return shot; }),
        S("Look through the shot camera", `helios.ops.view.camera()`, () => { toggleCam(true); return null; }),
      ];
    },
  },
  {
    ask: "Make the camera follow the car",
    say: "I'll add a Track To constraint so the shot camera keeps the car in the middle of the frame while it drives.",
    next: ["Delete the buildings on the left of the frame"],
    steps() {
      const c = cars()[0]; if (!c) return { fail: "There's no car in this scene to follow." };
      return [S(`Constraint on "Shot camera": Track To "${c.name}"`, `cam.constraints.new(<s>"TRACK_TO"</s>).target = helios.data.objects[<s>"${c.name}"</s>]`, () => { setTrack(shot, c.id); return shot; }), S("Look through the shot camera", `helios.ops.view.camera()`, () => { toggleCam(true); return null; })];
    },
  },
  {
    ask: "Delete the buildings on the left of the frame",
    say: "Looking through the shot camera, I'll delete every building on the left half of its frame.",
    next: ["Add three street lamps along the pavement, 8 m apart"],
    steps() {
      const cam = shot.obj.userData.cam; shot.obj.updateMatrixWorld(true);
      const left = items.filter((i) => i.name.startsWith("Building") && new THREE.Box3().setFromObject(i.obj).getCenter(new V3()).project(cam).x < 0);
      if (!left.length) return { fail: "No building is on the left of the shot camera's frame right now, so there's nothing to delete." };
      return left.map((b) => S(`Delete "${b.name}"`, `helios.data.objects.remove(helios.data.objects[<s>"${b.name}"</s>])`, () => { del([b]); return null; }));
    },
  },
  {
    ask: "Park a silver car behind the red one",
    say: "I'll duplicate the car, paint the copy silver and park it 6.5 m behind, standing still.",
    next: ["Paint the car red"],
    steps() {
      const c = cars()[0]; if (!c) return { fail: "There's no car in this scene to copy." };
      return [
        S(`Duplicate "${c.name}" as "Silver sports car", 6.5 m behind`, `new = helios.ops.object.duplicate(<s>"${c.name}"</s>, name=<s>"Silver sports car"</s>, offset=(-6.5, 0.0, 0.0))`, () => { evaluate(time); const it = dupItem(c, new V3(-6.5, 0, 0), "Silver sports car"); return it; }),
        S("Paint it #B9BEC6", `new.material.base_color = <s>"#B9BEC6"</s>`, () => { const it = items.find((i) => i.name === "Silver sports car"); if (it) setPaint(it, "#b9bec6"); return it; }),
      ];
    },
  },
  {
    ask: "Build a 3D model of my motorbike from a photo",
    say: "In Picacho I'd send your photo to our model builder and bring the model onto this stage, painted from the photo. That costs money, so there it runs only on your press. Nothing changes in this draft.",
    dry: true,
    steps() { return [S("Ask for a photo of the motorbike", `photo = helios.ui.ask_file(<s>"A photo of the motorbike"</s>)`), S("Build the model from the photo · about $0.30 · your press", `model = helios.ops.model.from_photo(photo, resolution=<k>1024</k>)`), S("Place it on the stage, painted from the photo", `helios.ops.object.import_model(model, paint_from=photo)`)]; },
  },
  {
    ask: "Drop three boxes onto the car",
    say: "I'll hang three boxes above the car, make the car solid, drop them from frame 1 and bake the fall into keyframes.",
    next: ["Put the camera low behind the car at 24 mm, looking at Anubis"],
    steps(ctx) {
      const cs = cars(); if (!cs.length) return { fail: "There's no car in this scene to drop boxes on." };
      const c = ctx.pick || (active && cs.includes(active) ? active : cs.length === 1 ? cs[0] : null);
      if (!c) return { question: `There are ${cs.length} cars. Which one?`, options: cs };
      const b = new THREE.Box3().setFromObject(c.obj), mid = b.getCenter(new V3());
      const spots = [[-0.5, 1.6, 0.2, 0.3], [0.4, 3.0, -0.2, 0.9], [0, 4.4, 0.1, 1.7]];
      return [
        ...spots.map(([dx, dy, dz, ry], n) => { const pos = new V3(mid.x + dx, b.max.y + dy, mid.z + dz); return S(`Add box ${n + 1} at ${bl(pos)}, an active rigid body`, `box = helios.ops.object.add(type=<s>"CUBE"</s>, size=<k>0.8</k>, location=${bl(pos)})\nhelios.ops.rigidbody.add(box, type=<s>"ACTIVE"</s>, mass=<k>2</k>)`, () => { const it = addKind("box", pos, nextName("Box")); it.obj.scale.setScalar(0.4); it.obj.rotation.set(ry * 0.4, ry, 0); it.phys = { ...PHYS_DEF, type: "active", mass: 2 }; return it; }); }),
        S(`Make ${c.name} a passive rigid body`, `helios.ops.rigidbody.add(<s>"${esc(c.name)}"</s>, type=<s>"PASSIVE"</s>)`, () => { setPhys(c, { ...(c.phys || PHYS_DEF), type: "passive" }); return c; }),
        S("Simulate from frame 1 and bake to keyframes", `helios.ops.rigidbody.bake(frame_start=<k>1</k>, frame_end=<k>${FRAMES + 1}</k>)`, () => { setTime(0); bakePhys(); return null; }),
      ];
    },
  },
  // People (2026-09-30, operator picked "Posable people").
  {
    ask: "Sit the stand-in on the car",
    say: "I'll sit the stand-in on the top of the car nearest to them, facing out, legs over the edge.",
    next: ["Make them wave", "Put the camera low behind the car at 24 mm, looking at Anubis"],
    steps() {
      const p = standIn(); const c = cars()[0] || null;
      if (!p) return { fail: "There's no person in this scene. Add one: Add ▸ Person." };
      if (!c) return { fail: "There's no car in this scene to sit on." };
      return [S(`Sit "${p.name}" on "${c.name}"`, `helios.ops.pose.sit_on(<s>"${esc(p.name)}"</s>, <s>"${esc(c.name)}"</s>)`, () => (sitOn(p, c) ? p : null))];
    },
  },
  {
    ask: "Make them wave",
    say: "Raising the right hand in a wave; the rest of the pose stays as it is.",
    next: ["Sit the stand-in on the car"],
    steps() {
      const p = active?.rig ? active : standIn();
      if (!p) return { fail: "There's no person in this scene. Add one: Add ▸ Person." };
      return [S(`Pose "${p.name}": Wave (right hand)`, `helios.ops.pose.preset(<s>"${esc(p.name)}"</s>, <s>"WAVE"</s>)`, () => { presetCmd(p, "wave"); return p; })];
    },
  },
];
/** The person the examples mean by "the stand-in" / "them": the set's own stand-in, else the first person. */
function standIn() { return items.includes(person) ? person : people()[0] || null; }
const astraLog = [];
let askFirst = true, examplesOpen = true, astraBusy = false;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function flash(it) {
  if (!it || !it.obj || !items.includes(it)) return;
  const b = new THREE.BoxHelper(it.obj, 0x7bc47f); helpers.add(b);
  let n = 0; const t = setInterval(() => { b.visible = !b.visible; if (++n > 5) { clearInterval(t); helpers.remove(b); } }, 110);
}
function buildAstra() {
  const nb = $("nbody"); nb.innerHTML = `
  <div class="astra">
    <div class="ahdr"><div class="mark">A</div><div><b>Astra</b><small>GPT-6 · works on this 3D scene</small></div></div>
    <p class="atop" id="atop">${esc(STUDIO_ASTRA_TOP_LINE)}</p>
    <div class="asees" id="asees"></div>
    <div class="thread" id="thread"></div>
    <div class="exh"><button class="hmenu" id="exToggle">Examples ${examplesOpen ? "▾" : "▸"}</button></div>
    <div class="chips" id="chips" ${examplesOpen ? "" : "hidden"}></div>
    <div class="ainput">
      <textarea id="astraIn" placeholder="Tell Astra what to add, move, change or animate in this scene…  “this” means the selected object" aria-label="Message to Astra"></textarea>
      <div class="row"><label class="check"><input type="checkbox" id="askFirst" ${askFirst ? "checked" : ""}> Show the plan before applying</label><button class="pbtn accent" id="astraSend" style="flex:none">Send ⏎</button></div>
    </div>
  </div>`;
  $("chips").innerHTML = PLANS.map((p, i) => `<button class="chip" data-plan="${i}">${esc(p.ask)}</button>`).join("");
  $("chips").onclick = (e) => { const b = e.target.closest("[data-plan]"); if (!b) return; $("astraIn").value = T(PLANS[+b.dataset.plan].ask); $("astraIn").focus(); };
  $("exToggle").onclick = () => { examplesOpen = !examplesOpen; $("chips").hidden = !examplesOpen; $("exToggle").textContent = `Examples ${examplesOpen ? "▾" : "▸"}`; };
  $("askFirst").onchange = (e) => (askFirst = e.target.checked);
  $("astraSend").onclick = () => sendAstra();
  $("astraIn").addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAstra(); } });
  if (!astraLog.length) astraLog.push({ who: "a", intro: true, text: "I can see the whole scene, the selection and the timeline. Ask me to add, move, recolour, light or animate anything in it, in your own words. I show every step before I take it, and ⌘Z brings it all back." });
  renderThread(); renderAstraSees();
}
function renderAstraSees() {
  const s = $("asees"); if (!s) return;
  s.innerHTML = `Astra sees <b>${items.length} objects</b> · selected <b>${esc(active ? active.name : "nothing")}</b> · frame <b>${frameNo()}</b> · <b>${hourText()}</b> · shot camera <b>${shot.obj.userData.lensMm} mm</b>`;
}
function sendAstra(text) {
  if (astraBusy) return toast("Astra is still working");
  const inp = $("astraIn"); text = (text ?? inp.value).trim(); if (!text) return; inp.value = "";
  astraLog.push({ who: "u", text });
  if (examplesOpen) { examplesOpen = false; $("chips").hidden = true; $("exToggle").textContent = "Examples ▸"; }
  const asked = text.toLowerCase().replace(/[.!]+$/, "");
  const plan = PLANS.find((p) => p.ask.toLowerCase() === asked || T(p.ask).toLowerCase() === asked);
  if (plan) return startPlan(plan, {});
  if (!opts.astra) { astraLog.push({ who: "a", text: "Here I run the examples only (open Examples ▸). Inside Picacho I read any request, in your words, and turn it into the same visible steps." }); renderThread(); return; }
  void askModel(text);
}
function startPlan(plan, ctx) {
  const r = plan.steps(ctx); const msg = { who: "a", plan, ctx };
  if (r.fail) { msg.text = r.fail; msg.state = "fail"; }
  else if (r.question) { msg.text = r.question; msg.state = "question"; msg.options = r.options; }
  else { msg.text = plan.say; msg.steps = r; msg.state = plan.dry ? "dry" : askFirst ? "plan" : "queued"; }
  astraLog.push(msg); renderThread();
  if (msg.state === "queued") runSteps(msg);
}
async function runSteps(msg) {
  astraBusy = true; astraMaking = true; msg.state = "running"; msg.at = 0; renderThread();
  const outer = txn; txn = []; const touched = new Set();
  try {
    for (let i = 0; i < msg.steps.length; i++) {
      // One step that breaks never stops the rest, nor leaves the plan half-undoable.
      let r = null;
      try { r = msg.steps[i].act ? msg.steps[i].act() : null; } catch (e) { console.warn("[studio] Astra step failed:", e); msg.steps[i].failed = true; r = null; }
      if (r) { touched.add(r); flash(r); }
      msg.at = i + 1; evaluate(time); refreshOutlines(); renderOutliner(); renderThread();
      await wait(320);
    }
  } finally {
    const list = txn; txn = outer; astraMaking = false;
    if (list.length) push({ label: "Astra: " + msg.plan.ask, undo() { [...list].reverse().forEach((c) => c.undo()); }, redo() { list.forEach((c) => c.redo()); } });
    msg.undoIndex = undoStack.length - 1; astraBusy = false;
  }
  msg.state = "done"; renderThread();
  const keep = [...touched].filter((t) => items.includes(t) && t.kind !== "sun");
  if (keep.length) { selection.clear(); keep.forEach((k) => selection.add(k)); active = keep[keep.length - 1]; }
  info(`Astra · ${msg.steps.length} steps applied · ⌘Z undoes them together`);
  refreshSel();
}
function renderThread() {
  const th = $("thread"); if (!th) return; th.innerHTML = "";
  astraLog.forEach((m, idx) => {
    if (m.who === "u") { const d = document.createElement("div"); d.className = "msg-u"; d.translate = false; d.textContent = m.text; th.appendChild(d); return; }
    const d = document.createElement("div"); d.className = "msg-a"; d.innerHTML = `<span class="who">Astra</span><div>${esc(m.text)}</div>`;
    if (m.state === "thinking") d.classList.add("thinking");
    if (m.state === "question") {
      const b = document.createElement("div"); b.className = "abtns";
      m.options.forEach((o, j) => { const x = document.createElement("button"); x.className = "pbtn"; x.textContent = o.name; x.dataset.opt = `${idx}:${j}`; b.appendChild(x); });
      d.appendChild(b);
    }
    if (m.state === "answered") d.insertAdjacentHTML("beforeend", `<div class="hint" style="margin:0">You picked ${esc(m.picked)}.</div>`);
    if (m.steps) {
      const st = document.createElement("div"); st.className = "steps";
      st.innerHTML = m.steps.map((s, i) => {
        const done = m.state === "done" || (m.state === "running" && i < m.at), now = m.state === "running" && i === m.at;
        const skip = m.state === "dry" || s.note;
        return `<div class="step ${skip ? "skip" : done ? "done" : ""}"><span class="st">${skip ? "·" : s.failed ? "✕" : done ? "✓" : now ? "…" : "○"}</span><span class="tx">${esc(s.tx)}</span></div>`;
      }).join("");
      d.appendChild(st);
      const code = document.createElement("div"); code.className = "code"; code.translate = false; code.hidden = !m.showCode;
      code.innerHTML = m.steps.map((s) => esc(s.code).replace(/&lt;(\/?)(s|k|c)&gt;/g, (_, sl, t) => (sl ? "</span>" : `<span class="${t}">`))).join("\n");
      d.appendChild(code);
      const b = document.createElement("div"); b.className = "abtns";
      if (m.state === "plan") b.innerHTML = `<button class="pbtn accent" data-apply="${idx}">Apply ${m.steps.length} step${m.steps.length > 1 ? "s" : ""}</button><button class="pbtn" data-cancel="${idx}">Cancel</button>`;
      if (m.state === "done") b.innerHTML = `<button class="pbtn" data-undo="${idx}">Undo these steps</button>`;
      if (m.state !== "running") b.insertAdjacentHTML("beforeend", `<button class="pbtn" data-code="${idx}">${m.showCode ? "Hide" : "Show"} code</button>`);
      d.appendChild(b);
      if (m.state === "done" && m.plan.next?.length) {
        const nx = document.createElement("div"); nx.className = "abtns"; nx.innerHTML = `<span class="hint" style="margin:0;width:100%">Next?</span>` + m.plan.next.map((n) => `<button class="chip" data-next="${esc(T(n))}">${esc(T(n))}</button>`).join(""); d.appendChild(nx);
      }
    }
    if (m.state === "undone") d.insertAdjacentHTML("beforeend", `<div class="hint" style="margin:0">Undone.</div>`);
    if (m.state === "cancelled") d.insertAdjacentHTML("beforeend", `<div class="hint" style="margin:0">Cancelled · nothing changed.</div>`);
    th.appendChild(d);
  });
  th.scrollTop = th.scrollHeight;
  th.onclick = (e) => {
    const t = e.target.closest("button"); if (!t || astraBusy) return;
    if (t.dataset.apply) { const m = astraLog[+t.dataset.apply]; const r = m.plan.steps(m.ctx || {}); if (r.fail || r.question) { m.state = "fail"; m.text = r.fail || "The scene changed since I planned this; send it again."; m.steps = null; renderThread(); return; } m.steps = r; runSteps(m); }
    else if (t.dataset.cancel) { const m = astraLog[+t.dataset.cancel]; m.state = "cancelled"; m.steps = null; renderThread(); }
    else if (t.dataset.undo) { const m = astraLog[+t.dataset.undo]; if (undoStack.length - 1 === m.undoIndex) { undo(); m.state = "undone"; } else toast("Other changes came after these steps: use Edit ▸ Undo History"); renderThread(); }
    else if (t.dataset.code) { const m = astraLog[+t.dataset.code]; m.showCode = !m.showCode; renderThread(); }
    else if (t.dataset.opt) { const [i, j] = t.dataset.opt.split(":").map(Number); const m = astraLog[i]; const pick = m.options[j]; m.state = "answered"; m.picked = pick.name; if (!m.plan) { renderThread(); sendAstra(pick.name); return; } select(pick); startPlan(m.plan, { pick }); }
    else if (t.dataset.next) sendAstra(t.dataset.next);
  };
}

// ================= Astra, any request (stage 4, 2026-09-29) =================
// Free words go to Astra (opts.astra → askStudioAstra): she reads the scene
// summary below and answers with a plan in the same shape as the scripted
// examples — steps in plain words, Apply / Cancel, one undo for the whole
// request, ✦ on what she makes. Her answer is checked again here against
// the scene as it stands when Apply is pressed (validateStudioPlan, the
// server's own check): an object that has gone since becomes a plain
// "I can't find …" step, and every number is clamped.
const sid = (it) => "o" + it.id;
function sceneSummary() {
  scene.updateMatrixWorld(true);
  const objs = items.filter((i) => i.kind !== "sun").map((i) => {
    const b = new THREE.Box3().setFromObject(i.obj), e = b.isEmpty();
    const c = e ? i.obj.getWorldPosition(new V3()) : b.getCenter(new V3()), sz = e ? new V3() : b.getSize(new V3());
    const y = e ? c.y : b.min.y, par = i.obj.parent && i.obj.parent !== scene ? itemOf(i.obj.parent) : null;
    return { id: sid(i), name: i.name, kind: i.kind === "light" || i.kind === "camera" || i.kind === "empty" ? i.kind : "mesh", at: [c.x, -c.z, y], size: [sz.x, sz.z, sz.y], turn: THREE.MathUtils.radToDeg(i.obj.rotation.y), sel: selection.has(i), hidden: i.hidden, astra: !!i.byAstra, parent: par ? sid(par) : undefined, keys: i.keys.length, physics: i.phys && i.phys.type !== "none" ? i.phys.type : undefined, pose: i.rig ? personWords(i)?.words : undefined };
  });
  const fk = Object.keys(STUDIO_FORMATS).find((k) => STUDIO_FORMATS[k] === format) || "16:9";
  return normaliseStudioSummary({ frame: frameNo(), hour, sky: skyMode, format: fk, lens: shot.obj.userData.lensMm, camera: sid(shot), aim: shot.obj.userData.track ? "o" + shot.obj.userData.track : null, range: [pStart, pEnd], objects: objs });
}
/** The shot camera's right and "towards the camera" on the ground (three.js x, z). */
function camGround() {
  const d = new V3(); shot.obj.userData.cam.getWorldDirection(d);
  const l = Math.hypot(d.x, d.z) || 1, dx = d.x / l, dz = d.z / l;
  return { right: [-dz, dx], toward: [-dx, -dz] };
}
const worldBox = (it) => { it.obj.updateMatrixWorld(true); return new THREE.Box3().setFromObject(it.obj); };
/** Puts `it` beside `ref` (StudioPlace), base on the ground or on top. */
function placeBeside(it, ref, pl) {
  const rb = worldBox(ref), ob = worldBox(it); if (rb.isEmpty()) return;
  const own = ob.isEmpty() ? [0.5, 0.5, 0.5] : ob.getSize(new V3()).toArray(), g = camGround();
  const at = besidePosition({ min: rb.min.toArray(), max: rb.max.toArray() }, own, pl.side, pl.gap, g.right, g.toward);
  const base = ob.isEmpty() ? it.obj.getWorldPosition(new V3()) : new V3((ob.min.x + ob.max.x) / 2, ob.min.y, (ob.min.z + ob.max.z) / 2);
  it.obj.position.add(new V3(at[0] - base.x, at[1] - base.y, at[2] - base.z));
}
/** Moves an object's base centre to (mode "to") or by (mode "by") a Blender-axes vector; null axes keep. */
function moveBy(it, mode, v) {
  const t = toThreeAxes(v);
  if (mode === "by") { it.obj.position.add(new V3(t.x ?? 0, t.y ?? 0, t.z ?? 0)); return; }
  const b = worldBox(it), base = b.isEmpty() ? it.obj.getWorldPosition(new V3()) : new V3((b.min.x + b.max.x) / 2, b.min.y, (b.min.z + b.max.z) / 2);
  it.obj.position.add(new V3(t.x === null ? 0 : t.x - base.x, t.y === null ? 0 : t.y - base.y, t.z === null ? 0 : t.z - base.z));
}

// Stage 5 (2026-09-29 — operator: "Fix walls."): what Astra adds, moves or
// copies is kept clear of the set's walls (The place's solid meshes, and
// the other things) and in the shot camera's view — clearSpot searches
// further the way it was asked to go, then towards the shot camera — and
// the step says where it went and why.
function solidMeshes() {
  const out = []; if (place.hidden || !items.includes(place)) return out;
  place.obj.updateMatrixWorld(true);
  place.obj.traverse((o) => { if (!o.isMesh) return; const b = new THREE.Box3().setFromObject(o); if (!b.isEmpty() && b.max.y >= 0.3) out.push({ o, b }); });
  return out;
}
const _clearRay = new THREE.Raycaster();
function seenFromShot(meshes, box) {
  if (!meshes.length) return true;
  const eye = shot.obj.userData.cam.getWorldPosition(new V3()), objs = meshes.map((m) => m.o);
  const cx = (box.min[0] + box.max[0]) / 2, cz = (box.min[2] + box.max[2]) / 2, h = box.max[1] - box.min[1];
  for (const f of [0.5, 0.8, 0.97]) {
    const d = new V3(cx, box.min[1] + h * f, cz).sub(eye), dist = d.length(); if (dist < 0.01) return true;
    _clearRay.set(eye, d.divideScalar(dist)); _clearRay.near = 0; _clearRay.far = Math.max(0, dist - 0.05);
    if (!_clearRay.intersectObjects(objs, false).length) return true;
  }
  return false;
}
const related = (a, b) => { for (let o = a.obj; o; o = o.parent) if (o === b.obj) return true; for (let o = b.obj; o; o = o.parent) if (o === a.obj) return true; return false; };
const SIDE_WORDS = { left: "further left", right: "further right", front: "closer to the camera", behind: "further back", near: "further aside" };
function keepClear(it, dirs, words) {
  if (!it || it.obj.parent !== scene || it.kind === "camera" || it.kind === "sun") return "";
  const b = worldBox(it); if (b.isEmpty() || b.min.y > 0.5) return "";
  const meshes = solidMeshes();
  const obstacles = meshes.map((m) => ({ min: m.b.min.toArray(), max: m.b.max.toArray(), name: "the wall" }));
  for (const o of items) {
    if (o === it || o === place || o.hidden || o.kind !== "mesh" || related(o, it)) continue;
    const ob = worldBox(o); if (!ob.isEmpty()) obstacles.push({ min: ob.min.toArray(), max: ob.max.toArray(), name: `"${o.name}"` });
  }
  const g = camGround();
  const r = clearSpot({ box: { min: b.min.toArray(), max: b.max.toArray() }, obstacles, dirs: [...dirs, g.toward], visible: (bx) => seenFromShot(meshes, bx) });
  if (r.moved > 0) it.obj.position.add(new V3(r.dx, 0, r.dz));
  return clearNote(r, [...words, "towards the shot camera"]);
}
const sideDirs = (pl) => (pl && SIDE_WORDS[pl.side] ? { dirs: [sideDirection(pl.side, camGround().right, camGround().toward)], words: [SIDE_WORDS[pl.side]] } : { dirs: [], words: [] });
const alongDirs = (dx, dz) => (Math.hypot(dx, dz) > 0.01 ? { dirs: [[dx, dz]], words: ["further along"] } : { dirs: [], words: [] });
const DEG2 = Math.PI / 180;
function codeOf(s) {
  const { say, op, ...args } = s;
  const parts = Object.entries(args).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `${k}=${typeof v === "string" ? `<s>"${v}"</s>` : typeof v === "number" ? `<k>${v}</k>` : JSON.stringify(v)}`);
  return `helios.ops.${op}(${parts.join(", ")})`;
}
function modelSteps(answer) {
  const plan = validateStudioPlan(answer, knownOf(sceneSummary()));
  const made = new Map();
  const get = (ref) => { const it = ref.startsWith("new:") ? made.get(ref.slice(4)) : byId(+ref.slice(1)); return it && items.includes(it) ? it : null; };
  const all = (refs) => refs.map(get).filter(Boolean);
  const keep = (it, name) => { if (it && name) made.set(name.toLowerCase(), it); return it; };
  return plan.steps.map((s) => {
    const L = () => all(s.targets || []);
    let act = null, st = null;
    const told = new Set();
    const tell = (n) => { if (!n || told.has(n)) return; told.add(n); st.tx = `${s.say} — ${[...told].join("; ")}`; };
    switch (s.op) {
      case "note": break;
      case "select": act = () => { const l = L(); if (!l.length) return null; selection.clear(); l.forEach((i) => selection.add(i)); active = l[l.length - 1]; refreshSel(); return active; }; break;
      case "add": act = () => {
        let at = null; if (s.at) { const t = toThreeAxes(s.at); at = new V3(t.x ?? cursor3d.position.x, t.y ?? 0, t.z ?? cursor3d.position.z); }
        const it = addKind(STUDIO_ADD_KINDS[s.kind], at, s.name || undefined); if (!it) return null;
        if (s.place) { const ref = get(s.place.of); if (ref) placeBeside(it, ref, s.place); }
        if (s.color) setPaint(it, s.color);
        const w = s.place ? sideDirs(s.place) : { dirs: [], words: [] };
        tell(T(keepClear(it, w.dirs, w.words)));
        return keep(it, s.name);
      }; break;
      case "delete": act = () => { const l = L().filter((i) => i !== shot); if (l.length) del(l); return null; }; break;
      case "duplicate": act = () => {
        const src = L()[0]; if (!src || src === shot) return null; evaluate(time);
        const t = s.by ? toThreeAxes(s.by) : null;
        const it = dupItem(src, t ? new V3(t.x ?? 0, t.y ?? 0, t.z ?? 0) : s.place ? new V3() : undefined, s.name || undefined);
        if (s.place) { const ref = get(s.place.of); if (ref) placeBeside(it, ref, s.place); }
        const w = s.place ? sideDirs(s.place) : t ? alongDirs(t.x ?? 0, t.z ?? 0) : alongDirs(2.5, 0);
        tell(T(keepClear(it, w.dirs, w.words)));
        return keep(it, s.name);
      }; break;
      case "move": act = () => { let last = null; for (const it of L()) { moveCmd(it, (o) => {
        const was = o.position.clone();
        if (s.place) { const ref = get(s.place.of); if (ref && ref !== it) placeBeside(it, ref, s.place); } else if (s.v) moveBy(it, s.mode, s.v);
        const w = s.place ? sideDirs(s.place) : alongDirs(o.position.x - was.x, o.position.z - was.z);
        tell(T(keepClear(it, w.dirs, w.words)));
      }); last = it; } return last; }; break;
      case "rotate": act = () => { let last = null; for (const it of L()) { moveCmd(it, (o) => {
        if (s.face) { const f = get(s.face); if (!f || f === it) return; const fp = f.obj.getWorldPosition(new V3()), p = o.getWorldPosition(new V3()); o.rotation.set(0, Math.atan2(fp.x - p.x, fp.z - p.z), 0); return; }
        const t = toThreeAxes(s.v), r = [t.x, t.y, t.z].map((v) => (v === null ? null : v * DEG2));
        ["x", "y", "z"].forEach((k, n) => { if (r[n] === null) return; o.rotation[k] = s.mode === "by" ? o.rotation[k] + r[n] : r[n]; });
      }); last = it; } return last; }; break;
      case "scale": act = () => { let last = null; for (const it of L()) { moveCmd(it, (o) => { const t = toThreeSizes(s.v); ["x", "y", "z"].forEach((k) => { if (t[k] === null) return; o.scale[k] = Math.max(0.001, s.mode === "by" ? o.scale[k] * t[k] : t[k]); }); tell(T(keepClear(it, [], []))); }); last = it; } return last; }; break;
      case "size": act = () => { let last = null; for (const it of L()) { moveCmd(it, (o) => {
        const b = worldBox(it); if (b.isEmpty()) return; const sz = b.getSize(new V3()), f = sizeFactors({ x: sz.x, y: sz.y, z: sz.z }, toThreeSizes(s.v)); if (!f) return;
        const low = b.min.y; o.scale.set(o.scale.x * f.x, o.scale.y * f.y, o.scale.z * f.z); const a = worldBox(it); if (!a.isEmpty()) o.position.y += low - a.min.y;
        // Stage 8: grown into a wall, or behind one from the shot camera, it is moved clear like an add or a move.
        tell(T(keepClear(it, [], [])));
      }); last = it; } return last; }; break;
      case "color": act = () => { let last = null; for (const it of L()) { setPaint(it, s.color); last = it; } return last; }; break;
      case "material": act = () => { let last = null; for (const it of L()) {
        const paint = it.obj.userData.paint || []; if (!paint.length) continue;
        const snap = () => paint.map((m) => [m.metalness, m.roughness, m.emissive.getHex(), m.emissiveIntensity, m.color.getHex()]);
        const put = (v) => paint.forEach((m, n) => { m.metalness = v[n][0]; m.roughness = v[n][1]; m.emissive.setHex(v[n][2]); m.emissiveIntensity = v[n][3]; m.color.setHex(v[n][4]); });
        const b = snap();
        paint.forEach((m) => { if (s.metallic !== null) m.metalness = s.metallic; if (s.roughness !== null) m.roughness = s.roughness; if (s.emission) { m.emissive.set(s.emission); m.emissiveIntensity = Math.max(1, m.emissiveIntensity); } if (s.color) m.color.set(s.color); });
        const a = snap(); push({ label: "Material", undo() { put(b); }, redo() { put(a); } }); last = it;
      } return last; }; break;
      case "hide": case "show": act = () => { let last = null; for (const it of L()) { if (it.hidden !== (s.op === "hide")) setHidden(it, s.op === "hide"); last = it; } return s.op === "show" ? last : null; }; break;
      case "rename": act = () => { const it = L()[0]; if (!it) return null; rename(it, s.name); return it; }; break;
      case "parent": act = () => {
        const par = s.parent ? get(s.parent) : null; if (s.parent && !par) return null;
        for (const k of L()) {
          if (!par) { unparentOne(k); continue; }
          let up = par.obj, loop = false; while (up) { if (up === k.obj) loop = true; up = up.parent; } if (loop || k === par) continue;
          const was = k.obj.parent, w = trs(k.obj), kk = clone(k.keys); par.obj.attach(k.obj); const now = trs(k.obj); k.keys = [];
          push({ label: "parent", undo() { was.attach(k.obj); applyTRS(k.obj, w); k.keys = clone(kk); }, redo() { par.obj.attach(k.obj); applyTRS(k.obj, now); k.keys = []; } });
        }
        return par;
      }; break;
      case "key": act = () => { let last = null; const t = (s.frame - 1) / FPS; for (const it of L()) {
        keyAtCmd(it, t, () => { if (s.mode && s.v) moveBy(it, s.mode, s.v); });
        if (s.interp && it.interp !== s.interp) { const b = it.interp, v = s.interp; it.interp = v; push({ label: "interp", undo() { it.interp = b; }, redo() { it.interp = v; } }); }
        last = it;
      } evaluate(time); return last; }; break;
      case "hour": act = () => { setHourCmd(s.hour); return null; }; break;
      case "sky": act = () => { if (skyMode !== s.sky) setSkyMode(s.sky); return null; }; break;
      case "lens": act = () => { setLensCmd(s.mm); return shot; }; break;
      case "format": act = () => { propCmd("Format", () => format, (v) => { format = v; renderVText(); }, STUDIO_FORMATS[s.format]); return shot; }; break;
      case "aim": act = () => { const t = s.target ? get(s.target) : null; if (s.target && !t) return null; setTrack(shot, t ? t.id : null); return shot; }; break;
      case "view": act = () => { toggleCam(s.camera); return null; }; break;
      case "array": act = () => { let last = null; const t = toThreeAxes(s.v); for (const it of L()) { if (it.kind === "camera") continue; const sc = it.obj.scale; setArray(it, s.count > 1 ? { count: s.count, x: (t.x ?? 0) / (sc.x || 1), y: (t.y ?? 0) / (sc.y || 1), z: (t.z ?? 0) / (sc.z || 1) } : undefined); last = it; } return last; }; break;
      case "mirror": act = () => { let last = null; for (const it of L()) { if (it.kind === "camera") continue; setMirror(it, s.axis ? { axis: s.axis } : undefined); last = it; } return last; }; break;
      case "physics": act = () => { let last = null; for (const it of L()) { if (it.kind === "camera" || (it.obj.parent && it.obj.parent !== scene)) continue; setPhys(it, { ...physOf(it), type: s.type, ...(s.mass !== null ? { mass: s.mass } : {}) }); last = it; } return last; }; break;
      case "simulate": act = () => { simulatePhys(time); return null; }; break;
      case "bake": act = () => { bakePhys(); return null; }; break;
      case "frame": act = () => { setTime((s.frame - 1) / FPS); return null; }; break;
      case "pose": act = () => { let last = null; for (const it of L()) {
        if (!it.rig) continue;
        if (s.preset) presetCmd(it, s.preset);
        if (s.bone && s.v) { const n = s.bone, cur = it.pose.rot[n] || [0, 0, 0], v = [s.v.x, s.v.y, s.v.z]; poseAct(it, `Rotate ${boneLabel(n)}`, () => { it.pose.rot[n] = clampRot(n, v.map((x, i) => (x === null ? cur[i] : s.mode === "by" ? cur[i] + x : x))); }, [n]); }
        last = it;
      } return last; }; break;
      case "sit_on": case "lean_on": case "look_at": act = () => { let last = null; const t = get(s.of); if (!t) return null; for (const it of L()) {
        if (!it.rig || it === t) continue;
        const ok = s.op === "sit_on" ? sitOn(it, t) : s.op === "lean_on" ? leanOn(it, t) : lookAtCmd(it, t);
        if (!ok) tell(T(s.op === "sit_on" ? `there's no top on "${t.name}" to sit on` : `"${t.name}" is out of reach`)); else last = it;
      } return last; }; break;
      case "add_person": act = () => {
        let at = null; if (s.at) { const t = toThreeAxes(s.at); at = new V3(t.x ?? cursor3d.position.x, t.y ?? 0, t.z ?? cursor3d.position.z); }
        const it = addKind("person", at, s.name || undefined); if (!it) return null;
        if (s.place) { const ref = get(s.place.of); if (ref) placeBeside(it, ref, s.place); }
        const w = s.place ? sideDirs(s.place) : { dirs: [], words: [] };
        tell(T(keepClear(it, w.dirs, w.words)));
        if (s.preset && s.preset !== "stand") presetCmd(it, s.preset);
        return keep(it, s.name);
      }; break;
      case "range": act = () => { propCmd("Playback range", () => [pStart, pEnd], (v) => { pStart = v[0]; pEnd = v[1]; renderTimeline(); }, [s.start, s.end]); return null; }; break;
    }
    st = { ...S(s.say, s.op === "note" ? "# skipped" : codeOf(s), act), note: s.op === "note" };
    return st;
  });
}
async function askModel(text) {
  const turns = astraLog.slice(0, -1).filter((m) => m.text && !m.intro && m.state !== "thinking").slice(-STUDIO_TURNS_MAX).map((m) => ({ who: m.who === "u" ? "person" : "astra", text: m.text }));
  const wait1 = { who: "a", text: "Reading the scene and planning…", state: "thinking" };
  astraLog.push(wait1); astraBusy = true; renderThread();
  let r;
  try { r = await opts.astra.ask(text, sceneSummary(), turns); } catch { r = { error: opts.astra.unreachable }; } finally { astraBusy = false; }
  if (stopped) return;
  astraLog.splice(astraLog.indexOf(wait1), 1);
  if (!r || r.error) { astraLog.push({ who: "a", text: (r && r.error) || opts.astra.unreachable, state: "fail" }); renderThread(); return; }
  const p = r.plan;
  if (p.question) { astraLog.push({ who: "a", text: p.question, state: "question", options: p.options.map((o) => ({ name: o })) }); renderThread(); return; }
  const notes = p.steps.filter((s) => s.op === "note").map((s) => s.say);
  if (!planActs(p)) { astraLog.push({ who: "a", text: [p.reply || T(STUDIO_ASTRA_NOTHING), ...notes.map(T)].join(" "), state: "said" }); renderThread(); return; }
  startPlan({ ask: text, say: p.reply || "Here's my plan.", next: [], steps: () => { const st = modelSteps(r.answer); return st.some((x) => !x.note) ? st : { fail: "The scene changed since I planned this, and nothing in the plan is left to do. Send it again." }; } }, {});
}

// ================= outliner =================
const OI = {
  mesh: `<svg viewBox="0 0 24 24"><path d="M12 4l8 14H4z" fill="#e0a468"/></svg>`,
  camera: `<svg viewBox="0 0 24 24" fill="none" stroke="#8bdc00" stroke-width="2.2" stroke-linejoin="round"><rect x="3" y="7" width="12" height="10" rx="1.5"/><path d="M15 11l6-3.5v9L15 13"/></svg>`,
  light: `<svg viewBox="0 0 24 24"><circle cx="12" cy="10" r="5" fill="#ffd166"/><rect x="10" y="15" width="4" height="4" fill="#ffd166"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" fill="none" stroke="#ffd166" stroke-width="2"><circle cx="12" cy="12" r="4" fill="#ffd166"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/></svg>`,
  empty: `<svg viewBox="0 0 24 24" fill="none" stroke="#e4e5e8" stroke-width="2"><path d="M12 3v18M3 12h18M6 6l12 12"/></svg>`,
  coll: `<svg viewBox="0 0 24 24" fill="none" stroke="#e4e5e8" stroke-width="1.8"><rect x="4" y="5" width="16" height="14" rx="2"/></svg>`,
};
const CAM_ICO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="7" width="12" height="10" rx="1.5"/><path d="M15 11l6-3.5v9L15 13"/></svg>`;
const EYE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/></svg>`;
const EYE_OFF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 12s4-4 9-4 9 4 9 4M5 15l-1.5 1.5M19 15l1.5 1.5M9 16.5 8.4 18.5M15 16.5l.6 2"/></svg>`;
let q = ""; const closed = new Set();
function renderOutliner() {
  const ul = $("outliner"); ul.innerHTML = "";
  const row = (html, cls = "") => { const li = document.createElement("li"); li.className = cls; li.innerHTML = html; ul.appendChild(li); return li; };
  row(`<span class="tw">▼</span><span class="oi">${OI.coll}</span><span class="nm">Scene Collection</span>`, "coll");
  const roots = (coll) => items.filter((i) => i.coll === coll && (i.obj.parent === scene || i.kind === "sun" || !itemOf(i.obj.parent)));
  const draw = (it, depth) => {
    if (q && !it.name.toLowerCase().includes(q)) { items.filter((k) => k.obj.parent === it.obj).forEach((k) => draw(k, depth + 1)); return; }
    const li = row(`${"<span class='tw'></span>".repeat(depth)}<span class="oi">${OI[it.kind] || OI.mesh}</span><span class="nm"></span>${it.byAstra ? `<span class="ast" title="Made by Astra">✦</span>` : ""}${it.obj.userData.track ? `<span class="md" title="Track To constraint">⛓</span>` : ""}${it.obj.userData.array ? `<span class="md" title="Array modifier">▦</span>` : ""}${it.keys.length ? `<span class="kf">◆ ${it.keys.length}</span>` : ""}${it.kind !== "sun" ? `<button class="tg" title="Hide in viewport (H)">${it.hidden ? EYE_OFF : EYE}</button><button class="tg rv ${it.noRender ? "off" : ""}" title="${it.noRender ? "Left out of renders" : "Shown in renders"}">${CAM_ICO}</button>` : ""}`,
      (selection.has(it) ? "sel " : "") + (it === active ? "act " : "") + (it.hidden ? "hid" : ""));
    li.querySelector(".nm").textContent = it.name; li.querySelector(".nm").translate = false;
    li.onclick = (e) => { if (e.target.closest(".rv")) { setNoRender(it, !it.noRender); renderOutliner(); return; } if (e.target.closest(".tg")) return toggleHide([it]); if (["world", "render", "output"].includes(ptab)) ptab = "object"; select(it, e.shiftKey || e.metaKey || e.ctrlKey); };
    li.ondblclick = (e) => { if (e.target.closest(".nm")) renameInline(li, it); else if (it.kind !== "sun") frameObj(it.obj); };
    items.filter((k) => k.obj.parent === it.obj).forEach((k) => draw(k, depth + 1));
  };
  for (const coll of COLLS) {
    const list = roots(coll); if (!list.length) continue;
    const li = row(`<span class="tw"></span><span class="tw">${closed.has(coll) ? "▶" : "▼"}</span><span class="oi">${OI.coll}</span><span class="nm">${coll}</span>`, "coll");
    li.onclick = () => { closed.has(coll) ? closed.delete(coll) : closed.add(coll); renderOutliner(); };
    if (!closed.has(coll)) list.forEach((it) => draw(it, 2));
  }
}

// ================= timeline =================
const frameNo = () => Math.round(time * FPS) + 1;
function renderTimeline() {
  $("rangeStart").innerHTML = ""; $("rangeStart").append("Start ", field(pStart, { step: 0.3, dec: 0, min: 1, max: pEnd - 1, onCommit: (v) => { pStart = Math.round(v); renderTimeline(); } })); $("rangeEnd").innerHTML = ""; $("rangeEnd").append("End ", field(pEnd, { step: 0.3, dec: 0, min: pStart + 1, max: FRAMES, onCommit: (v) => { pEnd = Math.round(v); renderTimeline(); } }));
  if (editorType === "graph") { renderGraph(); return; } gView = null;
  const names = $("tnames"), lanes = $("tlanes");
  names.innerHTML = `<div class="rh"></div><div class="sum">Summary</div>`; lanes.innerHTML = "";
  const ruler = document.createElement("div"); ruler.className = "ruler"; lanes.appendChild(ruler);
  for (let f = 0; f <= FRAMES; f += 20) { const t = document.createElement("span"); t.className = "tick"; t.style.left = (f / FRAMES) * 100 + "%"; t.textContent = f === 0 ? 1 : f; ruler.appendChild(t); const g = document.createElement("span"); g.className = "gridln"; g.style.left = (f / FRAMES) * 100 + "%"; lanes.appendChild(g); }
  drawMarkers(ruler); rangeShade(lanes);
  const sum = document.createElement("div"); sum.className = "lane sum"; lanes.appendChild(sum);
  for (const f of new Set(items.flatMap((i) => [...i.keys, ...(i.poseKeys || [])].map((k) => Math.round(k.t * FPS))))) { const d = document.createElement("span"); d.className = "dia"; d.style.left = (f / FRAMES) * 100 + "%"; d.onclick = (e) => { e.stopPropagation(); setTime(f / FPS); }; sum.appendChild(d); }
  for (const it of items.filter((i) => i.keys.length || i.poseKeys?.length || selection.has(i))) {
    const n = document.createElement("div"); n.className = selection.has(it) ? "sel" : ""; n.innerHTML = `<span></span><small>${it.keys.length ? it.interp : ""}</small>`; n.querySelector("span").textContent = it.name; n.onclick = (e) => select(it, e.shiftKey); names.appendChild(n);
    const lane = document.createElement("div"); lane.className = "lane" + (selection.has(it) ? " sel" : ""); lanes.appendChild(lane);
    it.keys.forEach((k) => {
      const d = document.createElement("span"); d.className = "dia" + (selection.has(it) ? " on" : "") + (it.interp === "linear" ? " lin" : it.interp === "constant" ? " con" : ""); d.style.left = (k.t / DUR) * 100 + "%";
      d.title = `${it.name} · frame ${Math.round(k.t * FPS) + 1} · drag to retime`;
      d.onpointerdown = (e) => { e.stopPropagation(); dragKey(e, it, k, d); };
      lane.appendChild(d);
    });
    if (it.poseKeys?.length) {
      // A person's pose keys, on their own row under its object keys (people, 2026-09-30).
      const pn = document.createElement("div"); pn.className = selection.has(it) ? "sel" : ""; pn.innerHTML = `<span translate="no"></span><small>Pose</small>`; pn.querySelector("span").textContent = it.name; pn.onclick = (e) => select(it, e.shiftKey); names.appendChild(pn);
      const pl = document.createElement("div"); pl.className = "lane" + (selection.has(it) ? " sel" : ""); lanes.appendChild(pl);
      it.poseKeys.forEach((k) => {
        const d = document.createElement("span"); d.className = "dia" + (selection.has(it) ? " on" : "") + (it.interp === "linear" ? " lin" : it.interp === "constant" ? " con" : ""); d.style.left = (k.t / DUR) * 100 + "%"; d.style.borderRadius = "50%";
        d.title = `${it.name} · pose · frame ${Math.round(k.t * FPS) + 1} · drag to retime`;
        d.onpointerdown = (e) => { e.stopPropagation(); dragKey(e, it, k, d, "poseKeys"); };
        pl.appendChild(d);
      });
    }
  }
  const ph = document.createElement("div"); ph.className = "ph"; ph.id = "ph"; ph.innerHTML = `<b></b>`; lanes.appendChild(ph);
  lanes.onpointerdown = (e) => { if (e.target.classList.contains("dia")) return; scrub(e); };
  placePlayhead();
}
function dragKey(e, it, k, d, field = "keys") {
  const lanes = $("tlanes"), r = lanes.getBoundingClientRect(), before = clone(it[field]), sx = e.clientX; let moved = false;
  const mv = (ev) => { if (Math.abs(ev.clientX - sx) > 3) moved = true; if (!moved) return; const t = Math.round(Math.min(DUR, Math.max(0, ((ev.clientX - r.left) / r.width) * DUR)) * FPS) / FPS; k.t = t; d.style.left = (t / DUR) * 100 + "%"; info(`Frame ${Math.round(t * FPS) + 1}`); };
  const up = () => {
    window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up);
    if (!moved) { select(it); setTime(k.t); return; }
    it[field].sort((a, b) => a.t - b.t); const after = clone(it[field]);
    push({ label: "Move keyframe", undo() { it[field] = clone(before); }, redo() { it[field] = clone(after); } });
    evaluate(time); renderAll();
  };
  wOn("pointermove", mv); wOn("pointerup", up);
}
function placePlayhead() { if (editorType === "graph") { if (gView) renderGraph(); $("curFrame").innerHTML = `<b>${frameNo()}</b>`; return; } const ph = $("ph"); if (!ph) return; ph.style.left = (time / DUR) * 100 + "%"; ph.querySelector("b").textContent = frameNo(); $("curFrame").innerHTML = `<b>${frameNo()}</b>`; }
function scrub(e) { const lanes = $("tlanes"); const mv = (ev) => { const r = lanes.getBoundingClientRect(); setTime(Math.min(DUR, Math.max(0, ((ev.clientX - r.left) / r.width) * DUR))); }; mv(e); const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); renderAll(); }; wOn("pointermove", mv); wOn("pointerup", up); }
function setTime(t) { time = Math.round(t * FPS) / FPS; evaluate(time); refreshOutlines(); placePlayhead(); renderVText(); renderAstraSees(); propsSoon(); }
function jumpKey(dir) { const ts = [...new Set(items.flatMap((i) => [...i.keys, ...(i.poseKeys || [])].map((k) => k.t)))].sort((a, b) => a - b); const n = dir > 0 ? ts.find((t) => t > time + 1e-6) : [...ts].reverse().find((t) => t < time - 1e-6); if (n != null) setTime(n); }
let playing = false, last = 0;
function play(v = !playing) { playing = v; last = performance.now(); $("playIcon").innerHTML = playing ? `<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>` : `<path d="M7 4v16l13-8z"/>`; if (!playing) renderAll(); }

// ================= overlays text, gizmo, info =================
function renderVText() {
  const who = active ? active.name : "nothing selected";
  $("vtext").innerHTML = camView ? `<b>Camera Perspective</b><br>(${frameNo()}) Shot camera · ${shot.obj.userData.lensMm} mm` : `<b>User Perspective</b><br>(${frameNo()}) Scene Collection | ${esc(who)}`;
  $("frameLabel").textContent = `${format.split(" ·")[0]} · ${shot.obj.userData.lensMm} mm · ${hourText()}`;
  let verts = 0; scene.traverse((o) => { if (o.isMesh && o.visible && o.geometry?.attributes?.position && o !== ground) verts += o.geometry.attributes.position.count; });
  $("stats").textContent = `Objects ${selection.size}/${items.length} | Verts ${verts.toLocaleString("en")} | ${hourText()}`;
}
let infoT = 0; function info(m) { $("info").textContent = m; clearTimeout(infoT); infoT = setTimeout(() => ($("info").textContent = ""), 5000); }
const gz = $("gizmo");
const AX = [{ l: "X", c: "#ff3352", v: new THREE.Vector3(1, 0, 0) }, { l: "Y", c: "#8bdc00", v: new THREE.Vector3(0, 0, -1) }, { l: "Z", c: "#2890ff", v: new THREE.Vector3(0, 1, 0) }];
function drawGizmo() {
  const m = new THREE.Matrix4().extractRotation(editorCam.matrixWorldInverse), pts = [];
  for (const a of AX) for (const s of [1, -1]) { const p = a.v.clone().multiplyScalar(s).applyMatrix4(m); pts.push({ ...a, s, x: p.x * 32, y: -p.y * 32, z: p.z }); }
  pts.sort((a, b) => a.z - b.z);
  let h = `<circle r="46" fill="rgba(255,255,255,0.04)"/>`;
  for (const p of pts) if (p.s > 0) h += `<line x1="0" y1="0" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" stroke="${p.c}" stroke-width="2.5"/>`;
  for (const p of pts) h += p.s > 0 ? `<g data-ax="${p.l}${p.s}" style="cursor:pointer"><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="9" fill="${p.c}"/><text x="${p.x.toFixed(1)}" y="${(p.y + 3.8).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="#1a1b1e" font-family="Archivo, sans-serif">${p.l}</text></g>` : `<g data-ax="${p.l}${p.s}" style="cursor:pointer"><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="7.5" fill="${p.c}" fill-opacity="0.28" stroke="${p.c}" stroke-opacity="0.7"/></g>`;
  gz.innerHTML = h;
}
gz.addEventListener("click", (e) => { const g = e.target.closest("[data-ax]"); if (!g) return; const a = AX.find((x) => x.l === g.dataset.ax[0]); viewAlong(a.v.clone().multiplyScalar(+g.dataset.ax.slice(1))); });

// ================= menus, popups =================
function closeMenus() { document.querySelectorAll(".list").forEach((x) => (x.hidden = true)); document.querySelectorAll("[data-menu]").forEach((x) => x.setAttribute("aria-expanded", "false")); }
function openPopup(x, y, html) {
  const p = $("popup"); p.innerHTML = html; p.hidden = false;
  const w = p.offsetWidth, h = p.offsetHeight; p.style.left = Math.min(x, innerWidth - w - 8) + "px"; p.style.top = Math.min(y, innerHeight - h - 8) + "px";
  wireList(p);
}
function openContext(x, y) {
  const has = movable().length;
  openPopup(x, y, `<h4>${has ? esc(active?.name || "Selection") : "Scene"}</h4>
    <button data-act="key" ${has ? "" : "disabled"}><span>Insert keyframe</span><small>I</small></button>
    <button data-act="dup" ${has ? "" : "disabled"}><span>Duplicate</span><small>⇧D</small></button>
    <button data-act="parent" ${movable().length > 1 ? "" : "disabled"}><span>Parent to active</span><small>⌘P</small></button>
    <button data-act="frameSel" ${has ? "" : "disabled"}><span>Frame selected</span><small>.</small></button>
    <div class="sep"></div>
    <button data-act="astraAbout" ${has ? "" : "disabled"}><span>Ask Astra about this</span><small>N</small></button>
    <button data-act="hide" ${has ? "" : "disabled"}><span>Hide</span><small>H</small></button>
    <button data-act="del" ${has ? "" : "disabled"}><span>Delete</span><small>X</small></button>
    <div class="sep"></div><button data-act="addAt"><span>Add…</span><small>⇧A</small></button>`);
}
function wireList(root) {
  root.querySelectorAll("[data-act]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); closeMenus(); ACTS[b.dataset.act]?.(); }));
  root.querySelectorAll("[data-add]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); closeMenus(); addUI(b.dataset.add); }));
  root.querySelectorAll("[data-orient]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); closeMenus(); setOrient(b.dataset.orient); }));
  root.querySelectorAll("[data-pivot]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); closeMenus(); setPivot(b.dataset.pivot); }));
  root.querySelectorAll("[data-editor]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); closeMenus(); setEditor(b.dataset.editor); }));
  root.querySelectorAll("[data-interp]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); closeMenus(); setInterp(b.dataset.interp); }));
}
function openHistory() {
  openWin("Undo History", `<p>Everything you and Astra did, oldest first. ⌘Z steps back one line at a time.</p><ol>${undoStack.map((c) => `<li>${esc(c.label)}</li>`).join("") || "<li>Nothing yet</li>"}</ol>`);
}
function openKeys() {
  openWin("Keyboard shortcuts", `<ol style="list-style:none;padding:0">
  <li>G · R · S — move, rotate, scale  ·  W — select tool</li><li>Shift+click — add to selection  ·  A — select all  ·  Alt+A — none</li>
  <li>X — delete  ·  Shift+D — duplicate  ·  H / Alt+H — hide / show all</li><li>Ctrl+P / Alt+P — parent / clear parent</li>
  <li>I / Alt+I — insert / delete keyframe  ·  T — interpolation  ·  Space — play</li><li>0 — camera view  ·  Ctrl+Alt+0 — camera to view  ·  7 1 3 — top front right  ·  . — frame selected</li>
  <li>Shift+A — add  ·  Right-click — object menu  ·  N — sidebar (Astra)  ·  F12 — render</li><li>Tab — Edit Mode (vertices)  ·  Shift+right-click — 3D cursor  ·  Shift+S — snap menu</li><li>Alt+Z — X-ray  ·  / — local view  ·  M — move to collection (over the timeline: add a marker)  ·  ⌘J — join</li><li>F3 — search  ·  Z — shading pie  ·  Ctrl+Space — maximize  ·  ⌘Z / ⇧⌘Z — undo / redo</li></ol>`);
}

// ================= render =================
const off = document.createElement("canvas"); let offR = null;
function offRenderer(w, h) { if (!offR) { offR = new THREE.WebGLRenderer({ canvas: off, antialias: true, preserveDrawingBuffer: true }); offR.shadowMap.enabled = true; offR.shadowMap.type = THREE.PCFSoftShadowMap; offR.toneMapping = THREE.ACESFilmicToneMapping; } offR.setPixelRatio(1); offR.setSize(w, h, false); return offR; }
function outSize() { const a = FORMATS[format]; return a >= 1 ? [1280, Math.round(1280 / a)] : [Math.round(1080 * a), 1080]; }
function drawShot(r, w, h) {
  const cam = shot.obj.userData.cam; cam.aspect = w / h; cam.updateProjectionMatrix();
  const hv = helpers.visible, sv = shot.obj.visible, bg = scene.background, ov = scene.overrideMaterial;
  const hid = items.filter((i) => i.noRender && i.obj.visible); hid.forEach((i) => (i.obj.visible = false)); const skv = skyObj.visible; skyObj.visible = skyMode === "physical";
  helpers.visible = false; shot.obj.visible = false; scene.background = worldBg(); scene.overrideMaterial = null;
  r.render(scene, cam); helpers.visible = hv; shot.obj.visible = sv; scene.background = bg; scene.overrideMaterial = ov; hid.forEach((i) => (i.obj.visible = true)); skyObj.visible = skv;
}
function openWin(title, html) { $("dlgTitle").textContent = title; $("dlgBody").innerHTML = html; $("dlg").hidden = false; }
$("dlgClose").onclick = () => { $("dlg").hidden = true; recording = false; ptBusy = false; };
function renderStill() { const [w, h] = outSize(); const r = offRenderer(w, h); drawShot(r, w, h); const url = off.toDataURL("image/jpeg", 0.92); openWin("Helios Render · still", `<img alt="Render of the shot camera" src="${url}"><div class="row-btns"><a class="pbtn accent" style="display:grid;place-items:center;text-decoration:none" download="helios-frame-${frameNo()}.jpg" href="${url}">Save image</a></div><p>Frame ${frameNo()} through the shot camera, ${shot.obj.userData.lensMm} mm, ${format}.</p><p>In Picacho this frame, with its depth and every object's place, goes to the image engine with your character's photos and your models. The engine paints the final photo onto this exact layout.</p>`); }
// ================= photo with your character (stage 3, 2026-09-29) =================
// The shot camera's frame, drawn at the photo format's render size with the
// strips outside the band painted dark (as the set page's sketch is), goes
// through the set page's own Shoot with the chosen character: one press, one
// charge, followed by its id if the answer is lost (studio-press.ts). What is
// sent is worked out in studio-shot.ts; the window keeps its state while it
// is closed, so a press in flight is never pressed again by reopening it.
const CAST_TITLE = "Photo with your character";
const RIG_NAMES = { square: "square", scope: "Scope 2.39:1", flat: "Flat 1.85:1", wide: "Wide 16:9", classic: "Classic 4:3", vertical: "Vertical 9:16" };
const credits = (n) => `${n} credit${n === 1 ? "" : "s"}`;
const castLabel = () => `${CAST_TITLE} · ${credits(opts.render.credits)}`;
const cast = { busy: false, t0: 0, phase: "sent", result: null, frame: null, charId: null, words: "", timer: 0, traced: false, trace: null, sent: null };
/** The frame and what is sent with it, measured from the scene as it stands now. */
function castFrame() {
  const cam = shot.obj.userData.cam;
  shot.obj.updateMatrixWorld(true); person.obj.updateMatrixWorld(true);
  const p = shot.obj.getWorldPosition(new THREE.Vector3());
  // The lens looks along the group's +Z (makeShotCamera).
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(shot.obj.getWorldQuaternion(new THREE.Quaternion()));
  const fp = person.obj.getWorldPosition(new THREE.Vector3());
  const fd = new THREE.Vector3(0, 0, 1).applyQuaternion(person.obj.getWorldQuaternion(new THREE.Quaternion()));
  const moved = [];
  for (const it of items) {
    if (!it.saveKey || !it.saveKey.startsWith("el:")) continue;
    const el = els.find((e) => "el:" + e.key === it.saveKey); if (!el) continue;
    const wp = it.obj.getWorldPosition(new THREE.Vector3());
    const turn = THREE.MathUtils.radToDeg(new THREE.Euler().setFromQuaternion(it.obj.getWorldQuaternion(new THREE.Quaternion()), "YXZ").y);
    const d = Math.hypot(wp.x - el.centre[0], wp.z - el.centre[2]);
    if (d > 0.05 || Math.abs(turn) > 0.5) moved.push({ key: el.key, x: wp.x, z: wp.z, turnDeg: turn, d });
  }
  moved.sort((a, b) => b.d - a.d);
  // The pose (people, 2026-09-30): the set's nearest stand pose rides the layout; its words fill "What happens".
  const pw = personWords(person);
  const input = studioShotInput({
    format,
    camera: { position: [p.x, p.y, p.z], forward: [fwd.x, fwd.y, fwd.z], fovDeg: cam.fov, focusM: shot.obj.userData.focus },
    figure: { x: fp.x, z: fp.z, facingDeg: THREE.MathUtils.radToDeg(Math.atan2(fd.x, fd.z)), pose: pw ? pw.stand : "stand" },
    markId: SPEC.marks?.[0]?.id ?? null,
    moved: moved.map(({ key, x, z, turnDeg }) => ({ key, x, z, turnDeg })),
  });
  const fr = input.frame, f0 = cam.fov;
  cam.fov = input.renderFovDeg;
  try { drawShot(offRenderer(fr.renderW, fr.renderH), fr.renderW, fr.renderH); } finally { cam.fov = f0; cam.updateProjectionMatrix(); }
  const out = document.createElement("canvas"); out.width = fr.renderW; out.height = fr.renderH;
  const ctx = out.getContext("2d"); ctx.drawImage(off, 0, 0);
  ctx.fillStyle = "#0a0a0a"; for (const b of letterbox(fr)) ctx.fillRect(b.x, b.y, b.w, b.h);
  return { dataUri: out.toDataURL("image/jpeg", 0.9), input, lens: shot.obj.userData.lensMm, studioFormat: format, poseWords: pw && pw.words !== "standing" ? pw.sentence : "" };
}
/** "What happens" starts as the pose's words; once changed by hand it stays as written. */
function prefillCast() { const w = cast.frame?.poseWords || ""; if (!cast.words || cast.words === cast.autoWords) cast.words = w; cast.autoWords = w; }
function castChar() { return (opts.render?.characters || []).find((c) => c.id === cast.charId) || null; }
function openCast() {
  const R = opts.render;
  if (!R) return openWin(CAST_TITLE, `<p>Rendering with your character works inside Picacho, on your set.</p>`);
  if (!cast.busy && !cast.result) {
    if (!R.characters.length) return openWin(CAST_TITLE, `<p>You don't have a character with a photo yet. Make one, then come back — the Studio keeps your scene.</p><div class="cast-links"><a href="/app/character/new">Make a character</a></div>`);
    if (!person.obj.visible || person.noRender) return openWin(CAST_TITLE, `<p>The stand-in is hidden, so the photo has nowhere to put your character. Show the Stand-in (H / the eye in the outliner) and try again.</p>`);
    try { cast.frame = castFrame(); } catch (e) { return openWin(CAST_TITLE, `<p>This browser couldn't draw the frame, so nothing was sent. Try again after a reload.</p>`); }
    prefillCast();
    if (!cast.charId || !castChar()) cast.charId = R.characters[0].id;
  }
  showCast();
}
/** The window, drawn from the press's state: pick, sending, or its answer. */
function showCast() {
  const R = opts.render, f = cast.frame; if (!R || !f) return;
  const fmt = f.input.rig.format;
  const shape = `${f.lens} mm, shot as ${RIG_NAMES[fmt] || fmt}${f.studioFormat === "4:5 · Portrait" ? " (4:5 has no photo format yet)" : ""}`;
  let body = "";
  if (cast.result && cast.result.error === null && cast.result.succeeded && cast.result.resultUrl) {
    body = `<img class="cast-img" alt="Your photo" src="${esc(cast.result.resultUrl)}"><p class="hint">Your photo, from this frame · ${esc(shape)}.</p><div class="cast-links"><a href="${esc(R.historyHref(cast.result.generationId))}">Open in History</a><a href="${esc(R.setHref)}">Open the set</a></div><div class="row-btns"><button class="pbtn" id="castAgain">Make another</button></div>`;
  } else if (cast.result) {
    const r = cast.result;
    const why = r.error === null ? (r.failure ? `It didn't come out: ${r.failure}` : "It didn't come out.") : r.error || R.unreachable;
    const link = r.error === null && r.generationId ? `<a href="${esc(R.historyHref(r.generationId))}">Open in History</a>` : "";
    body = `<img class="cast-img" alt="The frame that was sent" src="${cast.sent || f.dataUri}"><p class="cast-note" role="alert">${esc(why)}</p><div class="cast-links">${link}<a href="${esc(R.setHref)}">Open the set</a></div><div class="row-btns"><button class="pbtn" id="castAgain">Back</button></div>`;
  } else {
    const opts2 = R.characters.map((c) => `<option value="${esc(c.id)}"${c.id === cast.charId ? " selected" : ""}>${esc(c.name || "Your character")}</option>`).join("");
    body = `<img class="cast-img" id="castPrev" alt="The frame that goes to the image engine" src="${f.dataUri}"><p class="hint">Through the shot camera · ${esc(shape)}. The stand-in marks where your character stands; the image engine paints the photo onto this layout.</p>
<div class="fr" style="margin-top:8px"><label for="castWho">Character</label><select class="sel2" id="castWho"${cast.busy ? " disabled" : ""}>${opts2}</select></div>
<div class="fr" style="margin-top:6px;align-items:start"><label for="castWords">What happens</label><textarea class="cast-words" id="castWords" maxlength="${SET_DIRECTION_MAX_CHARS}" placeholder="Optional: what they're doing, the mood"${cast.busy ? " disabled" : ""}>${esc(cast.words)}</textarea></div>${cast.autoWords && cast.words === cast.autoWords && !cast.busy ? `<p class="hint" id="castPoseHint" style="margin:2px 0 0">Filled in from the stand-in's pose, in English for the image engine. Change it freely.</p>` : ""}
<div class="fr" style="margin-top:6px"><label></label><label class="check"><input type="checkbox" id="castTrace"${cast.traced ? " checked" : ""}${cast.busy ? " disabled" : ""}> <span>${esc(castTraceLabel(f))}</span></label></div>
<p class="cast-note" id="castNote" hidden></p>
<div class="row-btns"><button class="pbtn accent" id="castGo"${cast.busy ? " disabled" : ""}>${esc(castLabel())}</button>${cast.busy && (cast.phase === "tracing" || cast.phase === "cleaning") ? `<button class="pbtn" id="castStop">Stop</button>` : ""}</div>
<div class="prog"${cast.busy ? "" : " hidden"}><i id="castProg"></i></div><p class="hint" id="castTxt" role="status"></p>`;
  }
  const open = $("dlgBody") && $("dlgBody").querySelector("[data-cast]");
  if (!open || $("dlg").hidden) openWin(CAST_TITLE, `<div data-cast></div>`);
  const box = $("dlgBody").querySelector("[data-cast]"); box.innerHTML = body;
  const who = $("castWho"), words = $("castWords"), go = $("castGo"), again = $("castAgain"), tr = $("castTrace"), stop = $("castStop");
  if (tr) tr.onchange = () => { cast.traced = tr.checked; };
  if (stop) stop.onclick = () => { ptBusy = false; stop.disabled = true; };
  if (who) who.onchange = () => { cast.charId = who.value; castCheck(); };
  if (words) words.oninput = () => { cast.words = words.value; };
  if (go) go.onclick = castGo;
  if (again) again.onclick = () => { const ok = cast.result && cast.result.error === null && cast.result.succeeded; cast.result = null; if (ok) { try { cast.frame = castFrame(); prefillCast(); } catch {} } showCast(); };
  castCheck(); castTick();
}
/** Says why the press can't go yet: this character's photos need an answer first (on the set page, as the Shoot asks). */
function castCheck() {
  const note = $("castNote"), go = $("castGo"); if (!note || !go) return;
  const c = castChar();
  const block = c && c.likenessNeeded;
  note.hidden = !block;
  note.innerHTML = block ? `Say who is in ${esc(c.name || "this character")}'s photos first — on the set page, on the figure's card. <a href="${esc(opts.render.setHref)}">Open the set</a>` : "";
  go.disabled = cast.busy || !c || !!block;
}
function castTick() {
  const bar = $("castProg"), txt = $("castTxt"); if (!bar || !txt || !cast.busy) return;
  const s = Math.round((Date.now() - cast.t0) / 1000);
  bar.style.width = Math.min(95, (s / 90) * 100) + "%";
  if (cast.phase === "tracing" || cast.phase === "cleaning") { bar.style.width = (cast.trace ? Math.min(100, (cast.trace[0] / cast.trace[1]) * 100) : 0) + "%"; txt.textContent = cast.phase === "cleaning" ? "Cleaning the grain…" : cast.trace && cast.trace[0] > 0 ? `Tracing a clean frame · sample ${cast.trace[0]} of ${cast.trace[1]} · ${s} s. Stop sends nothing.` : `Starting the graphics card · ${s} s`; return; }
  txt.textContent = cast.phase === "checking" ? `The answer didn't arrive, so we're checking whether it went through · ${s} s. Don't press again.` : cast.phase === "rendering" ? `Still rendering — following your press · ${s} s. Don't press again.` : `Rendering your photo · ${s} s. It usually takes under a minute or two.`;
}
/** "Use a clean traced frame": its label with the time it takes here, once this device has been timed. */
function castTraceLabel(f) {
  const fr = f.input.frame, sec = traceEstimate(ptSpeed(), TRACE_PRESETS.still.draft, fr.renderW, fr.renderH, 1, 2);
  return sec == null ? "Use a clean traced frame (better light; the first one also times this device)" : `Use a clean traced frame (better light, takes about ${traceDuration(sec)})`;
}
/** The shot camera's frame at the send size, path-traced at Draft and denoised; null when Stop was pressed. */
async function castTrace(f) {
  const fr = f.input.frame, cam = shot.obj.userData.cam, f0 = cam.fov, dn = ptSet.denoise, n = TRACE_PRESETS.still.draft;
  cam.fov = f.input.renderFovDeg; ptSet.denoise = true; ptBusy = true;
  try {
    const res = await ptTrace(fr.renderW, fr.renderH, n, { meter: true, cleanStopped: false, onSample: (x) => { cast.trace = [Math.floor(x), n]; castTick(); }, onClean: () => { cast.phase = "cleaning"; castTick(); } });
    if (!ptBusy || res.samples < n) return null;
  } finally { ptBusy = false; ptSet.denoise = dn; cam.fov = f0; cam.updateProjectionMatrix(); }
  const out = document.createElement("canvas"); out.width = fr.renderW; out.height = fr.renderH;
  const ctx = out.getContext("2d"); ctx.drawImage(ptSnap, 0, 0, fr.renderW, fr.renderH);
  ctx.fillStyle = "#0a0a0a"; for (const b of letterbox(fr)) ctx.fillRect(b.x, b.y, b.w, b.h);
  return out.toDataURL("image/jpeg", 0.9);
}
async function castGo() {
  const R = opts.render, f = cast.frame, c = castChar();
  if (!R || !f || !c || c.likenessNeeded || cast.busy) return;
  if (cast.traced && ptBusy) return toast("A path-traced render is already running");
  // One press id, taken before any trace: the traced frame and its send are one press, never charged twice.
  const pressId = newPressId();
  cast.busy = true; cast.t0 = Date.now(); cast.phase = cast.traced ? "tracing" : "sent"; cast.result = null; cast.sent = null; cast.trace = null;
  clearInterval(cast.timer); cast.timer = setInterval(castTick, 1000);
  showCast();
  let traced = null;
  if (cast.traced) {
    try { traced = await castTrace(f); } catch { traced = undefined; }
    if (stopped) return;
    if (!traced) {
      // Stopped, or this device couldn't trace: nothing was sent, nothing was charged.
      clearInterval(cast.timer); cast.busy = false;
      if (traced === undefined) cast.result = { error: "This device couldn't trace the frame, so nothing was sent." };
      showCast(); const tx = $("castTxt"); if (tx && traced === null) tx.textContent = "Stopped before sending: nothing was sent and nothing was charged.";
      return;
    }
    cast.sent = traced; cast.phase = "sent"; cast.t0 = Date.now(); showCast();
    const pv = $("castPrev"); if (pv) pv.src = traced;
  }
  const input = studioCastInput({ viewFrameUri: f.dataUri, tracedFrameUri: traced, characterId: c.id, words: cast.words, maxChars: SET_DIRECTION_MAX_CHARS, frame: f.input, pressId });
  let res;
  try { res = await R.shoot(input, (ph) => { cast.phase = ph; castTick(); }); } catch { res = { error: R.unreachable }; }
  clearInterval(cast.timer); cast.busy = false;
  if (stopped) return;
  // "left": the Studio closed while following; nothing to say.
  cast.result = res && (res.error !== "" || res.generationId) ? res : { error: R.unreachable };
  if (!$("dlg").hidden && $("dlgBody").querySelector("[data-cast]")) showCast();
  else toast(cast.result.error === null && cast.result.succeeded ? "Your photo is ready · Render ▸ " + CAST_TITLE : "Your photo didn't come out · Render ▸ " + CAST_TITLE);
}
let recording = false;
async function renderVideo() {
  if (!("MediaRecorder" in window) || !off.captureStream) return openWin("Helios Render", "<p>This browser can't record video. Chrome, Edge and Firefox can.</p>");
  const [w, h] = outSize(); const r = offRenderer(w, h); const stream = off.captureStream(FPS);
  const type = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
  const rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 8e6 } : undefined); const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  openWin("Helios Render · animation", `<p>Rendering frames 1–${FRAMES} through the shot camera.</p><div class="prog"><i id="prog"></i></div><p id="progTxt" style="font-family:var(--mono)"></p>`);
  const was = time; play(false); recording = true; rec.start();
  for (let f = 0; f <= FRAMES && recording; f++) { evaluate(f / FPS); drawShot(r, w, h); const pr = $("prog"); if (pr) pr.style.width = (f / FRAMES) * 100 + "%"; const pt = $("progTxt"); if (pt) pt.textContent = `Frame ${f + 1} / ${FRAMES + 1}`; await new Promise((res) => setTimeout(res, 1000 / FPS)); }
  rec.stop(); await new Promise((res) => (rec.onstop = res)); setTime(was); if (!recording) return; recording = false;
  const url = URL.createObjectURL(new Blob(chunks, { type: type || "video/webm" }));
  openWin("Helios Render · animation", `<video src="${url}" controls autoplay loop muted playsinline></video><p>In Picacho this clip guides the video engine: it follows this exact motion and camera move, with your character and your car in place of the stand-ins.</p>`);
}

// ================= physics (rigid bodies) =================
// Blender-style: each object can be an Active (falls, collides) or Passive (solid, follows its keyframes) rigid body.
// Simulate fills a cache the timeline plays; Bake writes the cache as ordinary keyframes; Clear bake puts the old keys back.
const PHYS_DEF = { type: "none", mass: 1, friction: 0.5, bounce: 0.2, shape: "auto" };
const physOf = (it) => ({ ...PHYS_DEF, ...(it.phys || {}) });
function setPhys(it, next) { propCmd("Rigid body", () => (it.phys ? { ...it.phys } : undefined), (v) => { it.phys = v; }, next); }
function localBounds(obj) {
  const q = obj.quaternion.clone(), p = obj.position.clone();
  obj.quaternion.identity(); obj.position.set(0, 0, 0); obj.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(obj, true);
  obj.quaternion.copy(q); obj.position.copy(p); obj.updateMatrixWorld(true);
  return b;
}
function physShape(it, ph) {
  const b = localBounds(it.obj); if (b.isEmpty()) return null;
  const size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
  const round = ph.shape === "sphere" || (ph.shape === "auto" && ["sphere", "ico"].includes(it.addKind));
  const shape = round ? new CANNON.Sphere(Math.max(0.01, Math.max(size.x, size.y, size.z) / 2)) : new CANNON.Box(new CANNON.Vec3(Math.max(0.01, size.x / 2), Math.max(0.01, size.y / 2), Math.max(0.01, size.z / 2)));
  return [shape, new CANNON.Vec3(c.x, c.y, c.z)];
}
const physItems = () => items.filter((i) => i.phys && i.phys.type !== "none" && i.kind !== "sun" && i.kind !== "camera" && !i.hidden);
function simulatePhys(from = time, quiet = false) {
  physCache = null;
  const start = Math.round(from * FPS);
  if (start >= FRAMES) { toast("Go back to an earlier frame: the simulation runs from the current frame to the end"); return false; }
  const list = physItems(), act = list.filter((i) => i.phys.type === "active");
  if (!act.length) { if (!quiet) { toast("Nothing to simulate: make an object an Active rigid body in the Physics tab"); } return false; }
  const nested = list.filter((i) => i.obj.parent !== scene);
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world); world.allowSleep = true;
  const floor = new CANNON.Body({ mass: 0, material: new CANNON.Material({ friction: 1, restitution: 1 }) });
  floor.addShape(new CANNON.Plane()); floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0); world.addBody(floor);
  evaluate(start / FPS);
  const bodies = [];
  for (const it of list) {
    if (it.obj.parent !== scene) continue;
    const ph = physOf(it), sh = physShape(it, ph); if (!sh) continue;
    const body = new CANNON.Body({ mass: ph.type === "active" ? Math.max(0.01, ph.mass) : 0, type: ph.type === "active" ? CANNON.Body.DYNAMIC : CANNON.Body.KINEMATIC, material: new CANNON.Material({ friction: Math.max(0, ph.friction), restitution: Math.min(1, Math.max(0, ph.bounce)) }) });
    body.addShape(sh[0], sh[1]); body.position.copy(it.obj.position); body.quaternion.copy(it.obj.quaternion);
    body.sleepSpeedLimit = 0.05; world.addBody(body); bodies.push([it, body, []]);
  }
  const rec = (it, body, out) => out.push({ p: [body.position.x, body.position.y, body.position.z], q: [body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w] });
  for (const [it, body, out] of bodies) if (it.phys.type === "active") rec(it, body, out);
  const SUB = 4, dt = 1 / (FPS * SUB);
  for (let f = start + 1; f <= FRAMES; f++) {
    evaluate(f / FPS);
    for (const [it, body] of bodies) if (it.phys.type !== "active") { body.velocity.set((it.obj.position.x - body.position.x) * FPS, (it.obj.position.y - body.position.y) * FPS, (it.obj.position.z - body.position.z) * FPS); body.quaternion.copy(it.obj.quaternion); }
    for (let s = 0; s < SUB; s++) world.step(dt);
    for (const [it, body, out] of bodies) { if (it.phys.type === "active") rec(it, body, out); else body.position.copy(it.obj.position); }
  }
  physCache = { start, end: FRAMES, frames: new Map(bodies.filter(([it]) => it.phys.type === "active").map(([it, , out]) => [it, out])) };
  evaluate(time); refreshOutlines(); renderAll();
  if (!quiet) info(`Simulated ${physCache.frames.size} active bod${physCache.frames.size === 1 ? "y" : "ies"}, frames ${start + 1}–${FRAMES + 1} · press play or scrub to watch · Bake keeps it`);
  if (nested.length) toast(`${nested.length} parented object${nested.length > 1 ? "s were" : " was"} left out: clear the parent (Alt+P) to simulate ${nested.length > 1 ? "them" : "it"}`);
  return true;
}
function applyPhys(t) {
  const f = Math.round(t * FPS);
  for (const [it, arr] of physCache.frames) {
    if (!items.includes(it) || !arr.length) continue;
    if (f < physCache.start && it.keys.length) continue;
    const fr = arr[Math.min(arr.length - 1, Math.max(0, f - physCache.start))];
    it.obj.position.fromArray(fr.p); it.obj.quaternion.fromArray(fr.q);
  }
}
function bakePhys() {
  if (!physCache && !simulatePhys(time, true)) return toast("Nothing to bake: make an object an Active rigid body in the Physics tab");
  const { start, frames } = physCache; let n = 0;
  group("Bake physics", () => {
    for (const [it, arr] of frames) {
      if (!items.includes(it)) continue;
      const b = { keys: clone(it.keys), interp: it.interp, bake: it.bake };
      const keys = it.keys.filter((k) => k.t < start / FPS - 1e-6), s = it.obj.scale.toArray(), e = new THREE.Euler(), q = new THREE.Quaternion();
      let prev = null;
      arr.forEach((fr, i) => {
        e.setFromQuaternion(q.fromArray(fr.q)); const r = [e.x, e.y, e.z];
        if (prev) for (let k = 0; k < 3; k++) { while (r[k] - prev[k] > Math.PI) r[k] -= 2 * Math.PI; while (r[k] - prev[k] < -Math.PI) r[k] += 2 * Math.PI; }
        prev = r; keys.push({ t: (start + i) / FPS, p: fr.p, r, s });
      });
      const a = { keys, interp: "linear", bake: { start, end: FRAMES, prev: it.bake ? it.bake.prev : b.keys, prevInterp: it.bake ? it.bake.prevInterp : b.interp } };
      const put = (v) => { it.keys = clone(v.keys); it.interp = v.interp; it.bake = v.bake ? clone(v.bake) : undefined; };
      put(a); push({ label: "bake", undo() { put(b); }, redo() { put(a); } }); n++;
    }
  });
  physCache = null; evaluate(time); refreshSel();
  info(`Baked ${n} object${n === 1 ? "" : "s"} to keyframes · one ⌘Z takes it back`);
}
function clearBake() {
  const list = items.filter((i) => i.bake); if (!list.length) return toast("Nothing is baked");
  group("Clear bake", () => list.forEach((it) => {
    const b = { keys: clone(it.keys), interp: it.interp, bake: clone(it.bake) }, a = { keys: clone(it.bake.prev || []), interp: it.bake.prevInterp || "bezier", bake: undefined };
    const put = (v) => { it.keys = clone(v.keys); it.interp = v.interp; it.bake = v.bake ? clone(v.bake) : undefined; };
    put(a); push({ label: "clear bake", undo() { put(b); }, redo() { put(a); } });
  }));
  evaluate(time); refreshSel(); info(`Bake cleared on ${list.length} object${list.length === 1 ? "" : "s"}: their own keyframes are back`);
}
function renderPhysics(p, it) {
  const [sp, sb] = panel("Simulation");
  const baked = items.filter((i) => i.bake).length, bodies = physItems();
  sb.appendChild(fr("Rigid bodies", ro(`${bodies.filter((i) => i.phys.type === "active").length} active · ${bodies.filter((i) => i.phys.type === "passive").length} passive`)));
  sb.appendChild(fr("Cache", ro(physCache ? `frames ${physCache.start + 1}–${physCache.end + 1}` : "empty")));
  sb.appendChild(fr("Gravity", ro("−9.81 m/s² · ground at 0")));
  const r = document.createElement("div"); r.className = "row-btns";
  r.innerHTML = `<button class="pbtn" id="phSim">Simulate from frame ${frameNo()}</button><button class="pbtn accent" id="phBake">Bake to keyframes</button>`;
  const r2 = document.createElement("div"); r2.className = "row-btns"; r2.innerHTML = `<button class="pbtn" id="phClear" ${baked ? "" : "disabled"}>Clear bake${baked ? ` (${baked})` : ""}</button><button class="pbtn" id="phFree" ${physCache ? "" : "disabled"}>Free cache</button>`;
  sb.append(r, r2); p.appendChild(sp);
  r.querySelector("#phSim").onclick = () => simulatePhys(); r.querySelector("#phBake").onclick = bakePhys;
  r2.querySelector("#phClear").onclick = clearBake; r2.querySelector("#phFree").onclick = () => { physCache = null; evaluate(time); refreshSel(); };
  if (!it || it.kind === "camera") { p.insertAdjacentHTML("beforeend", `<p class="hint">Select an object to make it a rigid body. Active bodies fall and collide; passive ones stay solid and follow their own keyframes. The ground is always solid.</p>`); return; }
  const ph = physOf(it);
  const [bp, bb] = panel("Rigid Body");
  const sel = (id, label, opts, v, on) => { const s = document.createElement("select"); s.className = "sel2"; s.id = id; s.setAttribute("aria-label", label); opts.forEach(([k, n]) => s.add(new Option(n, k, false, k === v))); s.onchange = () => on(s.value); bb.appendChild(fr(label, s)); };
  sel("phType", "Type", [["none", "None"], ["active", "Active"], ["passive", "Passive"]], ph.type, (v) => { setPhys(it, { ...ph, type: v }); renderProps(); });
  if (ph.type !== "none") {
    sel("phShape", "Shape", [["auto", "Auto (from its bounds)"], ["box", "Box"], ["sphere", "Sphere"]], ph.shape, (v) => { setPhys(it, { ...ph, shape: v }); renderProps(); });
    const num = (label, key, o) => bb.appendChild(fr(label, field(ph[key], { ...o, onCommit: (v) => { setPhys(it, { ...physOf(it), [key]: v }); renderProps(); } })));
    if (ph.type === "active") num("Mass", "mass", { step: 0.1, unit: " kg", dec: 2, min: 0.01, max: 100000 });
    num("Friction", "friction", { step: 0.05, dec: 2, min: 0, max: 2 });
    num("Bounciness", "bounce", { step: 0.05, dec: 2, min: 0, max: 1 });
  }
  if (it.obj.parent !== scene) bb.insertAdjacentHTML("beforeend", `<p class="hint">This object has a parent, so the simulation leaves it out. Clear the parent (Alt+P) first.</p>`);
  if (it.bake) bb.insertAdjacentHTML("beforeend", `<p class="hint">Baked: frames ${it.bake.start + 1}–${it.bake.end + 1} are keyframes now. Clear bake brings back its own.</p>`);
  p.appendChild(bp);
  p.insertAdjacentHTML("beforeend", `<p class="hint">Simulate plays the fall on the timeline. Bake turns it into ordinary keyframes, so renders, the Graph Editor and saving all keep it.</p>`);
}

// ================= export (GLB / OBJ / STL) + print check =================
// Real size: one Helios unit is one metre. STL can be written in millimetres, the unit printers' slicers assume.
let expScope = "scene", stlUnit = "mm";
const exportable = (it) => it.kind === "mesh" && !it.hidden;
function exportTargets(scope = expScope) { const sel = [...selection].filter(exportable); return scope === "selection" && sel.length ? sel : items.filter(exportable); }
function exportGroup(list, scale = 1) {
  const g = new THREE.Group(); scene.updateMatrixWorld(true);
  for (const it of list) {
    const c = it.obj.clone(true); it.obj.matrixWorld.decompose(c.position, c.quaternion, c.scale); c.name = it.name;
    const drop = []; c.traverse((o) => { if (o !== c && (o.isLight || o.isCamera || o.isLine || o.isPoints || o.isSprite || o.type === "AxesHelper")) drop.push(o); });
    drop.forEach((o) => o.parent?.remove(o)); g.add(c);
  }
  g.scale.setScalar(scale); g.updateMatrixWorld(true); return g;
}
function printCheck(list) {
  const g = exportGroup(list), v = new THREE.Vector3(), key = (x) => Math.round(x * 1e4);
  const ids = new Map(), edges = new Map(); let tris = 0, vid = 0;
  const idOf = () => { const k = key(v.x) + "," + key(v.y) + "," + key(v.z); let i = ids.get(k); if (i == null) { i = vid++; ids.set(k, i); } return i; };
  const parent = []; const find = (a) => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
  g.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const pos = o.geometry.attributes.position, idx = o.geometry.index, n = idx ? idx.count : pos.count;
    for (let i = 0; i + 2 < n; i += 3) {
      const t = [0, 1, 2].map((j) => { v.fromBufferAttribute(pos, idx ? idx.getX(i + j) : i + j).applyMatrix4(o.matrixWorld); return idOf(); });
      if (t[0] === t[1] || t[1] === t[2] || t[0] === t[2]) continue; tris++;
      for (const a of t) if (parent[a] == null) parent[a] = a;
      for (let j = 0; j < 3; j++) { const a = t[j], b = t[(j + 1) % 3], k = a < b ? a + ":" + b : b + ":" + a; edges.set(k, (edges.get(k) || 0) + 1); const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }
    }
  });
  let open = 0, over = 0; for (const c of edges.values()) { if (c === 1) open++; else if (c > 2) over++; }
  const roots = new Set(); for (let i = 0; i < parent.length; i++) if (parent[i] != null) roots.add(find(i));
  const size = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3()).multiplyScalar(1000);
  return { tris, open, over, parts: roots.size, size, closed: tris > 0 && open === 0 && over === 0 };
}
function printVerdict(c, list) {
  const setBlocks = list.some((i) => i.saveKey === "place" || (i.saveKey || "").startsWith("el:") || i.saveKey === "person" || ["car", "person", "lamp"].includes(i.addKind));
  if (!c.tris) return `<p class="hint">Nothing to check: there's no mesh in what you're exporting.</p>`;
  if (c.closed && c.parts === 1) return `<p><b style="color:#7bc47f">Ready to print.</b> One sealed solid: every edge joins exactly two faces.</p>`;
  if (c.closed) return `<p><b style="color:#e0b050">Sealed, but in ${c.parts} separate pieces.</b> Each piece is closed, so a printer can make them, but as loose or overlapping parts, not one object. Join them into one solid in a 3D tool (a boolean union) for a single print.</p>`;
  return `<p><b style="color:#e06a5a">Won't print well as it is.</b> ${c.open ? `${c.open.toLocaleString()} open edge${c.open === 1 ? "" : "s"}` : ""}${c.open && c.over ? " and " : ""}${c.over ? `${c.over.toLocaleString()} edge${c.over === 1 ? "" : "s"} shared by more than two faces` : ""}: a printer needs one closed skin, and a slicer may fill these gaps badly or skip them.</p>${setBlocks ? `<p class="hint">The set's models are built from separate blocks and panels for the camera, not one sealed solid. Imported .glb models and models built from a photo are the good ones to print.</p>` : ""}`;
}
function download(data, name, type) {
  const url = URL.createObjectURL(new Blob([data], { type })); const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
const fileBase = () => (opts.title || "helios").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "helios";
async function exportAs(fmt) {
  const list = exportTargets(); if (!list.length) return toast("Nothing to export: there's no visible mesh");
  const base = fileBase() + (expScope === "selection" && [...selection].some(exportable) ? "-" + list.map((i) => i.name).join("-").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) : "");
  try {
    if (fmt === "glb") { const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js"); const out = await new GLTFExporter().parseAsync(exportGroup(list), { binary: true }); download(out, base + ".glb", "model/gltf-binary"); }
    else if (fmt === "obj") { const { OBJExporter } = await import("three/examples/jsm/exporters/OBJExporter.js"); download(new OBJExporter().parse(exportGroup(list)), base + ".obj", "text/plain"); }
    else { const { STLExporter } = await import("three/examples/jsm/exporters/STLExporter.js"); download(new STLExporter().parse(exportGroup(list, stlUnit === "mm" ? 1000 : 1), { binary: true }), `${base}-${stlUnit}.stl`, "model/stl"); }
    info(`Exported ${list.length} object${list.length === 1 ? "" : "s"} as ${fmt.toUpperCase()}`);
  } catch (e) { toast("Export failed: " + (e?.message || e)); }
}
function openExport() {
  const hasSel = [...selection].some(exportable); if (!hasSel) expScope = "scene";
  const list = exportTargets(), c = printCheck(list), mm = (x) => (x >= 100 ? x.toFixed(0) : x.toFixed(1));
  openWin("Export", `
    <div class="row-btns"><label class="check"><input type="radio" name="expScope" value="selection" ${expScope === "selection" ? "checked" : ""} ${hasSel ? "" : "disabled"}> Selection${hasSel ? ` (${[...selection].filter(exportable).length})` : ""}</label><label class="check"><input type="radio" name="expScope" value="scene" ${expScope === "scene" ? "checked" : ""}> Whole scene</label></div>
    <div class="row-btns"><button class="pbtn accent" id="exGlb">GLB</button><button class="pbtn" id="exObj">OBJ</button><button class="pbtn" id="exStl">STL</button></div>
    <div class="fr"><label>STL units</label><select class="sel2" id="exUnit" aria-label="STL units"><option value="mm" ${stlUnit === "mm" ? "selected" : ""}>Millimetres (3D printers)</option><option value="m" ${stlUnit === "m" ? "selected" : ""}>Metres</option></select></div>
    <p class="hint">GLB keeps colours and materials (Blender, Unity, Unreal, the web). OBJ is shape only, for any 3D tool. STL is shape only, for 3D printing. Everything is at real size, as it stands on the current frame.</p>
    <h4 style="margin:14px 0 6px">Print check</h4>
    <p style="font-family:var(--mono)">${list.length} object${list.length === 1 ? "" : "s"} · ${mm(c.size.x)} × ${mm(c.size.z)} × ${mm(c.size.y)} mm (W × D × H) · ${c.tris.toLocaleString()} triangles</p>
    ${printVerdict(c, list)}`);
  document.querySelectorAll('input[name="expScope"]').forEach((r) => (r.onchange = () => { expScope = r.value; openExport(); }));
  $("exUnit").onchange = (e) => (stlUnit = e.target.value);
  $("exGlb").onclick = () => exportAs("glb"); $("exObj").onclick = () => exportAs("obj"); $("exStl").onclick = () => exportAs("stl");
}

// ================= path-traced renders, made to look like Blender Cycles (2026-09-29) =================
// The operator: "something of our own without paying a monthly fee" → "Lets go with A. Build it better."
// The same scene, models and materials as the viewport, traced on this device's own graphics card
// (three-gpu-pathtracer, MIT), then cleaned by Open Image Denoise (Intel's network, Apache-2.0 weights in
// public/studio/oidn, run by oidn-web on WebGPU, MIT) — nothing leaves the device, nothing is paid for.
// Light like Cycles: the World (simple colour, physical sky or studio room) is baked into one HDR dome the
// tracer importance-samples, with the sun as a 0.526° disc (Blender's default) carrying the viewport sun's
// strength, so shadows are soft at the edge and the sky fills them; lamps get Blender's 0.1 m radius.
// Materials: each set thing's material word (glass, fabric, grass…) adds its physical layers (glass that lets light
// through, cloth sheen, softer highlights) on top of the colour, roughness and metal the viewport shows. The shot camera's
// f-stop and focus distance give the depth of field; AgX (Blender's view transform) or ACES, with exposure.
// ptSnap: a 2D copy of each finished trace, taken in the same task it was drawn (a WebGL canvas reads back empty later on)
const ptCanvas = document.createElement("canvas"), ptSnap = document.createElement("canvas");
let ptR = null, pt = null, ptCam = null, ptQuad = null, ptShow = null, ptFilter = null, ptAovT = null, ptNormalMat = null, ptBusy = false;
let ptWorldKey = "", ptWorldTex = null, ptAuto = 1;
const ptSet = { still: { q: "final", custom: 128 }, animation: { q: "draft", custom: 12 }, scale: { still: 1, animation: 0.5 }, denoise: true, dof: true, look: "agx", ev: 0 };
const ptSpeed = () => { try { const v = +localStorage.getItem(TRACE_SPEED_KEY); return v > 0 ? v : null; } catch { return null; } };
const ptKeepSpeed = (v) => { if (!(v > 0) || !Number.isFinite(v)) return; const o = ptSpeed(); try { localStorage.setItem(TRACE_SPEED_KEY, String(o ? o * 0.5 + v * 0.5 : v)); } catch {} };
async function ptEngine(w, h) {
  if (!pt) {
    const lib = await import("three-gpu-pathtracer");
    const r = new THREE.WebGLRenderer({ canvas: ptCanvas, antialias: false, preserveDrawingBuffer: true });
    if (!r.capabilities.isWebGL2) { r.dispose(); throw new Error("this browser has no WebGL 2"); }
    if (!r.extensions.has("EXT_color_buffer_float")) { r.dispose(); throw new Error("this graphics card can't draw into float textures"); }
    ptR = r;
    pt = new lib.WebGLPathTracer(ptR); Object.assign(pt, { renderDelay: 0, fadeDuration: 0, minSamples: 1, rasterizeScene: false, dynamicLowRes: false, synchronizeRenderSize: true });
    pt.bounces = 8; pt.transmissiveBounces = 10; pt.filterGlossyFactor = 0.5; pt.tiles.set(2, 2);
    ptCam = new lib.PhysicalCamera(); ptFilter = new lib.DenoiseMaterial();
    ptShow = new THREE.MeshBasicMaterial({ toneMapped: true }); ptQuad = new FullScreenQuad(ptShow);
  }
  ptR.setPixelRatio(1); ptR.setSize(w, h, false); return pt;
}
function ptLook() { ptR.toneMapping = ptSet.look === "aces" ? THREE.ACESFilmicToneMapping : THREE.AgXToneMapping; ptR.toneMappingExposure = ptAuto * 2 ** ptSet.ev; }
// the World as one HDR dome (radiance), rebuilt only when the sky, the hour or a light changes
const PT_EQ_VERT = "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
const PT_EQ_FRAG = "uniform samplerCube env; varying vec2 vUv; void main() { float p = (vUv.x - 0.5) * 6.28318530718; float t = (vUv.y - 0.5) * 3.14159265359; gl_FragColor = vec4(textureCube(env, vec3(cos(t) * cos(p), sin(t), cos(t) * sin(p))).rgb, 1.0); }";
function ptWorld() {
  const studio = skyMode === "studio", phys = skyMode === "physical", sp = sun.getWorldPosition(new THREE.Vector3()), tp = sun.target.getWorldPosition(new THREE.Vector3());
  const key = JSON.stringify([skyMode, sun.visible, sp.toArray(), tp.toArray(), sun.color.getHex(), sun.intensity, hemi.color.getHex(), hemi.groundColor.getHex(), hemi.intensity]);
  if (key === ptWorldKey && ptWorldTex) return ptWorldTex;
  const W = ENV_W, H = ENV_H, data = new Float32Array(W * H * 4), k = hemi.intensity / Math.PI; let physSun = null;
  const up = [hemi.color.r * k, hemi.color.g * k, hemi.color.b * k], down = [hemi.groundColor.r * k, hemi.groundColor.g * k, hemi.groundColor.b * k];
  if (phys || studio) {
    const world = studio ? new RoomEnvironment() : new THREE.Scene(); let sk = null;
    if (phys) {
      sk = new Sky(); sk.scale.setScalar(450); const u = sk.material.uniforms, v = skyObj.material.uniforms;
      for (const n of ["turbidity", "rayleigh", "mieCoefficient", "mieDirectionalG"]) u[n].value = v[n].value;
      u.sunPosition.value.copy(sp).sub(tp).normalize(); u.showSunDisc.value = 0; world.add(sk);
    }
    const cube = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType }), cc = new THREE.CubeCamera(studio ? 0.04 : 1, studio ? 100 : 2000, cube);
    const tm = ptR.toneMapping; ptR.toneMapping = THREE.NoToneMapping; cc.update(ptR, world);
    const eq = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType }), mat = new THREE.ShaderMaterial({ uniforms: { env: { value: cube.texture } }, vertexShader: PT_EQ_VERT, fragmentShader: PT_EQ_FRAG, depthTest: false, depthWrite: false }), q = new FullScreenQuad(mat);
    ptR.setRenderTarget(eq); q.render(ptR); ptR.readRenderTargetPixels(eq, 0, 0, W, H, data); ptR.setRenderTarget(null); ptR.toneMapping = tm;
    q.dispose(); mat.dispose(); eq.dispose(); cube.dispose(); if (sk) { sk.geometry.dispose(); sk.material.dispose(); } world.dispose?.();
    if (phys) {
      // One model for sun and sky, like Cycles' sky texture: the sun's colour and strength come from the same
      // Preetham air the viewport's sky is drawn with (orange and weaker as it sinks, white overhead), and the sky's
      // light on a roof is the clear-sky share of that sun (SKY_DIFFUSE_SHARE), so a low sun still rakes warm and
      // strong over a softer blue fill. Below the horizon is ground, as in the viewport.
      data.fill(0, 0, (W * H) / 2 * 4);
      const dn = sp.clone().sub(tp).normalize(); physSun = physicalSunIrradiance(Math.asin(dn.y));
      const s = luminance(envUpIrradiance(data, W, H)), want = SKY_DIFFUSE_SHARE * luminance(physSun), f = s > 0 ? want / s : 0;
      for (let i = (W * H) / 2 * 4; i < data.length; i++) data[i] *= f;
      envAddSplit(data, W, H, [0, 0, 0], down, "lower");
    } else envAddSplit(data, W, H, up, down);
  } else envAddSplit(data, W, H, up, down);
  // the sun: the physical sky's own sun, otherwise the viewport sun's colour × strength
  if (sun.visible && sun.intensity > 0) { const d = sp.clone().sub(tp); envAddSun(data, W, H, [d.x, d.y, d.z], physSun || [sun.color.r * sun.intensity, sun.color.g * sun.intensity, sun.color.b * sun.intensity]); }
  for (let i = 3; i < data.length; i += 4) data[i] = 1;
  ptWorldTex?.dispose();
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping; tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  ptWorldKey = key; ptWorldTex = tex; return tex;
}
// a set thing's material word → its physical layers, over the viewport's own colour, roughness and metal.
// Left out on purpose (checked in the harness, 2026-09-30, three-gpu-pathtracer 0.0.25 with three r185): any clear coat
// renders pitch black, and glass with a thickness turns black inside, so paint keeps the viewport's gloss and glass is
// thin-walled (a window pane, which is what set glass is).
function ptMaterial(m, word) {
  if (m?.isMeshPhysicalMaterial) { if (!(m.clearcoat > 0)) return null; const c = m.clone(); c.clearcoat = 0; return c; } // an imported model's coat
  const r = word && MATERIAL_RECIPES[word]?.physical;
  if (!r || Array.isArray(m) || !m?.isMeshStandardMaterial) return null;
  if (r.transmission === undefined && r.sheen === undefined && r.specularIntensity === undefined) return null;
  const p = new THREE.MeshPhysicalMaterial(); THREE.MeshStandardMaterial.prototype.copy.call(p, m); p.defines = { STANDARD: "", PHYSICAL: "" };
  for (const n of ["specularIntensity", "sheen", "sheenRoughness", "ior"]) if (typeof r[n] === "number") p[n] = r[n];
  if (r.sheenColor) p.sheenColor = r.sheenColor === "self" ? m.color.clone() : new THREE.Color(r.sheenColor);
  if (r.transmission !== undefined) { p.transmission = r.transmission === "byLightness" ? (hslOf("#" + m.color.getHexString()).l > 0.45 ? 0.9 : 0.2) : r.transmission; p.thickness = 0; p.roughness = Math.min(p.roughness, 0.05); p.metalness = 0; }
  if (r.doubleSided) p.side = THREE.DoubleSide;
  return p;
}
function ptPrep() {
  const hv = helpers.visible, sv = shot.obj.visible, bg = scene.background, env = scene.environment, ei = scene.environmentIntensity, ov = scene.overrideMaterial, skv = skyObj?.visible, hv2 = hemi.visible, sunV = sun.visible;
  const hid = items.filter((i) => i.noRender && i.obj.visible); hid.forEach((i) => (i.obj.visible = false));
  helpers.visible = false; shot.obj.visible = false; if (skyObj) skyObj.visible = false; scene.overrideMaterial = null;
  const world = ptWorld();
  scene.environment = world; scene.environmentIntensity = 1; scene.background = skyMode === "physical" ? world : skyMode === "studio" ? studioBg : skyColor;
  hemi.visible = false; sun.visible = false; // both live in the dome now (the sun as its disc)
  // the tracer gathers meshes and lights by their OWN visible flag, not their parents': everything under a hidden parent
  // (a hidden thing and its lamp, the editor's gizmos) is hidden itself — the move gizmo's invisible 100 km plane
  // used to sit over the whole set and shade it, in every traced render before 2026-09-30
  const dark = []; (function walk(o, shown) { const vis = shown && o.visible && !(o.isMesh && o.material?.visible === false); if (!vis && o.visible) { o.visible = false; dark.push(o); } o.children.forEach((c) => walk(c, vis)); })(scene, true);
  const swaps = []; items.forEach((it) => it.obj.visible && it.obj.traverse((o) => { if (!o.isMesh) return; const pm = ptMaterial(o.material, o.userData.word); if (pm) { swaps.push([o, o.material]); o.material = pm; } }));
  const soft = []; scene.traverse((o) => { if ((o.isPointLight || o.isSpotLight) && o.radius === undefined) { o.radius = 0.1; soft.push(o); } });
  return () => {
    helpers.visible = hv; shot.obj.visible = sv; scene.background = bg; scene.environment = env; scene.environmentIntensity = ei; scene.overrideMaterial = ov; if (skyObj) skyObj.visible = skv; hemi.visible = hv2; sun.visible = sunV;
    hid.forEach((i) => (i.obj.visible = true)); dark.forEach((o) => (o.visible = true));
    swaps.forEach(([o, m]) => { o.material.dispose(); o.material = m; }); soft.forEach((o) => delete o.radius);
  };
}
function ptCamSync(w, h) {
  const cam = shot.obj.userData.cam, u = shot.obj.userData; cam.updateMatrixWorld(true);
  cam.matrixWorld.decompose(ptCam.position, ptCam.quaternion, ptCam.scale);
  Object.assign(ptCam, { fov: cam.fov, aspect: w / h, near: cam.near, far: cam.far, focusDistance: Math.max(0.1, u.focus || 7) }); ptCam.updateProjectionMatrix(); ptCam.updateMatrixWorld(true);
  if (ptSet.dof && u.fstop > 0) ptCam.bokehSize = (u.lensMm || 35) / u.fstop; else ptCam.fStop = Infinity;
}
// the denoiser's guides: what colour each pixel's surface is (albedo) and which way it faces (normal), anti-aliased like the trace
function ptAovs(w, h) {
  // one target per guide: reading a second pass back from the same multisampled target returned the first pass's pixels
  if (!ptAovT || ptAovT[0].width !== w || ptAovT[0].height !== h) { ptAovT?.forEach((t) => t.dispose()); ptAovT = [0, 1].map(() => new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, samples: 4 })); }
  const albedo = new Float32Array(w * h * 4), normal = new Float32Array(w * h * 4);
  const tm = ptR.toneMapping, cc = ptR.getClearColor(new THREE.Color()), ca = ptR.getClearAlpha(), bg = scene.background, fg = scene.fog, ov = scene.overrideMaterial;
  const swaps = [], off = [];
  scene.traverseVisible((o) => {
    if (o.isLine || o.isPoints || o.isSprite) { off.push(o); return; }
    if (!o.isMesh) return;
    const one = (m) => new THREE.MeshBasicMaterial({ color: m.color || 0xffffff, map: m.map || null, side: m.side, transparent: m.transparent, opacity: m.opacity, fog: false });
    swaps.push([o, o.material]); o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material);
  });
  off.forEach((o) => (o.visible = false)); scene.fog = null; ptR.toneMapping = THREE.NoToneMapping; ptR.setRenderTarget(ptAovT[0]);
  ptR.setClearColor(0x000000, 1); ptR.clear(); ptR.render(scene, ptCam); ptR.readRenderTargetPixels(ptAovT[0], 0, 0, w, h, albedo);
  swaps.forEach(([o, m]) => { (Array.isArray(o.material) ? o.material : [o.material]).forEach((b) => b.dispose()); o.material = m; });
  ptNormalMat ||= new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
  scene.background = null; scene.overrideMaterial = ptNormalMat; ptR.setRenderTarget(ptAovT[1]); ptR.setClearColor(new THREE.Color(0.5, 0.5, 0.5), 1); ptR.clear(); ptR.render(scene, ptCam); ptR.readRenderTargetPixels(ptAovT[1], 0, 0, w, h, normal);
  for (let i = 0; i < normal.length; i++) normal[i] = normal[i] * 2 - 1;
  ptR.setRenderTarget(null); scene.background = bg; scene.fog = fg; scene.overrideMaterial = ov; ptR.toneMapping = tm; ptR.setClearColor(cc, ca); off.forEach((o) => (o.visible = true));
  return { albedo, normal };
}
function ptPresent(tex, filter) {
  const m = filter ? ptFilter : ptShow;
  if (m.map !== tex) { m.map = tex; m.needsUpdate = true; }
  ptQuad.material = m; ptR.setRenderTarget(null); ptR.clear(); ptQuad.render(ptR);
}
// cleans the finished trace and shows it: "oidn" (Open Image Denoise), "filter" (the tracer's own smoothing filter, when
// this browser has no WebGPU) or "none"
async function ptFinish(w, h, onPhase) {
  let how = "none";
  if (ptSet.denoise) {
    onPhase?.();
    const unet = await loadOidn();
    if (unet) {
      try {
        const color = new Float32Array(w * h * 4); ptR.readRenderTargetPixels(pt.target, 0, 0, w, h, color);
        const { albedo, normal } = ptAovs(w, h);
        const out = await oidnDenoise(unet, color, albedo, normal, w, h);
        const tex = new THREE.DataTexture(out, w, h, THREE.RGBAFormat, THREE.FloatType); tex.needsUpdate = true;
        ptLook(); ptPresent(tex, false); ptSnapNow(w, h); tex.dispose(); ptShow.map = null;
        return "oidn";
      } catch (e) { console.warn("Helios Studio: Open Image Denoise failed, using the built-in filter", e); how = "filter"; }
    } else how = "filter";
  }
  ptLook(); ptPresent(pt.target.texture, how === "filter"); ptSnapNow(w, h);
  return how;
}
function ptSnapNow(w, h) { const c = ptSnap.getContext("2d"); if (ptSnap.width !== w || ptSnap.height !== h) { ptSnap.width = w; ptSnap.height = h; } c.drawImage(ptCanvas, 0, 0, w, h); }
// Waits until the graphics card has really finished what was sent. Without it the loop queues samples far faster than
// the card traces them: the counter runs ahead of the picture, Stop waits for the whole queue, and the next read-back
// stalls the browser for minutes (it froze Chrome 154 on the race track at full size, 2026-09-30).
function ptTick() {
  const gl = ptR.getContext(), sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
  return new Promise((ok) => { const poll = () => { const r = gl.clientWaitSync(sync, 0, 0); if (r === gl.TIMEOUT_EXPIRED) return setTimeout(poll, 2); gl.deleteSync(sync); ok(); }; setTimeout(poll, 0); });
}
// meter: expose the picture like a camera would, from its first few samples (Final/Draft alike); the Exposure field
// is an offset on top. An animation meters its first frame and keeps that for every frame, so it doesn't flicker.
const ptMeter = (w, h) => { const px = new Float32Array(w * h * 4); ptR.readRenderTargetPixels(pt.target, 0, 0, w, h, px); ptAuto = meterExposure(px); ptLook(); };
async function ptTrace(w, h, samples, { onSample, onClean, meter = false, cleanStopped = true } = {}) {
  const cam = shot.obj.userData.cam; cam.aspect = w / h; cam.updateProjectionMatrix();
  const engine = await ptEngine(w, h); ptLook(); const restore = ptPrep();
  try {
    ptCamSync(w, h); engine.setScene(scene, ptCam); engine.reset();
    // while its shader compiles the tracer counts samples it hasn't traced: start counting once it has compiled
    const t0 = performance.now(); let lastSnap = 0, t1 = 0, warm = engine.isCompiling;
    while (engine.samples < samples && ptBusy) {
      engine.renderSample(); if (warm && !engine.isCompiling) { warm = false; engine.reset(); continue; } if (!t1 && !warm && engine.samples >= 1) t1 = performance.now();
      if (meter && !warm && engine.samples >= Math.min(4, samples)) { ptMeter(w, h); meter = false; }
      if (performance.now() - lastSnap > 1000) { ptSnapNow(w, h); lastSnap = performance.now(); }
      if (onSample) onSample(warm ? 0 : engine.samples);
      if ((warm || engine.samples < 1) && performance.now() - t0 > 180000) throw new Error("the graphics card didn't start tracing within three minutes");
      await ptTick();
    }
    const n = Math.floor(engine.samples); if (t1 && n > 4) ptKeepSpeed((performance.now() - t1) / (n - 1) / ((w * h) / 1e6));
    if (n < 1 || (!ptBusy && !cleanStopped)) return { how: "none", samples: n };
    if (meter) ptMeter(w, h);
    return { how: await ptFinish(w, h, onClean), samples: n };
  } finally { restore(); }
}
function ptFail(title, e) {
  ptBusy = false;
  openWin(title, `<p><b>This device can't path-trace this scene.</b> <span>${esc(e?.message || String(e))}.</span></p><p class="hint">Path tracing needs WebGL 2 with float textures, on a computer's graphics card. Render ▸ Render still and Render animation still work here, and give the same framing.</p>`);
}
function ptStop() { ptBusy = false; }
// the settings both windows share: quality, samples, size, denoise, depth of field, look, exposure, and the estimate
function ptSettings(kind) {
  const u = shot.obj.userData, s = ptSet[kind];
  const sizes = TRACE_SCALES.map((k) => { const [w, h] = traceSize(outSize(), k); return `<option value="${k}" ${ptSet.scale[kind] === k ? "selected" : ""}>${k === 0.5 ? "½" : k + "×"} · ${w} × ${h}</option>`; }).join("");
  const q = (v, n) => `<option value="${v}" ${s.q === v ? "selected" : ""}>${n}</option>`;
  return `<div class="fr"><label>Quality</label><select class="sel2" id="ptQ" aria-label="Quality">${q("draft", "Draft")}${q("final", "Final")}${q("custom", "Custom")}</select></div>`
    + `<div class="fr"><label>${kind === "still" ? "Samples" : "Samples per frame"}</label><span id="ptSampF"></span></div>`
    + `<div class="fr"><label>Size</label><select class="sel2" id="ptSize" aria-label="Size">${sizes}</select></div>`
    + `<div class="fr"><label>Denoise</label><label class="check"><input type="checkbox" id="ptDn" ${ptSet.denoise ? "checked" : ""}> <span>Clean the grain</span></label></div>`
    + `<div class="fr"><label>Depth of Field</label><label class="check"><input type="checkbox" id="ptDof" ${ptSet.dof ? "checked" : ""}> <span>f/${(+u.fstop || 2.8).toFixed(1)} · focus ${(+u.focus || 7).toFixed(1)} m</span></label></div>`
    + `<div class="fr"><label>Look</label><select class="sel2" id="ptLook" aria-label="Look"><option value="agx" ${ptSet.look === "agx" ? "selected" : ""}>AgX (like Blender)</option><option value="aces" ${ptSet.look === "aces" ? "selected" : ""}>ACES (like the viewport)</option></select></div>`
    + `<div class="fr"><label>Exposure</label><span id="ptEvF"></span></div>`
    + `<p class="hint" id="ptEst"></p><p class="hint" id="ptWarn" hidden></p>`;
}
function ptWire(kind, frames = 1) {
  const s = ptSet[kind];
  const mountSamples = () => { const h = $("ptSampF"); if (!h) return; h.textContent = ""; h.appendChild(field(traceSamples(kind, s.q, s.custom), { step: kind === "still" ? 4 : 1, dec: 0, min: 1, max: TRACE_MAX_SAMPLES[kind], onCommit: (v) => { s.custom = Math.round(v); s.q = "custom"; $("ptQ").value = "custom"; est(); } })); };
  const est = () => {
    const [w, h] = traceSize(outSize(), ptSet.scale[kind]), n = traceSamples(kind, s.q, s.custom), sec = traceEstimate(ptSpeed(), n, w, h, frames, ptSet.denoise ? 1 : 0), e = $("ptEst"), warn = $("ptWarn"); if (!e) return;
    e.textContent = sec == null ? "The time is measured on this device during the first render." : frames > 1 ? `About ${traceDuration(sec)} for ${frames} frames on this device` : `About ${traceDuration(sec)} on this device`;
    const slow = sec != null && sec > TRACE_SLOW_SECONDS[kind]; warn.hidden = !slow; if (slow) warn.textContent = "That is slow on this device. Draft or ½ size is much quicker.";
  };
  mountSamples(); est();
  $("ptQ").onchange = (e) => { s.q = e.target.value; mountSamples(); est(); };
  $("ptSize").onchange = (e) => { ptSet.scale[kind] = +e.target.value; est(); };
  $("ptDn").onchange = (e) => { ptSet.denoise = e.target.checked; est(); };
  $("ptDof").onchange = (e) => (ptSet.dof = e.target.checked);
  $("ptLook").onchange = (e) => (ptSet.look = e.target.value);
  $("ptEvF").appendChild(field(ptSet.ev, { step: 0.05, dec: 1, min: -5, max: 5, onCommit: (v) => (ptSet.ev = Math.round(v * 10) / 10) }));
  return est;
}
const ptLock = (on) => { ["ptGo", "ptQ", "ptSize", "ptDn", "ptDof", "ptLook"].forEach((id) => { const e = $(id); if (e) e.disabled = on; }); const st = $("ptStop"); if (st) st.disabled = !on; };
const ptHost = () => { ptCanvas.style.width = "100%"; ptCanvas.style.height = "auto"; ptCanvas.style.display = "block"; $("ptHost").appendChild(ptCanvas); };
const PT_CLEANED = { oidn: "Cleaned by Open Image Denoise, on this device.", filter: "Cleaned by the simpler built-in filter: this browser has no WebGPU for Open Image Denoise.", none: "" };
const ptNoteHtml = (how) => `${PT_CLEANED[how] ? `<span>${PT_CLEANED[how]}</span> ` : ""}<span>Exposure metered for this shot: ${(Math.round(Math.log2(ptAuto) * 10) / 10).toFixed(1)} EV (your offset ${ptSet.ev.toFixed(1)} EV).</span>`;
function ptSlowCheck(kind, left) { const w = $("ptWarn"); if (!w || left < TRACE_SLOW_SECONDS[kind]) return; w.hidden = false; w.textContent = `This device is slow for this: about ${traceDuration(left)} left. Stop, then pick Draft or ½ size for a quicker render.`; }
async function renderTracedStill() {
  if (ptBusy) return toast("A path-traced render is already running");
  const title = "Helios Render · path traced still";
  openWin(title, ptSettings("still") + `<div class="row-btns"><button class="pbtn accent" id="ptGo">Render</button><button class="pbtn" id="ptStop" disabled>Stop</button><a class="pbtn" id="ptSave" style="display:grid;place-items:center;text-decoration:none;pointer-events:none;opacity:.5" download="helios-traced-frame-${frameNo()}.png">Save image</a></div><div class="prog"><i id="prog"></i></div><p id="progTxt" style="font-family:var(--mono)"></p><p class="hint" id="ptNote"></p><div id="ptHost"></div><p class="hint">Frame ${frameNo()} through the shot camera. Light bounces the way it does in Blender's Cycles: soft sun shadows, sky light, colour bleeding, true reflections and glass. The grain is cleaned at the end, on this device; nothing is sent anywhere.</p>`);
  const est = ptWire("still");
  $("ptGo").onclick = async () => {
    const save = $("ptSave"); save.style.pointerEvents = "none"; save.style.opacity = ".5"; $("ptNote").textContent = ""; $("ptWarn").hidden = true;
    const [w, h] = traceSize(outSize(), ptSet.scale.still), n = traceSamples("still", ptSet.still.q, ptSet.still.custom);
    ptBusy = true; ptLock(true); ptHost();
    const t0 = performance.now(); let res;
    try {
      res = await ptTrace(w, h, n, { meter: true,
        onSample: (s) => { const el = (performance.now() - t0) / 1000, done = Math.floor(s), pr = $("prog"); if (pr) pr.style.width = Math.min(100, (s / n) * 100) + "%"; const left = done > 0 ? (el / s) * (n - s) : 0; const tx = $("progTxt"); if (tx) tx.textContent = done > 0 ? `Sample ${done} of ${n} · ${traceDuration(el)} · about ${traceDuration(left)} left` : `Starting the graphics card · ${traceDuration(el)}`; if (el > 4 && done > 1) ptSlowCheck("still", left); },
        onClean: () => { const tx = $("progTxt"); if (tx) tx.textContent = "Cleaning the grain…"; },
      });
    } catch (e) { return ptFail(title, e); }
    const done = ptBusy; ptBusy = false; if (!$("ptGo")) return;
    ptLock(false); if (res.samples) { save.href = ptSnap.toDataURL("image/png"); save.style.pointerEvents = ""; save.style.opacity = ""; }
    const tx = $("progTxt"), el = (performance.now() - t0) / 1000; if (tx) tx.textContent = `${done ? "Done" : "Stopped"} · ${res.samples} samples · ${traceDuration(el)}`;
    $("ptNote").innerHTML = ptNoteHtml(res.how); est();
  };
  $("ptStop").onclick = ptStop;
}
async function renderTracedVideo() {
  if (ptBusy) return toast("A path-traced render is already running");
  if (!("MediaRecorder" in window)) return openWin("Helios Render", "<p>This browser can't record video. Chrome, Edge and Firefox can.</p>");
  const title = "Helios Render · path traced animation", total = pEnd - pStart + 1;
  openWin(title, ptSettings("animation") + `<div class="row-btns"><button class="pbtn accent" id="ptGo">Render frames ${pStart}–${pEnd}</button><button class="pbtn" id="ptStop" disabled>Stop</button></div><div class="prog"><i id="prog"></i></div><p id="progTxt" style="font-family:var(--mono)"></p><p class="hint" id="ptNote"></p><div id="ptHost"></div><p class="hint">Traces every frame of the playback range (set it on the timeline) and cleans each one, then plays them back into a video at ${FPS} fps. The model, materials and light match the still.</p>`);
  ptWire("animation", total);
  $("ptStop").onclick = ptStop;
  $("ptGo").onclick = async () => {
    const [w, h] = traceSize(outSize(), ptSet.scale.animation), n = traceSamples("animation", ptSet.animation.q, ptSet.animation.custom);
    ptBusy = true; ptLock(true); ptHost(); $("ptNote").textContent = ""; $("ptWarn").hidden = true;
    const was = time; play(false); const shots = [], t0 = performance.now(); let how = "none";
    try {
      for (let f = pStart; f <= pEnd && ptBusy; f++) {
        evaluate((f - 1) / FPS); const res = await ptTrace(w, h, n, { meter: f === pStart }); if (!ptBusy && res.samples < n) break; how = res.how;
        shots.push(await new Promise((r) => ptSnap.toBlob(r, "image/jpeg", 0.92)));
        const i = f - pStart + 1, pr = $("prog"); if (pr) pr.style.width = (i / total) * 100 + "%";
        const tx = $("progTxt"), el = (performance.now() - t0) / 1000, left = (el / i) * (total - i); if (tx) tx.textContent = `Frame ${i} of ${total} · ${traceDuration(el)} · about ${traceDuration(left)} left`;
        if (i === 2) ptSlowCheck("animation", left);
      }
    } catch (e) { setTime(was); return ptFail(title, e); }
    setTime(was); const stopped = !ptBusy; ptBusy = false;
    if (!$("ptGo")) return;
    ptLock(false); $("ptNote").innerHTML = ptNoteHtml(how);
    if (!shots.length) { const tx = $("progTxt"); if (tx) tx.textContent = "Stopped before the first frame was finished."; return; }
    const tx = $("progTxt"); if (tx) tx.textContent = `${stopped ? "Stopped after" : "Traced"} ${shots.length} frames · recording the video at ${FPS} fps…`;
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const ctx = cv.getContext("2d"); const stream = cv.captureStream(FPS);
    const type = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
    const rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 8e6 } : undefined); const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const bitmaps = await Promise.all(shots.map((b) => createImageBitmap(b)));
    ctx.drawImage(bitmaps[0], 0, 0); rec.start();
    for (const bm of bitmaps) { ctx.drawImage(bm, 0, 0); await new Promise((r) => setTimeout(r, 1000 / FPS)); }
    rec.stop(); await new Promise((r) => (rec.onstop = r)); bitmaps.forEach((b) => b.close());
    const blob = new Blob(chunks, { type: type || "video/webm" }), url = URL.createObjectURL(blob), ext = (type || "video/webm").includes("mp4") ? "mp4" : "webm";
    openWin(title, `<video src="${url}" controls autoplay loop muted playsinline></video><div class="row-btns"><a class="pbtn accent" style="display:grid;place-items:center;text-decoration:none" download="helios-traced-${pStart}-${pEnd}.${ext}" href="${url}">Save video</a></div><p>${shots.length} path-traced frames, ${w} × ${h}, ${n} samples each${stopped ? ", stopped early" : ""}.</p><p class="hint">${ptNoteHtml(how)}</p>`);
  };
}

// ================= Blender (Cycles) render on a cloud GPU (2026-09-29) =================
// The operator picked "Real Blender renders": the scene (every visible thing, lamps with their lights) goes as
// a GLB with the job (shot camera per frame, moving things per frame, sun, sky, size, samples) to Blender on a
// cloud GPU (opts.cycles → studio-cycles.ts → cycles-actions.ts → modal/helios_cycles.py). Admins only for now.
const cy = { busy: false, kind: "still", edge: { still: 1920, animation: 1280 }, samples: { ...CYCLES_DEFAULT_SAMPLES }, start: null, end: null, t0: 0, upd: null, est: 0, result: null, timer: 0 };
const CY_TITLE = { still: "Blender render (Cycles) — still", animation: "Blender render (Cycles) — animation" };
const cyRound = (a) => Array.from(a, (v) => Math.round(v * 1e5) / 1e5 || 0);
const cyRgb = (c) => [c.r, c.g, c.b].map((v) => Math.round(Math.max(0, v) * 1e4) / 1e4);
/** What Blender renders: every visible thing that renders (the export's list, less "don't render"). */
const cyItems = () => items.filter((i) => exportable(i) && !i.noRender);
/** Like exportGroup, but lamps keep their lights, a spot faces its target, and each thing is named for Blender to find. */
function cyGroup(list) {
  const g = new THREE.Group(); scene.updateMatrixWorld(true);
  list.forEach((it, n) => {
    const c = it.obj.clone(true); it.obj.matrixWorld.decompose(c.position, c.quaternion, c.scale); c.name = "helios_item_" + n;
    const drop = []; c.traverse((o) => { if (o !== c && (o.isCamera || o.isLine || o.isPoints || o.isSprite || o.type === "AxesHelper" || o.isHemisphereLight || o.isRectAreaLight)) drop.push(o); });
    drop.forEach((o) => o.parent?.remove(o));
    c.traverse((o) => { if (o.isSpotLight && o.target && o.target.parent === o.parent) { const d = o.target.position.clone().sub(o.position); if (d.lengthSq() > 1e-9) o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), d.normalize()); o.add(o.target); o.target.position.set(0, 0, -1); } });
    g.add(c);
  });
  g.updateMatrixWorld(true); return g;
}
function cyPick() {
  const k = cy.kind, [w, h] = cyclesSize(FORMATS[format], cy.edge[k]);
  const start = k === "still" ? frameNo() : Math.min(FRAMES - 1, Math.max(1, cy.start ?? pStart));
  const end = k === "still" ? start : Math.min(FRAMES, Math.max(start + 1, cy.end ?? pEnd), start + CYCLES_MAX_FRAMES - 1);
  const frames = end - start + 1, est = estimateCycles({ width: w, height: h, samples: cy.samples[k], frames });
  return { w, h, start, end, frames, samples: cy.samples[k], est };
}
/** The scene file and the job, as the door checks it (cycles.ts validateCyclesJob). */
async function cyPayload(p) {
  const kind = cy.kind, list = cyItems(), was = time, cam = shot.obj.userData.cam;
  const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
  let glb, camera = [], per = list.map(() => []);
  try {
    if (kind === "animation") evaluate((p.start - 1) / FPS);
    glb = await new GLTFExporter().parseAsync(cyGroup(list), { binary: true });
    for (let f = p.start; f <= p.end; f++) {
      if (kind === "animation") evaluate((f - 1) / FPS);
      scene.updateMatrixWorld(true); camera.push(cyRound(cam.matrixWorld.elements)); list.forEach((it, n) => per[n].push(cyRound(it.obj.matrixWorld.elements)));
    }
  } finally { if (kind === "animation") setTime(was); }
  const tracks = kind === "animation" ? list.map((it, n) => ({ node: "helios_item_" + n, m: per[n] })).filter((t) => t.m.some((m) => m.some((v, j) => Math.abs(v - t.m[0][j]) > 1e-5))) : [];
  const studio = skyMode === "studio";
  const job = {
    kind, width: p.w, height: p.h, samples: p.samples, frameStart: p.start, frameEnd: p.end, fps: FPS,
    lensMm: shot.obj.userData.lensMm, sensorMm: 24, camera, tracks, hour,
    world: { mode: skyMode === "physical" || studio ? skyMode : "simple", background: cyRgb(studio ? studioBg : skyColor), sky: cyRgb(studio ? new THREE.Color(0xffffff) : hemi.color), ground: cyRgb(studio ? new THREE.Color(0x9a9a9a) : hemi.groundColor), strength: Math.round((studio ? 1 : hemi.intensity) * 1e4) / 1e4 },
    sun: { on: sun.visible && !sunItem.hidden, dir: cyRound(sun.position.clone().normalize().toArray()), color: cyRgb(sun.color), strength: Math.round(sun.intensity * 1e4) / 1e4 },
  };
  return { glb: new Blob([glb], { type: "model/gltf-binary" }), job };
}
function openCycles(kind) {
  if (!opts.cycles) return;
  if (!cy.busy && cy.kind !== kind) { cy.kind = kind; cy.result = null; }
  showCycles();
}
function cyStatus() {
  const s = Math.round((Date.now() - cy.t0) / 1000), u = cy.upd;
  if (!u || u.phase === "uploading") return `Sending the scene to the render computer · ${s} s`;
  if (u.phase === "starting") return `Starting a cloud GPU and Blender · ${s} s`;
  return cy.kind === "animation" ? `Rendering frame ${u.done} of ${u.total} · ${s} s` : `Rendering in Blender · ${s} s`;
}
function cyTick() {
  const bar = $("cyProg"), txt = $("cyTxt"); if (!bar || !txt || !cy.busy) return;
  const u = cy.upd, el = (Date.now() - cy.t0) / 1000;
  bar.style.width = (u && u.phase === "rendering" && u.total > 0 ? (u.done / u.total) * 100 : Math.min(95, (el / Math.max(10, cy.est)) * 100)) + "%";
  txt.textContent = cyStatus();
}
function showCycles() {
  const C = opts.cycles; if (!C) return;
  const k = cy.kind, p = cyPick(), r = cy.result;
  let body = "";
  if (r && r.error === null) {
    const media = r.kind === "animation" ? `<video src="${esc(r.url)}" controls autoplay loop muted playsinline></video>` : `<img alt="Blender render" src="${esc(r.url)}">`;
    const file = r.kind === "animation" ? `helios-cycles-${p.start}-${p.end}.mp4` : `helios-cycles-frame-${p.start}.png`;
    body = `${media}<div class="row-btns"><a class="pbtn accent" style="display:grid;place-items:center;text-decoration:none" download="${esc(file)}" href="${esc(r.url)}">${r.kind === "animation" ? "Save video" : "Save image"}</a><button class="pbtn" id="cyAgain">Render again</button></div>
<p>Rendered by Blender Cycles on ${esc(HELIOS_CYCLES_GPU + (r.device ? " · " + r.device : ""))} · ${esc(cyclesDuration(r.seconds))} in all · ${esc(cyclesDollars(r.usd))} of GPU time</p>`;
  } else if (r) {
    body = `<p class="cast-note" role="alert">${esc(r.error || C.unreachable)}</p><div class="row-btns"><button class="pbtn" id="cyAgain">Back</button></div>`;
  } else {
    const sizes = CYCLES_EDGES[k].map((e) => { const [w, h] = cyclesSize(FORMATS[format], e); return `<option value="${e}"${e === cy.edge[k] ? " selected" : ""}>${w} × ${h}</option>`; }).join("");
    const tooLong = p.est.seconds > CYCLES_MAX_SECONDS;
    body = `<p class="hint">Blender renders the shot camera's view with Cycles on a cloud GPU: real bounced light, soft shadows and reflections, from the scene exactly as it is here.</p>
<div class="fr"><label for="cySize">Size</label><select class="sel2" id="cySize"${cy.busy ? " disabled" : ""}>${sizes}</select></div>
<div class="fr" style="margin-top:4px"><label>Samples</label><span id="cySampF"></span></div>
${k === "animation" ? `<div class="fr" style="margin-top:4px"><label>Start</label><span id="cyStartF"></span></div><div class="fr" style="margin-top:4px"><label>End</label><span id="cyEndF"></span></div>` : ""}
<p id="cyEst">About ${esc(cyclesDuration(p.est.seconds))} on a cloud GPU · about ${esc(cyclesDollars(p.est.usd))} of GPU time</p>
<p class="hint">An estimate until the first renders are timed. No credits are taken while Blender renders are for the team.</p>
<p class="cast-note" id="cyLong"${tooLong ? "" : " hidden"}>${esc(CYCLES_TOO_LONG)}</p>
<div class="row-btns"><button class="pbtn accent" id="cyGo"${cy.busy || tooLong ? " disabled" : ""}>Render in Blender</button></div>
<div class="prog"${cy.busy ? "" : " hidden"}><i id="cyProg"></i></div><p class="hint" id="cyTxt" role="status"></p>
<p class="hint"${cy.busy ? "" : " hidden"}>You can close this window: the render keeps going, and Render ▸ opens it again.</p>`;
  }
  const open = $("dlgBody") && $("dlgBody").querySelector("[data-cycles-win]");
  if (!open || $("dlg").hidden || $("dlgTitle").dataset.cy !== k) { openWin(CY_TITLE[k], `<div data-cycles-win></div>`); $("dlgTitle").dataset.cy = k; }
  const box = $("dlgBody").querySelector("[data-cycles-win]"); box.innerHTML = body;
  const again = $("cyAgain"); if (again) again.onclick = () => { cy.result = null; showCycles(); };
  if (!r) {
    const redo = () => { if (!cy.busy) showCycles(); };
    $("cySize").onchange = (e) => { cy.edge[k] = +e.target.value; redo(); };
    const maxS = k === "animation" ? CYCLES_MAX_SAMPLES_ANIMATION : CYCLES_MAX_SAMPLES_STILL;
    $("cySampF").appendChild(field(p.samples, { step: 1, dec: 0, min: 1, max: maxS, onCommit: (v) => { cy.samples[k] = Math.round(v); redo(); } }));
    if (k === "animation") {
      $("cyStartF").appendChild(field(p.start, { step: 1, dec: 0, min: 1, max: FRAMES - 1, onCommit: (v) => { cy.start = Math.round(v); redo(); } }));
      $("cyEndF").appendChild(field(p.end, { step: 1, dec: 0, min: 2, max: FRAMES, onCommit: (v) => { cy.end = Math.round(v); redo(); } }));
    }
    $("cyGo").onclick = cyGo;
    cyTick();
  }
}
async function cyGo() {
  const C = opts.cycles; if (!C || cy.busy) return;
  const p = cyPick(); if (p.est.seconds > CYCLES_MAX_SECONDS) return;
  cy.busy = true; cy.t0 = Date.now(); cy.upd = null; cy.est = p.est.seconds; cy.result = null;
  clearInterval(cy.timer); cy.timer = setInterval(cyTick, 1000);
  showCycles();
  let res;
  try {
    const pay = await cyPayload(p);
    res = await C.run(pay.glb, pay.job, (u) => { cy.upd = u; cyTick(); });
  } catch (e) { res = { error: C.unreachable }; }
  clearInterval(cy.timer); cy.busy = false;
  if (stopped || (res && res.left)) return;
  cy.result = res && (res.error !== undefined) ? res : { error: C.unreachable };
  const here = !$("dlg").hidden && $("dlgBody").querySelector("[data-cycles-win]");
  if (here) showCycles();
  else toast(cy.result.error === null ? "Your Blender render is ready · Render ▸" : "Your Blender render didn't come out · Render ▸");
}

// ================= constraints & motion paths =================
function setTrack(it, targetId) {
  const b = it.obj.userData.track ?? null; it.obj.userData.track = targetId ?? null;
  push({ label: targetId ? "Track To" : "Remove constraint", undo() { it.obj.userData.track = b; evaluate(time); }, redo() { it.obj.userData.track = targetId ?? null; evaluate(time); } });
  evaluate(time);
}
const _tp = new THREE.Vector3();
function applyConstraints() {
  for (const it of items) {
    const id = it.obj.userData.track; if (!id) continue;
    const tg = byId(id); if (!tg || tg.hidden) continue;
    tg.obj.getWorldPosition(_tp); _tp.y += tg === person ? 1.4 : 0.8;
    it.obj.lookAt(_tp);
  }
}
let pathOn = false;
const pathLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xf3c48c }));
const pathDots = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xffffff, size: 6, sizeAttenuation: false }));
helpers.add(pathLine, pathDots);
function updatePath() {
  const it = active; const show = pathOn && it && it.keys.length > 1;
  pathLine.visible = pathDots.visible = !!show; if (!show) return;
  const pts = [], dots = [];
  for (let f = 0; f <= FRAMES; f += 2) { evaluate(f / FPS); pts.push(it.obj.getWorldPosition(new THREE.Vector3())); }
  for (const k of it.keys) { evaluate(k.t); dots.push(it.obj.getWorldPosition(new THREE.Vector3())); }
  evaluate(time);
  pathLine.geometry.setFromPoints(pts); pathDots.geometry.setFromPoints(dots);
}
function togglePath() { pathOn = !pathOn; updatePath(); info(pathOn ? "Motion path on: the line the active object travels" : "Motion path off"); renderProps(); }

// ================= people: the posable figure and Pose Mode (2026-09-30) =================
// Operator picked "Posable people": the stand-in is an articulated mannequin
// (studio-figure.ts; the rig, IK, presets and words in studio-pose.ts). Pose
// Mode (Ctrl+Tab, or the mode menu) works like Blender's: click a joint, R
// rotates that bone (X Y Z lock its own axes, typed degrees, always inside
// its joint limits), drag a hand or foot (or G on it) and the whole limb
// follows by IK, G on the pelvis moves the body, Alt+R / Alt+G clear. The
// Pose panel in Properties has the presets, Sit on… / Lean on… / Look at…,
// a joint picker (tap-sized on phones) and the bone's numbers. Poses key per
// bone or whole (I) and ease between keys; every action is one undo.
function initFigure(item) { item.rig = findSkeleton(item.obj); if (!item.rig) return; item.pose = presetPose("stand"); item.poseKeys = []; applyPose(item.rig, item.pose); }
const people = () => items.filter((i) => i.rig);
const boneLabel = (n) => BONE[n]?.label || n;
const limbEnd = (n) => Object.keys(LIMBS).find((k) => LIMBS[k].end === n) || null;
function poseSnap(it) { return { pose: clonePose(it.pose), keys: clone(it.poseKeys), t: trs(it.obj), okeys: clone(it.keys) }; }
function putPose(it, s) { it.pose = clonePose(s.pose); it.poseKeys = clone(s.keys); it.keys = clone(s.okeys); applyTRS(it.obj, s.t); applyPose(it.rig, it.pose); }
function setWorldPos(it, wp) { it.obj.position.copy(it.obj.parent === scene ? wp : it.obj.parent.worldToLocal(wp.clone())); it.obj.updateMatrixWorld(true); }
/** One undoable pose action: `fn` changes it.pose (and may move the figure); auto keying keys the bones it names (all, when null). */
function poseAct(it, label, fn, bones = null) {
  if (!it || !it.rig) return;
  const b = poseSnap(it); fn(); it.pose = { rot: it.pose.rot, loc: clampLoc(it.pose.loc) }; applyPose(it.rig, it.pose);
  const moved = JSON.stringify(trs(it.obj)) !== JSON.stringify(b.t);
  if (autoKey) { it.poseKeys = setPoseKey(it.poseKeys, time, it.pose, bones, 0.5 / FPS); if (moved) setKey(it, time); }
  const a = poseSnap(it);
  push({ label, undo() { putPose(it, b); }, redo() { putPose(it, a); } });
  if (!autoKey && (it.poseKeys.length || (moved && it.keys.length))) toast("Auto keying is off: the timeline will move it back. Press I to key it.");
  updateBoneViz(); renderAll(); info(label + (autoKey ? ` · keyed at frame ${frameNo()}` : ""));
}
/** A preset: a gesture poses the arms only; a body preset the whole figure, back on the ground unless it sits where it is. */
function presetCmd(it, name) {
  if (!it?.rig) return toast("Select a person first");
  poseAct(it, `Pose · ${PRESET_LABELS[name]}`, () => {
    const raised = it.obj.getWorldPosition(new V3()).y > 0.05;
    let p = applyPreset(it.pose, name);
    if (!presetBones(name) && raised) {
      if (name === "sit") p = { rot: p.rot, loc: [0, 0, 0] };
      else { const w = it.obj.getWorldPosition(new V3()); w.y = 0; setWorldPos(it, w); }
    }
    it.pose = p;
  }, presetBones(name));
}
/** The top of `tgt` nearest the figure, where it can sit: a point on an upward face 0.3–1.35 m up, and "outwards" from its middle. */
function seatOn(tgt, it) {
  const b = worldBox(tgt); if (b.isEmpty()) return null;
  const meshes = []; tgt.obj.traverse((o) => { if (o.isMesh && o.visible) meshes.push(o); });
  const fp = it.obj.getWorldPosition(new V3()), c = b.getCenter(new V3()), rc = new THREE.Raycaster(), hits = [], N = 11;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x = b.min.x + ((b.max.x - b.min.x) * (i + 0.5)) / N, z = b.min.z + ((b.max.z - b.min.z) * (j + 0.5)) / N;
    rc.set(new V3(x, b.max.y + 1, z), new V3(0, -1, 0)); const h = rc.intersectObjects(meshes, false)[0]; if (!h) continue;
    const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new V3(0, 1, 0); if (n.y < 0.7) continue;
    hits.push(h.point.clone());
  }
  if (!hits.length) return null;
  const ok = hits.filter((p) => p.y >= 0.3 && p.y <= 1.35), pool = ok.length ? ok : hits;
  pool.sort((p, q) => Math.hypot(p.x - fp.x, p.z - fp.z) - Math.hypot(q.x - fp.x, q.z - fp.z));
  const at = pool[0]; let out = new V3(at.x - c.x, 0, at.z - c.z); if (out.lengthSq() < 1e-6) out = new V3(fp.x - c.x, 0, fp.z - c.z); if (out.lengthSq() < 1e-6) out.set(0, 0, 1);
  return { at, out: out.normalize() };
}
/** Sits the figure on `tgt`: its seat on the top nearest to it, facing out, legs over the edge. */
function sitOn(it, tgt) {
  if (!it?.rig || !tgt || tgt === it || tgt.kind === "camera") return false;
  const s = seatOn(tgt, it); if (!s) return false;
  poseAct(it, `Sit on "${tgt.name}"`, () => {
    const p = applyPreset(it.pose, "sit"); p.loc = [0, 0, 0];
    // On something low the legs go out straight, as sitting on the ground.
    if (s.at.y < 0.32) { p.rot["thigh.L"] = [-86, 0, 4]; p.rot["thigh.R"] = [-86, 0, 4]; p.rot["shin.L"] = [0, 0, 0]; p.rot["shin.R"] = [0, 0, 0]; }
    it.pose = p;
    const seat = s.at.clone().sub(s.out.clone().multiplyScalar(0.08));
    it.obj.rotation.set(0, Math.atan2(s.out.x, s.out.z), 0);
    setWorldPos(it, new V3(seat.x, seat.y + SEAT_DROP_M - BONE.pelvis.at[1], seat.z));
  });
  return true;
}
/** Leans the figure on `tgt`: hands on its top when that is table-to-chest high, else its back against it, arms crossed. */
function leanOn(it, tgt) {
  if (!it?.rig || !tgt || tgt === it || tgt.kind === "camera") return false;
  const b = worldBox(tgt); if (b.isEmpty()) return false;
  const fp = it.obj.getWorldPosition(new V3());
  const q = new V3(THREE.MathUtils.clamp(fp.x, b.min.x, b.max.x), 0, THREE.MathUtils.clamp(fp.z, b.min.z, b.max.z));
  const n = new V3(fp.x - q.x, 0, fp.z - q.z);
  if (n.lengthSq() < 1e-6) {
    const d = [[fp.x - b.min.x, -1, 0], [b.max.x - fp.x, 1, 0], [fp.z - b.min.z, 0, -1], [b.max.z - fp.z, 0, 1]].sort((u, v) => u[0] - v[0])[0];
    n.set(d[1], 0, d[2]); if (d[1]) q.x = d[1] < 0 ? b.min.x : b.max.x; else q.z = d[2] < 0 ? b.min.z : b.max.z;
  }
  n.normalize();
  const meshes = []; tgt.obj.traverse((o) => { if (o.isMesh && o.visible) meshes.push(o); });
  const h = new THREE.Raycaster(new V3(q.x - n.x * 0.12, b.max.y + 1, q.z - n.z * 0.12), new V3(0, -1, 0)).intersectObjects(meshes, false)[0];
  const ground = Math.max(0, b.min.y), top = (h ? h.point.y : b.max.y) - ground;
  poseAct(it, `Lean on "${tgt.name}"`, () => {
    let p = presetPose("stand");
    if (top >= 0.55 && top <= 1.45) {
      p.rot.spine = clampRot("spine", [-24, 0, 0]); p.rot.chest = clampRot("chest", [-10, 0, 0]); p.rot.neck = clampRot("neck", [12, 0, 0]);
      it.obj.rotation.set(0, Math.atan2(-n.x, -n.z), 0); setWorldPos(it, new V3(q.x + n.x * 0.38, ground, q.z + n.z * 0.38));
      it.pose = p; applyPose(it.rig, p);
      const left = new V3(1, 0, 0).applyQuaternion(it.obj.getWorldQuaternion(new THREE.Quaternion()));
      for (const [limb, sgn] of [["arm.L", 1], ["arm.R", -1]]) solveLimb(it.rig, p, limb, new V3(q.x - n.x * 0.1, ground + top + 0.05, q.z - n.z * 0.1).add(left.clone().multiplyScalar(0.2 * sgn)));
    } else {
      it.obj.rotation.set(0, Math.atan2(n.x, n.z), 0); setWorldPos(it, new V3(q.x + n.x * 0.2, ground, q.z + n.z * 0.2));
      p.rot.pelvis = clampRot("pelvis", [7, 0, 0]); p.rot["thigh.L"] = clampRot("thigh.L", [-7, 0, 0]); p.rot["thigh.R"] = clampRot("thigh.R", [-14, 0, -4]); p.rot["shin.R"] = clampRot("shin.R", [14, 0, 0]);
      p = groundFeet(applyPreset(p, "crossed"));
    }
    it.pose = p;
  });
  return true;
}
/** Turns the figure's chest, neck and head so it looks at `tgt` (the shot camera, a person's face, a thing's middle). */
function lookAtCmd(it, tgt) {
  if (!it?.rig || !tgt || tgt === it) return false;
  const tp = tgt === shot ? shot.obj.getWorldPosition(new V3()) : tgt.rig ? tgt.rig.bones.head.getWorldPosition(new V3()).add(new V3(0, 0.1, 0)) : worldBox(tgt).getCenter(new V3());
  poseAct(it, `Look at "${tgt.name}"`, () => {
    const p = clonePose(it.pose), c0 = p.rot.chest || [0, 0, 0];
    p.rot.chest = [c0[0], 0, c0[2]]; p.rot.neck = [0, 0, 0]; p.rot.head = [0, 0, 0]; applyPose(it.rig, p);
    const eye = it.rig.bones.head.getWorldPosition(new V3()).add(new V3(0, 0.09, 0).applyQuaternion(it.rig.bones.head.getWorldQuaternion(new THREE.Quaternion())));
    const d = tp.clone().sub(eye).applyQuaternion(it.rig.bones.chest.getWorldQuaternion(new THREE.Quaternion()).invert());
    const r = lookRot([d.x, d.y, d.z]);
    p.rot.chest = clampRot("chest", [c0[0], r.chest[1], c0[2]]); p.rot.neck = r.neck; p.rot.head = r.head; it.pose = p;
  }, ["chest", "neck", "head"]);
  return true;
}
/** What the figure is doing, measured: what it sits or leans on and what it looks at, then the pose's words. */
function personWords(it) {
  if (!it?.rig || !items.includes(it)) return null;
  scene.updateMatrixWorld(true);
  const others = items.filter((o) => o !== it && o.kind === "mesh" && !o.hidden && o !== place);
  const nameOf = (o) => thingWords(o.name, o.obj.userData.paint?.[0]?.color ? "#" + o.obj.userData.paint[0].color.getHexString() : null);
  const B = it.rig.bones, wp = (n) => B[n].getWorldPosition(new V3());
  const seat = wp("pelvis").sub(new V3(0, SEAT_DROP_M, 0)), seated = (it.pose.rot["thigh.L"]?.[0] ?? 0) < -55 && (it.pose.rot["thigh.R"]?.[0] ?? 0) < -55;
  let sittingOn = null, leaningOn = null, lookingAt = null;
  if (seated && seat.y > 0.15) for (const o of others) { const b = worldBox(o); if (!b.isEmpty() && b.distanceToPoint(seat) < 0.12) { sittingOn = nameOf(o); break; } }
  if (!sittingOn) {
    // A hand rests on a thing when that thing's surface is just under the wrist; a back leans on a tall thing it touches.
    const wl = wp("hand.L"), wr = wp("hand.R"), ch = wp("chest"), rc = new THREE.Raycaster();
    const restsOn = (o, p) => { rc.set(new V3(p.x, p.y + 0.3, p.z), new V3(0, -1, 0)); rc.far = 0.5; const h = rc.intersectObject(o.obj, true).find((x) => x.object.isMesh); return !!h && p.y - h.point.y > -0.06 && p.y - h.point.y < 0.14; };
    for (const o of others) { const b = worldBox(o); if (b.isEmpty()) continue; if (restsOn(o, wl) || restsOn(o, wr) || (b.max.y > 1.3 && b.distanceToPoint(ch) < 0.22)) { leaningOn = nameOf(o); break; } }
  }
  const eye = wp("head").add(new V3(0, 0.09, 0)), fwd = new V3(0, 0, 1).applyQuaternion(B.head.getWorldQuaternion(new THREE.Quaternion()));
  const ang = (p) => fwd.angleTo(p.clone().sub(eye)) * (180 / Math.PI);
  if (ang(shot.obj.getWorldPosition(new V3())) < 20) lookingAt = "the camera";
  else { let best = 12; for (const o of [...others, ...people().filter((x) => x !== it)]) { const c = o.rig ? o.rig.bones.head.getWorldPosition(new V3()) : worldBox(o).getCenter(new V3()); const a = ang(c); if (a < best) { best = a; lookingAt = o.rig ? "the other person" : nameOf(o); } } }
  const ctx = { sittingOn, leaningOn, lookingAt };
  return { words: poseWords(it.pose, ctx), sentence: poseSentence(it.pose, ctx), stand: standPoseOf(it.pose, ctx) };
}

// ---- Pose Mode ----
const boneViz = new THREE.Group(); boneViz.visible = false; helpers.add(boneViz);
const bvDot = new THREE.SphereGeometry(1, 14, 10);
const bvMat = (c) => new THREE.MeshBasicMaterial({ color: c, depthTest: false, transparent: true, opacity: 0.95 });
const bvMats = { off: bvMat(0xdadce2), on: bvMat(0x4fa3ff), ik: bvMat(0xf3a24a) };
let bvLines = null, bvDots = {};
function buildBoneViz() {
  boneViz.clear(); bvDots = {}; bvLines = null;
  if (!poseMode || !poseItem) { boneViz.visible = false; return; }
  for (const n of BONE_NAMES) { const m = new THREE.Mesh(bvDot, bvMats.off); m.renderOrder = 41; boneViz.add(m); bvDots[n] = m; }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(BONE_NAMES.length * 6), 3));
  bvLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xf2f2f4, depthTest: false, transparent: true, opacity: 0.9 })); bvLines.renderOrder = 40; bvLines.frustumCulled = false; boneViz.add(bvLines);
  boneViz.visible = true; updateBoneViz();
}
function updateBoneViz() {
  if (!bvLines || !poseItem) return;
  if (!items.includes(poseItem)) { exitPose(); return; }
  poseItem.obj.updateMatrixWorld(true);
  const arr = bvLines.geometry.attributes.position.array, cam = viewCam();
  BONE_NAMES.forEach((n, k) => {
    const bo = poseItem.rig.bones[n], a = bo.getWorldPosition(new V3()), t = new V3(...BONE[n].tail).applyMatrix4(bo.matrixWorld);
    arr.set([a.x, a.y, a.z, t.x, t.y, t.z], k * 6);
    const m = bvDots[n], end = !!limbEnd(n); m.position.copy(a); m.material = n === poseBone ? bvMats.on : end ? bvMats.ik : bvMats.off;
    m.scale.setScalar(Math.max(0.01, cam.position.distanceTo(a) * (end ? 0.012 : 0.008)));
  });
  bvLines.geometry.attributes.position.needsUpdate = true;
}
function segDist(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy; const u = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0; return Math.hypot(px - ax - u * dx, py - ay - u * dy); }
/** The pose item's bone under the pointer: its joint dot within `px`, or its line a little further. */
function boneAt(cx, cy, px = 16) {
  if (!poseItem) return null; poseItem.obj.updateMatrixWorld(true); let best = null, bd = px;
  for (const n of BONE_NAMES) {
    const bo = poseItem.rig.bones[n], [ax, ay, az] = screenOf(bo.getWorldPosition(new V3())), [tx, ty] = screenOf(new V3(...BONE[n].tail).applyMatrix4(bo.matrixWorld));
    if (az > 1) continue; const d = Math.min(Math.hypot(ax - cx, ay - cy), segDist(cx, cy, ax, ay, tx, ty) + 5); if (d < bd) { bd = d; best = n; }
  }
  return best;
}
function pickBone(cx, cy) {
  let n = boneAt(cx, cy);
  if (!n) {
    const r = canvas.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), viewCam());
    const hit = ray.intersectObjects(people().filter((i) => !i.hidden).map((i) => i.obj), true)[0];
    if (hit) { const it = byId(hit.object.userData.itemId); if (it && it !== poseItem) { selection.clear(); selection.add(it); active = it; poseItem = it; buildBoneViz(); } n = boneOfMesh(hit.object); }
  }
  poseBone = n; updateBoneViz(); renderAll();
  info(n ? `${boneLabel(n)} · R rotates · Alt+R clears${limbEnd(n) ? " · drag it, or G, to move the whole limb" : ""}` : "Pose Mode · click a joint");
}
function enterPose(it = active) {
  if (!it || !it.rig) return toast("Select a person, then Ctrl+Tab for Pose Mode");
  if (editMode) exitEdit();
  poseMode = true; poseItem = it; poseBone = null; selection.clear(); selection.add(it); active = it;
  $("modeBtn").innerHTML = MODE_ICON + "Pose Mode ▾"; $("modeBtn").classList.add("edit");
  buildBoneViz(); refreshSel(); info(`Pose Mode · ${it.name} · click a joint, R rotates, drag a hand or foot`);
}
function exitPose() {
  if (!poseMode) return; poseMode = false; poseBone = null; buildBoneViz();
  $("modeBtn").innerHTML = MODE_ICON + "Object Mode ▾"; $("modeBtn").classList.remove("edit"); refreshSel();
}
function togglePose() { poseMode ? exitPose() : enterPose(); }
function openModeMenu(btn) {
  const r = btn.getBoundingClientRect(), a = active && active.kind !== "sun" ? active : null;
  openPopup(r.left, r.bottom + 4, `<h4>Mode</h4><button data-act="modeObject"><span>Object Mode</span></button><button data-act="modeEdit" ${a && a.kind !== "camera" && !a.rig ? "" : "disabled"}><span>Edit Mode</span><small>Tab</small></button><button data-act="modePose" ${a?.rig ? "" : "disabled"}><span>Pose Mode</span><small>Ctrl+Tab</small></button>`);
}
/** Drags a hand or foot: the whole limb follows by IK, on the plane facing the view through where it was. */
function startIkDrag(n) {
  const it = poseItem, limb = limbEnd(n), b = poseSnap(it), cam = viewCam();
  const end = it.rig.bones[n].getWorldPosition(new V3()), plane = new THREE.Plane().setFromNormalAndCoplanarPoint(cam.getWorldDirection(new V3()).negate(), end);
  orbit.enabled = false; let moved = false;
  const mv = (ev) => {
    const r = canvas.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), cam);
    const p = ray.ray.intersectPlane(plane, new V3()); if (!p) return; moved = true; solveLimb(it.rig, it.pose, limb, p); updateBoneViz();
  };
  const up = () => {
    window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); orbit.enabled = true;
    if (!moved) { renderAll(); info(`${boneLabel(n)} · drag it to move the whole limb · R rotates`); return; }
    const after = clonePose(it.pose); putPose(it, b);
    poseAct(it, `Move ${boneLabel(n)} (IK)`, () => { it.pose = after; }, [LIMBS[limb].upper, LIMBS[limb].lower]);
  };
  wOn("pointermove", mv); wOn("pointerup", up);
}
canvas.addEventListener("pointerdown", (e) => {
  if (!poseMode || modal || e.button !== 0 || !poseItem || !e.isPrimary) return;
  const n = boneAt(e.clientX, e.clientY, 14); if (!n || !limbEnd(n)) return;
  e.stopImmediatePropagation(); e.preventDefault(); downAt = null; poseBone = n; updateBoneViz(); startIkDrag(n);
}, { capture: true, signal: ac.signal });
/** The modal R / G on a bone (startModal hands it here): rotate about its own axes or the view, move a hand or foot by IK, or the pelvis. */
function poseModalApply(m, d, q) {
  const it = m.it, p = clonePose(m.start); let label = "";
  if (m.mode === "rotate") {
    const dg = THREE.MathUtils.radToDeg(m.ang || 0);
    if (m.axis) { const i = { x: 0, y: 1, z: 2 }[m.axis], v = [...(p.rot[m.name] || [0, 0, 0])]; v[i] += dg; p.rot[m.name] = clampRot(m.name, v); }
    else p.rot[m.name] = clampRot(m.name, eulerNumbers(m.name, m.pq.clone().invert().multiply(q.clone().multiply(m.q0))));
    const v = p.rot[m.name];
    label = `Rotate ${boneLabel(m.name)}${m.axis ? " " + m.axis.toUpperCase() : ""}  ${dg.toFixed(1)}°  ·  X ${v[0].toFixed(1)}°  Y ${v[1].toFixed(1)}°  Z ${v[2].toFixed(1)}°`;
  } else {
    if (m.limb) solveLimb(it.rig, p, m.limb, m.w0.clone().add(d));
    else { const dl = d.clone().applyQuaternion(it.obj.getWorldQuaternion(new THREE.Quaternion()).invert()).divide(it.obj.getWorldScale(new V3())); p.loc = clampLoc([m.start.loc[0] + dl.x, m.start.loc[1] + dl.y, m.start.loc[2] + dl.z]); }
    label = `Move ${boneLabel(m.name)}${m.limb ? " (IK)" : ""}  D  ${d.x.toFixed(2)}  ${(-d.z).toFixed(2)}  ${d.y.toFixed(2)} m`;
  }
  it.pose = p; applyPose(it.rig, p); updateBoneViz();
  $("modal").innerHTML = `<b>${esc(label)}</b>${m.typed ? `<span class="typed">${esc(m.typed)}</span>` : ""}<span>X Y Z lock the bone's own axis · type degrees · the joint's limits hold · click or ⏎ confirm · Esc or right-click cancel</span>`;
}
function startPoseModal(mode) {
  if (!poseItem || !poseBone) { toast("Click a joint first (Pose Mode)"); return false; }
  if (mode === "scale") { toast("Bones keep their length: R rotates, G moves a hand, a foot or the pelvis"); return false; }
  const limb = limbEnd(poseBone);
  if (mode === "translate" && !limb && poseBone !== "pelvis") { toast("Only a hand, a foot or the pelvis moves with G; R rotates this bone"); return false; }
  poseItem.obj.updateMatrixWorld(true);
  const bo = poseItem.rig.bones[poseBone], c = bo.getWorldPosition(new V3()), [cx, cy] = screenOf(c);
  modal = { bone: true, it: poseItem, name: poseBone, limb, snap: poseSnap(poseItem), start: clonePose(poseItem.pose), q0: bo.getWorldQuaternion(new THREE.Quaternion()), pq: bo.parent.getWorldQuaternion(new THREE.Quaternion()), w0: c.clone(), mode, sx: mouse[0], sy: mouse[1], center: c, cx, cy, axis: null, typed: "" };
  orbit.enabled = false; tc.detach(); $("modal").hidden = false; updateModal(); return true;
}
function endPoseModal(m, ok) {
  if (!ok) { putPose(m.it, m.snap); updateBoneViz(); return; }
  const after = clonePose(m.it.pose); putPose(m.it, m.snap);
  poseAct(m.it, `${m.mode === "rotate" ? "Rotate" : "Move"} ${boneLabel(m.name)}`, () => { m.it.pose = after; }, m.limb && m.mode === "translate" ? [LIMBS[m.limb].upper, LIMBS[m.limb].lower] : [m.name]);
}
/** Alt+R: the selected bone's rotation (every bone's, with none selected); Alt+G: the pelvis back to where it stands. */
function clearBones(kind) {
  const it = poseItem || (active?.rig ? active : null); if (!it) return toast("Select a person first");
  const one = poseMode && poseBone && kind !== "loc" ? poseBone : null;
  poseAct(it, kind === "loc" ? "Clear location · Pelvis" : one ? `Clear rotation · ${boneLabel(one)}` : "Clear pose", () => {
    const p = clonePose(it.pose); if (kind === "loc") p.loc = [0, 0, 0]; else if (one) delete p.rot[one]; else p.rot = {}; it.pose = p;
  }, kind === "loc" ? ["pelvis"] : one ? [one] : null);
}
/** I in Pose Mode: the selected bone at this frame, or the whole pose. */
function keyPoseCmd(bones, it = poseItem || (active?.rig ? active : null)) {
  if (!it) return toast("Select a person to key their pose");
  const b = clone(it.poseKeys); it.poseKeys = setPoseKey(it.poseKeys, time, it.pose, bones, 0.5 / FPS); const a = clone(it.poseKeys);
  push({ label: "Insert pose keyframe", undo() { it.poseKeys = clone(b); }, redo() { it.poseKeys = clone(a); } });
  renderAll(); info(bones ? `Keyed ${boneLabel(bones[0])} · frame ${frameNo()}` : `Pose keyed · frame ${frameNo()}`);
}
// The joint picker (tap-sized on phones, where bones are small): the figure as you face it, its right on your left.
const JOINT_MAP = [
  ["head", 3, 1, "Head"], ["neck", 3, 2, "Neck"], ["shoulder.R", 2, 2, "Shoulder"], ["shoulder.L", 4, 2, "Shoulder"],
  ["upperArm.R", 1, 3, "Upper arm"], ["chest", 3, 3, "Chest"], ["upperArm.L", 5, 3, "Upper arm"],
  ["forearm.R", 1, 4, "Forearm"], ["spine", 3, 4, "Spine"], ["forearm.L", 5, 4, "Forearm"],
  ["hand.R", 1, 5, "Hand"], ["pelvis", 3, 5, "Pelvis"], ["hand.L", 5, 5, "Hand"],
  ["thigh.R", 2, 6, "Thigh"], ["thigh.L", 4, 6, "Thigh"], ["shin.R", 2, 7, "Shin"], ["shin.L", 4, 7, "Shin"], ["foot.R", 2, 8, "Foot"], ["foot.L", 4, 8, "Foot"],
];
function posePanel(p, it) {
  const mine = poseMode && poseItem === it, big = $("app").classList.contains("compact");
  const [pp, pb] = panel("Pose");
  pb.insertAdjacentHTML("beforeend", `<div class="row-btns"><button class="pbtn${mine ? " accent" : ""}" id="pMode">${mine ? "Back to Object Mode" : "Pose Mode"}</button><button class="pbtn" id="pKeyPose">Key whole pose</button><button class="pbtn" id="pClearPose">Clear pose</button></div>`);
  const pr = document.createElement("div"); pr.className = "row-btns"; pr.style.flexWrap = "wrap";
  pr.innerHTML = POSE_PRESETS.map((k) => `<button class="pbtn" data-preset="${k}" style="flex:1 1 30%">${esc(PRESET_LABELS[k])}</button>`).join(""); pb.appendChild(pr);
  pr.onclick = (e) => { const b = e.target.closest("[data-preset]"); if (b) presetCmd(it, b.dataset.preset); };
  pb.querySelector("#pMode").onclick = () => (mine ? exitPose() : enterPose(it));
  pb.querySelector("#pKeyPose").onclick = () => keyPoseCmd(null, it);
  pb.querySelector("#pClearPose").onclick = () => presetCmd(it, "stand");
  const things = items.filter((o) => o !== it && o.kind === "mesh" && !o.hidden && o !== place);
  for (const [id, label, fn, cam] of [["pSit", "Sit on…", sitOn, false], ["pLean", "Lean on…", leanOn, false], ["pLook", "Look at…", lookAtCmd, true]]) {
    const s = document.createElement("select"); s.className = "sel2"; s.id = id + "T"; s.setAttribute("aria-label", label);
    if (cam) s.add(new Option("Shot camera", "cam")); things.forEach((o) => s.add(new Option(o.name, String(o.id)))); if (!cam && !things.length) s.disabled = true;
    const go = document.createElement("button"); go.className = "pbtn"; go.id = id; go.textContent = "Apply"; go.style.flex = "none";
    go.onclick = () => { const t = s.value === "cam" ? shot : byId(+s.value); if (!t) return; if (!fn(it, t)) toast(`There's nothing there ${label === "Sit on…" ? "to sit on" : "to lean on"}`); };
    const w = document.createElement("div"); w.style.cssText = "display:flex;gap:6px;min-width:0"; s.style.flex = "1"; s.style.minWidth = "0"; w.append(s, go); pb.appendChild(fr(label, w));
  }
  pb.insertAdjacentHTML("beforeend", `<p class="hint">Ctrl+Tab · click a joint · R rotates it (X Y Z, typed degrees, inside its limits) · drag a hand or foot · Alt+R clears · I keys.</p>`);
  p.appendChild(pp);
  const [jp, jb] = panel("Joints");
  const grid = document.createElement("div"); grid.className = "joint-map"; grid.style.cssText = "display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px";
  grid.innerHTML = `<small style="grid-column:1;grid-row:1;align-self:end;opacity:.7">Right</small><small style="grid-column:5;grid-row:1;align-self:end;text-align:right;opacity:.7">Left</small>` + JOINT_MAP.map(([n, c, r, short]) => `<button class="pbtn${mine && poseBone === n ? " accent" : ""}" data-bone="${n}" title="${esc(boneLabel(n))}" aria-label="${esc(boneLabel(n))}" style="grid-column:${c};grid-row:${r};padding:2px;font-size:11px;min-height:${big ? 40 : 26}px;white-space:normal;line-height:1.1">${esc(short)}</button>`).join("");
  grid.onclick = (e) => { const b = e.target.closest("[data-bone]"); if (!b) return; if (!mine) enterPose(it); poseBone = b.dataset.bone; updateBoneViz(); renderAll(); info(`${boneLabel(poseBone)} · R rotates · Alt+R clears${limbEnd(poseBone) ? " · drag it, or G, to move the whole limb" : ""}`); };
  jb.appendChild(grid); p.appendChild(jp);
  if (!mine || !poseBone) return;
  const n = poseBone, lim = BONE[n].limits, v = it.pose.rot[n] || [0, 0, 0];
  const [bp, bb] = panel("Bone");
  const nm = document.createElement("div"); nm.className = "ptitle"; nm.textContent = boneLabel(n); bb.appendChild(nm);
  let snap = null; const commit = (lab) => { const after = clonePose(it.pose); if (snap) putPose(it, snap); snap = null; poseAct(it, lab, () => { it.pose = after; }, [n]); };
  const st = document.createElement("div"); st.className = "stack";
  ["X", "Y", "Z"].forEach((ax, i) => st.appendChild(fr(i === 0 ? `Rotation ${ax}` : ax, lim[i][0] === lim[i][1] ? ro(`${lim[i][0].toFixed(1)}°`) : field(v[i], { step: 0.5, unit: "°", dec: 1, min: lim[i][0], max: lim[i][1], onStart: () => { snap = snap || poseSnap(it); }, onLive: (x) => { const r = [...(it.pose.rot[n] || [0, 0, 0])]; r[i] = x; it.pose.rot[n] = clampRot(n, r); applyPose(it.rig, it.pose); updateBoneViz(); }, onCommit: () => commit(`Rotate ${boneLabel(n)}`) }))));
  bb.appendChild(st);
  if (n === "pelvis") {
    const lt = document.createElement("div"); lt.className = "stack"; const L = it.pose.loc;
    [["Offset X", 0, 1], ["Y", 2, -1], ["Z", 1, 1]].forEach(([lab, i, sg]) => lt.appendChild(fr(lab, field(L[i] * sg, { step: 0.01, unit: " m", dec: 2, min: -2, max: 2, onStart: () => { snap = snap || poseSnap(it); }, onLive: (x) => { const l = [...it.pose.loc]; l[i] = x * sg; it.pose.loc = clampLoc(l); applyPose(it.rig, it.pose); updateBoneViz(); }, onCommit: () => commit("Move Pelvis") }))));
    bb.appendChild(lt);
  }
  bb.appendChild(fr("Limits", ro(lim.map((l, i) => `${"XYZ"[i]} ${l[0]}…${l[1]}°`).join("  "))));
  const r = document.createElement("div"); r.className = "row-btns";
  r.innerHTML = `<button class="pbtn" id="bClear">Clear rotation</button><button class="pbtn accent" id="bKey">Key this bone</button><button class="pbtn" id="bDelKey">Delete pose key</button>`;
  bb.appendChild(r); p.appendChild(bp);
  r.querySelector("#bClear").onclick = () => clearBones("rot"); r.querySelector("#bKey").onclick = () => keyPoseCmd([n], it); r.querySelector("#bDelKey").onclick = () => delKey([it]);
}

// ================= modal G / R / S (Blender) =================
const AXV = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 0, -1), z: new THREE.Vector3(0, 1, 0) };
let modal = null, pivotMode = "median";
const viewCam = () => (camView ? shot.obj.userData.cam : editorCam);
function overView() { const r = canvas.getBoundingClientRect(); return mouse[0] >= r.left && mouse[0] <= r.right && mouse[1] >= r.top && mouse[1] <= r.bottom; }
function screenOf(v) { const r = canvas.getBoundingClientRect(), p = v.clone().project(viewCam()); return [r.left + ((p.x + 1) / 2) * r.width, r.top + ((1 - p.y) / 2) * r.height, p.z]; }
function startModal(mode) {
  if (poseMode) return startPoseModal(mode);
  let center = new THREE.Vector3(), m;
  if (editMode) {
    if (!vSel.size) return false;
    editMesh.updateMatrixWorld(true);
    const pts = [...vSel].map((k) => ({ k, wp: uniq[k].local.clone().applyMatrix4(editMesh.matrixWorld) }));
    pts.forEach((p) => center.add(p.wp)); center.divideScalar(pts.length);
    m = { edit: true, pts, arr: editMesh.geometry.attributes.position.array.slice() };
  } else {
    const sel = movable(); if (!sel.length) return false;
    sel.forEach((i) => center.add(i.obj.getWorldPosition(new THREE.Vector3()))); center.divideScalar(sel.length);
    m = { before: sel.map((i) => ({ i, t: trs(i.obj), keys: clone(i.keys), q: i.obj.quaternion.clone(), s: i.obj.scale.clone(), wp: i.obj.getWorldPosition(new THREE.Vector3()) })) };
  }
  if (pivotMode === "cursor") center = cursor3d.position.clone();
  const [cx, cy] = screenOf(center);
  modal = { ...m, mode, sx: mouse[0], sy: mouse[1], center, cx, cy, axis: null, typed: "" };
  orbit.enabled = false; tc.detach(); $("modal").hidden = false; updateModal(); return true;
}
function toLocal(it, world) { const p = it.obj.parent; return p === scene ? world : p.worldToLocal(world.clone()); }
function updateModal() {
  if (!modal) return;
  const m = modal, cam = viewCam(), r = canvas.getBoundingClientRect();
  const typedV = m.typed !== "" && !Number.isNaN(parseFloat(m.typed)) ? parseFloat(m.typed) : null;
  let d = null, q = null, fv = null, label = "";
  if (m.mode === "translate") {
    if (typedV !== null) d = (m.axis ? AXV[m.axis] : AXV.x).clone().multiplyScalar(typedV);
    else {
      const dist = cam.position.distanceTo(m.center), k = (2 * dist * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / r.height;
      const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
      d = right.multiplyScalar((mouse[0] - m.sx) * k).add(up.multiplyScalar(-(mouse[1] - m.sy) * k));
      if (m.axis) d = AXV[m.axis].clone().multiplyScalar(d.dot(AXV[m.axis]));
      const st = m.edit ? 0.05 : 0.25;
      if (snapOn) d.set(Math.round(d.x / st) * st, Math.round(d.y / st) * st, Math.round(d.z / st) * st);
    }
    label = `Move${m.axis ? " " + m.axis.toUpperCase() : ""}  D  ${d.x.toFixed(2)}  ${(-d.z).toFixed(2)}  ${d.y.toFixed(2)} m`;
  } else if (m.mode === "rotate") {
    let a = typedV !== null ? THREE.MathUtils.degToRad(typedV) : -(Math.atan2(mouse[1] - m.cy, mouse[0] - m.cx) - Math.atan2(m.sy - m.cy, m.sx - m.cx));
    if (snapOn && typedV === null) a = Math.round(a / THREE.MathUtils.degToRad(5)) * THREE.MathUtils.degToRad(5);
    m.ang = a;
    const axis = m.axis ? AXV[m.axis].clone() : new THREE.Vector3(); if (!m.axis) cam.getWorldDirection(axis).negate();
    q = new THREE.Quaternion().setFromAxisAngle(axis, a);
    label = `Rotate${m.axis ? " " + m.axis.toUpperCase() : ""}  ${THREE.MathUtils.radToDeg(a).toFixed(1)}°`;
  } else {
    const d0 = Math.hypot(m.sx - m.cx, m.sy - m.cy) || 1; let f = typedV !== null ? typedV : Math.hypot(mouse[0] - m.cx, mouse[1] - m.cy) / d0;
    if (snapOn && typedV === null) f = Math.max(0.05, Math.round(f * 10) / 10);
    fv = m.axis ? new THREE.Vector3(m.axis === "x" ? f : 1, m.axis === "z" ? f : 1, m.axis === "y" ? f : 1) : new THREE.Vector3(f, f, f);
    label = `Scale${m.axis ? " " + m.axis.toUpperCase() : ""}  ${f.toFixed(3)}`;
  }
  if (m.bone) { poseModalApply(m, d, q); return; }
  const place = (wp, own) => { if (d) return wp.clone().add(d); const c = pivotMode === "individual" && own ? own : m.center; return q ? wp.clone().sub(c).applyQuaternion(q).add(c) : wp.clone().sub(c).multiply(fv).add(c); };
  if (m.edit) {
    const arr = editMesh.geometry.attributes.position.array; arr.set(m.arr);
    const inv = editMesh.matrixWorld.clone().invert();
    for (const p of m.pts) { const l = place(p.wp).applyMatrix4(inv); for (const i of uniq[p.k].idx) { arr[i * 3] = l.x; arr[i * 3 + 1] = l.y; arr[i * 3 + 2] = l.z; } }
    editMesh.geometry.attributes.position.needsUpdate = true; editMesh.geometry.computeVertexNormals(); editMesh.geometry.computeBoundingSphere(); editMesh.geometry.computeBoundingBox(); updateEditPoints();
  } else {
    for (const b of m.before) {
      b.i.obj.position.copy(toLocal(b.i, place(b.wp, b.wp)));
      if (q) b.i.obj.quaternion.copy(q.clone().multiply(b.q));
      if (fv) b.i.obj.scale.copy(b.s.clone().multiply(fv));
    }
    refreshOutlines();
  }
  $("modal").innerHTML = `<b>${esc(label)}</b>${m.typed ? `<span class="typed">${esc(m.typed)}</span>` : ""}<span>X Y Z lock an axis · type a value · click or ⏎ confirm · Esc or right-click cancel</span>`;
}
function endModal(ok) {
  if (!modal) return; const m = modal; modal = null; $("modal").hidden = true; orbit.enabled = true;
  if (m.bone) { endPoseModal(m, ok); return; }
  const label = m.mode === "translate" ? "Move" : m.mode === "rotate" ? "Rotate" : "Scale";
  if (m.edit) {
    const geo = editMesh.geometry, attr = geo.attributes.position, before = m.arr, after = attr.array.slice();
    const setArr = (a) => { attr.array.set(a); attr.needsUpdate = true; geo.computeVertexNormals(); geo.computeBoundingSphere(); geo.computeBoundingBox(); if (editMode) updateEditPoints(); };
    if (!ok) { setArr(before); return; }
    push({ label: label + " vertices", undo() { setArr(before); }, redo() { setArr(after); } }); info(`${label} · ${m.pts.length} vertices`); return;
  }
  if (ok) commitMany(m.before.map((b) => ({ i: b.i, t: b.t, keys: b.keys })), label);
  else { m.before.forEach((b) => applyTRS(b.i.obj, b.t)); refreshSel(); }
}
function modalKey(e) {
  const k = e.key.toLowerCase();
  if (k === "escape") endModal(false);
  else if (k === "enter") endModal(true);
  else if (k === "x" || k === "y" || k === "z") modal.axis = modal.axis === k ? null : k;
  else if (/^[0-9.\-]$/.test(k)) modal.typed += k;
  else if (k === "backspace") modal.typed = modal.typed.slice(0, -1);
  else return;
  e.preventDefault(); if (modal) updateModal();
}
wOn("pointermove", () => { if (modal) updateModal(); });
canvas.addEventListener("pointerdown", (e) => { if (!modal) return; e.stopImmediatePropagation(); e.preventDefault(); downAt = null; endModal(e.button === 0); }, true);

// ================= Edit Mode (Tab) =================
let editMode = false, editItem = null, editMesh = null, uniq = [], editPts = null;
const vSel = new Set();
function buildUniq() {
  const a = editMesh.geometry.attributes.position, map = new Map(); uniq = [];
  for (let i = 0; i < a.count; i++) { const key = `${a.getX(i).toFixed(4)},${a.getY(i).toFixed(4)},${a.getZ(i).toFixed(4)}`; let u = map.get(key); if (!u) { u = { local: new THREE.Vector3(a.getX(i), a.getY(i), a.getZ(i)), idx: [] }; map.set(key, u); uniq.push(u); } u.idx.push(i); }
}
function updateEditPoints() {
  if (!editPts) return;
  const a = editMesh.geometry.attributes.position, pos = new Float32Array(uniq.length * 3), col = new Float32Array(uniq.length * 3);
  uniq.forEach((u, k) => { const i = u.idx[0]; u.local.set(a.getX(i), a.getY(i), a.getZ(i)); pos.set([u.local.x, u.local.y, u.local.z], k * 3); col.set(vSel.has(k) ? [1, 0.62, 0.25] : [0.08, 0.08, 0.09], k * 3); });
  editPts.geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3)); editPts.geometry.setAttribute("color", new THREE.BufferAttribute(col, 3));
  $("stats").textContent = `Edit Mode · ${editItem.name} · Verts ${vSel.size}/${uniq.length}`;
}
function enterEdit() {
  const it = active; if (!it || it.kind === "sun" || it.kind === "camera") return toast("Select a mesh object, then press Tab to edit its vertices");
  const m = it.obj.children.find((c) => c.isMesh && !c.userData.isItem); if (!m) return toast("This object has no mesh to edit");
  if (!m.userData.ownGeo) { m.geometry = m.geometry.clone(); m.userData.ownGeo = true; }
  editMode = true; editItem = it; editMesh = m; vSel.clear(); buildUniq();
  editPts = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, vertexColors: true, depthTest: false }));
  editPts.renderOrder = 10; editPts.userData.isEditPts = true; m.add(editPts);
  const wire = new THREE.LineSegments(new THREE.WireframeGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.6 }));
  wire.userData.isEditPts = true; m.add(wire); m.userData.editWire = wire;
  tc.detach(); updateEditPoints(); $("modeBtn").innerHTML = MODE_ICON + "Edit Mode ▾"; $("modeBtn").classList.add("edit");
  info(`Edit Mode · ${it.name}${it.obj.children.filter((c) => c.isMesh && !c.userData.isItem).length > 1 ? " (its main mesh)" : ""} · click a vertex, then G R S`);
}
function exitEdit() {
  if (!editMode) return;
  editPts.parent?.remove(editPts); editPts = null; const w = editMesh.userData.editWire; if (w) { w.parent?.remove(w); editMesh.userData.editWire = null; }
  editMode = false; editItem = null; editMesh = null; vSel.clear();
  $("modeBtn").innerHTML = MODE_ICON + "Object Mode ▾"; $("modeBtn").classList.remove("edit"); refreshSel();
}
function toggleEdit() { editMode ? exitEdit() : enterEdit(); }
function pickVertex(cx, cy, add) {
  editMesh.updateMatrixWorld(true); let best = -1, bd = 14;
  uniq.forEach((u, k) => { const [x, y] = screenOf(u.local.clone().applyMatrix4(editMesh.matrixWorld)); const dd = Math.hypot(x - cx, y - cy); if (dd < bd) { bd = dd; best = k; } });
  if (!add) vSel.clear(); if (best >= 0) { if (add && vSel.has(best)) vSel.delete(best); else vSel.add(best); }
  updateEditPoints();
}

// ================= box select =================
let box = null;
canvas.addEventListener("pointerdown", (e) => { if (modal || (tool !== "select" && !editMode) || e.button !== 0 || e.altKey) return; if (editMode && tool !== "select") return; box = { x: e.clientX, y: e.clientY, add: e.shiftKey }; });
wOn("pointermove", (e) => {
  if (!box) return; const mq = $("marquee"), r = view.getBoundingClientRect();
  if (Math.hypot(e.clientX - box.x, e.clientY - box.y) < 5) return;
  mq.hidden = false; Object.assign(mq.style, { left: Math.min(e.clientX, box.x) - r.left + "px", top: Math.min(e.clientY, box.y) - r.top + "px", width: Math.abs(e.clientX - box.x) + "px", height: Math.abs(e.clientY - box.y) + "px" });
});
wOn("pointerup", (e) => {
  if (!box) return; const b = box; box = null; const mq = $("marquee"); const dragged = !mq.hidden; mq.hidden = true; if (!dragged) return;
  const x0 = Math.min(e.clientX, b.x), x1 = Math.max(e.clientX, b.x), y0 = Math.min(e.clientY, b.y), y1 = Math.max(e.clientY, b.y);
  const inside = (v) => { const [sx, sy, z] = screenOf(v); return z < 1 && sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1; };
  if (editMode) { if (!b.add) vSel.clear(); editMesh.updateMatrixWorld(true); uniq.forEach((u, k) => { if (inside(u.local.clone().applyMatrix4(editMesh.matrixWorld))) vSel.add(k); }); updateEditPoints(); return; }
  if (!b.add) selection.clear();
  for (const it of items) { if (it.kind === "sun" || it.hidden) continue; if (inside(new THREE.Box3().setFromObject(it.obj).getCenter(new THREE.Vector3()))) { selection.add(it); active = it; } }
  if (!selection.size) active = null; refreshSel(); info(`Box select · ${selection.size} selected`);
});

// ================= Z pie, F3 search =================
function openPie() {
  const p = $("pie"); p.hidden = false; Object.assign(p.style, { left: mouse[0] + "px", top: mouse[1] + "px" });
  p.innerHTML = `<button data-pie="lit" style="transform:translate(-50%,-140%)">Rendered</button><button data-pie="clay" style="transform:translate(-50%,40%)">Solid</button><button data-pie="wire" style="transform:translate(calc(-100% - 36px),-50%)">Wireframe</button><button data-pie="ovl" style="transform:translate(36px,-50%)">Overlays</button><i></i>`;
  p.onclick = (e) => { const b = e.target.closest("[data-pie]"); if (!b) return; if (b.dataset.pie === "ovl") $("ovlBtn").click(); else setShade(b.dataset.pie); p.hidden = true; };
}
function commands() {
  const c = [
    ["Undo", undo], ["Redo", redo], ["Undo history", openHistory], ["Duplicate", duplicate], ["Delete", () => del()], ["Hide", () => toggleHide()], ["Show all hidden", showAll],
    ["Insert keyframe", () => keyItems()], ["Delete keyframe", () => delKey()], ["Interpolation: Bézier", () => setInterp("bezier")], ["Interpolation: Linear", () => setInterp("linear")], ["Interpolation: Constant", () => setInterp("constant")],
    ["Parent to active", parentTo], ["Clear parent", clearParent], ["Select all", ACTS.selAll], ["Select none", ACTS.selNone], ["Invert selection", ACTS.selInvert],
    ["Camera view", () => toggleCam()], ["Align camera to view", camToView], ["Frame all", frameAll], ["Frame selected", ACTS.frameSel], ["Top view", ACTS.top], ["Front view", ACTS.front], ["Right view", ACTS.right],
    ["Toggle motion path", togglePath], ["Toggle sidebar", () => toggleN()], ["Maximize viewport", toggleMax], ["Render still", renderStill], ["Render: photo with your character", openCast], ["Render animation", renderVideo], ["Render: path traced still", renderTracedStill], ["Render: path traced animation", renderTracedVideo], ["Physics: simulate", () => simulatePhys()], ["Physics: bake to keyframes", bakePhys], ["Physics: clear bake", clearBake], ["Import 3D model", () => fileIn.click()], ["Export (GLB, OBJ, STL) + print check", openExport],
    ["Edit Mode (vertices)", toggleEdit], ["Join", joinSel], ["Move to collection", openMoveTo], ["X-ray", toggleXray], ["Local view", toggleLocal], ["Snap menu (3D cursor)", openSnapPie], ["Add marker", addMarker], ["Graph Editor", () => setEditor("graph")], ["Timeline", () => setEditor("timeline")], ["Pivot: 3D cursor", () => setPivot("cursor")], ["Pivot: median point", () => setPivot("median")], ["Pivot: individual origins", () => setPivot("individual")], ["Orientation: Local", () => setOrient("local")], ["Orientation: Global", () => setOrient("world")], ["World: physical sky", () => setSkyMode("physical")], ["World: studio lighting", () => setSkyMode("studio")], ["What Helios leaves out", openLeavesOut],
    ["Shading: Rendered", () => setShade("lit")], ["Shading: Solid", () => setShade("clay")], ["Shading: Wireframe", () => setShade("wire")],
  ];
  for (const [k, d] of Object.entries(ADD)) c.push(["Add " + d.l, () => addUI(k)]);
  c.push(["Pose Mode", togglePose], ["Pose: clear pose", () => clearBones("rot")], ["Pose: key whole pose", () => keyPoseCmd(null)]);
  for (const k of POSE_PRESETS) c.push([`Pose: ${PRESET_LABELS[k]}`, () => { const it = poseItem || (active?.rig ? active : null); if (!it) return toast("Select a person first"); presetCmd(it, k); }]);
  return c;
}
function openSearch() {
  const p = $("popup"); p.hidden = false; p.innerHTML = `<input class="srch" id="srch" placeholder="Search commands, or ask Astra…" aria-label="Search commands"><div id="srchList"></div>`;
  const r = view.getBoundingClientRect(); p.style.left = r.left + r.width / 2 - 170 + "px"; p.style.top = r.top + 40 + "px"; p.style.width = "340px";
  const inp = $("srch"), list = $("srchList"); let hits = [];
  const draw = () => {
    const qq = inp.value.trim().toLowerCase(); hits = commands().filter(([n]) => !qq || n.toLowerCase().includes(qq) || T(n).toLowerCase().includes(qq)).slice(0, 10);
    list.innerHTML = hits.map(([n], i) => `<button data-i="${i}"><span>${esc(n)}</span></button>`).join("") + (qq ? `<div class="sep"></div><button data-astra="1"><span>Ask Astra: “${esc(inp.value.trim())}”</span><small>N</small></button>` : "");
  };
  const run = (btn) => { p.hidden = true; p.style.width = ""; if (btn?.dataset.astra) { ntab = "astra"; toggleN(true); renderN(); sendAstra(inp.value.trim()); } else if (btn) hits[+btn.dataset.i]?.[1](); };
  inp.addEventListener("input", draw); inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") run(list.querySelector("button")); if (e.key === "Escape") { p.hidden = true; p.style.width = ""; } });
  list.onclick = (e) => { const b = e.target.closest("button"); if (b) { e.stopPropagation(); run(b); } };
  draw(); inp.focus();
}

// ================= layout: splitters, maximize =================
function splitter(el, axis, cssVar, min, max, invert) {
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault(); const app = $("app"), start = axis === "x" ? e.clientX : e.clientY, cur = parseFloat(getComputedStyle(app).getPropertyValue(cssVar)) || (cssVar === "--sw" ? 300 : cssVar === "--th" ? 196 : 318);
    const mv = (ev) => { const d = (axis === "x" ? ev.clientX : ev.clientY) - start; app.style.setProperty(cssVar, Math.min(max, Math.max(min, cur + (invert ? -d : d))) + "px"); resize(); };
    const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); resize(); };
    wOn("pointermove", mv); wOn("pointerup", up);
  });
}
splitter($("splitSide"), "x", "--sw", 220, 560, true);
splitter($("splitTime"), "y", "--th", 110, 520, true);
splitter($("splitN"), "x", "--nw", 240, 560, true);
function toggleMax() { $("app").classList.toggle("max"); setTimeout(resize, 0); info($("app").classList.contains("max") ? "Viewport maximized · Ctrl+Space to restore" : "Layout restored"); }

// ================= 3D cursor, snap, pivot, orientation =================
const cursor3d = new THREE.Group();
{
  const ring = (r, c, dash) => { const pts = []; for (let i = 0; i <= 48; i++) { const a = (i / 48) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0)); } const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), dash ? new THREE.LineDashedMaterial({ color: c, dashSize: 0.06, gapSize: 0.06, depthTest: false }) : new THREE.LineBasicMaterial({ color: c, depthTest: false })); if (dash) l.computeLineDistances(); l.renderOrder = 11; return l; };
  const face = new THREE.Group(); face.add(ring(0.25, 0xffffff), ring(0.25, 0xff3352, true));
  const cross = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.45, 0, 0), new THREE.Vector3(-0.3, 0, 0), new THREE.Vector3(0.3, 0, 0), new THREE.Vector3(0.45, 0, 0), new THREE.Vector3(0, -0.45, 0), new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(0, 0.3, 0), new THREE.Vector3(0, 0.45, 0)]), new THREE.LineBasicMaterial({ color: 0x111111, depthTest: false }));
  face.add(cross); cursor3d.add(face); cursor3d.userData.face = face; overlays.add(cursor3d);
}
function hitPoint(cx, cy) {
  const r = canvas.getBoundingClientRect(), v = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(v, viewCam());
  const hit = ray.intersectObjects(items.filter((i) => i.kind !== "sun" && !i.hidden).map((i) => i.obj), true).find((h) => h.object.isMesh);
  if (hit) return hit.point;
  const p = new THREE.Vector3(); return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? p : null;
}
function setCursor(v) { const b = cursor3d.position.clone(); cursor3d.position.copy(v); push({ label: "3D cursor", undo() { cursor3d.position.copy(b); }, redo() { cursor3d.position.copy(v); } }); }
function openSnapPie() {
  const p = $("pie"); p.hidden = false; Object.assign(p.style, { left: mouse[0] + "px", top: mouse[1] + "px" });
  p.innerHTML = `<button data-sn="c2s" style="transform:translate(-50%,-150%)">Cursor to Selected</button><button data-sn="s2c" style="transform:translate(-50%,50%)">Selection to Cursor</button><button data-sn="c0" style="transform:translate(calc(-100% - 36px),-50%)">Cursor to World Origin</button><button data-sn="c2a" style="transform:translate(36px,-50%)">Cursor to Active</button><i></i>`;
  p.onclick = (e) => {
    const b = e.target.closest("[data-sn]"); if (!b) return; p.hidden = true; const sel = movable();
    if (b.dataset.sn === "c0") setCursor(new THREE.Vector3());
    else if (b.dataset.sn === "c2a") { if (active) setCursor(active.obj.getWorldPosition(new THREE.Vector3())); }
    else if (b.dataset.sn === "c2s") { if (sel.length) { const c = new THREE.Vector3(); sel.forEach((i) => c.add(i.obj.getWorldPosition(new THREE.Vector3()))); setCursor(c.divideScalar(sel.length)); } }
    else if (sel.length) { group("Selection to cursor", () => sel.forEach((i) => moveCmd(i, (o) => o.position.copy(toLocal(i, cursor3d.position.clone()))))); refreshSel(); }
  };
}
function setPivot(m) { pivotMode = m; $("pivotBtn").innerHTML = `${{ median: "⊙ Median", individual: "⊚ Individual", cursor: "⊕ 3D cursor" }[m]} ▾`; info("Pivot point · " + { median: "median point", individual: "individual origins", cursor: "3D cursor" }[m]); }
function setOrient(s) { tc.setSpace(s); $("orientBtn").textContent = (s === "local" ? "Local" : "Global") + " ▾"; }

// ================= X-ray, local view, measure =================
let xray = false; const xrayWas = new Map();
function toggleXray() {
  xray = !xray; $("xrayBtn").classList.toggle("on", xray);
  scene.traverse((o) => { if (!o.isMesh || o === ground || o.userData.isEditPts) return; const ms = Array.isArray(o.material) ? o.material : [o.material];
    ms.forEach((m) => { if (xray) { if (!xrayWas.has(m)) xrayWas.set(m, { t: m.transparent, o: m.opacity, d: m.depthWrite }); m.transparent = true; m.opacity = Math.min(m.opacity, 0.42); m.depthWrite = false; } else if (xrayWas.has(m)) { const w = xrayWas.get(m); m.transparent = w.t; m.opacity = w.o; m.depthWrite = w.d; } m.needsUpdate = true; }); });
  if (!xray) xrayWas.clear(); info(xray ? "X-ray on · see and select through things" : "X-ray off");
}
let localView = null;
function toggleLocal() {
  if (localView) { localView.forEach((v, it) => (it.obj.visible = v)); localView = null; info("Local view off"); return; }
  const sel = movable(); if (!sel.length) return toast("Select something to isolate it");
  localView = new Map(); items.forEach((it) => { if (it.kind === "sun") return; localView.set(it, it.obj.visible); if (!sel.includes(it) && !sel.some((s) => s.obj === it.obj.parent)) it.obj.visible = false; });
  frameObj(sel[0].obj); info("Local view · only the selection · / to go back");
}
const measure = { line: new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xf3c48c, dashSize: 0.2, gapSize: 0.1, depthTest: false })), a: null, b: null, drag: false };
measure.line.renderOrder = 12; overlays.add(measure.line);
canvas.addEventListener("pointerdown", (e) => { if (tool !== "measure" || modal || e.button !== 0) return; const p = hitPoint(e.clientX, e.clientY); if (!p) return; measure.a = p.clone(); measure.b = p.clone(); measure.drag = true; drawMeasure(); });
wOn("pointermove", (e) => { if (!measure.drag) return; const p = hitPoint(e.clientX, e.clientY); if (p) { measure.b = p; drawMeasure(); } });
wOn("pointerup", () => { if (measure.drag) { measure.drag = false; if (measure.a && measure.b) info(`Measured ${measure.a.distanceTo(measure.b).toFixed(2)} m`); } });
function drawMeasure() { if (!measure.a) return; measure.line.geometry.setFromPoints([measure.a, measure.b]); measure.line.computeLineDistances(); measure.line.visible = true; }
function placeMeasureLabel() {
  const l = $("measureLabel"); if (!measure.a || !measure.line.visible || camView) { l.hidden = true; return; }
  const mid = measure.a.clone().add(measure.b).multiplyScalar(0.5), [x, y, z] = screenOf(mid), r = view.getBoundingClientRect();
  if (z > 1) { l.hidden = true; return; } l.hidden = false; l.style.left = x - r.left + "px"; l.style.top = y - r.top + "px";
  l.textContent = `${measure.a.distanceTo(measure.b).toFixed(2)} m`;
}
function clearMeasure() { measure.a = null; measure.line.visible = false; $("measureLabel").hidden = true; }

// ================= world: physical sky, studio =================
skyObj = new Sky(); skyObj.scale.setScalar(450); skyObj.visible = false; scene.add(skyObj);
skyObj.material.uniforms.turbidity.value = 5; skyObj.material.uniforms.rayleigh.value = 1.6; skyObj.material.uniforms.mieCoefficient.value = 0.005; skyObj.material.uniforms.mieDirectionalG.value = 0.8;
const pmrem = new THREE.PMREMGenerator(renderer); let studioEnv = null;
let skyMode = "simple";
const studioBg = new THREE.Color(0x4b4d52);
function worldBg() { return skyMode === "physical" ? null : skyMode === "studio" ? studioBg : skyColor; }
function setSkyMode(m) {
  const b = skyMode; const apply = (v) => { skyMode = v; if (v === "studio" && !studioEnv) studioEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environment = v === "studio" ? studioEnv : null; syncSky(); };
  apply(m); push({ label: "World", undo() { apply(b); }, redo() { apply(m); } });
}
function syncSky() { if (skyObj) skyObj.material.uniforms.sunPosition.value.copy(sun.position).normalize(); }
syncSky();

// ================= modifiers: array + mirror =================
function applyArray(it) {
  const o = it.obj; o.children.filter((c) => c.userData.isArray || c.userData.isMirror).forEach((c) => o.remove(c));
  const base = o.children.filter((c) => !c.userData.isItem && !c.isLight && !c.userData.isEditPts && !c.isLine && !c.isPoints);
  const made = [];
  const a = o.userData.array;
  if (a && a.count > 1) { const g = new THREE.Group(); g.userData.isArray = true; for (let k = 1; k < a.count; k++) for (const b of base) { const c = b.clone(false); c.position.add(new THREE.Vector3(a.x * k, a.y * k, a.z * k)); g.add(c); } o.add(g); made.push(g); }
  const mi = o.userData.mirror;
  if (mi) { const g = new THREE.Group(); g.userData.isMirror = true; for (const b of [...base, ...made]) g.add(b.clone(true)); g.scale[mi.axis === "x" ? "x" : mi.axis === "y" ? "z" : "y"] = -1; if (mi.gap) g.position[mi.axis === "x" ? "x" : mi.axis === "y" ? "z" : "y"] = 0; o.add(g); made.push(g); }
  made.forEach((g) => g.traverse((x) => { x.userData.itemId = it.id; }));
}
function setMirror(it, next) { const b = it.obj.userData.mirror ? { ...it.obj.userData.mirror } : undefined; it.obj.userData.mirror = next; applyArray(it); push({ label: "Mirror", undo() { it.obj.userData.mirror = b; applyArray(it); }, redo() { it.obj.userData.mirror = next; applyArray(it); } }); refreshOutlines(); }

// ================= generic property command =================
function propCmd(label, get, set, v) { const b = get(); set(v); push({ label, undo() { set(b); }, redo() { set(v); } }); }
function liveField(value, label, get, set, opts) { let b; return field(value, { ...opts, onStart: () => (b = get()), onLive: (v) => set(v), onCommit: (v) => { set(b); propCmd(label, get, set, v); } }); }
function colorInput(id, hex, label, get, set) {
  const c = document.createElement("input"); c.type = "color"; c.className = "color"; c.id = id; c.value = hex; c.setAttribute("aria-label", label);
  let b = null; c.addEventListener("focus", () => (b = get())); c.addEventListener("input", () => set(c.value)); c.addEventListener("change", () => { const v = c.value; set(b ?? v); propCmd(label, get, set, v); }); return c;
}

// ================= camera guides =================
const guides = { thirds: true, center: false, golden: false, safe: false };
function drawGuides() {
  const s = $("guides"); if (!s) return; let h = "";
  const ln = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  if (guides.thirds) h += ln(33.33, 0, 33.33, 100) + ln(66.67, 0, 66.67, 100) + ln(0, 33.33, 100, 33.33) + ln(0, 66.67, 100, 66.67);
  if (guides.golden) h += ln(38.2, 0, 38.2, 100) + ln(61.8, 0, 61.8, 100) + ln(0, 38.2, 100, 38.2) + ln(0, 61.8, 100, 61.8);
  if (guides.center) h += ln(47, 50, 53, 50) + ln(50, 47, 50, 53);
  if (guides.safe) h += `<rect x="3.5" y="3.5" width="93" height="93"/><rect x="10" y="10" width="80" height="80"/>`;
  s.innerHTML = h;
}

// ================= outliner extras: rename, render visibility, collections =================
const COLLS = ["Set", "Cast", "Cameras", "Lights"];
function renameInline(li, it) {
  const nm = li.querySelector(".nm"); const inp = document.createElement("input"); inp.className = "search"; inp.value = it.name; inp.style.borderRadius = "3px"; nm.replaceWith(inp); inp.focus(); inp.select();
  let done = false; const fin = (ok) => { if (done) return; done = true; if (ok && inp.value.trim() && inp.value.trim() !== it.name) rename(it, inp.value.trim()); renderAll(); };
  inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") fin(true); if (e.key === "Escape") fin(false); }); inp.addEventListener("blur", () => fin(true)); inp.addEventListener("click", (e) => e.stopPropagation());
}
function setNoRender(it, v) { propCmd(v ? "Disable in renders" : "Enable in renders", () => !!it.noRender, (x) => (it.noRender = x), v); }
function openMoveTo() {
  const sel = movable(); if (!sel.length) return toast("Select objects to move to a collection");
  openPopup(mouse[0], mouse[1], `<h4>Move to Collection</h4>${COLLS.map((c) => `<button data-coll="${esc(c)}"><span>${esc(c)}</span></button>`).join("")}<div class="sep"></div><button data-coll="__new"><span>+ New Collection</span></button>`);
  $("popup").querySelectorAll("[data-coll]").forEach((b) => (b.onclick = (e) => {
    e.stopPropagation(); closeMenus(); let c = b.dataset.coll; if (c === "__new") { let n = 1; while (COLLS.includes("Collection " + n)) n++; c = "Collection " + n; COLLS.push(c); }
    group("Move to " + c, () => sel.forEach((it) => propCmd("collection", () => it.coll, (x) => (it.coll = x), c))); renderAll(); info(`Moved ${sel.length} to ${c}`);
  }));
}

// ================= join (Ctrl+J) =================
function joinSel() {
  const others = movable().filter((i) => i !== active && i !== shot && i.kind !== "camera"); if (!active || !others.length) return toast("Select the objects to join, then Shift-click the one to keep last");
  group(`Join into ${active.name}`, () => {
    for (const it of others) {
      const parts = it.obj.children.filter((c) => !c.userData.isItem && !c.userData.isArray && !c.userData.isMirror);
      const moves = parts.map((c) => ({ c })); moves.forEach((m) => { active.obj.attach(m.c); m.c.traverse((x) => (x.userData.itemId = active.id)); });
      const paint = it.obj.userData.paint || []; const ap = active.obj.userData.paint || (active.obj.userData.paint = []); const addPaint = paint.filter((p) => !ap.includes(p)); ap.push(...addPaint);
      const idx = detachItem(it);
      push({ label: "join", undo() { reattachItem(it, idx); moves.forEach((m) => { it.obj.attach(m.c); m.c.traverse((x) => (x.userData.itemId = it.id)); }); addPaint.forEach((p) => ap.splice(ap.indexOf(p), 1)); }, redo() { moves.forEach((m) => { active.obj.attach(m.c); m.c.traverse((x) => (x.userData.itemId = active.id)); }); ap.push(...addPaint); detachItem(it); } });
    }
  });
  selection.clear(); selection.add(active); refreshSel(); info(`Joined into ${active.name}`);
}

// ================= markers, playback range =================
const markers = []; let pStart = 1, pEnd = FRAMES;
function addMarker() { const f = frameNo(); if (markers.some((m) => m.f === f)) return; const m = { f, name: "F_" + f }; markers.push(m); push({ label: "Add marker", undo() { markers.splice(markers.indexOf(m), 1); }, redo() { markers.push(m); } }); renderTimeline(); info(`Marker ${m.name}`); }
function drawMarkers(ruler) { for (const m of markers) { const d = document.createElement("span"); d.className = "marker"; d.style.left = ((m.f - 1) / FRAMES) * 100 + "%"; d.innerHTML = `<i></i>${esc(m.name)}`; d.title = "Jump to " + m.name; d.onpointerdown = (e) => { e.stopPropagation(); setTime((m.f - 1) / FPS); }; ruler.appendChild(d); } }
function rangeShade(lanes) {
  const a = document.createElement("div"); a.className = "outrange"; a.style.left = "0"; a.style.width = ((pStart - 1) / FRAMES) * 100 + "%"; lanes.appendChild(a);
  const b = document.createElement("div"); b.className = "outrange"; b.style.left = ((pEnd - 1) / FRAMES) * 100 + "%"; b.style.right = "0"; lanes.appendChild(b);
}

// ================= graph editor =================
let editorType = "timeline"; const chOn = [true, true, true];
const CH = [{ n: "X Location", c: "#ff3352", get: (k) => k.p[0], set: (k, v) => (k.p[0] = v) }, { n: "Y Location", c: "#8bdc00", get: (k) => -k.p[2], set: (k, v) => (k.p[2] = -v) }, { n: "Z Location", c: "#2890ff", get: (k) => k.p[1], set: (k, v) => (k.p[1] = v) }];
function curveVal(it, t, ch) {
  const ks = it.keys; if (!ks.length) return 0; if (t <= ks[0].t) return CH[ch].get(ks[0]); if (t >= ks[ks.length - 1].t) return CH[ch].get(ks[ks.length - 1]);
  let i = 0; while (ks[i + 1].t < t) i++; const a = ks[i], b = ks[i + 1]; let u = (t - a.t) / (b.t - a.t);
  if (it.interp === "bezier") u = u * u * (3 - 2 * u); else if (it.interp === "constant") u = 0; return CH[ch].get(a) + (CH[ch].get(b) - CH[ch].get(a)) * u;
}
let gView = null;
function renderGraph() {
  const names = $("tnames"), lanes = $("tlanes"); lanes.innerHTML = ""; names.innerHTML = `<div class="rh"></div>`;
  const it = active && active.keys.length ? active : null;
  if (!it) { names.innerHTML += `<div class="sum">No curves</div>`; lanes.innerHTML = `<p class="hint" style="padding:30px 12px">Select an animated object (the car, the stand-in, the shot camera) to see its curves.</p>`; return; }
  names.innerHTML += `<div class="sum">${esc(it.name)}</div>`;
  CH.forEach((c, i) => { const d = document.createElement("div"); d.innerHTML = `<span style="width:9px;height:9px;border-radius:2px;background:${c.c};opacity:${chOn[i] ? 1 : 0.25}"></span><span>${c.n}</span>`; d.onclick = () => { chOn[i] = !chOn[i]; renderGraph(); }; names.appendChild(d); });
  const cv = document.createElement("canvas"); cv.className = "gcv"; lanes.appendChild(cv);
  const W = lanes.clientWidth, H = Math.max(120, $("tbody").clientHeight - 2), dpr = devicePixelRatio || 1; cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + "px";
  let lo = Infinity, hi = -Infinity; it.keys.forEach((k) => CH.forEach((c, i) => { if (!chOn[i]) return; lo = Math.min(lo, c.get(k)); hi = Math.max(hi, c.get(k)); }));
  if (!isFinite(lo)) { lo = -1; hi = 1; } const pad = Math.max(0.5, (hi - lo) * 0.15); lo -= pad; hi += pad;
  const X = (t) => (t / DUR) * W, Y = (v) => 24 + (1 - (v - lo) / (hi - lo)) * (H - 34), V = (y) => lo + (1 - (y - 24) / (H - 34)) * (hi - lo);
  gView = { it, W, H, X, Y, V, cv };
  const g = cv.getContext("2d"); g.scale(dpr, dpr); g.fillStyle = "#2b2c30"; g.fillRect(0, 0, W, H);
  g.font = "10px JetBrains Mono, monospace"; g.fillStyle = "#8b8e96"; g.strokeStyle = "rgba(255,255,255,.05)";
  for (let f = 0; f <= FRAMES; f += 20) { const x = X(f / FPS); g.beginPath(); g.moveTo(x, 20); g.lineTo(x, H); g.stroke(); g.fillText(String(f || 1), x + 3, 13); }
  const step = Math.pow(10, Math.floor(Math.log10((hi - lo) / 4))); for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) { const y = Y(v); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); g.fillText(v.toFixed(step < 1 ? 1 : 0), 4, y - 3); }
  CH.forEach((c, i) => {
    if (!chOn[i]) return; g.strokeStyle = c.c; g.lineWidth = 1.6; g.beginPath();
    for (let px = 0; px <= W; px += 2) { const v = curveVal(it, (px / W) * DUR, i); px ? g.lineTo(px, Y(v)) : g.moveTo(px, Y(v)); } g.stroke();
    it.keys.forEach((k) => { g.fillStyle = selection.has(it) ? "#f3c48c" : "#fff"; g.beginPath(); g.arc(X(k.t), Y(c.get(k)), 4, 0, Math.PI * 2); g.fill(); g.strokeStyle = "#111"; g.lineWidth = 1; g.stroke(); });
  });
  g.strokeStyle = "#e0a468"; g.lineWidth = 2; g.beginPath(); g.moveTo(X(time), 0); g.lineTo(X(time), H); g.stroke();
  cv.onpointerdown = (e) => {
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top; let hit = null;
    it.keys.forEach((k, ki) => CH.forEach((c, ci) => { if (chOn[ci] && Math.hypot(X(k.t) - mx, Y(c.get(k)) - my) < 8) hit = { k, ci }; }));
    if (!hit) { const mv = (ev) => setTime(Math.min(DUR, Math.max(0, ((ev.clientX - r.left) / W) * DUR))); mv(e); const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); renderAll(); }; wOn("pointermove", mv); wOn("pointerup", up); return; }
    const before = clone(it.keys);
    const mv = (ev) => { const x = ev.clientX - r.left, y = ev.clientY - r.top; hit.k.t = Math.round(Math.min(DUR, Math.max(0, (x / W) * DUR)) * FPS) / FPS; let v = V(y); if (snapOn) v = Math.round(v * 10) / 10; CH[hit.ci].set(hit.k, v); it.keys.sort((a, b) => a.t - b.t); evaluate(time); renderGraph(); info(`${CH[hit.ci].n} ${v.toFixed(2)} m · frame ${Math.round(hit.k.t * FPS) + 1}`); };
    const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); const after = clone(it.keys); push({ label: "Edit curve", undo() { it.keys = clone(before); evaluate(time); }, redo() { it.keys = clone(after); evaluate(time); } }); renderAll(); };
    wOn("pointermove", mv); wOn("pointerup", up);
  };
}
function setEditor(t) { editorType = t; $("edBtn").textContent = (t === "graph" ? "Graph Editor" : "Timeline") + " ▾"; renderTimeline(); }

// ================= what Helios leaves out =================
function openLeavesOut() {
  openWin("What Helios leaves out of Blender", `<p>Helios takes the part of Blender that stages and films a shot: objects, cameras, light, animation and rendering. These parts of Blender are left out on purpose, because the AI render makes them unnecessary or they belong to other tools:</p>
  <ol style="font-family:var(--sans);font-size:12px;line-height:1.8">
  <li><b>Sculpting and detailed modelling</b> (extrude, bevel, loop cuts, sculpt brushes): you bring a real model (.glb) or have one built from a photo, and Edit Mode covers quick vertex fixes.</li>
  <li><b>Shader and geometry nodes</b>: materials stay simple here, because the AI render paints the final look.</li>
  <li><b>Physics</b> (cloth, fluids, rigid bodies, particles): the video engine animates hair, cloth and smoke from the words.</li>
  <li><b>Compositor and video sequencer</b>: Picacho's Director's Cut edits the clips.</li>
  <li><b>UV unwrapping and texture painting</b>: an image texture on the Material tab covers signs, posters and screens.</li></ol>
  <p>Next on the list if you want it: people with a real skeleton you can pose (walk, sit, point), and camera paths drawn as a curve.</p>`);
}


// ================= saving (the account, and this browser as the backup) =================
// Stage 3 (2026-09-29): the scene is kept on the person's account
// (studio-actions.ts saveStudioScene, location_sets.studio_scene) about 5 s
// after a change settles, and in this browser at once, as before. Each copy
// carries when it was written (`at`); the Studio opens from the account's
// copy unless this browser's is newer (a save that couldn't reach the
// account), and then sends that one up.
const SAVE_KEY = "helios.studio." + opts.setId;
function snapshot() {
  return { v: 1, hour, format, lens: shot.obj.userData.lensMm, skyMode, markers, items: items.filter((i) => i.kind !== "sun" && (i.saveKey || i.addKind)).map((i) => ({ key: i.saveKey || null, add: i.addKind || null, name: i.name, coll: i.coll, t: trs(i.obj), keys: i.keys, interp: i.interp, hidden: i.hidden, noRender: !!i.noRender, color: i.obj.userData.paint?.[0] ? "#" + i.obj.userData.paint[0].color.getHexString() : null, array: i.obj.userData.array || null, mirror: i.obj.userData.mirror || null, track: i.obj.userData.track ? byId(i.obj.userData.track)?.saveKey || null : null, phys: i.phys || null, bake: i.bake || null, pose: i.rig ? i.pose : undefined, poseKeys: i.rig && i.poseKeys.length ? i.poseKeys : undefined })) };
}
let lastSaved = "", lastServer = "", changedAt = 0, serverBusy = false, serverRetryAt = 0;
const SERVER_DELAY_MS = 5000, SERVER_RETRY_MS = 30000;
const stamped = (s) => ({ ...JSON.parse(s), at: Date.now() });
function saveNow() {
  let s; try { s = JSON.stringify(snapshot()); } catch { return; }
  if (s !== lastSaved) { lastSaved = s; changedAt = Date.now(); try { localStorage.setItem(SAVE_KEY, JSON.stringify(stamped(s))); } catch {} }
  saveToAccount(false);
}
function saveState(kind, why) {
  const el = $("saveState"); if (!el) return;
  el.className = "save" + (kind === "local" ? " local" : "");
  el.textContent = kind === "account" ? "Saved to your account" : kind === "saving" ? "Saving to your account…" : kind === "browser" ? "Saved in this browser" : "Saved in this browser only — " + (/too big/i.test(why || "") ? "too big for your account" : "couldn't reach your account");
  el.title = kind === "local" && why && why !== "unreachable" ? why : "";
}
/** Sends the latest scene to the account once changes have settled for SERVER_DELAY_MS (`now`: at once, when the Studio closes or the tab hides). */
function saveToAccount(now) {
  if (!opts.saveScene || serverBusy || !lastSaved || lastSaved === lastServer) return;
  const t = Date.now(); if (!now && (t - changedAt < SERVER_DELAY_MS || t < serverRetryAt)) return;
  const s = lastSaved; serverBusy = true; saveState("saving");
  Promise.resolve().then(() => opts.saveScene(stamped(s))).then((r) => (r && r.error === null ? { ok: true } : { ok: false, why: r && r.error }), () => ({ ok: false })).then((res) => {
    serverBusy = false;
    if (res.ok) { lastServer = s; serverRetryAt = 0; saveState(s === lastSaved ? "account" : "saving"); }
    else { serverRetryAt = Date.now() + SERVER_RETRY_MS; saveState("local", res.why); }
  });
}
const saveTimer = setInterval(saveNow, 2000);
dOn("visibilitychange", () => { if (document.hidden) { saveNow(); saveToAccount(true); } });
/** The copy to open from: the account's, unless this browser holds a newer one. */
function pickSaved() {
  let local = null; try { local = JSON.parse(localStorage.getItem(SAVE_KEY) || "null"); } catch {}
  if (!local || local.v !== 1 || !Array.isArray(local.items)) local = null;
  const acct = opts.savedScene && opts.savedScene.v === 1 && Array.isArray(opts.savedScene.items) ? opts.savedScene : null;
  if (acct && !(local && typeof local.at === "number" && local.at > (acct.at || 0))) return { data: acct, from: "account" };
  if (local) return { data: local, from: acct ? "newer" : "browser" };
  return null;
}
function restoreSaved() {
  const picked = pickSaved();
  if (!picked) { lastSaved = lastServer = JSON.stringify(snapshot()); saveState(opts.saveScene ? "account" : "browser"); return; }
  const data = picked.data;
  const keep = new Set(data.items.filter((s) => s.key).map((s) => s.key));
  items.filter((i) => i.saveKey && !keep.has(i.saveKey)).forEach((i) => detachItem(i));
  const made = [];
  for (const s of data.items) {
    let it = s.key ? items.find((i) => i.saveKey === s.key) : s.add ? addKind(s.add) : null;
    if (!it) continue; made.push([it, s]);
    it.name = s.name; it.obj.name = s.name; it.coll = s.coll; applyTRS(it.obj, s.t); it.keys = s.keys || []; it.interp = s.interp || "bezier"; it.hidden = !!s.hidden; it.obj.visible = !s.hidden; it.noRender = !!s.noRender; it.phys = s.phys || undefined; it.bake = s.bake || undefined;
    if (s.color && it.obj.userData.paint?.length) it.obj.userData.paint.forEach((m) => m.color.set(s.color));
    it.obj.userData.array = s.array || undefined; it.obj.userData.mirror = s.mirror || undefined; if (s.array || s.mirror) applyArray(it);
    // A person: its pose and pose keys; a scene saved before people (a capsule stand-in) stands where the capsule stood.
    if (it.rig) { it.pose = normalisePose(s.pose) || presetPose("stand"); it.poseKeys = normalisePoseKeys(s.poseKeys, DUR); applyPose(it.rig, it.pose); }
  }
  for (const [it, s] of made) if (s.track) { const t = items.find((i) => i.saveKey === s.track); if (t) it.obj.userData.track = t.id; }
  if (typeof data.hour === "number") setHour(data.hour); if (data.format) format = data.format; if (data.lens) setLens(data.lens); if (data.skyMode && data.skyMode !== "simple") setSkyMode(data.skyMode); if (Array.isArray(data.markers)) markers.push(...data.markers);
  undoStack.length = 0; redoStack.length = 0; evaluate(time); refreshSel(); lastSaved = JSON.stringify(snapshot());
  // Opened from the account: that copy is what the account holds. From this browser: sent up once it has settled.
  if (picked.from === "account" || !opts.saveScene) lastServer = lastSaved; else changedAt = Date.now() - SERVER_DELAY_MS;
  saveState(!opts.saveScene ? "browser" : picked.from === "account" ? "account" : "saving");
  info(picked.from === "account" ? "Your last session on this set is back · from your account" : picked.from === "newer" ? "Your last session on this set is back · from this browser, newer than your account's copy" : "Your last session on this set is back · from this browser");
}
// ================= wiring =================
// Blender renders (2026-09-29): the Render menu's two entries show only when the page hands the door in.
document.querySelectorAll("[data-cycles]").forEach((el) => (el.hidden = !opts.cycles));
const ACTS = {
  import: () => fileIn.click(), exportFile: openExport, renderStill, renderCast: openCast, tracedStill: renderTracedStill, tracedVideo: renderTracedVideo, cyclesStill: () => openCycles("still"), cyclesVideo: () => openCycles("animation"), renderVideo, undo, redo, history: openHistory, keys: openKeys, dup: duplicate, del: () => del(), key: () => keyItems(), delKey: () => delKey(), hide: () => toggleHide(),
  frameSel: () => active && frameObj(active.obj), frameAll, camView: () => toggleCam(), camToView, top: () => viewAlong(new THREE.Vector3(0, 1, 0)), front: () => viewAlong(new THREE.Vector3(0, 0, 1)), right: () => viewAlong(new THREE.Vector3(1, 0, 0)),
  selAll: () => { items.filter((i) => !i.hidden && i.kind !== "sun").forEach((i) => selection.add(i)); active = active || [...selection][0]; refreshSel(); },
  selNone: () => select(null), selInvert: () => { const all = items.filter((i) => !i.hidden && i.kind !== "sun"); const was = new Set(selection); selection.clear(); all.forEach((i) => !was.has(i) && selection.add(i)); active = [...selection][0] || null; refreshSel(); },
  modeObject: () => { exitPose(); exitEdit(); }, modeEdit: () => { exitPose(); if (!editMode) enterEdit(); }, modePose: () => enterPose(),
  selCam: () => select(shot), showAll, path: togglePath, leaves: openLeavesOut, join: joinSel, moveTo: openMoveTo, xray: toggleXray, local: toggleLocal, parent: parentTo, unparent: clearParent, sidebar: () => toggleN(),
  addAt: () => openPopup(mouse[0], mouse[1], addMenuHTML()),
  astraAbout: () => { ntab = "astra"; toggleN(true); renderN(); const i = $("astraIn"); if (i) { i.value = `About "${active?.name}": `; i.focus(); } },
  astraModel: () => { ntab = "astra"; toggleN(true); renderN(); const i = $("astraIn"); if (i) { i.value = T(PLANS[6].ask); i.focus(); } },
};
document.querySelectorAll("[data-menu]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); const l = document.querySelector(`[data-list="${b.dataset.menu}"]`); const open = l.hidden; closeMenus(); l.hidden = !open; b.setAttribute("aria-expanded", String(open)); }));
dOn("click", (e) => { if (!e.target.closest(".list")) { closeMenus(); } if (!e.target.closest("#pie")) $("pie").hidden = true; });
document.querySelectorAll(".list").forEach(wireList);
document.querySelectorAll("[data-tool]").forEach((b) => b.addEventListener("click", () => setTool(b.dataset.tool)));
document.querySelectorAll("[data-shade]").forEach((b) => b.addEventListener("click", () => setShade(b.dataset.shade)));
document.querySelectorAll("[data-pt]").forEach((b) => b.addEventListener("click", () => { ptab = b.dataset.pt; renderProps(); }));
document.querySelectorAll("[data-nt]").forEach((b) => b.addEventListener("click", () => { ntab = b.dataset.nt; renderN(); }));
document.querySelectorAll("[data-ws]").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("[data-ws]").forEach((x) => x.classList.toggle("on", x === b));
  const ws = b.dataset.ws; $("app").classList.toggle("anim", ws === "animation");
  toggleCam(ws === "shot"); ptab = ws === "shot" ? "camera" : ws === "render" ? "render" : "object"; renderProps(); setTimeout(resize, 0);
}));
$("shelfAdd").onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); openPopup(r.right + 6, r.top, addMenuHTML()); e.stopPropagation(); };
$("shelfCam").onclick = () => toggleCam(); $("navCam").onclick = () => toggleCam(); $("navZoom").onclick = frameAll; $("nBtn").onclick = () => toggleN();
$("snapBtn").onclick = () => { snapOn = !snapOn; applySnap(); info(snapOn ? "Snapping on · 0.25 m, 15°" : "Snapping off"); };
$("xrayBtn").onclick = toggleXray; $("modeBtn").onclick = (e) => { e.stopPropagation(); openModeMenu(e.currentTarget); };
$("modeBtn").title = "Object Mode / Edit Mode (Tab) / Pose Mode (Ctrl+Tab)";
$("ovlBtn").onclick = () => { overlays.visible = !overlays.visible; $("ovlBtn").classList.toggle("on", overlays.visible); };
$("rec").onclick = () => { autoKey = !autoKey; $("rec").classList.toggle("on", autoKey); info(autoKey ? "Auto keying on" : "Auto keying off"); };
$("tPlay").onclick = () => play(); $("tStart").onclick = () => setTime(0); $("tEnd").onclick = () => setTime(DUR); $("tPrevKey").onclick = () => jumpKey(-1); $("tNextKey").onclick = () => jumpKey(1);
$("find").addEventListener("input", (e) => { q = e.target.value.trim().toLowerCase(); renderOutliner(); });

wOn("keydown", (e) => {
  const tag = (e.target.tagName || "").toLowerCase(); if (tag === "input" || tag === "select" || tag === "textarea") return;
  if (astraBusy) return;
  if (modal) { modalKey(e); return; }
  const k = e.key.toLowerCase(), mod = e.metaKey || e.ctrlKey;
  if (e.key === "F3") { e.preventDefault(); openSearch(); return; }
  if (e.ctrlKey && k === " ") { e.preventDefault(); toggleMax(); return; }
  if (e.key === "Tab" && e.ctrlKey) { e.preventDefault(); togglePose(); return; }
  if (e.key === "Tab") { e.preventDefault(); if (poseMode) exitPose(); else toggleEdit(); return; }
  if (mod && k === "j") { e.preventDefault(); joinSel(); return; }
  if (e.altKey && k === "z") { e.preventDefault(); toggleXray(); return; }
  if (e.shiftKey && k === "s" && !mod) { openSnapPie(); return; }
  if (editMode && !mod) {
    if (k === "a" && !e.altKey) { uniq.forEach((_, i) => vSel.add(i)); updateEditPoints(); return; }
    if (k === "a" && e.altKey) { vSel.clear(); updateEditPoints(); return; }
    if (k === "x" || k === "delete") { toast("Deleting vertices comes with the full build; move them in Edit Mode, or delete the object in Object Mode"); return; }
    if (k === "escape") { exitEdit(); return; }
  }
  if (poseMode && !mod) {
    if (e.altKey && e.code === "KeyR") { e.preventDefault(); clearBones("rot"); return; }
    if (e.altKey && e.code === "KeyG") { e.preventDefault(); clearBones("loc"); return; }
    if (k === "i" && !e.altKey) { keyPoseCmd(poseBone ? [poseBone] : null); return; }
    if (k === "x" || k === "delete" || k === "h") { toast("Back in Object Mode (Tab) to delete or hide"); return; }
  }
  if (mod && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === "y") { e.preventDefault(); redo(); return; }
  if (e.key === "F12") { e.preventDefault(); e.ctrlKey ? renderVideo() : renderStill(); return; }
  if (mod && e.altKey && (k === "0" || e.code === "Numpad0")) { e.preventDefault(); camToView(); return; }
  if (mod && k === "p") { e.preventDefault(); parentTo(); return; }
  if (mod && k === "i") { e.preventDefault(); ACTS.selInvert(); return; }
  if (mod) return;
  if (e.altKey) { if (k === "a") ACTS.selNone(); else if (k === "h") showAll(); else if (k === "i") delKey(); else if (k === "p") clearParent(); return; }
  if (k === "a" && e.shiftKey) { openPopup(mouse[0], mouse[1], addMenuHTML()); return; }
  if (k === "d" && e.shiftKey) { duplicate(); return; }
  if (k === "g" || k === "r" || k === "s") { const m = k === "g" ? "translate" : k === "r" ? "rotate" : "scale"; if (tool !== "select") setTool(m); if (overView() && startModal(m)) return; setTool(m); }
  else if (k === "w") setTool("select");
  else if (k === "z") openPie();
  else if (k === "/") toggleLocal();
  else if (k === "m") { const t = document.querySelector(".time").getBoundingClientRect(); if (mouse[1] >= t.top && mouse[1] <= t.bottom && mouse[0] >= t.left && mouse[0] <= t.right) addMarker(); else openMoveTo(); }
  else if (k === "a") ACTS.selAll();
  else if (k === "x" || k === "delete") del();
  else if (k === "i") keyItems();
  else if (k === "t") { const r = view.getBoundingClientRect(); openPopup(mouse[0] || r.left + 60, mouse[1] || r.top + 60, document.querySelector('[data-list="interp"]').innerHTML); }
  else if (k === " ") { e.preventDefault(); play(); }
  else if (k === "0" || e.code === "Numpad0") toggleCam();
  else if (k === "." || e.code === "NumpadDecimal") active && frameObj(active.obj);
  else if (k === "home") frameAll();
  else if (k === "7") viewAlong(new THREE.Vector3(0, 1, 0)); else if (k === "1") viewAlong(new THREE.Vector3(0, 0, 1)); else if (k === "3") viewAlong(new THREE.Vector3(1, 0, 0));
  else if (k === "n") toggleN();
  else if (k === "h") toggleHide();
  else if (k === "escape") { closeMenus(); if (!$("dlg").hidden) ptBusy = false; $("dlg").hidden = true; $("pie").hidden = true; clearMeasure(); }
  else if (k === "arrowright") setTime(Math.min(DUR, time + 1 / FPS)); else if (k === "arrowleft") setTime(Math.max(0, time - 1 / FPS));
  else if (k === "arrowup") jumpKey(1); else if (k === "arrowdown") jumpKey(-1);
});
let toastT = 0; function toast(m) { const t = $("toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2600); }
function renderAll() { if (typeof updatePath === "function") updatePath(); renderOutliner(); renderProps(); renderTimeline(); renderVText(); if (ntab !== "astra") renderN(); else renderAstraSees(); }

// ================= loop =================
const bgStudio = new THREE.Color(0x3a3b3f);
function resize() { const r = view.getBoundingClientRect(); if (!r.width) return; renderer.setSize(r.width, r.height, false); editorCam.aspect = r.width / Math.max(1, r.height); editorCam.updateProjectionMatrix(); }
const resizeObs = new ResizeObserver(resize); resizeObs.observe(view); resize();

// ================= phones and tablets (stage 6, 2026-09-29) =================
// Blender-on-iPad style (STUDIO_COMPACT_QUERY): the viewport takes the
// screen; File/Edit/Render/Help sit behind one menu button; the Outliner,
// Properties, Astra and the Timeline are bottom sheets from a tab row, each
// with a grip (drag between half and full, tap to switch); menus open as
// sheets from the bottom; long-press opens the context menu; Undo, Redo and
// Search (F3) get buttons. One finger orbits (or drags the gizmo), two
// fingers pinch-zoom and pan (OrbitControls' own touch), a tap selects.
// Nothing is hidden, only moved; a desktop window is left exactly as it was.
const appEl = $("app");
let sheet = "", sheetSize = "half", compactOnce = false;
function sheetRoom() { const t = document.querySelector(".top"), m = $("mTabs"); return Math.max(200, appEl.clientHeight - (t ? t.offsetHeight : 48) - (m ? m.offsetHeight : 56)); }
function sizeSheet(px) { appEl.style.setProperty("--sheet-h", Math.round(px) + "px"); }
function showSheet(name) {
  sheet = name; appEl.dataset.sheet = sheet;
  document.querySelectorAll("#mTabs [data-sheet]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sheet === sheet)));
  if (!sheet) return;
  const h = sheetHeights(sheetRoom()); sizeSheet(sheetSize === "full" ? h.full : h.half);
  if (sheet === "astra") { ntab = "astra"; toggleN(true); renderN(); }
  else if (sheet === "props") renderProps();
  else if (sheet === "outliner") renderOutliner();
  else if (sheet === "time") renderTimeline();
}
const compactMq = matchMedia(STUDIO_COMPACT_QUERY);
function syncCompact() {
  const on = compactMq.matches; appEl.classList.toggle("compact", on); appEl.parentElement?.classList.toggle("studio-compact", on);
  if (!on) { appEl.removeAttribute("data-sheet"); appEl.style.removeProperty("--sheet-h"); sheet = ""; } else {
    // A half sheet on a phone has room for the thread and the box, not the example list too: it starts folded (one tap opens it).
    if (examplesOpen && !compactOnce) { if ($("exToggle")) $("exToggle").click(); else examplesOpen = false; }
    compactOnce = true; showSheet(sheet);
  }
  requestAnimationFrame(resize);
}
compactMq.addEventListener("change", syncCompact, { signal: ac.signal });
$("mTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-sheet]"); if (!b) return; closeMenus(); if (b.dataset.sheet !== sheet) sheetSize = "half"; showSheet(nextSheet(sheet, b.dataset.sheet)); }, { signal: ac.signal });
// The grips: drag to size, let go to settle (closed / half / full), tap to switch half ↔ full.
document.querySelectorAll("[data-grip]").forEach((g) => {
  let start = null;
  g.addEventListener("pointerdown", (e) => { e.preventDefault(); g.setPointerCapture?.(e.pointerId); const sh = g.parentElement.getBoundingClientRect().height; start = { y: e.clientY, h: sh }; }, { signal: ac.signal });
  g.addEventListener("pointermove", (e) => { if (!start) return; sizeSheet(sheetDragHeight(start.h, e.clientY - start.y, sheetRoom())); }, { signal: ac.signal });
  const end = (e) => {
    if (!start) return; const dy = e.clientY - start.y, room = sheetRoom(), h = sheetHeights(room); const was = start; start = null;
    if (Math.abs(dy) < GRIP_TAP_PX) { sheetSize = sheetSize === "full" ? "half" : "full"; sizeSheet(h[sheetSize]); return; }
    const snap = sheetSnap(sheetDragHeight(was.h, dy, room), room);
    if (snap === "closed") { showSheet(""); return; }
    sheetSize = snap; sizeSheet(h[snap]);
  };
  g.addEventListener("pointerup", end, { signal: ac.signal }); g.addEventListener("pointercancel", end, { signal: ac.signal });
  g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sheetSize = sheetSize === "full" ? "half" : "full"; sizeSheet(sheetHeights(sheetRoom())[sheetSize]); } }, { signal: ac.signal });
});
// The one menu button's list opens the top bar's own menus (as sheets from the bottom).
document.querySelector('[data-list="mmenu"]').addEventListener("click", (e) => {
  const b = e.target.closest("[data-open]"); if (!b) return; e.stopPropagation(); closeMenus();
  document.querySelector(`[data-menu="${b.dataset.open}"]`)?.click();
}, { signal: ac.signal });
wireList($("mBar"));
$("mSearch").addEventListener("click", (e) => { e.stopPropagation(); closeMenus(); openSearch(); }, { signal: ac.signal });
// Long-press (touch) = right-click: the context menu for what's under the finger.
let lpress = null, lpFired = false, swallowUntil = 0;
const lpCancel = () => { if (lpress) { clearTimeout(lpress.t); lpress = null; } };
canvas.addEventListener("pointerdown", (e) => {
  if (e.pointerType !== "touch") return;
  if (!e.isPrimary) { lpCancel(); return; }
  lpCancel(); const x = e.clientX, y = e.clientY;
  lpress = { x, y, t: setTimeout(() => { lpress = null; if (tc.dragging || modal) return; downAt = null; lpFired = true; canvas.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y })); }, LONG_PRESS_MS) };
}, { signal: ac.signal });
wOn("pointermove", (e) => { if (lpress && Math.hypot(e.clientX - lpress.x, e.clientY - lpress.y) > LONG_PRESS_SLOP_PX) lpCancel(); });
wOn("pointerup", () => { lpCancel(); if (lpFired) { lpFired = false; swallowUntil = performance.now() + 400; } }); wOn("pointercancel", () => { lpCancel(); lpFired = false; });
// The click the lifted finger makes after a long-press must not close the menu it opened.
window.addEventListener("click", (e) => { if (performance.now() < swallowUntil) { swallowUntil = 0; e.stopPropagation(); e.preventDefault(); } }, { capture: true, signal: ac.signal });
syncCompact();
function frameBox(w, h) { const a = FORMATS[format], pad = 40; let bh = h - pad * 2, bw = bh * a; if (bw > w - pad * 2) { bw = w - pad * 2; bh = bw / a; } return { x: (w - bw) / 2, y: (h - bh) / 2, w: bw, h: bh }; }
function tick(now) {
  if (stopped) return; raf = requestAnimationFrame(tick);
  if (playing) { time += (now - last) / 1000; last = now; if (time > (pEnd - 1) / FPS || time < (pStart - 1) / FPS) time = (pStart - 1) / FPS; evaluate(time); placePlayhead(); refreshOutlines(); if (Math.round(time * FPS) % 6 === 0) renderVText(); }
  orbit.update(); if (poseMode) updateBoneViz(); drawGizmo(); cursor3d.userData.face.quaternion.copy(viewCam().quaternion); { const s = viewCam().position.distanceTo(cursor3d.position) * 0.045; cursor3d.scale.setScalar(Math.max(0.2, s)); } placeMeasureLabel();
  const r = view.getBoundingClientRect(), w = r.width, h = r.height;
  scene.background = shade === "lit" ? worldBg() : bgStudio; skyObj.visible = shade === "lit" && skyMode === "physical";
  if (camView) {
    const b = frameBox(w, h), cam = shot.obj.userData.cam; cam.aspect = b.w / b.h; cam.updateProjectionMatrix();
    renderer.setScissorTest(false); renderer.setClearColor(0x1c1d20); renderer.clear();
    renderer.setScissorTest(true); renderer.setScissor(b.x, h - b.y - b.h, b.w, b.h); renderer.setViewport(b.x, h - b.y - b.h, b.w, b.h);
    const sv = shot.obj.visible, gv = helpers.visible; shot.obj.visible = false; helpers.visible = false; renderer.render(scene, cam); shot.obj.visible = sv; helpers.visible = gv;
    renderer.setScissorTest(false); renderer.setViewport(0, 0, w, h);
    Object.assign($("frame").style, { left: b.x + "px", top: b.y + "px", width: b.w + "px", height: b.h + "px" });
  } else { renderer.setViewport(0, 0, w, h); renderer.render(scene, editorCam); }
}
drawGuides();
renderN();
scene.fog = null; // haze is a World-tab choice; a whole track under it reads as fog
select(car);
{ const b = new THREE.Box3().expandByObject(car.obj).expandByObject(person.obj); const c = b.getCenter(new THREE.Vector3()), size = Math.max(6, b.getSize(new THREE.Vector3()).length()); orbit.target.copy(c); editorCam.position.copy(c.clone().add(new THREE.Vector3(0.6, 0.45, 0.75).normalize().multiplyScalar(size * 1.5))); }
restoreSaved();
raf = requestAnimationFrame(tick);

document.getElementById("sceneTitle").textContent = opts.title;
if (opts.render && $("castMenuLabel")) $("castMenuLabel").textContent = castLabel();
document.getElementById("backLink").setAttribute("href", opts.backHref);
const stopText = opts.t ? watchStudioText($("app").parentElement || document.body, opts.t) : () => {};
return () => { stopText(); saveNow(); saveToAccount(true); stopped = true; clearInterval(cast.timer); clearInterval(cy.timer); cancelAnimationFrame(raf); clearInterval(saveTimer); ac.abort(); resizeObs.disconnect(); tc.dispose?.(); orbit.dispose(); renderer.dispose(); offR?.dispose(); ptBusy = false; pt?.dispose(); ptR?.dispose(); ptWorldTex?.dispose(); ptAovT?.forEach((t) => t.dispose()); };
}
