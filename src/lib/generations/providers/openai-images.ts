// Image generation via OpenAI's GPT Image 2.5 — the recommended default.
// Returns raw base64 image data; the caller is responsible for persisting it
// (OpenAI's image endpoints don't return a durable hosted URL).
//
// THE MODEL (2026-09-14, the operator's call: "update our image engine to
// GPT 2.5"). OpenAI shipped two GPT Image 2.5 models on 2026-09-08:
// "sunburst", "our most capable model for image generation and editing",
// recommended "for workflows where editing precision matters most", and
// "flare", "our fastest model for high-quality, everyday image generation"
// (developers.openai.com/api/docs/models/gpt-image-2.5-sunburst and
// …-flare, the image-generation guide, read 2026-09-14). Every Picacho
// render is an edit anchored to a person's photos, so sunburst it is. The
// DATED snapshot is named, not the alias: a model OpenAI moves under an
// alias would move the money and the eval's bars without a commit.
//
// THE MONEY. Both 2.5 models and GPT Image 2 bill the same token rates
// (pricing page, read 2026-09-14): text input $5, image input $8, image
// output $30, per million tokens (cached: $1.25 and $2). What a picture
// COSTS is how many output image tokens the model spends on it, and that
// is the quality setting's doing: with quality unset the model picked, and
// the same request came back at 196 to 1,756 output image tokens (docs/
// ASTRA_SETS.md, "Quality varies", measured on GPT Image 2). So quality is
// pinned, and every answer's `usage` is read and priced at those rates
// (readImageUsage): the pipeline writes it into the take's log, so the
// price of a picture is on record, never estimated. OpenAI's own calculator
// does not estimate 2.5's consumption ("The GPT Image 2 calculator does not
// estimate GPT Image 2.5 token consumption"): the measurements are in
// docs/ASTRA_SETS.md and admin/economics.ts.

// Relative imports (2026-09-14): sets/look-sheet.ts is tested with this
// module loaded as it is, and the test suite resolves no "@/" alias.
import { fetchWithTimeout } from "./fetch-with-timeout";
import { readOpenAiRefusal } from "./refusal-messages";

/** The one image model every render and reference photo goes to: GPT Image 2.5 Sunburst, the 2026-09-08 snapshot (the header). */
export const OPENAI_IMAGE_MODEL = "gpt-image-2.5-sunburst-2026-09-08";
/** What the person sees it called (image-models.ts, the pipeline's "Generated via"). */
export const OPENAI_IMAGE_MODEL_NAME = "GPT Image 2.5";
/**
 * The sizes a render may be asked for: the square every take pins, and the
 * two 3:2 shapes only a Helios rig format asks for (sets/rig.ts). Never
 * "auto" — the edits endpoint's auto matches the input's shape, and a
 * phone photo made a pricier picture for the same credit (2026-08-31).
 */
export const OPENAI_IMAGE_SIZES = ["1024x1024", "1536x1024", "1024x1536"] as const;
export type OpenAiImageSize = (typeof OPENAI_IMAGE_SIZES)[number];
/** Pinned, never "auto" (the header): one quality, one price. 2.5 also offers "xhigh" and "max". */
export const OPENAI_IMAGE_QUALITY = "high";
// The edits endpoint's input_fidelity ("high" keeps more of what the input
// pictures show) is NOT sent: GPT Image 2.5 Sunburst refuses it — 400,
// "does not support the 'input_fidelity' parameter", measured 2026-09-14.
/**
 * How long one answer may take, headers to body. GPT Image 2 renders took
 * 29 s at the fastest on record (refund-rules.ts); GPT Image 2.5 Sunburst at
 * quality high took 55 s for a Set shot with three input pictures
 * (2026-09-14), and a fourth picture ran past the 60 s this used to be. The
 * pages' own limit is 300 s (maxDuration); this leaves room for a retry.
 */
export const OPENAI_IMAGE_TIMEOUT_MS = 150_000;
/** USD per million tokens, the pricing page read 2026-09-14; the same for GPT Image 2 and both 2.5 models. */
export const OPENAI_IMAGE_USD_PER_MILLION = { textInput: 5, imageInput: 8, imageOutput: 30 } as const;

/** What one answer cost, from its `usage` (the images API's own count), priced at OPENAI_IMAGE_USD_PER_MILLION. */
export type OpenAiImageUsage = {
  model: string;
  quality: string;
  textInputTokens: number;
  imageInputTokens: number;
  imageOutputTokens: number;
  usd: number;
};

const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

/** One line for a take's log: "Quality high; 2,465 image tokens in, 1,056 out; $0.0487." */
export function describeImageUsage(u: OpenAiImageUsage): string {
  const n = (v: number) => v.toLocaleString("en-US");
  return `Quality ${u.quality}; ${n(u.imageInputTokens)} image tokens in, ${n(u.imageOutputTokens)} out; $${u.usd.toFixed(4)}.`;
}

/** The answer's `usage`, priced — or null when the answer carries none. Never throws. */
export function readImageUsage(data: unknown, model = OPENAI_IMAGE_MODEL, quality = OPENAI_IMAGE_QUALITY): OpenAiImageUsage | null {
  const usage = (data as { usage?: Record<string, unknown> } | null)?.usage;
  if (!usage || typeof usage !== "object") return null;
  const input = (usage.input_tokens_details ?? {}) as Record<string, unknown>;
  const output = (usage.output_tokens_details ?? {}) as Record<string, unknown>;
  const textInputTokens = count(input.text_tokens);
  const imageInputTokens = count(input.image_tokens);
  // Older answers carry only output_tokens; every output token of an image model is an image token.
  const imageOutputTokens = count(output.image_tokens) || count(usage.output_tokens);
  const r = OPENAI_IMAGE_USD_PER_MILLION;
  const usd = (textInputTokens * r.textInput + imageInputTokens * r.imageInput + imageOutputTokens * r.imageOutput) / 1_000_000;
  return { model, quality, textInputTokens, imageInputTokens, imageOutputTokens, usd };
}

// Thrown specifically when OpenAI's safety classifier rejects the prompt, so
// callers can tell it apart from an outage, a bad key, or a rate limit.
// Measured 2026-08-10: this was the single most common named cause of failed
// generations (3 of 8) — the classifier is aggressive about photorealistic
// people, which is exactly what Picacho makes. It is FINAL: image.ts used to
// catch it and reword-and-retry, then hop to Flux, and that ladder was
// removed on 2026-09-09. No caller retries it or sends it elsewhere now; the
// render it belongs to fails.
//
// beforeRender is what the refund reads (pipeline.ts turns it into
// REFUSED_BEFORE_RENDER_ISSUE): true unless OpenAI said the block came from
// a generated image. See readOpenAiRefusal.
export class ImageSafetyRejection extends Error {
  readonly beforeRender: boolean;
  constructor(message: string, beforeRender: boolean) {
    super(message);
    this.name = "ImageSafetyRejection";
    this.beforeRender = beforeRender;
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
//
// Known to land in that fallback: HEIC. The prebuilt libvips ships no HEVC
// decoder (patent-encumbered; verified 2026-08-29 — decode fails with
// "heif: Decoder plugin" even though sharp.format.heif advertises the
// container; AVIF round-trips fine). Real exposure is small (iOS Safari
// converts photo-library picks to JPEG on upload) and the failure is now
// graceful: the provider rejects, which refunds and auto-reports.
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
  // Told what the answer cost, when the answer says (the header: THE MONEY).
  // model and quality are measurement knobs (the eval and the harnesses in
  // docs/ASTRA_SETS.md): the product never passes them, and sends
  // OPENAI_IMAGE_MODEL at OPENAI_IMAGE_QUALITY.
  // size: the pinned square unless a Helios rig format asks for its render
  // (sets/rig.ts: 1536x1024 measured cheaper than 1024x1024, 2026-09-15).
  opts: { onUsage?: (usage: OpenAiImageUsage) => void; model?: string; quality?: string; size?: OpenAiImageSize } = {},
): Promise<string> {
  const model = opts.model ?? OPENAI_IMAGE_MODEL;
  const quality = opts.quality ?? OPENAI_IMAGE_QUALITY;
  const size: OpenAiImageSize = opts.size && OPENAI_IMAGE_SIZES.includes(opts.size) ? opts.size : "1024x1024";
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
    form.set("model", model);
    form.set("quality", quality);
    form.set("prompt", prompt);
    // Pinned like the /generations call below pins size (2026-08-31): with
    // size unset, the edits endpoint defaults to "auto" and matches the
    // INPUT's dimensions — so the same flat 1-credit charge bought a square
    // render for one person and a taller, materially more expensive one for
    // whoever anchored to a phone photo. One price, one output size.
    form.set("size", size);
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
      OPENAI_IMAGE_TIMEOUT_MS,
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
        body: JSON.stringify({ model, quality, prompt, size }),
      },
      OPENAI_IMAGE_TIMEOUT_MS,
    );
  }

  if (!res.ok) {
    const text = await res.text();
    // GPT Image's safety classifier flags this as a distinct
    // "image_generation_user_error" with a safety_violations list. Dumping
    // that raw JSON — including OpenAI's internal request ID — straight into
    // the UI is neither helpful nor good practice, so this case gets a plain
    // refusal instead: what happened, and no advice on getting past it (see
    // refusal-messages.ts for why, and for what the sentence must keep).
    // Anything else (auth, billing, rate limit, etc.) still surfaces the real
    // API response, since that detail is what's actually useful for
    // debugging those.
    const refusal = readOpenAiRefusal(text);
    if (refusal) {
      // The stage goes to the server log, never to the person: until
      // 2026-09-10 the whole body was thrown away here, so no past refusal
      // can say which stage refused it.
      console.warn("OpenAI refused an image request.", {
        status: res.status,
        stage: refusal.stage ?? "not stated",
      });
      throw new ImageSafetyRejection(refusal.message, refusal.beforeRender);
    }
    throw new Error(`OpenAI image API error (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const b64 = data?.data?.[0]?.b64_json as string | undefined;
  if (!b64) throw new Error("OpenAI didn't return image data.");
  const usage = readImageUsage(data, model, quality);
  if (usage) {
    // The server log carries the price of every picture too (no prompt, no person).
    console.info("[openai-images] usage", usage);
    try {
      opts.onUsage?.(usage);
    } catch {
      // A listener's failure is never the render's.
    }
  }
  return b64;
}
