import { describe, expect, it } from "vitest";
import { OIDN_MAX_INPUT, OidnFailed, oidnAlbedoValue, oidnBlankPatches, oidnColorValue, oidnCrop, oidnDenoise, oidnNormalValue, oidnPad, oidnSide } from "./studio-trace";

// Live 2026-10-01, real Chrome with WebGPU on a Mac: Render ▸ Path traced still, Final 256, 1280 × 720, Denoise on,
// photographed sky. "Done … Cleaned by Open Image Denoise", and a solid black rectangle over the top-left, about 30 %
// of the width and 45 % of the height. oidn-web 0.4.0 exposes each tile by the average log brightness of its own
// pixels; one NaN, infinite or negative pixel makes that tile's exposure NaN (or 0) and the whole tile comes back
// black. Its first tiles are 384 px: on the 1280 × 1280 square the picture is padded to, the tile at x 0–383, rows
// 384–767 holds the picture's top 336 rows (rows run bottom-up out of the graphics card) — 30 % × 47 %.

const W = 1280, H = 720;
/** A traced-looking picture: light everywhere, a darker band, no pixel exactly 0. */
function picture(w = W, h = H): Float32Array {
  const c = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = (y * w + x) * 4, v = 0.05 + ((x * 7 + y * 13) % 97) / 97;
    c[k] = v; c[k + 1] = v * 0.9; c[k + 2] = v * 1.1; c[k + 3] = 1;
  }
  return c;
}

/**
 * oidn-web 0.4.0's tiling as it ran live (UNet.ts _executeTile: 384-px output tiles on the padded square), with its
 * per-tile exposure (process.ts avgLogLum: key 0.18 over 2^mean log2(lum + 0.0001)), and a network that hands the
 * exposed tile back unchanged. What a NaN does to a tile is exactly what the real one does.
 */
function fakeUnet(tile = 384, answer = true) {
  const sent: { color: Float32Array }[] = [];
  return {
    sent,
    tileExecute(o: Record<string, unknown>) {
      const color = o.color as { data: Float32Array; width: number; height: number };
      sent.push({ color: color.data });
      const s = color.width, out = new Float32Array(s * s * 4);
      for (let ty = 0; ty < s; ty += tile) for (let tx = 0; tx < s; tx += tile) {
        let sum = 0, n = 0;
        for (let y = ty; y < Math.min(s, ty + tile); y++) for (let x = tx; x < Math.min(s, tx + tile); x++) {
          const k = (y * s + x) * 4; sum += Math.log2(0.212671 * color.data[k] + 0.71516 * color.data[k + 1] + 0.072169 * color.data[k + 2] + 0.0001); n++;
        }
        const scale = 0.18 / 2 ** (sum / n);
        for (let y = ty; y < Math.min(s, ty + tile); y++) for (let x = tx; x < Math.min(s, tx + tile); x++) {
          const k = (y * s + x) * 4;
          for (let ch = 0; ch < 3; ch++) out[k + ch] = ((color.data[k + ch] * scale) / scale) * (Number.isFinite(scale) && scale > 0 ? 1 : NaN);
          out[k + 3] = 1;
        }
      }
      if (answer) setTimeout(() => (o.done as (x: { data: Float32Array }) => void)({ data: out }), 0);
      return () => {};
    },
  };
}

describe("Open Image Denoise in the Studio: pad, crop and the black tile", () => {
  it("the square is the longer side rounded up to 16; padding repeats the last row and column; cropping takes the picture back exactly", () => {
    expect(oidnSide(1280, 720)).toBe(1280);
    expect(oidnSide(640, 360)).toBe(640);
    expect(oidnSide(1281, 10)).toBe(1296);
    expect(oidnSide(720, 1280)).toBe(1280);
    // 3 × 2, values = 10·y + x in red; into a 4 × 4 square.
    const src = new Float32Array(3 * 2 * 4);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) src[(y * 3 + x) * 4] = 10 * y + x;
    const sq = oidnPad(src, 3, 2, 4, (v) => v + 100);
    const red = (x: number, y: number) => sq[(y * 4 + x) * 4];
    expect([red(0, 0), red(2, 0), red(3, 0), red(0, 1), red(2, 1), red(3, 1), red(0, 3), red(3, 3)]).toEqual([100, 102, 102, 110, 112, 112, 110, 112]);
    for (let i = 3; i < sq.length; i += 4) expect(sq[i]).toBe(1);
    // Round trip, no shift and no flip, for the live size, a portrait and odd sizes.
    for (const [w, h] of [[W, H], [720, 1280], [33, 17], [640, 360]]) {
      const p = picture(w, h), s = oidnSide(w, h), back = oidnCrop(oidnPad(p, w, h, s, (v) => v), s, w, h);
      expect(back.length).toBe(w * h * 4);
      for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1], [w >> 1, h >> 1]]) {
        const k = (y * w + x) * 4;
        expect([back[k], back[k + 1], back[k + 2], back[k + 3]]).toEqual([p[k], p[k + 1], p[k + 2], 1]);
      }
    }
  });

  it("one NaN pixel blacked out exactly the live tile before; every value is made safe now", () => {
    const live = picture();
    live[((H - 40) * W + 100) * 4] = NaN; // in the sky, near the top-left of the picture (rows run bottom-up)
    // The old way: the colour handed over as it was.
    const s = oidnSide(W, H), unet = fakeUnet();
    const out: Float32Array[] = [];
    unet.tileExecute({ color: { data: oidnPad(live, W, H, s, (v) => v), width: s, height: s }, done: (o: { data: Float32Array }) => out.push(o.data) });
    return new Promise<void>((resolve) => setTimeout(() => {
      const old = oidnCrop(out[0], s, W, H), blank = oidnBlankPatches(live, old, W, H);
      const xs = blank.map((b) => b.x), ys = blank.map((b) => b.y);
      // The blank region: x 0–383 (30 % of 1280), picture rows 384–719 (the top 47 %): the black rectangle he saw.
      expect(Math.min(...xs)).toBe(0); expect(Math.max(...xs)).toBe(352);
      expect(Math.min(...ys)).toBe(384); expect(Math.max(...ys)).toBe(704);
      expect(blank.length).toBe(12 * 11);
      // Now: the same picture comes back whole, with the NaN as 0.
      const unet2 = fakeUnet();
      void oidnDenoise(unet2, live, picture(), picture(), W, H).then((res) => {
        expect(oidnBlankPatches(live, res, W, H)).toEqual([]);
        expect(unet2.sent[0].color.every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
        resolve();
      });
    }, 5));
  });

  it("safe values: NaN, below zero and infinite colour; albedo and normals kept in range", () => {
    expect([NaN, -1, 0, 0.5, 1e6, Infinity, -Infinity].map(oidnColorValue)).toEqual([0, 0, 0, 0.5, OIDN_MAX_INPUT, OIDN_MAX_INPUT, 0]);
    expect([NaN, -0.2, 0.5, 2].map(oidnAlbedoValue)).toEqual([0, 0, 127.5, 255]);
    expect([NaN, -3, -0.5, 0, 0.5, 3, Infinity].map(oidnNormalValue)).toEqual([0, -255, -127.5, 0, 127.5, 255, 255]);
  });

  it("the check finds blank patches only where the input has light", () => {
    const input = picture(256, 128), whole = input.slice();
    expect(oidnBlankPatches(input, whole, 256, 128)).toEqual([]);
    // A corner black in the input too is a dark corner, not a lost tile.
    const dark = input.slice(), darkOut = input.slice();
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { const k = (y * 256 + x) * 4; dark[k] = dark[k + 1] = dark[k + 2] = 0; darkOut[k] = darkOut[k + 1] = darkOut[k + 2] = 0; }
    expect(oidnBlankPatches(dark, darkOut, 256, 128)).toEqual([]);
    // Black or NaN out where the input is lit: found, patch by patch.
    const lost = input.slice();
    for (let y = 64; y < 128; y++) for (let x = 192; x < 256; x++) { const k = (y * 256 + x) * 4; lost[k] = lost[k + 1] = lost[k + 2] = y < 96 ? 0 : NaN; }
    expect(oidnBlankPatches(input, lost, 256, 128)).toEqual([{ x: 192, y: 64 }, { x: 224, y: 64 }, { x: 192, y: 96 }, { x: 224, y: 96 }]);
    // A few black pixels (a real shadow speck) don't make a patch blank.
    const speck = input.slice(); for (let i = 0; i < 40; i++) speck[i * 4] = speck[i * 4 + 1] = speck[i * 4 + 2] = 0;
    expect(oidnBlankPatches(input, speck, 256, 128)).toEqual([]);
  });

  it("a denoise that comes back with a blank tile, or never comes back, is refused, so the Studio cleans it another way", async () => {
    const blanking = {
      tileExecute(o: Record<string, unknown>) {
        const c = o.color as { data: Float32Array; width: number };
        const d = c.data.slice(); for (let y = 0; y < 384; y++) for (let x = 0; x < 384; x++) { const k = (y * c.width + x) * 4; d[k] = d[k + 1] = d[k + 2] = 0; }
        setTimeout(() => (o.done as (x: { data: Float32Array }) => void)({ data: d }), 0);
        return () => {};
      },
    };
    await expect(oidnDenoise(blanking, picture(), picture(), picture(), W, H)).rejects.toBeInstanceOf(OidnFailed);
    await expect(oidnDenoise(fakeUnet(384, false), picture(), picture(), picture(), W, H, 20)).rejects.toThrow(/didn't finish/);
    await expect(oidnDenoise(fakeUnet(), picture(), picture(), picture(), W, H)).resolves.toHaveLength(W * H * 4);
  });
});
