// Every reference photo handed to FLUX 3 is fitted to the endpoint's limits
// first: at least 256 pixels a side and at most 4 megapixels (fal's schema
// for blackforestlabs/flux-3/edit-image, read 2026-10-02 and again
// 2026-10-04). FLUX.2 Pro, which this lane replaced on 2026-10-02, had no
// stated limit and took whatever a phone produced.
//
// The incident (2026-10-03, a new free account's first and only render, six
// minutes after signing up): Aly drafted a studio portrait from the photo
// they attached, and fal answered 422 "Image dimensions are too large.
// Maximum area is 4000000 pixels². Found 12192768" — an ordinary 12 MP phone
// photo. The person was told "Something went wrong… try again", which would
// have failed the same way, and left. Free accounts' pictures all render on
// FLUX 3, so every phone photo, attached or behind a character, hit it.
//
// Only a photo OUTSIDE the limits is touched. A shrunk one is cut to a 2048px
// long edge (the GPT lane's cap, openai-images.ts asOpenAiImage — far more
// than a 1k render can use) and travels as a data URI, which the schema
// accepts in place of a URL. Everything else leaves as the same URL as
// before. Best-effort by design: a photo that cannot be fetched or read goes
// out unchanged and fal decides, exactly as it did before this existed.
//
// Its own module with relative imports only, so vitest (no "@/" alias) can
// load it.

import { fetchWithTimeout } from "./fetch-with-timeout";

export const FLUX_MAX_INPUT_PIXELS = 4_000_000;
export const FLUX_MIN_INPUT_EDGE = 256;
const FIT_LONG_EDGE = 2048;
// The media route's ceiling (api/media): sharp refuses anything bigger
// rather than decoding a pixel bomb.
const MAX_DECODE_PIXELS = 50_000_000;

/**
 * The size a reference of width x height must be resized to before FLUX 3
 * will take it, or null when no resize is needed — or none can help (a strip
 * so thin that 256px tall is already over 4 MP), in which case it goes as it
 * is. Orientation does not matter: area and shortest side survive a rotation.
 */
export function fluxReferenceFit(width: number, height: number): { width: number; height: number } | null {
  if (!(width > 0 && height > 0)) return null;
  const area = width * height;
  const shortEdge = Math.min(width, height);
  if (area <= FLUX_MAX_INPUT_PIXELS && shortEdge >= FLUX_MIN_INPUT_EDGE) return null;

  const scale =
    area > FLUX_MAX_INPUT_PIXELS
      ? Math.max(
          Math.min(FIT_LONG_EDGE / Math.max(width, height), Math.sqrt(FLUX_MAX_INPUT_PIXELS / area)),
          // Never shrink the short side under the floor to meet the long-edge cap.
          FLUX_MIN_INPUT_EDGE / shortEdge,
        )
      : FLUX_MIN_INPUT_EDGE / shortEdge;
  const round = scale < 1 ? Math.floor : Math.ceil;
  const fitted = { width: round(width * scale), height: round(height * scale) };
  if (
    fitted.width * fitted.height > FLUX_MAX_INPUT_PIXELS ||
    Math.min(fitted.width, fitted.height) < FLUX_MIN_INPUT_EDGE
  ) {
    return null;
  }
  return fitted;
}

// The server fetches these itself now, so the same internal-address fence the
// GPT lane puts in front of its fetch (openai-images.ts) applies. A reference
// that fails it is not fetched — it goes to fal as the URL it is.
function isFetchablePublicUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase();
  return !(
    h === "localhost" ||
    h === "::1" ||
    h === "[::1]" ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^0\./.test(h) ||
    h.startsWith("fd") ||
    h.startsWith("fc")
  );
}

/** One reference, fitted to FLUX 3's limits: the same URL, or a data URI of the resized photo. */
export async function fitReferenceForFlux(url: string): Promise<string> {
  if (!isFetchablePublicUrl(url)) return url;
  try {
    const res = await fetchWithTimeout(url, {}, 20_000);
    if (!res.ok) return url;
    const input = Buffer.from(await res.arrayBuffer());
    const { default: sharp } = await import("sharp");
    const meta = await sharp(input, { limitInputPixels: MAX_DECODE_PIXELS }).metadata();
    const fitted = fluxReferenceFit(meta.width ?? 0, meta.height ?? 0);
    if (!fitted) return url;
    // rotate() applies the EXIF orientation (the output carries none), which
    // swaps the axes of a sideways-stored photo, so the target swaps with it.
    const sideways = (meta.orientation ?? 1) >= 5;
    const pipeline = sharp(input, { limitInputPixels: MAX_DECODE_PIXELS })
      .rotate()
      .resize(sideways ? fitted.height : fitted.width, sideways ? fitted.width : fitted.height, { fit: "fill" });
    // A logo on transparency stays PNG — a JPEG would flatten it onto black.
    if (meta.hasAlpha) return `data:image/png;base64,${(await pipeline.png().toBuffer()).toString("base64")}`;
    return `data:image/jpeg;base64,${(await pipeline.jpeg({ quality: 90 }).toBuffer()).toString("base64")}`;
  } catch {
    return url;
  }
}

/** Every reference, fitted in parallel, order kept (the first sets the shape). */
export function fitReferencesForFlux(urls: readonly string[]): Promise<string[]> {
  return Promise.all(urls.map(fitReferenceForFlux));
}
