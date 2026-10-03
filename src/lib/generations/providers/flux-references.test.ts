import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FLUX_MAX_INPUT_PIXELS,
  FLUX_MIN_INPUT_EDGE,
  fitReferenceForFlux,
  fitReferencesForFlux,
  fluxReferenceFit,
} from "./flux-references";

// Incident replay: 2026-10-03, a new free account's attached 12 MP phone
// photo (12,192,768 px² = 4032 x 3024) was a 422 from FLUX 3, whose
// references must be 256px a side and at most 4 MP.

const within = (s: { width: number; height: number } | null) =>
  Boolean(s && s.width * s.height <= FLUX_MAX_INPUT_PIXELS && Math.min(s.width, s.height) >= FLUX_MIN_INPUT_EDGE);

describe("fluxReferenceFit", () => {
  it("the reported photo, 4032 x 3024, comes down to a 2048 long edge", () => {
    expect(4032 * 3024).toBe(12_192_768);
    expect(fluxReferenceFit(4032, 3024)).toEqual({ width: 2048, height: 1536 });
    expect(fluxReferenceFit(3024, 4032)).toEqual({ width: 1536, height: 2048 });
  });

  it("leaves anything already inside the window alone", () => {
    expect(fluxReferenceFit(1024, 1024)).toBeNull();
    expect(fluxReferenceFit(2560, 1440)).toBeNull(); // 3.7 MP, long edge over 2048: untouched
    expect(fluxReferenceFit(2000, 2000)).toBeNull(); // exactly 4 MP
    expect(fluxReferenceFit(256, 256)).toBeNull();
  });

  it("a big square lands at or under 4 MP, not at 2048 x 2048 (4.19 MP)", () => {
    const s = fluxReferenceFit(3000, 3000);
    expect(s).toEqual({ width: 2000, height: 2000 });
    expect(within(s)).toBe(true);
  });

  it("every common phone and camera size fits after the resize", () => {
    for (const [w, h] of [
      [4000, 3000], [4080, 3072], [8160, 6120], [6000, 4000], [4624, 3472], [3840, 2160], [1080, 4000], [2001, 2000],
    ]) {
      const s = fluxReferenceFit(w, h);
      expect(within(s), `${w}x${h} -> ${JSON.stringify(s)}`).toBe(true);
      // Shape kept to within a pixel of rounding.
      expect(Math.abs(s!.width / s!.height - w / h)).toBeLessThan(0.01);
    }
  });

  it("a small picture is lifted to 256px on its short side", () => {
    expect(fluxReferenceFit(200, 200)).toEqual({ width: 256, height: 256 });
    expect(within(fluxReferenceFit(120, 400))).toBe(true);
  });

  it("a long strip keeps its short side at 256 rather than meet the 2048 cap", () => {
    const s = fluxReferenceFit(12000, 400);
    expect(s!.height).toBeGreaterThanOrEqual(FLUX_MIN_INPUT_EDGE);
    expect(within(s)).toBe(true);
  });

  it("gives up (null: send as is) when no size can satisfy both limits, or on nonsense", () => {
    expect(fluxReferenceFit(40000, 200)).toBeNull(); // 256 tall is already 13 MP wide
    expect(fluxReferenceFit(0, 100)).toBeNull();
    expect(fluxReferenceFit(Number.NaN, 100)).toBeNull();
  });
});

describe("fitReferenceForFlux", () => {
  afterEach(() => vi.unstubAllGlobals());

  function serve(bytes: Buffer) {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array(bytes), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  async function dimsOf(dataUri: string) {
    const [, b64] = dataUri.split(",");
    return sharp(Buffer.from(b64, "base64")).metadata();
  }

  it("the reported case: a 4032 x 3024 JPEG goes as a 2048 x 1536 JPEG data URI", async () => {
    serve(await sharp({ create: { width: 4032, height: 3024, channels: 3, background: "#c08060" } }).jpeg().toBuffer());
    const out = await fitReferenceForFlux("https://picacho.ai/api/media/chat-attachments/u/aly-1.jpg?v=sig");
    expect(out.startsWith("data:image/jpeg;base64,")).toBe(true);
    const meta = await dimsOf(out);
    expect([meta.width, meta.height]).toEqual([2048, 1536]);
  });

  it("a sideways-stored portrait (EXIF 6) comes out upright at 1536 x 2048", async () => {
    const stored = await sharp({ create: { width: 4032, height: 3024, channels: 3, background: "#808080" } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    serve(stored);
    const out = await fitReferenceForFlux("https://picacho.ai/api/media/x.jpg?v=s");
    const meta = await dimsOf(out);
    expect([meta.width, meta.height]).toEqual([1536, 2048]);
    expect(meta.orientation ?? 1).toBe(1);
  });

  it("a transparent PNG over 4 MP stays PNG with its alpha", async () => {
    serve(
      await sharp({ create: { width: 3000, height: 3000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .png()
        .toBuffer(),
    );
    const out = await fitReferenceForFlux("https://picacho.ai/api/media/logo.png?v=s");
    expect(out.startsWith("data:image/png;base64,")).toBe(true);
    const meta = await dimsOf(out);
    expect(meta.hasAlpha).toBe(true);
    expect((meta.width ?? 0) * (meta.height ?? 0)).toBeLessThanOrEqual(FLUX_MAX_INPUT_PIXELS);
  });

  it("a photo already inside the window goes as the same URL", async () => {
    serve(await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#fff" } }).png().toBuffer());
    const url = "https://abc.supabase.co/storage/v1/object/sign/character-references/u/a.png?token=t";
    expect(await fitReferenceForFlux(url)).toBe(url);
  });

  it("never fetches a local or non-https address, and sends it unchanged", async () => {
    const fetchMock = serve(Buffer.from("x"));
    for (const url of ["http://localhost:3000/api/media/a.jpg", "https://127.0.0.1/a.jpg", "https://169.254.169.254/latest", "not a url"]) {
      expect(await fitReferenceForFlux(url)).toBe(url);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an unreadable answer or a failed download sends the URL unchanged", async () => {
    serve(Buffer.from("not an image"));
    expect(await fitReferenceForFlux("https://picacho.ai/a.jpg")).toBe("https://picacho.ai/a.jpg");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("gone", { status: 404 })));
    expect(await fitReferenceForFlux("https://picacho.ai/b.jpg")).toBe("https://picacho.ai/b.jpg");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    expect(await fitReferenceForFlux("https://picacho.ai/c.jpg")).toBe("https://picacho.ai/c.jpg");
  });

  it("keeps the order of several references (the first sets the shape)", async () => {
    const big = await sharp({ create: { width: 4032, height: 3024, channels: 3, background: "#000" } }).jpeg().toBuffer();
    const small = await sharp({ create: { width: 800, height: 800, channels: 3, background: "#000" } }).jpeg().toBuffer();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(new Uint8Array(url.includes("big") ? big : small))));
    const out = await fitReferencesForFlux(["https://picacho.ai/small.jpg", "https://picacho.ai/big.jpg"]);
    expect(out[0]).toBe("https://picacho.ai/small.jpg");
    expect(out[1].startsWith("data:image/jpeg;base64,")).toBe(true);
  });
});
