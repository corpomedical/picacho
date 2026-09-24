// The views in a thing's photo (2026-09-24, "The 3d Model car came out messed
// up."). The first TRELLIS.2 build in Helios was sent a car "blueprint": ONE
// image holding the car four times — side, top, front, back — plus a stock
// site's banner. TRELLIS.2 builds one object from one view, so it built
// exactly what it was shown: four small cars laid out like the sheet
// (measured from fal's own record of the job: a 1.0 × 0.48 × 0.48 clump of
// four partial cars), and the stage fitted the whole clump to the car's
// length.
//
// So a photo is read before it is sent. The separate objects on it are found
// (everything that stands off the photo's background, joined where it
// touches), strips and captions are dropped, and each object is cut out on
// its own. Several views of the one thing → TRELLIS.2's multi-view endpoint,
// which builds ONE model from all of them; one object → that object alone,
// cut out and centred; nothing clean to find (an ordinary photo with a real
// background) → the photo as it was.
//
// The finding is pure (a mask in, boxes out) so the rules are tested without
// an image library; cutting uses sharp, loaded only when a build runs.

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

/** The objects in a photo, as boxes in its OWN pixels, largest first; empty = send the photo whole. */
export async function findViews(photo: Buffer): Promise<Box[]> {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(photo).metadata();
  if (!meta.width || !meta.height) return [];
  const scale = Math.min(1, VIEW_SCAN_WIDTH / meta.width);
  const width = Math.max(1, Math.round(meta.width * scale));
  const height = Math.max(1, Math.round(meta.height * scale));
  const { data } = await sharp(photo).rotate().flatten({ background: "#ffffff" }).resize(width, height, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgb = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const bg = borderColour(rgb, width, height);
  if (!borderIsPlain(rgb, width, height, bg)) return [];
  const views = pickViews(componentsOf(dilate(inkMask(rgb, width, height, bg), width, height, VIEW_JOIN_RADIUS), width, height), width, height);
  return views.map((b) => ({
    x: Math.round(b.x / scale),
    y: Math.round(b.y / scale),
    w: Math.round(b.w / scale),
    h: Math.round(b.h / scale),
    area: Math.round(b.area / (scale * scale)),
  }));
}

/** Each view cut out with a margin, on the photo's own background, as a JPEG data URI no larger than 1024 px. */
export async function cutViews(photo: Buffer, views: Box[]): Promise<string[]> {
  const sharp = (await import("sharp")).default;
  const oriented = await sharp(photo).rotate().flatten({ background: "#ffffff" }).toBuffer();
  const meta = await sharp(oriented).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  const out: string[] = [];
  for (const v of views) {
    // The view exactly (its box already carries the join radius), and the
    // margin added as WHITE — never the photo around it, where a
    // neighbouring view or the banner would reach in.
    const left = Math.max(0, v.x);
    const top = Math.max(0, v.y);
    const width = Math.min(W - left, v.w);
    const height = Math.min(H - top, v.h);
    if (width < 8 || height < 8) continue;
    const pad = Math.round(Math.max(width, height) * 0.08);
    // Squared on white, so the view sits centred the way TRELLIS.2's own examples do.
    const side = Math.max(width, height) + 2 * pad;
    const cut = await sharp(oriented).extract({ left, top, width, height }).toBuffer();
    const jpeg = await sharp({ create: { width: side, height: side, channels: 3, background: "#ffffff" } })
      .composite([{ input: cut, left: Math.round((side - width) / 2), top: Math.round((side - height) / 2) }])
      .resize(Math.min(side, 1024), Math.min(side, 1024))
      .jpeg({ quality: 92 })
      .toBuffer();
    out.push(`data:image/jpeg;base64,${jpeg.toString("base64")}`);
  }
  return out;
}
