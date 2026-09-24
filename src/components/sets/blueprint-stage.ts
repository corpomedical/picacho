// The stage's half of painting a thing's drawings onto its model
// (lib/sets/blueprint-paint.ts): the drawings cut out of the thing's photos
// in the browser (the same finding rules the build uses, thing-views.ts),
// the model seen straight on from its six sides in its own paint, the plan
// of which drawing paints which side, one atlas of the drawings turned to
// fit, and the model's materials — the stage's and the sketch's, so the
// image model is handed the painted thing — taught to read it.
//
// Browser only: canvas, WebGL. Loaded by the stage with three.js.

import type * as ThreeNS from "three";
import {
  ATLAS_COLS,
  ATLAS_ROWS,
  ATLAS_TILE,
  GRID_PX,
  PAINT_DIRS,
  PAINT_FRAGMENT_BODY,
  PAINT_FRAGMENT_HEAD,
  PAINT_VERTEX_BODY,
  PAINT_VERTEX_HEAD,
  dihedralMatrix,
  planPaint,
  sideExtent,
  type Grid,
  type PaintDir,
} from "@/lib/sets/blueprint-paint";
import { VIEW_INK_DISTANCE, VIEW_JOIN_RADIUS, VIEW_SCAN_WIDTH, borderColour, borderIsPlain, componentsOf, dilate, inkMask, pickViews } from "@/lib/sets/thing-views-find";

type Three = typeof ThreeNS;

/** A metal a drawing is painted over reads as gold and chrome where the drawing is paint: held to a satin finish. */
const PAINTED_METALNESS = 0.35;

async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode();
  return img;
}

function rgbOf(ctx: CanvasRenderingContext2D, w: number, h: number): Uint8Array {
  const data = ctx.getImageData(0, 0, w, h).data;
  const rgb = new Uint8Array(w * h * 3);
  for (let p = 0, q = 0; p < data.length; p += 4, q += 3) {
    // Transparent reads as white: a PNG drawing on nothing is a drawing on white.
    const a = data[p + 3] / 255;
    rgb[q] = Math.round(data[p] * a + 255 * (1 - a));
    rgb[q + 1] = Math.round(data[p + 1] * a + 255 * (1 - a));
    rgb[q + 2] = Math.round(data[p + 2] * a + 255 * (1 - a));
  }
  return rgb;
}

/**
 * One view cut out on nothing: everything that joins the crop's edge through
 * background-coloured pixels is background (so a white headlight INSIDE the
 * car stays car), the rest is the thing, trimmed to its own box.
 */
function cutOut(src: HTMLCanvasElement, x: number, y: number, w: number, h: number, bg: [number, number, number]): HTMLCanvasElement | null {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(src, x, y, w, h, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const isBg = (p: number) => Math.hypot(d[p * 4] - bg[0], d[p * 4 + 1] - bg[1], d[p * 4 + 2] - bg[2]) <= VIEW_INK_DISTANCE;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let i = 0; i < w; i++) stack.push(i, (h - 1) * w + i);
  for (let j = 0; j < h; j++) stack.push(j * w, j * w + w - 1);
  while (stack.length) {
    const p = stack.pop()!;
    if (seen[p] || !isBg(p)) continue;
    seen[p] = 1;
    const px = p % w;
    const py = (p - px) / w;
    if (px > 0) stack.push(p - 1);
    if (px < w - 1) stack.push(p + 1);
    if (py > 0) stack.push(p - w);
    if (py < h - 1) stack.push(p + w);
  }
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let p = 0; p < w * h; p++) {
    if (seen[p]) {
      d[p * 4 + 3] = 0;
      continue;
    }
    const px = p % w;
    const py = (p - px) / w;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  if (maxX < minX || maxX - minX < 8 || maxY - minY < 8) return null;
  ctx.putImageData(img, 0, 0);
  const out = document.createElement("canvas");
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext("2d")?.drawImage(c, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/** The drawings in a thing's photos: each clean view cut out on nothing; a photo with a real background gives none. */
export async function drawingsFrom(urls: readonly string[]): Promise<HTMLCanvasElement[]> {
  const out: HTMLCanvasElement[] = [];
  for (const url of urls) {
    let img: HTMLImageElement;
    try {
      img = await loadImage(url);
    } catch {
      continue;
    }
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    if (!W || !H) continue;
    const full = document.createElement("canvas");
    full.width = W;
    full.height = H;
    const fctx = full.getContext("2d", { willReadFrequently: true });
    if (!fctx) continue;
    fctx.fillStyle = "#ffffff";
    fctx.fillRect(0, 0, W, H);
    fctx.drawImage(img, 0, 0);
    const scale = Math.min(1, VIEW_SCAN_WIDTH / W);
    const w = Math.max(1, Math.round(W * scale));
    const h = Math.max(1, Math.round(H * scale));
    const scan = document.createElement("canvas");
    scan.width = w;
    scan.height = h;
    const sctx = scan.getContext("2d", { willReadFrequently: true });
    if (!sctx) continue;
    sctx.drawImage(full, 0, 0, w, h);
    const rgb = rgbOf(sctx, w, h);
    const bg = borderColour(rgb, w, h);
    if (!borderIsPlain(rgb, w, h, bg)) continue;
    const views = pickViews(componentsOf(dilate(inkMask(rgb, w, h, bg), w, h, VIEW_JOIN_RADIUS), w, h), w, h);
    for (const v of views) {
      const pad = 2 / scale;
      const x = Math.max(0, Math.floor(v.x / scale - pad));
      const y = Math.max(0, Math.floor(v.y / scale - pad));
      const cut = cutOut(full, x, y, Math.min(W - x, Math.ceil(v.w / scale + 2 * pad)), Math.min(H - y, Math.ceil(v.h / scale + 2 * pad)), bg);
      if (cut) out.push(cut);
    }
  }
  return out;
}

/** A canvas reduced to a matching grid: the thing where its alpha is, its colour. */
export function gridOf(src: HTMLCanvasElement): Grid {
  const k = GRID_PX / Math.max(src.width, src.height);
  const w = Math.max(1, Math.round(src.width * k));
  const h = Math.max(1, Math.round(src.height * k));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  const rgb = new Uint8Array(w * h * 3);
  for (let p = 0; p < w * h; p++) {
    mask[p] = data[p * 4 + 3] > 127 ? 1 : 0;
    rgb[p * 3] = data[p * 4];
    rgb[p * 3 + 1] = data[p * 4 + 1];
    rgb[p * 3 + 2] = data[p * 4 + 2];
  }
  return { w, h, mask, rgb };
}

/** The model seen straight on from each of its six sides, in its own unlit paint, as matching grids. */
export function renderSides(THREE: Three, renderer: ThreeNS.WebGLRenderer, model: ThreeNS.Object3D, box: ThreeNS.Box3): Map<PaintDir, Grid> {
  const out = new Map<PaintDir, Grid>();
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const reach = Math.max(size.x, size.y, size.z) * 2 + 1;
  // The model in its own frame, its own paint unlit, for these pictures only.
  const saved = { p: model.position.clone(), q: model.quaternion.clone(), s: model.scale.clone(), parent: model.parent };
  model.position.set(0, 0, 0);
  model.quaternion.identity();
  model.scale.set(1, 1, 1);
  const swapped: [ThreeNS.Mesh, ThreeNS.Material | ThreeNS.Material[]][] = [];
  const flat: ThreeNS.Material[] = [];
  model.traverse((o) => {
    const mesh = o as ThreeNS.Mesh;
    if (!mesh.isMesh) return;
    const own = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as ThreeNS.MeshStandardMaterial;
    const m = new THREE.MeshBasicMaterial({ map: own?.map ?? null, color: own?.color ?? new THREE.Color(0xffffff), side: THREE.DoubleSide });
    flat.push(m);
    swapped.push([mesh, mesh.material]);
    mesh.material = m;
  });
  const scene = new THREE.Scene();
  scene.add(model);
  model.updateMatrixWorld(true);
  const was = { target: renderer.getRenderTarget(), colour: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha() };
  try {
    for (const d of PAINT_DIRS) {
      const [ew, eh] = sideExtent(d.dir, [size.x, size.y, size.z]);
      if (ew <= 0 || eh <= 0) continue;
      const k = GRID_PX / Math.max(ew, eh);
      const w = Math.max(4, Math.round(ew * k));
      const h = Math.max(4, Math.round(eh * k));
      const target = new THREE.WebGLRenderTarget(w, h);
      const cam = new THREE.OrthographicCamera(-ew / 2, ew / 2, eh / 2, -eh / 2, 0.001, reach * 2);
      cam.up.set(...d.up);
      cam.position.set(centre.x + d.normal[0] * reach, centre.y + d.normal[1] * reach, centre.z + d.normal[2] * reach);
      cam.lookAt(centre);
      cam.updateMatrixWorld();
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(scene, cam);
      const px = new Uint8Array(w * h * 4);
      renderer.readRenderTargetPixels(target, 0, 0, w, h, px);
      target.dispose();
      const mask = new Uint8Array(w * h);
      const rgb = new Uint8Array(w * h * 3);
      // Read bottom-up; a grid runs top-down. Linear light back to sRGB, as a drawing is.
      const srgb = (v: number) => Math.round(255 * Math.pow(v / 255, 1 / 2.2));
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = ((h - 1 - y) * w + x) * 4;
          const o = y * w + x;
          mask[o] = px[i + 3] > 127 ? 1 : 0;
          rgb[o * 3] = srgb(px[i]);
          rgb[o * 3 + 1] = srgb(px[i + 1]);
          rgb[o * 3 + 2] = srgb(px[i + 2]);
        }
      }
      out.set(d.dir, { w, h, mask, rgb });
    }
  } finally {
    renderer.setRenderTarget(was.target);
    renderer.setClearColor(was.colour, was.alpha);
    scene.remove(model);
    if (saved.parent) saved.parent.add(model);
    model.position.copy(saved.p);
    model.quaternion.copy(saved.q);
    model.scale.copy(saved.s);
    model.updateMatrixWorld(true);
    for (const [mesh, m] of swapped) mesh.material = m;
    for (const m of flat) m.dispose();
  }
  return out;
}

export type Painted = { sides: PaintDir[]; dispose: () => void };

/**
 * Paint a loaded model from the thing's photos, if they hold drawings that
 * fit its sides. `model` is the loaded scene, before or after it is placed
 * (its own frame is read through its matrices); `sketchKey` is where each
 * mesh keeps the flat material the sketch draws it with. Returns the sides
 * painted (none: the model keeps its own paint), and how to let the paint go.
 */
export async function paintFromDrawings(
  THREE: Three,
  renderer: ThreeNS.WebGLRenderer,
  model: ThreeNS.Object3D,
  urls: readonly string[],
  sketchKey = "sketchMaterial",
): Promise<Painted> {
  const none: Painted = { sides: [], dispose: () => {} };
  if (urls.length === 0) return none;
  const drawings = await drawingsFrom(urls);
  if (drawings.length === 0) return none;
  // The model's own box, in its own frame.
  model.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const box = new THREE.Box3();
  model.traverse((o) => {
    const mesh = o as ThreeNS.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    mesh.geometry.computeBoundingBox();
    const b = mesh.geometry.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld));
    box.union(b);
  });
  if (box.isEmpty()) return none;
  const renders = renderSides(THREE, renderer, model, box);
  const plan = planPaint(drawings.map(gridOf), renders);
  if (plan.length === 0) return none;

  const atlas = document.createElement("canvas");
  atlas.width = ATLAS_COLS * ATLAS_TILE;
  atlas.height = ATLAS_ROWS * ATLAS_TILE;
  const actx = atlas.getContext("2d")!;
  const have = new Array<number>(6).fill(0);
  for (const p of plan) {
    const i = PAINT_DIRS.findIndex((d) => d.dir === p.dir);
    const src = drawings[p.drawing];
    const m = dihedralMatrix(p.t, src.width, src.height);
    const turned = document.createElement("canvas");
    turned.width = m.w;
    turned.height = m.h;
    const tctx = turned.getContext("2d")!;
    tctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    tctx.drawImage(src, 0, 0);
    actx.drawImage(turned, (i % ATLAS_COLS) * ATLAS_TILE, Math.floor(i / ATLAS_COLS) * ATLAS_TILE, ATLAS_TILE, ATLAS_TILE);
    have[i] = 1;
  }
  const texture = new THREE.CanvasTexture(atlas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  texture.needsUpdate = true;

  const made: ThreeNS.Material[] = [];
  const teach = (material: ThreeNS.Material, toModel: ThreeNS.Matrix4): ThreeNS.Material => {
    const m = material.clone() as ThreeNS.MeshStandardMaterial;
    if (typeof m.metalness === "number") m.metalness = Math.min(m.metalness, PAINTED_METALNESS);
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uPaintAtlas = { value: texture };
      shader.uniforms.uPaintMin = { value: box.min.clone() };
      shader.uniforms.uPaintMax = { value: box.max.clone() };
      shader.uniforms.uPaintHave = { value: have };
      shader.uniforms.uPaintToModel = { value: toModel };
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${PAINT_VERTEX_HEAD}`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>\n${PAINT_VERTEX_BODY}`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${PAINT_FRAGMENT_HEAD}`)
        .replace("#include <map_fragment>", `#include <map_fragment>\n${PAINT_FRAGMENT_BODY}`);
    };
    m.customProgramCacheKey = () => "helios-blueprint-paint";
    m.needsUpdate = true;
    made.push(m);
    return m;
  };
  model.traverse((o) => {
    const mesh = o as ThreeNS.Mesh;
    if (!mesh.isMesh) return;
    const toModel = new THREE.Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld);
    const own = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (own) mesh.material = teach(own, toModel);
    const sketch = mesh.userData[sketchKey] as ThreeNS.Material | undefined;
    if (sketch) mesh.userData[sketchKey] = teach(sketch, toModel);
  });
  return {
    sides: plan.map((p) => p.dir),
    dispose: () => {
      texture.dispose();
      for (const m of made) m.dispose();
    },
  };
}
