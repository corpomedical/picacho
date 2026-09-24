import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { componentsOf, cutViews, dilate, findViews, pickViews, VIEW_MAX } from "./thing-views";

// "The 3d Model car came out messed up." (2026-09-24): a four-view car sheet
// was sent to TRELLIS.2 as one photo and came back as four small cars. The
// views are now found and cut apart before a build.

/** A white sheet with coloured blocks on it, and optionally a full-width banner along the foot. */
async function sheet(blocks: { x: number; y: number; w: number; h: number; c: string }[], banner = false, bg = "#ffffff"): Promise<Buffer> {
  const W = 1600, H = 980;
  const layers = blocks.map((b) => ({
    input: { create: { width: b.w, height: b.h, channels: 3 as const, background: b.c } },
    left: b.x,
    top: b.y,
  }));
  if (banner) layers.push({ input: { create: { width: W, height: 90, channels: 3 as const, background: "#1f6fa8" } }, left: 0, top: H - 90 });
  return sharp({ create: { width: W, height: H, channels: 3, background: bg } }).composite(layers).jpeg().toBuffer();
}

describe("finding the views on a photo", () => {
  it("finds a four-view sheet's four views, largest first, and drops the banner", async () => {
    const photo = await sheet(
      [
        { x: 110, y: 80, w: 850, h: 240, c: "#f2c320" }, // side
        { x: 1060, y: 80, w: 430, h: 240, c: "#f2c320" }, // front
        { x: 110, y: 400, w: 850, h: 420, c: "#f2c320" }, // top
        { x: 1060, y: 490, w: 430, h: 240, c: "#f2c320" }, // back
      ],
      true,
    );
    const views = await findViews(photo);
    expect(views).toHaveLength(4);
    // The top view is the biggest; nothing reaches into the banner.
    expect(views[0].y).toBeGreaterThan(380);
    for (const v of views) expect(v.y + v.h).toBeLessThan(980 - 90);
    const cuts = await cutViews(photo, views);
    expect(cuts).toHaveLength(4);
    for (const uri of cuts) {
      const meta = await sharp(Buffer.from(uri.split(",")[1], "base64")).metadata();
      expect(meta.width).toBe(meta.height);
      expect(meta.width).toBeLessThanOrEqual(1024);
    }
  });

  it("a single product shot is one view, cut out and centred", async () => {
    const views = await findViews(await sheet([{ x: 400, y: 300, w: 800, h: 300, c: "#c0392b" }]));
    expect(views).toHaveLength(1);
  });

  it("an ordinary photo with a busy background is sent whole", async () => {
    const busy = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#556b2f" } })
      .composite([
        { input: { create: { width: 400, height: 600, channels: 3, background: "#8b4513" } }, left: 0, top: 0 },
        { input: { create: { width: 800, height: 150, channels: 3, background: "#87ceeb" } }, left: 0, top: 0 },
      ])
      .jpeg()
      .toBuffer();
    expect(await findViews(busy)).toEqual([]);
  });
});

describe("the rules", () => {
  it("joins what touches (a wheel to its car) and keeps separate things apart", () => {
    const w = 20, h = 5;
    const mask = new Uint8Array(w * h);
    for (const x of [1, 2, 3, 5, 6]) mask[2 * w + x] = 1; // two runs, one pixel apart
    for (const x of [15, 16]) mask[2 * w + x] = 1;
    expect(componentsOf(mask, w, h)).toHaveLength(3);
    expect(componentsOf(dilate(mask, w, h, 1), w, h)).toHaveLength(2);
  });

  it("drops strips, specks and captions; keeps at most four", () => {
    const W = 400, H = 245;
    const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h, area: w * h });
    const views = pickViews(
      [box(0, 222, 400, 23), box(20, 20, 200, 60), box(260, 20, 100, 60), box(20, 100, 200, 100), box(260, 120, 100, 60), box(270, 200, 100, 8), box(5, 5, 3, 3)],
      W,
      H,
    );
    expect(views.map((v) => v.y)).toEqual([100, 20, 20, 120]);
    expect(views.length).toBeLessThanOrEqual(VIEW_MAX);
    // One object filling the frame is a photo, not a sheet.
    expect(pickViews([box(4, 4, 390, 236)], W, H)).toEqual([]);
  });
});
