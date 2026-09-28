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
import * as CANNON from "cannon-es";
import { setElements } from "@/lib/sets/elements";

export type StudioOptions = { setId: string; title: string; spec: any; backHref: string };

export function startStudio(opts: StudioOptions): () => void {
const ac = new AbortController();
const withSig = (o) => (typeof o === "object" && o !== null ? { ...o, signal: ac.signal } : { capture: !!o, signal: ac.signal });
const wOn = (t, f, o) => window.addEventListener(t, f, withSig(o));
const dOn = (t, f, o) => document.addEventListener(t, f, withSig(o));
let stopped = false, raf = 0;
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
  const g = new THREE.Group(), skin = std(0xcfcac4, { roughness: 0.8 });
  g.add(mesh(new THREE.CapsuleGeometry(0.22, 0.95, 6, 16), skin, 0, 0.8, 0), mesh(new THREE.SphereGeometry(0.13, 24, 16), skin, 0, 1.6, 0), mesh(new THREE.BoxGeometry(0.04, 0.04, 0.08), skin, 0, 1.6, 0.13));
  g.userData.paint = [skin]; return g;
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
  if (tool === "select" || tool === "measure" || editMode || !sel.length) { tc.detach(); return; }
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
  group("Insert keyframe", () => list.forEach((it) => { const b = clone(it.keys); setKey(it, time); const a = clone(it.keys); push({ label: "key", undo() { it.keys = clone(b); }, redo() { it.keys = clone(a); } }); }));
  renderAll(); info(`Keyframe inserted · frame ${frameNo()}`);
}
function delKey(list = movable()) {
  let n = 0;
  group("Delete keyframe", () => list.forEach((it) => { const i = it.keys.findIndex((k) => near(k.t, time)); if (i < 0) return; n++; const b = clone(it.keys); it.keys.splice(i, 1); const a = clone(it.keys); push({ label: "del key", undo() { it.keys = clone(b); }, redo() { it.keys = clone(a); } }); }));
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
  person: { l: "Person stand-in", h: "Things", f: () => [makePerson(), "Person stand-in", "mesh", "Cast"] },
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
    const done = (ok) => { if (fin) return; fin = true; if (ok) { const n = parseFloat(inp.value); if (!Number.isNaN(n)) { onStart?.(); v = Math.min(max, Math.max(min, n)); show(v); onLive?.(v); onCommit?.(v); } } inp.remove(); show(v); };
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
    const [ep, eb] = panel("Engine"); eb.append(fr("Draft", ro("Helios viewport")), fr("Final", ro("AI render · in Picacho")));
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
];
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
    <div class="ahdr"><div class="mark">A</div><div><b>Astra</b><small>GPT-6 · builds and directs this scene</small></div></div>
    <div class="asees" id="asees"></div>
    <div class="thread" id="thread"></div>
    <div class="exh"><button class="hmenu" id="exToggle">Examples ${examplesOpen ? "▾" : "▸"}</button></div>
    <div class="chips" id="chips" ${examplesOpen ? "" : "hidden"}></div>
    <div class="ainput">
      <textarea id="astraIn" placeholder="Tell Astra what to build, change or animate…  “this” means the selected object" aria-label="Message to Astra"></textarea>
      <div class="row"><label class="check"><input type="checkbox" id="askFirst" ${askFirst ? "checked" : ""}> Show the plan before applying</label><button class="pbtn accent" id="astraSend" style="flex:none">Send ⏎</button></div>
    </div>
  </div>`;
  $("chips").innerHTML = PLANS.map((p, i) => `<button class="chip" data-plan="${i}">${esc(p.ask)}</button>`).join("");
  $("chips").onclick = (e) => { const b = e.target.closest("[data-plan]"); if (!b) return; $("astraIn").value = PLANS[+b.dataset.plan].ask; $("astraIn").focus(); };
  $("exToggle").onclick = () => { examplesOpen = !examplesOpen; $("chips").hidden = !examplesOpen; $("exToggle").textContent = `Examples ${examplesOpen ? "▾" : "▸"}`; };
  $("askFirst").onchange = (e) => (askFirst = e.target.checked);
  $("astraSend").onclick = () => sendAstra();
  $("astraIn").addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAstra(); } });
  if (!astraLog.length) astraLog.push({ who: "a", text: "I can see the whole scene, the selection and the timeline. Ask me to build, move, recolour, light or animate anything. I show every step before I take it, and ⌘Z brings it all back." });
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
  const plan = PLANS.find((p) => p.ask.toLowerCase() === text.toLowerCase().replace(/[.!]+$/, ""));
  if (!plan) { astraLog.push({ who: "a", text: "In this draft I run the examples (open Examples ▸). In Picacho I read any request, in your words and your language, and turn it into the same visible steps." }); renderThread(); return; }
  startPlan(plan, {});
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
      const r = msg.steps[i].act ? msg.steps[i].act() : null;
      if (r) { touched.add(r); flash(r); }
      msg.at = i + 1; evaluate(time); refreshOutlines(); renderOutliner(); renderThread();
      await wait(320);
    }
  } finally {
    const list = txn; txn = outer; astraMaking = false;
    if (list.length) push({ label: "Astra: " + msg.plan.ask, undo() { [...list].reverse().forEach((c) => c.undo()); }, redo() { list.forEach((c) => c.redo()); } });
    msg.undoIndex = undoStack.length - 1; astraBusy = false;
  }
  msg.state = "done";
  const keep = [...touched].filter((t) => items.includes(t) && t.kind !== "sun");
  if (keep.length) { selection.clear(); keep.forEach((k) => selection.add(k)); active = keep[keep.length - 1]; }
  info(`Astra · ${msg.steps.length} steps applied · ⌘Z undoes them together`);
  refreshSel();
}
function renderThread() {
  const th = $("thread"); if (!th) return; th.innerHTML = "";
  astraLog.forEach((m, idx) => {
    if (m.who === "u") { const d = document.createElement("div"); d.className = "msg-u"; d.textContent = m.text; th.appendChild(d); return; }
    const d = document.createElement("div"); d.className = "msg-a"; d.innerHTML = `<span class="who">Astra</span><div>${esc(m.text)}</div>`;
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
        return `<div class="step ${done ? "done" : m.state === "dry" ? "skip" : ""}"><span class="st">${done ? "✓" : now ? "…" : m.state === "dry" ? "·" : "○"}</span><span class="tx">${esc(s.tx)}</span></div>`;
      }).join("");
      d.appendChild(st);
      const code = document.createElement("div"); code.className = "code"; code.hidden = !m.showCode;
      code.innerHTML = m.steps.map((s) => esc(s.code).replace(/&lt;(\/?)(s|k|c)&gt;/g, (_, sl, t) => (sl ? "</span>" : `<span class="${t}">`))).join("\n");
      d.appendChild(code);
      const b = document.createElement("div"); b.className = "abtns";
      if (m.state === "plan") b.innerHTML = `<button class="pbtn accent" data-apply="${idx}">Apply ${m.steps.length} step${m.steps.length > 1 ? "s" : ""}</button><button class="pbtn" data-cancel="${idx}">Cancel</button>`;
      if (m.state === "done") b.innerHTML = `<button class="pbtn" data-undo="${idx}">Undo these steps</button>`;
      if (m.state !== "running") b.insertAdjacentHTML("beforeend", `<button class="pbtn" data-code="${idx}">${m.showCode ? "Hide" : "Show"} code</button>`);
      d.appendChild(b);
      if (m.state === "done" && m.plan.next?.length) {
        const nx = document.createElement("div"); nx.className = "abtns"; nx.innerHTML = `<span class="hint" style="margin:0;width:100%">Next?</span>` + m.plan.next.map((n) => `<button class="chip" data-next="${esc(n)}">${esc(n)}</button>`).join(""); d.appendChild(nx);
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
    else if (t.dataset.opt) { const [i, j] = t.dataset.opt.split(":").map(Number); const m = astraLog[i]; const pick = m.options[j]; m.state = "answered"; m.picked = pick.name; select(pick); startPlan(m.plan, { pick }); }
    else if (t.dataset.next) sendAstra(t.dataset.next);
  };
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
    li.querySelector(".nm").textContent = it.name;
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
  for (const f of new Set(items.flatMap((i) => i.keys.map((k) => Math.round(k.t * FPS))))) { const d = document.createElement("span"); d.className = "dia"; d.style.left = (f / FRAMES) * 100 + "%"; d.onclick = (e) => { e.stopPropagation(); setTime(f / FPS); }; sum.appendChild(d); }
  for (const it of items.filter((i) => i.keys.length || selection.has(i))) {
    const n = document.createElement("div"); n.className = selection.has(it) ? "sel" : ""; n.innerHTML = `<span></span><small>${it.keys.length ? it.interp : ""}</small>`; n.querySelector("span").textContent = it.name; n.onclick = (e) => select(it, e.shiftKey); names.appendChild(n);
    const lane = document.createElement("div"); lane.className = "lane" + (selection.has(it) ? " sel" : ""); lanes.appendChild(lane);
    it.keys.forEach((k) => {
      const d = document.createElement("span"); d.className = "dia" + (selection.has(it) ? " on" : "") + (it.interp === "linear" ? " lin" : it.interp === "constant" ? " con" : ""); d.style.left = (k.t / DUR) * 100 + "%";
      d.title = `${it.name} · frame ${Math.round(k.t * FPS) + 1} · drag to retime`;
      d.onpointerdown = (e) => { e.stopPropagation(); dragKey(e, it, k, d); };
      lane.appendChild(d);
    });
  }
  const ph = document.createElement("div"); ph.className = "ph"; ph.id = "ph"; ph.innerHTML = `<b></b>`; lanes.appendChild(ph);
  lanes.onpointerdown = (e) => { if (e.target.classList.contains("dia")) return; scrub(e); };
  placePlayhead();
}
function dragKey(e, it, k, d) {
  const lanes = $("tlanes"), r = lanes.getBoundingClientRect(), before = clone(it.keys), sx = e.clientX; let moved = false;
  const mv = (ev) => { if (Math.abs(ev.clientX - sx) > 3) moved = true; if (!moved) return; const t = Math.round(Math.min(DUR, Math.max(0, ((ev.clientX - r.left) / r.width) * DUR)) * FPS) / FPS; k.t = t; d.style.left = (t / DUR) * 100 + "%"; info(`Frame ${Math.round(t * FPS) + 1}`); };
  const up = () => {
    window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up);
    if (!moved) { select(it); setTime(k.t); return; }
    it.keys.sort((a, b) => a.t - b.t); const after = clone(it.keys);
    push({ label: "Move keyframe", undo() { it.keys = clone(before); }, redo() { it.keys = clone(after); } });
    evaluate(time); renderAll();
  };
  wOn("pointermove", mv); wOn("pointerup", up);
}
function placePlayhead() { if (editorType === "graph") { if (gView) renderGraph(); $("curFrame").innerHTML = `<b>${frameNo()}</b>`; return; } const ph = $("ph"); if (!ph) return; ph.style.left = (time / DUR) * 100 + "%"; ph.querySelector("b").textContent = frameNo(); $("curFrame").innerHTML = `<b>${frameNo()}</b>`; }
function scrub(e) { const lanes = $("tlanes"); const mv = (ev) => { const r = lanes.getBoundingClientRect(); setTime(Math.min(DUR, Math.max(0, ((ev.clientX - r.left) / r.width) * DUR))); }; mv(e); const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); renderAll(); }; wOn("pointermove", mv); wOn("pointerup", up); }
function setTime(t) { time = Math.round(t * FPS) / FPS; evaluate(time); refreshOutlines(); placePlayhead(); renderVText(); renderAstraSees(); propsSoon(); }
function jumpKey(dir) { const ts = [...new Set(items.flatMap((i) => i.keys.map((k) => k.t)))].sort((a, b) => a - b); const n = dir > 0 ? ts.find((t) => t > time + 1e-6) : [...ts].reverse().find((t) => t < time - 1e-6); if (n != null) setTime(n); }
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

// ================= path-traced renders (three-gpu-pathtracer) =================
// The same scene, models and materials as the viewport, traced by the GPU with real bounced light and soft shadows.
// The hemisphere fill becomes a sky-to-ground light dome, so a traced frame keeps the viewport's look.
// ptSnap: a 2D copy of each finished trace, taken in the same task it was drawn (a WebGL canvas reads back empty later on)
const ptCanvas = document.createElement("canvas"), ptSnap = document.createElement("canvas"); let ptR = null, pt = null, ptEnv = null, ptBusy = false, ptSamples = 128, ptFrameSamples = 12, ptHalf = true;
async function ptEngine(w, h) {
  if (!pt) {
    const { WebGLPathTracer, GradientEquirectTexture } = await import("three-gpu-pathtracer");
    ptR = new THREE.WebGLRenderer({ canvas: ptCanvas, antialias: false, preserveDrawingBuffer: true });
    if (!ptR.capabilities.isWebGL2) throw new Error("this browser has no WebGL 2");
    ptR.toneMapping = THREE.ACESFilmicToneMapping;
    pt = new WebGLPathTracer(ptR); Object.assign(pt, { renderDelay: 0, fadeDuration: 0, minSamples: 1, rasterizeScene: false, dynamicLowRes: false, synchronizeRenderSize: true });
    pt.bounces = 6; pt.tiles.set(2, 2); ptEnv = new GradientEquirectTexture(64);
  }
  ptR.setPixelRatio(1); ptR.setSize(w, h, false); return pt;
}
function ptPrep() {
  const hv = helpers.visible, sv = shot.obj.visible, bg = scene.background, env = scene.environment, ei = scene.environmentIntensity, ov = scene.overrideMaterial, skv = skyObj?.visible, hv2 = hemi.visible;
  const hid = items.filter((i) => i.noRender && i.obj.visible); hid.forEach((i) => (i.obj.visible = false));
  // the tracer gathers lights by their own visible flag, not their parents', so a hidden lamp would still shine
  const dark = []; items.filter((i) => !i.obj.visible).forEach((i) => i.obj.traverse((o) => { if (o.isLight && o.visible) { o.visible = false; dark.push(o); } }));
  helpers.visible = false; shot.obj.visible = false; if (skyObj) skyObj.visible = false; scene.overrideMaterial = null;
  scene.background = skyMode === "studio" ? studioBg : skyColor;
  const studio = skyMode === "studio"; ptEnv.topColor.copy(studio ? new THREE.Color(0xffffff) : hemi.color); ptEnv.bottomColor.copy(studio ? new THREE.Color(0x9a9a9a) : hemi.groundColor); ptEnv.update();
  scene.environment = ptEnv; scene.environmentIntensity = studio ? 1 : hemi.intensity; hemi.visible = false;
  return () => { helpers.visible = hv; shot.obj.visible = sv; scene.background = bg; scene.environment = env; scene.environmentIntensity = ei; scene.overrideMaterial = ov; if (skyObj) skyObj.visible = skv; hemi.visible = hv2; hid.forEach((i) => (i.obj.visible = true)); dark.forEach((o) => (o.visible = true)); };
}
const ptTick = () => new Promise((r) => setTimeout(r, 0));
async function ptTrace(w, h, samples, onSample) {
  const cam = shot.obj.userData.cam; cam.aspect = w / h; cam.updateProjectionMatrix();
  const engine = await ptEngine(w, h), restore = ptPrep();
  try {
    engine.setScene(scene, cam); engine.reset(); const t0 = performance.now(), snap = ptSnap.getContext("2d"); let lastSnap = 0; ptSnap.width = w; ptSnap.height = h;
    while (engine.samples < samples && ptBusy) {
      engine.renderSample(); if (engine.samples >= samples || performance.now() - lastSnap > 1000) { snap.drawImage(ptCanvas, 0, 0, w, h); lastSnap = performance.now(); } if (onSample) onSample(engine.samples);
      if (engine.samples < 1 && performance.now() - t0 > 60000) throw new Error("the graphics card didn't start tracing within a minute");
      await ptTick();
    }
  } finally { restore(); }
}
function ptFail(title, e) {
  ptBusy = false;
  openWin(title, `<p><b>This device can't path-trace this scene.</b> ${esc(e?.message || String(e))}.</p><p class="hint">Path tracing needs WebGL 2 with float textures, on a computer's graphics card. Render ▸ Render still and Render animation still work here, and give the same framing.</p>`);
}
function ptStop() { ptBusy = false; }
async function renderTracedStill() {
  if (ptBusy) return toast("A path-traced render is already running");
  const [w, h] = outSize();
  openWin("Helios Render · path traced still", `<div class="fr"><label>Samples</label><span id="ptSampF"></span></div><div class="row-btns"><button class="pbtn accent" id="ptGo">Trace</button><button class="pbtn" id="ptStop" disabled>Stop</button><a class="pbtn" id="ptSave" style="display:grid;place-items:center;text-decoration:none;pointer-events:none;opacity:.5" download="helios-traced-frame-${frameNo()}.png">Save image</a></div><div class="prog"><i id="prog"></i></div><p id="progTxt" style="font-family:var(--mono)"></p><div id="ptHost"></div><p class="hint">Frame ${frameNo()} through the shot camera, ${w} × ${h}. Light bounces like a real camera would see it: soft shadows, colour bleeding between surfaces, true reflections. More samples mean less grain; the picture sharpens as you watch.</p>`);
  $("ptSampF").appendChild(field(ptSamples, { step: 4, dec: 0, min: 1, max: 4096, onCommit: (v) => (ptSamples = Math.round(v)) }));
  const go = async () => {
    const save = $("ptSave"); save.style.pointerEvents = "none"; save.style.opacity = ".5";
    ptBusy = true; $("ptGo").disabled = true; $("ptStop").disabled = false; ptCanvas.style.width = "100%"; ptCanvas.style.height = "auto"; ptCanvas.style.display = "block"; $("ptHost").appendChild(ptCanvas);
    const t0 = performance.now(), n = ptSamples;
    try {
      await ptTrace(w, h, n, (s) => { const pr = $("prog"); if (pr) pr.style.width = Math.min(100, (s / n) * 100) + "%"; const tx = $("progTxt"); if (tx) tx.textContent = `Sample ${Math.floor(s)} / ${n} · ${((performance.now() - t0) / 1000).toFixed(1)} s`; });
    } catch (e) { return ptFail("Helios Render · path traced still", e); }
    const done = ptBusy; ptBusy = false; if (!$("ptGo")) return;
    $("ptGo").disabled = false; $("ptStop").disabled = true; save.href = ptSnap.toDataURL("image/png"); save.style.pointerEvents = ""; save.style.opacity = "";
    const tx = $("progTxt"); if (tx) tx.textContent = `${done ? "Done" : "Stopped"} · ${Math.floor(pt.samples)} samples · ${((performance.now() - t0) / 1000).toFixed(1)} s`;
  };
  $("ptGo").onclick = go; $("ptStop").onclick = ptStop; go();
}
async function renderTracedVideo() {
  if (ptBusy) return toast("A path-traced render is already running");
  if (!("MediaRecorder" in window)) return openWin("Helios Render", "<p>This browser can't record video. Chrome, Edge and Firefox can.</p>");
  const title = "Helios Render · path traced animation";
  openWin(title, `<div class="fr"><label>Samples per frame</label><span id="ptSampF"></span></div><div class="fr"><label>Size</label><select class="sel2" id="ptSize" aria-label="Size"><option value="half" ${ptHalf ? "selected" : ""}>Half (faster)</option><option value="full" ${ptHalf ? "" : "selected"}>Full</option></select></div><div class="row-btns"><button class="pbtn accent" id="ptGo">Trace frames ${pStart}–${pEnd}</button><button class="pbtn" id="ptStop" disabled>Stop</button></div><div class="prog"><i id="prog"></i></div><p id="progTxt" style="font-family:var(--mono)"></p><div id="ptHost"></div><p class="hint">Traces every frame of the playback range (set it on the timeline), then plays them back into a video at ${FPS} fps. Few samples per frame keep it quick and leave a little grain; the model, materials and light match the still.</p>`);
  $("ptSampF").appendChild(field(ptFrameSamples, { step: 1, dec: 0, min: 1, max: 512, onCommit: (v) => (ptFrameSamples = Math.round(v)) }));
  $("ptSize").onchange = (e) => (ptHalf = e.target.value === "half");
  $("ptStop").onclick = ptStop;
  $("ptGo").onclick = async () => {
    let [w, h] = outSize(); if (ptHalf) { w = Math.round(w / 2); h = Math.round(h / 2); }
    ptBusy = true; $("ptGo").disabled = true; $("ptStop").disabled = false; ptCanvas.style.width = "100%"; ptCanvas.style.height = "auto"; ptCanvas.style.display = "block"; $("ptHost").appendChild(ptCanvas);
    const was = time; play(false); const shots = [], total = pEnd - pStart + 1, t0 = performance.now();
    try {
      for (let f = pStart; f <= pEnd && ptBusy; f++) {
        evaluate((f - 1) / FPS); await ptTrace(w, h, ptFrameSamples);
        shots.push(await new Promise((r) => ptSnap.toBlob(r, "image/jpeg", 0.92)));
        const i = f - pStart + 1, pr = $("prog"); if (pr) pr.style.width = (i / total) * 100 + "%";
        const tx = $("progTxt"), el = (performance.now() - t0) / 1000; if (tx) tx.textContent = `Frame ${f} · ${i} / ${total} · ${el.toFixed(0)} s, about ${Math.max(0, (el / i) * (total - i)).toFixed(0)} s left`;
      }
    } catch (e) { setTime(was); return ptFail(title, e); }
    setTime(was); const stopped = !ptBusy; ptBusy = false;
    if (!shots.length || !$("ptGo")) return;
    const tx = $("progTxt"); if (tx) tx.textContent = `${stopped ? "Stopped" : "Traced"} ${shots.length} frames · recording the video at ${FPS} fps…`;
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const ctx = cv.getContext("2d"); const stream = cv.captureStream(FPS);
    const type = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
    const rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 8e6 } : undefined); const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const bitmaps = await Promise.all(shots.map((b) => createImageBitmap(b)));
    ctx.drawImage(bitmaps[0], 0, 0); rec.start();
    for (const bm of bitmaps) { ctx.drawImage(bm, 0, 0); await new Promise((r) => setTimeout(r, 1000 / FPS)); }
    rec.stop(); await new Promise((r) => (rec.onstop = r)); bitmaps.forEach((b) => b.close());
    const blob = new Blob(chunks, { type: type || "video/webm" }), url = URL.createObjectURL(blob), ext = (type || "video/webm").includes("mp4") ? "mp4" : "webm";
    openWin(title, `<video src="${url}" controls autoplay loop muted playsinline></video><div class="row-btns"><a class="pbtn accent" style="display:grid;place-items:center;text-decoration:none" download="helios-traced-${pStart}-${pEnd}.${ext}" href="${url}">Save video</a></div><p>${shots.length} path-traced frames, ${w} × ${h}, ${ptFrameSamples} samples each${stopped ? " (stopped early)" : ""}.</p>`);
  };
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

// ================= modal G / R / S (Blender) =================
const AXV = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 0, -1), z: new THREE.Vector3(0, 1, 0) };
let modal = null, pivotMode = "median";
const viewCam = () => (camView ? shot.obj.userData.cam : editorCam);
function overView() { const r = canvas.getBoundingClientRect(); return mouse[0] >= r.left && mouse[0] <= r.right && mouse[1] >= r.top && mouse[1] <= r.bottom; }
function screenOf(v) { const r = canvas.getBoundingClientRect(), p = v.clone().project(viewCam()); return [r.left + ((p.x + 1) / 2) * r.width, r.top + ((1 - p.y) / 2) * r.height, p.z]; }
function startModal(mode) {
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
    const axis = m.axis ? AXV[m.axis].clone() : new THREE.Vector3(); if (!m.axis) cam.getWorldDirection(axis).negate();
    q = new THREE.Quaternion().setFromAxisAngle(axis, a);
    label = `Rotate${m.axis ? " " + m.axis.toUpperCase() : ""}  ${THREE.MathUtils.radToDeg(a).toFixed(1)}°`;
  } else {
    const d0 = Math.hypot(m.sx - m.cx, m.sy - m.cy) || 1; let f = typedV !== null ? typedV : Math.hypot(mouse[0] - m.cx, mouse[1] - m.cy) / d0;
    if (snapOn && typedV === null) f = Math.max(0.05, Math.round(f * 10) / 10);
    fv = m.axis ? new THREE.Vector3(m.axis === "x" ? f : 1, m.axis === "z" ? f : 1, m.axis === "y" ? f : 1) : new THREE.Vector3(f, f, f);
    label = `Scale${m.axis ? " " + m.axis.toUpperCase() : ""}  ${f.toFixed(3)}`;
  }
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
    ["Toggle motion path", togglePath], ["Toggle sidebar", () => toggleN()], ["Maximize viewport", toggleMax], ["Render still", renderStill], ["Render animation", renderVideo], ["Render: path traced still", renderTracedStill], ["Render: path traced animation", renderTracedVideo], ["Physics: simulate", () => simulatePhys()], ["Physics: bake to keyframes", bakePhys], ["Physics: clear bake", clearBake], ["Import 3D model", () => fileIn.click()], ["Export (GLB, OBJ, STL) + print check", openExport],
    ["Edit Mode (vertices)", toggleEdit], ["Join", joinSel], ["Move to collection", openMoveTo], ["X-ray", toggleXray], ["Local view", toggleLocal], ["Snap menu (3D cursor)", openSnapPie], ["Add marker", addMarker], ["Graph Editor", () => setEditor("graph")], ["Timeline", () => setEditor("timeline")], ["Pivot: 3D cursor", () => setPivot("cursor")], ["Pivot: median point", () => setPivot("median")], ["Pivot: individual origins", () => setPivot("individual")], ["Orientation: Local", () => setOrient("local")], ["Orientation: Global", () => setOrient("world")], ["World: physical sky", () => setSkyMode("physical")], ["World: studio lighting", () => setSkyMode("studio")], ["What Helios leaves out", openLeavesOut],
    ["Shading: Rendered", () => setShade("lit")], ["Shading: Solid", () => setShade("clay")], ["Shading: Wireframe", () => setShade("wire")],
  ];
  for (const [k, d] of Object.entries(ADD)) c.push(["Add " + d.l, () => addUI(k)]);
  return c;
}
function openSearch() {
  const p = $("popup"); p.hidden = false; p.innerHTML = `<input class="srch" id="srch" placeholder="Search commands, or ask Astra…" aria-label="Search commands"><div id="srchList"></div>`;
  const r = view.getBoundingClientRect(); p.style.left = r.left + r.width / 2 - 170 + "px"; p.style.top = r.top + 40 + "px"; p.style.width = "340px";
  const inp = $("srch"), list = $("srchList"); let hits = [];
  const draw = () => {
    const qq = inp.value.trim().toLowerCase(); hits = commands().filter(([n]) => !qq || n.toLowerCase().includes(qq)).slice(0, 10);
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


// ================= saving (this browser, per set) =================
const SAVE_KEY = "helios.studio." + opts.setId;
function snapshot() {
  return { v: 1, hour, format, lens: shot.obj.userData.lensMm, skyMode, markers, items: items.filter((i) => i.kind !== "sun" && (i.saveKey || i.addKind)).map((i) => ({ key: i.saveKey || null, add: i.addKind || null, name: i.name, coll: i.coll, t: trs(i.obj), keys: i.keys, interp: i.interp, hidden: i.hidden, noRender: !!i.noRender, color: i.obj.userData.paint?.[0] ? "#" + i.obj.userData.paint[0].color.getHexString() : null, array: i.obj.userData.array || null, mirror: i.obj.userData.mirror || null, track: i.obj.userData.track ? byId(i.obj.userData.track)?.saveKey || null : null, phys: i.phys || null, bake: i.bake || null })) };
}
let lastSaved = "";
function saveNow() { try { const s = JSON.stringify(snapshot()); if (s !== lastSaved) { localStorage.setItem(SAVE_KEY, s); lastSaved = s; } } catch {} }
const saveTimer = setInterval(saveNow, 2000);
function restoreSaved() {
  let data = null; try { data = JSON.parse(localStorage.getItem(SAVE_KEY) || "null"); } catch {}
  if (!data || data.v !== 1) return;
  const keep = new Set(data.items.filter((s) => s.key).map((s) => s.key));
  items.filter((i) => i.saveKey && !keep.has(i.saveKey)).forEach((i) => detachItem(i));
  const made = [];
  for (const s of data.items) {
    let it = s.key ? items.find((i) => i.saveKey === s.key) : s.add ? addKind(s.add) : null;
    if (!it) continue; made.push([it, s]);
    it.name = s.name; it.obj.name = s.name; it.coll = s.coll; applyTRS(it.obj, s.t); it.keys = s.keys || []; it.interp = s.interp || "bezier"; it.hidden = !!s.hidden; it.obj.visible = !s.hidden; it.noRender = !!s.noRender; it.phys = s.phys || undefined; it.bake = s.bake || undefined;
    if (s.color && it.obj.userData.paint?.length) it.obj.userData.paint.forEach((m) => m.color.set(s.color));
    it.obj.userData.array = s.array || undefined; it.obj.userData.mirror = s.mirror || undefined; if (s.array || s.mirror) applyArray(it);
  }
  for (const [it, s] of made) if (s.track) { const t = items.find((i) => i.saveKey === s.track); if (t) it.obj.userData.track = t.id; }
  if (typeof data.hour === "number") setHour(data.hour); if (data.format) format = data.format; if (data.lens) setLens(data.lens); if (data.skyMode && data.skyMode !== "simple") setSkyMode(data.skyMode); if (Array.isArray(data.markers)) markers.push(...data.markers);
  undoStack.length = 0; redoStack.length = 0; evaluate(time); refreshSel(); lastSaved = JSON.stringify(snapshot()); info("Your last session on this set is back · saved in this browser");
}
// ================= wiring =================
const ACTS = {
  import: () => fileIn.click(), exportFile: openExport, renderStill, tracedStill: renderTracedStill, tracedVideo: renderTracedVideo, renderVideo, undo, redo, history: openHistory, keys: openKeys, dup: duplicate, del: () => del(), key: () => keyItems(), delKey: () => delKey(), hide: () => toggleHide(),
  frameSel: () => active && frameObj(active.obj), frameAll, camView: () => toggleCam(), camToView, top: () => viewAlong(new THREE.Vector3(0, 1, 0)), front: () => viewAlong(new THREE.Vector3(0, 0, 1)), right: () => viewAlong(new THREE.Vector3(1, 0, 0)),
  selAll: () => { items.filter((i) => !i.hidden && i.kind !== "sun").forEach((i) => selection.add(i)); active = active || [...selection][0]; refreshSel(); },
  selNone: () => select(null), selInvert: () => { const all = items.filter((i) => !i.hidden && i.kind !== "sun"); const was = new Set(selection); selection.clear(); all.forEach((i) => !was.has(i) && selection.add(i)); active = [...selection][0] || null; refreshSel(); },
  selCam: () => select(shot), showAll, path: togglePath, leaves: openLeavesOut, join: joinSel, moveTo: openMoveTo, xray: toggleXray, local: toggleLocal, parent: parentTo, unparent: clearParent, sidebar: () => toggleN(),
  addAt: () => openPopup(mouse[0], mouse[1], addMenuHTML()),
  astraAbout: () => { ntab = "astra"; toggleN(true); renderN(); const i = $("astraIn"); if (i) { i.value = `About "${active?.name}": `; i.focus(); } },
  astraModel: () => { ntab = "astra"; toggleN(true); renderN(); const i = $("astraIn"); if (i) { i.value = PLANS[6].ask; i.focus(); } },
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
$("xrayBtn").onclick = toggleXray; $("modeBtn").onclick = toggleEdit;
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
  if (e.key === "Tab") { e.preventDefault(); toggleEdit(); return; }
  if (mod && k === "j") { e.preventDefault(); joinSel(); return; }
  if (e.altKey && k === "z") { e.preventDefault(); toggleXray(); return; }
  if (e.shiftKey && k === "s" && !mod) { openSnapPie(); return; }
  if (editMode && !mod) {
    if (k === "a" && !e.altKey) { uniq.forEach((_, i) => vSel.add(i)); updateEditPoints(); return; }
    if (k === "a" && e.altKey) { vSel.clear(); updateEditPoints(); return; }
    if (k === "x" || k === "delete") { toast("Deleting vertices comes with the full build; move them in Edit Mode, or delete the object in Object Mode"); return; }
    if (k === "escape") { exitEdit(); return; }
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
function frameBox(w, h) { const a = FORMATS[format], pad = 40; let bh = h - pad * 2, bw = bh * a; if (bw > w - pad * 2) { bw = w - pad * 2; bh = bw / a; } return { x: (w - bw) / 2, y: (h - bh) / 2, w: bw, h: bh }; }
function tick(now) {
  if (stopped) return; raf = requestAnimationFrame(tick);
  if (playing) { time += (now - last) / 1000; last = now; if (time > (pEnd - 1) / FPS || time < (pStart - 1) / FPS) time = (pStart - 1) / FPS; evaluate(time); placePlayhead(); refreshOutlines(); if (Math.round(time * FPS) % 6 === 0) renderVText(); }
  orbit.update(); drawGizmo(); cursor3d.userData.face.quaternion.copy(viewCam().quaternion); { const s = viewCam().position.distanceTo(cursor3d.position) * 0.045; cursor3d.scale.setScalar(Math.max(0.2, s)); } placeMeasureLabel();
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
document.getElementById("backLink").setAttribute("href", opts.backHref);
return () => { saveNow(); stopped = true; cancelAnimationFrame(raf); clearInterval(saveTimer); ac.abort(); resizeObs.disconnect(); tc.dispose?.(); orbit.dispose(); renderer.dispose(); offR?.dispose(); ptBusy = false; pt?.dispose(); ptR?.dispose(); };
}
