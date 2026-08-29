// Image generation via OpenAI's GPT Image 2 — the recommended default.
// Returns raw base64 image data; the caller is responsible for persisting it
// (OpenAI's image endpoints don't return a durable hosted URL).

import { fetchWithTimeout } from "@/lib/generations/providers/fetch-with-timeout";

// Thrown specifically when OpenAI's safety classifier rejects the prompt, so
// callers can tell it apart from an outage, a bad key, or a rate limit and
// react differently. Measured 2026-08-10: this was the single most common
// named cause of failed generations (3 of 8), and it is close to unavoidable
// for this product — the classifier is aggressive about photorealistic
// people, which is exactly what Picacho exists to make. image.ts catches
// this and retries on Flux rather than failing the generation.
export class ImageSafetyRejection extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageSafetyRejection";
  }
}

// Defense-in-depth SSRF guard. Callers only ever pass our own media route or
// Supabase URLs (validated upstream in resolveMaybeSignedUrl / at the form
// read), but never fetch a non-http(s) scheme or a private/loopback/link-local
// address from here — that's what turns a reference image into an internal
// request against something like the cloud metadata endpoint.
function assertNotInternalAddress(url: string): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("Invalid reference image URL.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Unsupported reference image URL scheme.");
  }
  const h = u.hostname.toLowerCase();
  const isInternal =
    h === "localhost" ||
    h === "::1" ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^0\./.test(h) ||
    h.startsWith("fd") ||
    h.startsWith("fc");
  if (isInternal) throw new Error("Refusing to fetch an internal address.");
}

async function fetchAsBlob(url: string): Promise<Blob> {
  assertNotInternalAddress(url);
  const res = await fetchWithTimeout(url, {}, 20_000);
  if (!res.ok) throw new Error(`Couldn't fetch the reference image (${res.status}).`);
  return res.blob();
}

// Every reference image is NORMALIZED before it is sent, because what
// arrives from a phone is not what the filename claims.
//
// 2026-08-29, first outside bug report, second act: a user's attached
// background failed three attempts with OpenAI's "Invalid image file or
// mode for image 1". Two faults stacked. (a) The filename was hardcoded
// "reference.png" while her bytes were JPEG — /images/edits validates the
// declared name against the bytes; it had never bitten because every
// reference before then really was one of our own generated .png files.
// (b) Her file was not even a plain JPEG: sharp reports format MPO — the
// multi-picture container Android cameras and WhatsApp emit, image/jpeg by
// mime, .jpg by name, and unreadable to the endpoint.
//
// So mapping the extension is not enough; the bytes themselves have to be
// made ordinary. sharp (already a dependency — the media route resizes with
// it) re-encodes to a plain PNG when the image has transparency (a logo on
// alpha must not be flattened to black) and to a plain JPEG otherwise,
// honouring EXIF rotation and capping the long edge at 2048px — well inside
// the endpoint's limits and far more than a 1024px render can use.
// Best-effort by design: if sharp cannot read it at all, the original bytes
// go out under a correctly-derived name and the provider decides.
const OPENAI_IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

async function asOpenAiImage(blob: Blob, index: number): Promise<{ blob: Blob; filename: string }> {
  try {
    const { default: sharp } = await import("sharp");
    const input = Buffer.from(await blob.arrayBuffer());
    const pipeline = sharp(input, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true });
    const { hasAlpha } = await sharp(input, { limitInputPixels: 50_000_000 }).metadata();
    const out = hasAlpha
      ? { buf: await pipeline.png().toBuffer(), type: "image/png", ext: "png" }
      : { buf: await pipeline.jpeg({ quality: 92 }).toBuffer(), type: "image/jpeg", ext: "jpg" };
    return {
      blob: new Blob([new Uint8Array(out.buf)], { type: out.type }),
      filename: `reference-${index}.${out.ext}`,
    };
  } catch {
    const ext = OPENAI_IMAGE_EXTENSIONS[blob.type] ?? "png";
    return { blob, filename: `reference-${index}.${ext}` };
  }
}

export async function generateImageWithOpenAI(
  prompt: string,
  referenceImageUrl?: string | string[] | null,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to .env.local, or turn off the " +
        "'real_ai_providers' flag in Admin > Feature flags to use the mock pipeline.",
    );
  }

  let res: Response;

  // Normalize to an array so the single-photo (ordinary) and multi-photo
  // (multi-character) cases can share one code path below.
  const referenceUrls = Array.isArray(referenceImageUrl)
    ? referenceImageUrl
    : referenceImageUrl
      ? [referenceImageUrl]
      : [];

  if (referenceUrls.length > 0) {
    // Anchor to the character's existing reference photo(s) so the result
    // actually looks like the same character(s) (image edit / identity
    // lock). OpenAI's /v1/images/edits accepts multiple images via repeated
    // image[] fields — with 2+, it composites all of them into one result
    // instead of editing just one, which is exactly what multi-character
    // generations need.
    const imageBlobs = await Promise.all(referenceUrls.map((url) => fetchAsBlob(url)));
    // Name each file by what it ACTUALLY is (and transcode what OpenAI
    // can't read) — see asOpenAiImage.
    const images = await Promise.all(imageBlobs.map((b, i) => asOpenAiImage(b, i)));
    const form = new FormData();
    form.set("model", "gpt-image-2");
    form.set("prompt", prompt);
    if (images.length === 1) {
      form.set("image", images[0].blob, images[0].filename);
    } else {
      images.forEach((img) => form.append("image[]", img.blob, img.filename));
    }

    res = await fetchWithTimeout(
      "https://api.openai.com/v1/images/edits",
      {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}` },
        body: form,
      },
      60_000,
    );
  } else {
    res = await fetchWithTimeout(
      "https://api.openai.com/v1/images/generations",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: "gpt-image-2", prompt, size: "1024x1024" }),
      },
      60_000,
    );
  }

  if (!res.ok) {
    const text = await res.text();
    // GPT Image's safety classifier is aggressive and rejects a lot of
    // perfectly innocent descriptions (it flags this as a distinct
    // "image_generation_user_error" with a safety_violations list). Dumping
    // that raw JSON — including OpenAI's internal request ID — straight into
    // the UI is neither helpful nor good practice, so this specific case
    // gets a plain, actionable message instead. Anything else (auth,
    // billing, rate limit, etc.) still surfaces the real API response, since
    // that detail is what's actually useful for debugging those.
    if (text.includes("safety system") || text.includes("safety_violations")) {
      throw new ImageSafetyRejection(
        "That description was flagged by OpenAI's safety filter and couldn't be generated. " +
          "Try simpler, unambiguous wording (for example, describing age and appearance " +
          "plainly rather than combining conflicting details), or upload a photo instead.",
      );
    }
    throw new Error(`OpenAI image API error (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const b64 = data?.data?.[0]?.b64_json as string | undefined;
  if (!b64) throw new Error("OpenAI didn't return image data.");
  return b64;
}
