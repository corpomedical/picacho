// Real 3D models in Helios Studio (2026-09-30, operator: "Apply this look for
// the car." · "I also want to see it rendered in 3d."). He sent a four-view
// sheet of a yellow supercar (side, front, top, back, on white). Until now the
// Studio drew a set's things from their blocks only, its "Model from a photo"
// was a scripted example, and a model imported from a file was gone when the
// Studio closed.
//
// Now:
//  - a thing that has a model kept with the set (thing-model.ts — built from
//    its photo or loaded from a file on the set page) is drawn from that model
//    in the Studio, fitted the way the set page fits it;
//  - "Model from a photo" builds one through the set page's own build
//    (model-actions.ts: the same endpoint, price, hourly limit and admin gate),
//    from ONE view the person picks — on a sheet, a box dragged around it;
//  - models are kept in the saved scene as a REFERENCE: a thing's kept model by
//    the thing's key, or a file the Studio uploaded by its storage path. Never
//    the file itself (the scene is capped at 512 KB), never a signed address
//    (it is signed afresh on every open).
//
// Pure and relative-import only: the tests, the engine and the server share it.

import { THING_BUILD_USD } from "./thing-build";
import type { Box } from "./thing-views-find";

// ---------------------------------------------------------------------------
// Files the Studio keeps (imports, and models built for a new object)
// ---------------------------------------------------------------------------

/** Between the set's id and the file's own name: never a thing model's `.model.`, so the two lists never mix. */
export const STUDIO_MODEL_INFIX = ".studio-model.";

/** A kept Studio model's name after the infix: when (base 36) and a random id. */
export const STUDIO_MODEL_NAME = /^([0-9a-z]{1,10})\.([0-9a-f]{16})\.glb$/;

/** Every Studio model of a set starts with this, in the owner's own sets folder. */
export function studioModelPrefix(setId: string): string {
  return `${setId}${STUDIO_MODEL_INFIX}`;
}

/** Where a Studio model is kept: its owner's folder, its set, when, and an id of its own. */
export function studioModelPath(userId: string, setId: string, stamp: number, id: string): string {
  return `${userId}/sets/${studioModelPrefix(setId)}${Math.max(0, Math.floor(stamp)).toString(36)}.${id}.glb`;
}

/** Whether a path is one of this person's Studio models of this set — nothing else is signed or kept through here. */
export function ownStudioModelPath(userId: string, setId: string, path: unknown): path is string {
  if (typeof path !== "string" || path.length > 300) return false;
  const head = `${userId}/sets/${studioModelPrefix(setId)}`;
  return path.startsWith(head) && STUDIO_MODEL_NAME.test(path.slice(head.length));
}

// ---------------------------------------------------------------------------
// The reference a saved scene keeps
// ---------------------------------------------------------------------------

const THING_KEY = /^[cvo]_[0-9a-f]{8}_-?\d{1,4}_-?\d{1,4}$/;
const HEX = /^#[0-9a-f]{6}$/i;

/**
 * A model as the saved scene keeps it: a thing's kept model (its key, turned
 * round or not) or a Studio file (its storage path); `colour` is the photo's
 * main colour when it was built here, for the words the video engine reads.
 */
export type StudioModelRef = ({ thing: string; flip?: boolean } | { file: string }) & { colour?: string };

/** The reference as sent or stored, or null for anything else — a data: or blob: address never passes. */
export function studioModelRef(v: unknown): StudioModelRef | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const colour = typeof o.colour === "string" && HEX.test(o.colour) ? { colour: o.colour.toLowerCase() } : {};
  if (typeof o.thing === "string" && THING_KEY.test(o.thing)) return { thing: o.thing, ...(o.flip === true ? { flip: true } : {}), ...colour };
  if (typeof o.file === "string" && o.file.length <= 300 && /^[0-9a-f-]{36}\/sets\/[0-9a-f-]{36}\.studio-model\.[0-9a-z]{1,10}\.[0-9a-f]{16}\.glb$/.test(o.file)) return { file: o.file, ...colour };
  return null;
}

/** The Studio files a saved scene names, once each (the page signs them before the Studio opens). */
export function studioModelFiles(scene: unknown): string[] {
  const items = (scene as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  const out = new Set<string>();
  for (const s of items) {
    const ref = studioModelRef((s as { model?: unknown } | null)?.model);
    if (ref && "file" in ref) out.add(ref.file);
    if (out.size >= STUDIO_MODEL_FILES_MAX) break;
  }
  return [...out];
}

/** At most this many Studio files are signed for one scene. */
export const STUDIO_MODEL_FILES_MAX = 64;

// ---------------------------------------------------------------------------
// The build's button and its photo
// ---------------------------------------------------------------------------

/** "Build the 3D model · about $0.30": the price from the build's own constant (thing-build.ts, fal's page read 2026-09-24). */
export function studioBuildLabel(usd: number = THING_BUILD_USD): string {
  return `Build the 3D model · about $${usd.toFixed(2)}`;
}

/** The long side a cropped view is sent at: TRELLIS.2 builds at 1024. */
export const STUDIO_PHOTO_SIDE = 1024;
/** White added round the view, as a share of its long side (the server's own cut adds white, thing-views.ts). */
export const STUDIO_PHOTO_MARGIN = 0.06;
/** The smallest crop, in the photo's own pixels. */
export const STUDIO_CROP_MIN = 24;

export type Crop = { x: number; y: number; w: number; h: number };

/**
 * The view to suggest on a sheet: the side view — a car's is its longest and
 * lowest (≈ 3.5 : 1, where the top is ≈ 2 : 1 and the front and back ≈ 1.6 : 1).
 * A three-quarter view, when there is one, is the biggest box that is neither
 * that long nor that square; it is preferred, as TRELLIS.2 sees two sides of
 * the thing in it. Null when nothing is found.
 */
export function studioViewSuggestion(views: readonly Box[]): Crop | null {
  if (!views.length) return null;
  const aspect = (b: Box) => b.w / Math.max(1, b.h);
  const byAspect = [...views].sort((a, b) => aspect(b) - aspect(a));
  const side = byAspect[0];
  // Only a sheet with four views or more can hold a three-quarter view beside the flat ones.
  const quarter = views.length >= 4 ? [...views].filter((b) => b !== side && aspect(b) > 1.25 && aspect(b) < 1.9 && b.area >= side.area * 1.15).sort((a, b) => b.area - a.area)[0] : undefined;
  const pick = quarter ?? side;
  return { x: pick.x, y: pick.y, w: pick.w, h: pick.h };
}

/** A crop drawn over the photo as shown (`shownW` × `shownH`), in the photo's own pixels: clamped inside it, never smaller than STUDIO_CROP_MIN. */
export function cropInPixels(c: Crop, shownW: number, shownH: number, naturalW: number, naturalH: number): Crop {
  const sx = naturalW / Math.max(1, shownW);
  const sy = naturalH / Math.max(1, shownH);
  const w = Math.min(naturalW, Math.max(STUDIO_CROP_MIN, Math.round(c.w * sx)));
  const h = Math.min(naturalH, Math.max(STUDIO_CROP_MIN, Math.round(c.h * sy)));
  const x = Math.min(naturalW - w, Math.max(0, Math.round(c.x * sx)));
  const y = Math.min(naturalH - h, Math.max(0, Math.round(c.y * sy)));
  return { x, y, w, h };
}

/** The picture sent for a crop: its size with the white margin, at most STUDIO_PHOTO_SIDE on the long side, and where the view sits in it. */
export function cropOut(c: Crop): { width: number; height: number; draw: Crop } {
  const pad = Math.round(Math.max(c.w, c.h) * STUDIO_PHOTO_MARGIN);
  const fullW = c.w + pad * 2;
  const fullH = c.h + pad * 2;
  const s = Math.min(1, STUDIO_PHOTO_SIDE / Math.max(fullW, fullH));
  return {
    width: Math.max(1, Math.round(fullW * s)),
    height: Math.max(1, Math.round(fullH * s)),
    draw: { x: Math.round(pad * s), y: Math.round(pad * s), w: Math.max(1, Math.round(c.w * s)), h: Math.max(1, Math.round(c.h * s)) },
  };
}

/** What the build is sent: a thing's photo goes onto the thing (the set page's addElementPhoto), a new object's to its own build. */
export type StudioBuildTarget = { key: string } | { new: true };

export function studioPhotoPayload(target: StudioBuildTarget, photoDataUri: string): { kind: "thing"; element: string; photoDataUri: string } | { kind: "new"; photoDataUri: string } | null {
  if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photoDataUri)) return null;
  if ("key" in target) return THING_KEY.test(target.key) ? { kind: "thing", element: target.key, photoDataUri } : null;
  return { kind: "new", photoDataUri };
}

// ---------------------------------------------------------------------------
// The photo's main colour (for the Studio's material and the words)
// ---------------------------------------------------------------------------

const toHex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");

/**
 * The main colour of an RGBA picture, as sRGB hex: the paint, not the sheet's
 * white, the tyres' black or the glass's grey. Pixels near the background
 * (the corners' colour) are left out; among the rest, the most common hue of
 * the clearly coloured ones wins (each weighed by how coloured it is), and its
 * pixels are averaged. A picture with next to nothing coloured gives the
 * average of what stands off the background.
 */
export function dominantColour(rgba: ArrayLike<number>, width: number, height: number): string | null {
  if (width < 1 || height < 1 || rgba.length < width * height * 4) return null;
  const at = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return [rgba[i], rgba[i + 1], rgba[i + 2]];
  };
  const corners = [at(0, 0), at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)];
  const bg = [0, 1, 2].map((k) => corners.map((c) => c[k]).sort((a, b) => a - b)[1]);
  const BINS = 24;
  const bins = Array.from({ length: BINS }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  let n = 0, sr = 0, sg = 0, sb = 0;
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 40000)));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      if (rgba[i + 3] !== undefined && rgba[i + 3] < 128) continue;
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      if (Math.hypot(r - bg[0], g - bg[1], b - bg[2]) < 40) continue;
      n++; sr += r; sg += g; sb += b;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const l = (max + min) / 510;
      const s = max === min ? 0 : (max - min) / 255 / (1 - Math.abs(2 * l - 1) || 1);
      if (s < 0.35 || max < 50) continue;
      let h = 0;
      if (max === r) h = ((g - b) / (max - min) + 6) % 6;
      else if (max === g) h = (b - r) / (max - min) + 2;
      else h = (r - g) / (max - min) + 4;
      const bin = bins[Math.floor((h / 6) * BINS) % BINS];
      bin.w += s; bin.r += r * s; bin.g += g * s; bin.b += b * s;
    }
  }
  if (!n) return null;
  const best = bins.reduce((a, b) => (b.w > a.w ? b : a));
  // Coloured enough to be the thing's paint: 8 % of what stands off the background, weighed.
  if (best.w >= n * 0.08) return toHex(best.r / best.w, best.g / best.w, best.b / best.w);
  return toHex(sr / n, sg / n, sb / n);
}
