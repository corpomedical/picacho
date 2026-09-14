// SAM 2 on fal, for a Set's look (2026-09-12): cut one of a set's objects
// out of an earlier still, given a box round it and a point on it
// (sets/look-cutout.ts says where). The answer is the still itself with
// everything outside the mask made transparent; sets/look-cutout-image.ts
// lays the objects together on grey.
//
// THE CONTRACT, measured against fal on 2026-09-12 and again on 2026-09-14:
//   POST https://fal.run/fal-ai/sam2/image, authorization "Key <FAL_KEY>"
//   { image_url, box_prompts: [{x_min, y_min, x_max, y_max}],
//     prompts: [{x, y, label: 1}], apply_mask: true, output_format: "png",
//     sync_mode: true }
//   image_url may be a data: URI. The answer is { image: { url:
//   "data:image/png;base64,…", width, height, … } }: the input with alpha 0
//   outside the mask and 255 inside.
// ONE OBJECT A REQUEST: A BOX AND A POINT. A box alone is not enough. Boxes
// drawn from a set's sketch are loose (GPT Image does not put things where
// the sketch does), and with a loose box SAM 2 cuts the biggest thing inside
// it: on the operator's race-track still, the product's own eight boxes
// round the car's parts came back as the wall and the road with the car cut
// out of them, two boxes (body and wing) the same, and one box round the
// whole car the road under it (2026-09-14). The same box with one positive
// point on the car cut the car whole, rear wing included; the point alone
// cut the wheel under it. So a request is one object: the box that bounds
// it and one point where it surely is. Several boxes in one request join
// one combined mask, but that is never sent: what several boxes and points
// together would mean to fal was not measured, and a look with more than
// one object is that many requests (sets/look-cutout-store.ts).
// sync_mode is what makes the answer carry the picture itself: nothing is
// fetched from a link afterwards, so an answer is either that PNG or refused.
//
// NEVER THROWS INTO THE SHOT. A missing key, a timeout, an error status or
// an answer of any other shape is null, logged by its kind only — never the
// picture, never fal's text, which could echo the request back. The shot
// then goes without its look (sets/actions.ts shootInSet).
//
// ONE DEADLINE FOR THE WHOLE ANSWER. The cut comes back in the body, some
// megabytes of base64, after the headers. fetchWithTimeout's deadline ends
// when the headers arrive, so a body that stalled or trickled in would hold
// the shot — before its frame is even uploaded — up to the page's own limit.
// Here one signal covers the request, the headers and the body read, and is
// cleared only once the body is in.
//
// The price and the per-cut arithmetic are in sets/look-cutout.ts.
//
// Relative imports only: tested with a fake fetch.

export const SAM2_ENDPOINT = "https://fal.run/fal-ai/sam2/image";
/** Five cuts on 2026-09-14 took 4–20 s of wall time (the first, cold, 20 s); past this, headers and body together, the shot stops waiting and goes without its look. */
export const SAM2_TIMEOUT_MS = 30_000;
/** A cut comes back as a PNG the still's size, in base64: a 1024² still is ~2.5 MB of it. */
const MAX_ANSWER_CHARS = 40 * 1024 * 1024;
const PNG_DATA_URI = "data:image/png;base64,";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A box in the still's own pixels, as SAM 2 takes it. */
export type SegmentBox = { x_min: number; y_min: number; x_max: number; y_max: number };
/** A point in the still's own pixels, on the object to cut. */
export type SegmentPoint = { x: number; y: number };

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

/** A box that is a box, and a point inside it. */
export function isObjectPrompt(box: SegmentBox, point: SegmentPoint): boolean {
  return (
    whole(box.x_min) && whole(box.y_min) && whole(box.x_max) && whole(box.y_max) && box.x_max > box.x_min && box.y_max > box.y_min &&
    whole(point.x) && whole(point.y) && point.x >= box.x_min && point.x <= box.x_max && point.y >= box.y_min && point.y <= box.y_max
  );
}

/**
 * The still with everything outside the object transparent, as PNG bytes —
 * or null (see the header). Only the box's four corners and the point's two
 * coordinates are sent; a box that is not a box, or a point outside it,
 * sends nothing at all.
 */
export async function segmentObject(
  bytes: Buffer,
  box: SegmentBox,
  point: SegmentPoint,
  opts: { timeoutMs?: number } = {},
): Promise<Buffer | null> {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) {
    console.warn("[sets] look cut skipped: FAL_KEY is not set");
    return null;
  }
  const mime = stillMime(bytes);
  if (!mime || !isObjectPrompt(box, point)) {
    console.warn(`[sets] look cut skipped: ${mime ? "not a box with a point in it" : "not a picture"}`);
    return null;
  }
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), opts.timeoutMs ?? SAM2_TIMEOUT_MS);
  try {
    const res = await fetch(SAM2_ENDPOINT, {
      method: "POST",
      headers: { authorization: `Key ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        image_url: `data:${mime};base64,${bytes.toString("base64")}`,
        box_prompts: [{ x_min: box.x_min, y_min: box.y_min, x_max: box.x_max, y_max: box.y_max }],
        prompts: [{ x: point.x, y: point.y, label: 1 }],
        apply_mask: true,
        output_format: "png",
        sync_mode: true,
      }),
      signal: deadline.signal,
    });
    if (!res.ok) {
      console.warn(`[sets] look cut failed: SAM 2 answered ${res.status}`);
      return null;
    }
    // Still under the deadline: an abort now ends the body read too.
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
  } finally {
    clearTimeout(timer);
  }
}
