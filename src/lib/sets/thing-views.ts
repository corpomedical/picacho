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

import { VIEW_JOIN_RADIUS, VIEW_SCAN_WIDTH, borderColour, borderIsPlain, componentsOf, dilate, inkMask, pickViews, type Box } from "./thing-views-find";

// The rules themselves live in thing-views-find.ts (no sharp there), for the browser too.
export * from "./thing-views-find";

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
