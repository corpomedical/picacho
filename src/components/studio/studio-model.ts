// Real 3D models in Helios Studio (2026-09-30, operator: "Apply this look for
// the car." · "I also want to see it rendered in 3d."): the parts of the
// engine's model work that can be held to tests — putting a model where a
// thing's blocks stand (the set page's own fit, thing-model.ts), falling back
// to the blocks when it can't load, the photo → build press through the set
// page's own doors, and keeping an imported file. The engine (studio-engine.ts)
// calls these; the doors are handed in by helios-studio.tsx.
//
// Relative imports only: vitest has no "@/" alias.

import { fitThingModel, modelUrlAllowed } from "../../lib/sets/thing-model";
import { STUDIO_PHOTO_MAX_DATA_URI_CHARS, cropOut, dominantColour, studioPhotoPayload, type Crop, type StudioBuildTarget } from "../../lib/sets/studio-models";
import { VIEW_JOIN_RADIUS, VIEW_SCAN_WIDTH, borderColour, borderIsPlain, componentsOf, dilate, inkMask, pickViews, type Box } from "../../lib/sets/thing-views-find";

type Three = typeof import("three");
type Obj = import("three").Object3D;

/** The blocks a thing is drawn from: the group's own meshes — never an object parented to it, an Array/Mirror copy or a model. */
export function blocksOf(obj: Obj): Obj[] {
  return obj.children.filter((c) => !c.userData.isItem && !c.userData.isArray && !c.userData.isMirror && !c.userData.modelHolder);
}

/**
 * A model placed where a thing's blocks stand, the set page's way
 * (set-view.tsx setThingModels → fitThingModel): the blocks' length, on their
 * ground, along their axis, turned round when `flip`. The holder is a child of
 * the thing's group, which stands at `home` (the group's own place when the
 * set was drawn), so moving or keying the thing moves the model with it.
 */
export function holderForThing(THREE: Three, root: Obj, el: { min: number[]; max: number[] }, flip: boolean, home: readonly number[]): Obj {
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) throw new Error("empty model");
  const fit = fitThingModel({ min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] }, { min: el.min as [number, number, number], max: el.max as [number, number, number] }, flip);
  root.rotation.y = fit.turnDeg * (Math.PI / 180);
  root.scale.setScalar(fit.scale);
  root.position.set(fit.offset[0], fit.offset[1], fit.offset[2]);
  const holder = new THREE.Group();
  holder.userData.modelHolder = true;
  holder.position.set(fit.at[0] - home[0], fit.at[1] - home[1], fit.at[2] - home[2]);
  holder.add(root);
  return holder;
}

/**
 * A model on an object of its own (an import, or a new object built from a
 * photo): standing on the ground at the object's middle. `longest` (metres)
 * sizes it — a photo's model comes about a metre long; without it, a file in
 * sensible units stays as it is and one far too big or small is brought to 4.5 m.
 */
export function holderLoose(THREE: Three, root: Obj, longest?: number): Obj {
  const b = new THREE.Box3().setFromObject(root);
  if (b.isEmpty()) throw new Error("empty model");
  const s = b.getSize(new THREE.Vector3());
  const m = Math.max(s.x, s.y, s.z);
  if (longest && longest > 0 && m > 0) root.scale.multiplyScalar(longest / m);
  else if (m > 30 || (m > 0 && m < 0.2)) root.scale.multiplyScalar(4.5 / m);
  const b2 = new THREE.Box3().setFromObject(root);
  const c2 = b2.getCenter(new THREE.Vector3());
  root.position.x -= c2.x;
  root.position.z -= c2.z;
  root.position.y -= b2.min.y;
  const holder = new THREE.Group();
  holder.userData.modelHolder = true;
  holder.add(root);
  return holder;
}

/**
 * The model in place of what the object was drawn from: its blocks come off
 * (kept, to come back) and any older model goes; objects parented to it stay.
 * Every mesh casts and takes shadows, as the stage's do.
 */
export function swapInModel(obj: Obj, holder: Obj, kept: { blocks: Obj[] | null }): void {
  for (const c of obj.children.filter((c) => c.userData.modelHolder)) obj.remove(c);
  const blocks = blocksOf(obj);
  if (blocks.length) kept.blocks = [...(kept.blocks ?? []), ...blocks];
  for (const b of blocks) obj.remove(b);
  holder.traverse((o) => {
    const mesh = o as import("three").Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  obj.add(holder);
}

/** Back to the blocks (the model gone, or never loaded). */
export function backToBlocks(obj: Obj, kept: { blocks: Obj[] | null }): void {
  for (const c of obj.children.filter((c) => c.userData.modelHolder)) obj.remove(c);
  for (const b of kept.blocks ?? []) if (!b.parent) obj.add(b);
  kept.blocks = null;
}

/**
 * Load a model and put it in place, or leave the object exactly as it was:
 * "model" when it is drawn from the model now, "blocks" when the address isn't
 * one we serve, the file won't load, or it holds nothing.
 */
export async function showModel(input: {
  THREE: Three;
  load: (url: string) => Promise<{ scene: Obj }>;
  obj: Obj;
  url: string;
  kept: { blocks: Obj[] | null };
  place: (root: Obj) => Obj;
  onError?: (err: unknown) => void;
}): Promise<"model" | "blocks"> {
  if (!modelUrlAllowed(input.url)) {
    input.onError?.(new Error("not a model address the Studio loads"));
    return "blocks";
  }
  try {
    const gltf = await input.load(input.url);
    const holder = input.place(gltf.scene);
    swapInModel(input.obj, holder, input.kept);
    return "model";
  } catch (err) {
    input.onError?.(err);
    return "blocks";
  }
}

/** The model's own main colour, from its textures (or its materials' colours): for the words, when no photo said it. */
export function modelPixels(root: Obj): { data: Uint8ClampedArray; width: number; height: number } | null {
  if (typeof document === "undefined") return null;
  const S = 48;
  const images: CanvasImageSource[] = [];
  const colours: number[][] = [];
  root.traverse((o) => {
    const mesh = o as import("three").Mesh;
    if (!mesh.isMesh) return;
    for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as import("three").MeshStandardMaterial[]) {
      const img = m?.map?.image as CanvasImageSource | undefined;
      if (img && images.length < 4) images.push(img);
      else if (m?.color) colours.push([m.color.r, m.color.g, m.color.b]);
    }
  });
  const c = document.createElement("canvas");
  const n = Math.max(1, images.length);
  c.width = S * n + (colours.length ? 8 : 0);
  c.height = S;
  const x = c.getContext("2d", { willReadFrequently: true });
  if (!x) return null;
  x.fillStyle = "#ffffff";
  x.fillRect(0, 0, c.width, c.height);
  images.forEach((img, i) => {
    try {
      x.drawImage(img, i * S, 0, S, S);
    } catch {
      // A texture that can't be drawn here is left out.
    }
  });
  if (colours.length && !images.length) {
    const [r, g, b] = colours[0].map((v) => Math.round(Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2) * 255));
    x.fillStyle = `rgb(${r},${g},${b})`;
    x.fillRect(8, 8, S - 16, S - 16);
  }
  return { data: x.getImageData(0, 0, c.width, c.height).data, width: c.width, height: c.height };
}

// ---------------------------------------------------------------------------
// The press: a photo → the set page's build → a model
// ---------------------------------------------------------------------------

export type ModelBuildPhase = "photo" | "building" | "placing";

type Err = { error: string };
type Handle = { requestId: string; statusUrl: string; responseUrl: string };

export type ModelBuildDoors = {
  addPhoto: (setId: string, input: { photoDataUri: string; element: string }) => Promise<Err | { error: null; photo: { refId: string } }>;
  startThing: (setId: string, key: string, input?: { refId?: string }) => Promise<Err | { error: null; key: string; handle: Handle }>;
  pollThing: (setId: string, input: { key: string; handle: unknown }) => Promise<Err | { error: null; state: "working" } | { error: null; state: "done"; model: { key: string; url: string; flip: boolean } }>;
  startNew: (setId: string, input: { photoDataUri: string }) => Promise<Err | { error: null; handle: Handle }>;
  pollNew: (setId: string, input: { handle: unknown }) => Promise<Err | { error: null; state: "working" } | { error: null; state: "done"; file: string; url: string }>;
  alive: () => boolean;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  waitMs: number;
  pollMs: number;
  /** The words for a build that ran past waitMs, or a press that couldn't be sent. */
  failed: string;
  unreachable: string;
};

export type ModelBuildAnswer =
  | { error: string }
  | { error: null; thing: { key: string; url: string; flip: boolean } }
  | { error: null; file: { file: string; url: string } };

/**
 * One build, the set page's way (set-view.tsx buildModel): a thing's photo
 * goes onto the thing (addElementPhoto — the upload's own checks), then the
 * build is started from THAT photo only (startThingBuild's refId) and asked
 * after every pollMs until done; a new object's photo goes to its own build
 * (startNewModelBuild). A door that throws is said as unreachable; nothing is
 * sent twice.
 */
export async function pressModelBuild(d: ModelBuildDoors, setId: string, target: StudioBuildTarget, photoDataUri: string, onPhase: (p: ModelBuildPhase) => void): Promise<ModelBuildAnswer> {
  const payload = studioPhotoPayload(target, photoDataUri);
  if (!payload) return { error: d.failed };
  try {
    onPhase("photo");
    if (payload.kind === "thing") {
      const added = await d.addPhoto(setId, { photoDataUri: payload.photoDataUri, element: payload.element });
      if (added.error !== null) return { error: added.error };
      const started = await d.startThing(setId, payload.element, { refId: added.photo.refId });
      if (started.error !== null) return { error: started.error };
      onPhase("building");
      const deadline = d.now() + d.waitMs;
      while (d.alive() && d.now() < deadline) {
        await d.sleep(d.pollMs);
        const res = await d.pollThing(setId, { key: started.key, handle: started.handle });
        if (res.error !== null) return { error: res.error };
        if (res.state === "done") {
          onPhase("placing");
          return { error: null, thing: res.model };
        }
      }
      return { error: d.failed };
    }
    const started = await d.startNew(setId, { photoDataUri: payload.photoDataUri });
    if (started.error !== null) return { error: started.error };
    onPhase("building");
    const deadline = d.now() + d.waitMs;
    while (d.alive() && d.now() < deadline) {
      await d.sleep(d.pollMs);
      const res = await d.pollNew(setId, { handle: started.handle });
      if (res.error !== null) return { error: res.error };
      if (res.state === "done") {
        onPhase("placing");
        return { error: null, file: { file: res.file, url: res.url } };
      }
    }
    return { error: d.failed };
  } catch {
    return { error: d.unreachable };
  }
}

// ---------------------------------------------------------------------------
// The prompt bar's 3D Model press (2026-10-01): any engine of model-engines.ts
// ---------------------------------------------------------------------------

export type EngineBuildStart = {
  engine: string;
  kind: "text" | "image" | "multi";
  prompt: string;
  images: Partial<Record<"front" | "back" | "left" | "right", string>>;
  options: unknown;
  target: { key: string } | { new: true };
};

export type EngineBuildDoors = {
  start: (setId: string, input: EngineBuildStart & { pressId: string }) => Promise<Err | { error: null; engine: string; kind: EngineBuildStart["kind"]; rig: boolean; key: string | null; handle: Handle; usd: number }>;
  poll: (
    setId: string,
    input: { engine: string; kind: EngineBuildStart["kind"]; rig: boolean; key: string | null; handle: unknown },
  ) => Promise<Err | { error: null; state: "working" } | { error: null; state: "done"; thing: { key: string; url: string; flip: boolean } } | { error: null; state: "done"; file: string; url: string }>;
  alive: () => boolean;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  waitMs: number;
  pollMs: number;
  failed: string;
  unreachable: string;
};

/**
 * One prompt-bar build: started once under `pressId` (taken by the caller before anything else, so a resend of the
 * same press is answered with the same build — model-actions.ts startStudioModelBuild's ticket), then asked after
 * every pollMs until it lands. A door that throws on the start is followed by asking the start again with the SAME
 * press id once (never a second build); a poll that throws is simply asked again.
 */
export async function pressEngineBuild(d: EngineBuildDoors, setId: string, pressId: string, input: EngineBuildStart, onPhase: (p: ModelBuildPhase) => void): Promise<ModelBuildAnswer> {
  onPhase("photo");
  let started: Awaited<ReturnType<EngineBuildDoors["start"]>> | null = null;
  for (let i = 0; i < 2 && started === null; i++) {
    try {
      started = await d.start(setId, { ...input, pressId });
    } catch {
      started = null;
    }
  }
  if (started === null) return { error: d.unreachable };
  if (started.error !== null) return { error: started.error };
  onPhase("building");
  const ask = { engine: started.engine, kind: started.kind, rig: started.rig, key: started.key, handle: started.handle };
  const deadline = d.now() + d.waitMs;
  while (d.alive() && d.now() < deadline) {
    await d.sleep(d.pollMs);
    let res: Awaited<ReturnType<EngineBuildDoors["poll"]>>;
    try {
      res = await d.poll(setId, ask);
    } catch {
      continue;
    }
    if (res.error !== null) return { error: res.error };
    if (res.state === "done") {
      onPhase("placing");
      return "thing" in res ? { error: null, thing: res.thing } : { error: null, file: { file: res.file, url: res.url } };
    }
  }
  return { error: d.failed };
}

/** A photo for a multi-view build, kept small enough that four of them fit one request (≈ 800 KB each as sent). */
export const BAR_VIEW_MAX_CHARS = 800_000;

/** The whole photo as a view: cropPhoto's white margin and size, then compressed until it fits `maxChars`. */
export function viewPhoto(img: HTMLImageElement, maxChars = BAR_VIEW_MAX_CHARS): { dataUri: string; colour: string | null } {
  const W = img.naturalWidth, H = img.naturalHeight;
  const first = cropPhoto(img, { x: 0, y: 0, w: W, h: H });
  if (first.dataUri.length <= maxChars) return first;
  // Too big: drawn again at a smaller size, stepping the quality down.
  const s = Math.min(1, 1280 / Math.max(W, H));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(W * s));
  c.height = Math.max(1, Math.round(H * s));
  const x = c.getContext("2d");
  if (!x) return first;
  x.fillStyle = "#ffffff";
  x.fillRect(0, 0, c.width, c.height);
  x.drawImage(img, 0, 0, c.width, c.height);
  let dataUri = c.toDataURL("image/jpeg", 0.85);
  for (const q of [0.75, 0.6, 0.45]) if (dataUri.length > maxChars) dataUri = c.toDataURL("image/jpeg", q);
  return { dataUri, colour: first.colour };
}

// ---------------------------------------------------------------------------
// An imported file, kept (studio-model-actions.ts)
// ---------------------------------------------------------------------------

export type KeepImportDoors = {
  reserve: (setId: string, input: { size: number }) => Promise<Err | { error: null; path: string; token: string }>;
  upload: (path: string, token: string, file: Blob) => Promise<{ error: unknown }>;
  keep: (setId: string, input: { path: string }) => Promise<Err | { error: null; file: string; url: string }>;
  failed: string;
};

/** The file to storage at an address made for it (never through our server), then kept if it is a model. */
export async function keepStudioImport(d: KeepImportDoors, setId: string, file: Blob): Promise<Err | { error: null; file: string; url: string }> {
  try {
    const place = await d.reserve(setId, { size: file.size });
    if (place.error !== null) return { error: place.error };
    const up = await d.upload(place.path, place.token, file);
    if (up.error) return { error: d.failed };
    return await d.keep(setId, { path: place.path });
  } catch {
    return { error: d.failed };
  }
}

// ---------------------------------------------------------------------------
// The photo in the browser: its views, and the crop that is sent
// ---------------------------------------------------------------------------

/**
 * The separate objects on a photo, in its own pixels, largest first — the
 * server's own finding (thing-views.ts findViews), run here on a canvas so the
 * window can say "a sheet with 4 views" and put the box round one. Empty for
 * an ordinary photo (no plain background).
 */
export function viewsOfImage(img: CanvasImageSource, naturalW: number, naturalH: number): Box[] {
  if (typeof document === "undefined" || !naturalW || !naturalH) return [];
  const scale = Math.min(1, VIEW_SCAN_WIDTH / naturalW);
  const width = Math.max(1, Math.round(naturalW * scale));
  const height = Math.max(1, Math.round(naturalH * scale));
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const x = c.getContext("2d", { willReadFrequently: true });
  if (!x) return [];
  x.fillStyle = "#ffffff";
  x.fillRect(0, 0, width, height);
  x.drawImage(img, 0, 0, width, height);
  const rgba = x.getImageData(0, 0, width, height).data;
  const rgb = new Uint8Array(width * height * 3);
  for (let p = 0, q = 0; p < rgba.length; p += 4, q += 3) {
    rgb[q] = rgba[p];
    rgb[q + 1] = rgba[p + 1];
    rgb[q + 2] = rgba[p + 2];
  }
  const bg = borderColour(rgb, width, height);
  if (!borderIsPlain(rgb, width, height, bg)) return [];
  const views = pickViews(componentsOf(dilate(inkMask(rgb, width, height, bg), width, height, VIEW_JOIN_RADIUS), width, height), width, height);
  return views.map((b) => ({ x: Math.round(b.x / scale), y: Math.round(b.y / scale), w: Math.round(b.w / scale), h: Math.round(b.h / scale), area: Math.round(b.area / (scale * scale)) }));
}

/** The crop as the JPEG the build is sent (white round it, at least 640 px on its short side — cropOut), and its main colour. */
export function cropPhoto(img: CanvasImageSource, crop: Crop): { dataUri: string; colour: string | null } {
  const out = cropOut(crop);
  const c = document.createElement("canvas");
  c.width = out.width;
  c.height = out.height;
  const x = c.getContext("2d", { willReadFrequently: true });
  if (!x) throw new Error("no canvas");
  x.fillStyle = "#ffffff";
  x.fillRect(0, 0, out.width, out.height);
  x.imageSmoothingQuality = "high";
  x.drawImage(img, crop.x, crop.y, crop.w, crop.h, out.draw.x, out.draw.y, out.draw.w, out.draw.h);
  const px = x.getImageData(0, 0, out.width, out.height);
  // Within the build's byte cap (MAX_SET_PHOTO_BYTES): a busy photo is sent a little more compressed rather than refused.
  let dataUri = c.toDataURL("image/jpeg", 0.92);
  for (const q of [0.85, 0.75, 0.6]) if (dataUri.length > STUDIO_PHOTO_MAX_DATA_URI_CHARS) dataUri = c.toDataURL("image/jpeg", q);
  return { dataUri, colour: dominantColour(px.data, out.width, out.height) };
}
