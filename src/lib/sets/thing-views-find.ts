// The finding rules of thing-views.ts, on their own (2026-09-24): pure — a
// mask in, boxes out — and free of sharp, so the stage can find the same
// views in the browser when it paints a thing's drawings onto its model
// (components/sets/blueprint-stage.ts). thing-views.ts re-exports all of it.

export type Box = { x: number; y: number; w: number; h: number; area: number };

/** The analysis width a photo is brought down to before its objects are found. */
export const VIEW_SCAN_WIDTH = 400;
/** How far a pixel must stand off the background (RGB distance) to be part of an object. */
export const VIEW_INK_DISTANCE = 56;
/** Pixels an object's parts are grown by before joining, so a mirror or a wheel stays with its car. */
export const VIEW_JOIN_RADIUS = 3;
/** An object smaller than this share of the largest one is a caption, a logo or a speck. */
export const VIEW_MIN_SHARE = 0.12;
/** At most this many views are sent. */
export const VIEW_MAX = 4;

/** 8-connected components of a mask (row-major, 1 = ink), each as its bounding box and pixel count. */
export function componentsOf(mask: Uint8Array, width: number, height: number): Box[] {
  const seen = new Uint8Array(mask.length);
  const boxes: Box[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let minX = width, minY = height, maxX = -1, maxY = -1, area = 0;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width;
      const y = (i - x) / width;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width || (dx === 0 && dy === 0)) continue;
          const j = ny * width + nx;
          if (mask[j] && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    boxes.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area });
  }
  return boxes;
}

/** Grows every ink pixel by `r` in each direction (a square brush). */
export function dilate(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  if (r <= 0) return mask;
  // Separable: rows, then columns.
  const rows = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    let last = -Infinity;
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) last = x;
      if (x - last <= r) rows[y * width + x] = 1;
    }
    last = Infinity;
    for (let x = width - 1; x >= 0; x--) {
      if (mask[y * width + x]) last = x;
      if (last - x <= r) rows[y * width + x] = 1;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let x = 0; x < width; x++) {
    let last = -Infinity;
    for (let y = 0; y < height; y++) {
      if (rows[y * width + x]) last = y;
      if (y - last <= r) out[y * width + x] = 1;
    }
    last = Infinity;
    for (let y = height - 1; y >= 0; y--) {
      if (rows[y * width + x]) last = y;
      if (last - y <= r) out[y * width + x] = 1;
    }
  }
  return out;
}

/**
 * The objects worth building from, largest first: not a strip (a banner or
 * a rule running most of the way across, or one touching two opposite
 * edges), not a speck or a caption, at most VIEW_MAX of them. Empty when the
 * photo has no clean background to stand things off — then nothing is cut.
 */
export function pickViews(boxes: Box[], width: number, height: number): Box[] {
  const strip = (b: Box) =>
    (b.w >= width * 0.9 && b.h <= height * 0.25) ||
    (b.h >= height * 0.9 && b.w <= width * 0.25) ||
    (b.x === 0 && b.x + b.w >= width) ||
    (b.y === 0 && b.y + b.h >= height);
  const kept = boxes.filter((b) => !strip(b)).sort((a, b) => b.area - a.area);
  if (!kept.length) return [];
  const largest = kept[0].area;
  // An object covering nearly the whole frame is an ordinary photo, not a sheet.
  if (kept[0].w * kept[0].h >= width * height * 0.85) return [];
  return kept.filter((b) => b.area >= largest * VIEW_MIN_SHARE).slice(0, VIEW_MAX);
}

/** The background colour: the median of the photo's border pixels, per channel. */
export function borderColour(rgb: Uint8Array, width: number, height: number): [number, number, number] {
  const r: number[] = [], g: number[] = [], b: number[] = [];
  const take = (x: number, y: number) => {
    const i = (y * width + x) * 3;
    r.push(rgb[i]);
    g.push(rgb[i + 1]);
    b.push(rgb[i + 2]);
  };
  for (let x = 0; x < width; x++) {
    take(x, 0);
    take(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    take(0, y);
    take(width - 1, y);
  }
  const mid = (v: number[]) => v.sort((a, c) => a - c)[v.length >> 1];
  return [mid(r), mid(g), mid(b)];
}

/** Whether the border is one clean colour — a sheet or a product shot, not a photo of a street. */
export function borderIsPlain(rgb: Uint8Array, width: number, height: number, bg: [number, number, number]): boolean {
  const off = (x: number, y: number) => {
    const i = (y * width + x) * 3;
    return Math.hypot(rgb[i] - bg[0], rgb[i + 1] - bg[1], rgb[i + 2] - bg[2]) > VIEW_INK_DISTANCE ? 1 : 0;
  };
  const share = (n: number, at: (k: number) => number) => {
    let s = 0;
    for (let k = 0; k < n; k++) s += at(k);
    return s / n;
  };
  const edges = [
    share(width, (x) => off(x, 0)),
    share(width, (x) => off(x, height - 1)),
    share(height, (y) => off(0, y)),
    share(height, (y) => off(width - 1, y)),
  ];
  // Three plain edges of four: a banner along one edge (a stock site's
  // strip, a caption bar) is allowed — it is a strip, dropped later.
  return edges.filter((e) => e <= 0.15).length >= 3;
}

/** The ink mask: every pixel standing off the background colour. */
export function inkMask(rgb: Uint8Array, width: number, height: number, bg: [number, number, number]): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let p = 0; p < mask.length; p++) {
    const i = p * 3;
    if (Math.hypot(rgb[i] - bg[0], rgb[i + 1] - bg[1], rgb[i + 2] - bg[2]) > VIEW_INK_DISTANCE) mask[p] = 1;
  }
  return mask;
}

