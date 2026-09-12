// SAM 2 on fal, for a Set's look (2026-09-12): cut a set's objects out of
// an earlier still, given boxes around them (sets/look-cutout.ts says
// where). The answer is the still itself with everything outside the mask
// made transparent; sets/look-cutout-image.ts lays what is left on grey.
//
// THE CONTRACT, measured against fal on 2026-09-12:
//   POST https://fal.run/fal-ai/sam2/image, authorization "Key <FAL_KEY>"
//   { image_url, box_prompts: [{x_min, y_min, x_max, y_max}, …],
//     apply_mask: true, output_format: "png", sync_mode: true }
//   image_url may be a data: URI. Every box joins one combined mask, and a
//   thin part (a car's rear wing) is caught only when it has a box of its
//   own. The answer is { image: { url: "data:image/png;base64,…", width,
//   height, … } }: the input with alpha 0 outside the mask and 255 inside.
// sync_mode is what makes the answer carry the picture itself: nothing is
// fetched from a link afterwards, so an answer is either that PNG or refused.
//
// NEVER THROWS INTO THE SHOT. A missing key, a timeout, an error status or
// an answer of any other shape is null, logged by its kind only — never the
// picture, never fal's text, which could echo the request back. The shot
// then goes without its look (sets/actions.ts shootInSet).
//
// The price and the per-cut arithmetic are in sets/look-cutout.ts.
//
// Relative imports only: tested with a fake fetch.

import { fetchWithTimeout } from "./fetch-with-timeout";

export const SAM2_ENDPOINT = "https://fal.run/fal-ai/sam2/image";
/** Two measured cuts took 2–3 s; past this the shot stops waiting and goes without its look. */
export const SAM2_TIMEOUT_MS = 30_000;
/** A cut comes back as a PNG the still's size, in base64: a 1024² still is ~2.5 MB of it. */
const MAX_ANSWER_CHARS = 40 * 1024 * 1024;
const PNG_DATA_URI = "data:image/png;base64,";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A box in the still's own pixels, as SAM 2 takes it. */
export type SegmentBox = { x_min: number; y_min: number; x_max: number; y_max: number };

/** The picture's kind, from its first bytes: the kinds a still is stored as. */
export function stillMime(bytes: Buffer): "image/png" | "image/jpeg" | "image/webp" | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

const whole = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;

/**
 * The still with everything outside the boxed objects transparent, as PNG
 * bytes — or null (see the header). Only the four corners of each box are
 * sent; a box that is not a box is dropped, and with none left nothing is
 * sent at all.
 */
export async function segmentWithBoxes(
  bytes: Buffer,
  boxes: readonly SegmentBox[],
  opts: { timeoutMs?: number } = {},
): Promise<Buffer | null> {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) {
    console.warn("[sets] look cut skipped: FAL_KEY is not set");
    return null;
  }
  const mime = stillMime(bytes);
  const box_prompts = boxes
    .filter((b) => whole(b.x_min) && whole(b.y_min) && whole(b.x_max) && whole(b.y_max) && b.x_max > b.x_min && b.y_max > b.y_min)
    .map((b) => ({ x_min: b.x_min, y_min: b.y_min, x_max: b.x_max, y_max: b.y_max }));
  if (!mime || box_prompts.length === 0) {
    console.warn(`[sets] look cut skipped: ${mime ? "no boxes" : "not a picture"}`);
    return null;
  }
  try {
    const res = await fetchWithTimeout(
      SAM2_ENDPOINT,
      {
        method: "POST",
        headers: { authorization: `Key ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          image_url: `data:${mime};base64,${bytes.toString("base64")}`,
          box_prompts,
          apply_mask: true,
          output_format: "png",
          sync_mode: true,
        }),
      },
      opts.timeoutMs ?? SAM2_TIMEOUT_MS,
    );
    if (!res.ok) {
      console.warn(`[sets] look cut failed: SAM 2 answered ${res.status}`);
      return null;
    }
    const text = await res.text();
    if (text.length > MAX_ANSWER_CHARS) {
      console.warn("[sets] look cut failed: SAM 2's answer was too large");
      return null;
    }
    const url: unknown = (JSON.parse(text) as { image?: { url?: unknown } } | null)?.image?.url;
    if (typeof url !== "string" || !url.startsWith(PNG_DATA_URI)) {
      console.warn("[sets] look cut failed: SAM 2's answer held no PNG");
      return null;
    }
    const png = Buffer.from(url.slice(PNG_DATA_URI.length), "base64");
    if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) {
      console.warn("[sets] look cut failed: SAM 2's answer held no PNG");
      return null;
    }
    return png;
  } catch (err) {
    console.warn(`[sets] look cut failed: ${err instanceof Error ? err.name : "error"}`);
    return null;
  }
}
