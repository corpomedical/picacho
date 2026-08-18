import crypto from "crypto";

// Stable, cacheable URLs for private-bucket media — the fix for two real
// problems at once:
//
// 1. SLOW: every page view minted fresh Supabase signed URLs (new token,
//    new URL), so neither the browser nor the CDN could ever cache an
//    image. Six 2 MB PNGs re-downloaded on every visit to paint six 56px
//    thumbnails.
// 2. BROKEN: generations.result_url stored a 7-day signed URL, so History
//    images silently died a week after creation.
//
// The scheme: /api/media/<bucket>/<path>?v=<sig>, where sig is an HMAC of
// bucket+path keyed by the service-role key (server-only, already in the
// environment — no new secret to manage). The URL is a capability: knowing
// it grants read access to that one file, exactly like a Supabase signed
// URL — except it never changes and never expires, so it can be cached
// as immutable by the browser and the CDN. Storage object names are
// random UUIDs and never rewritten in place, which is what makes
// "immutable" honest.
//
// Server-only module (crypto + service key) — never import from a client
// component. Client components only ever see the finished URL strings.

const MEDIA_BUCKETS = new Set(["character-references", "generated-images", "chat-attachments"]);

function hmac(input: string): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set.");
  return crypto.createHmac("sha256", key).update(input).digest("base64url").slice(0, 24);
}

export function mediaSig(bucket: string, path: string): string {
  return hmac(`${bucket}/${path}`);
}

export function isMediaBucket(bucket: string): boolean {
  return MEDIA_BUCKETS.has(bucket);
}

/** Stable display URL for a storage object. Relative — same-origin. */
export function mediaUrl(bucket: string, path: string): string {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `/api/media/${bucket}/${encodedPath}?v=${mediaSig(bucket, path)}`;
}

// Rows written before this existed store full Supabase signed URLs — many
// already expired (their tokens lasted 7 days; the files are all still
// there). This rescues them: pull bucket+path out of the stored URL and
// re-issue the stable form. Anything unrecognized passes through untouched
// (external video URLs, already-converted media URLs, null).
const SIGNED_URL_RE = /\/storage\/v1\/object\/(?:sign|public)\/([^/]+)\/([^?]+)/;

export function toMediaUrl(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (stored.startsWith("/api/media/")) return stored;
  const match = stored.match(SIGNED_URL_RE);
  if (!match) return stored;
  const [, bucket, rawPath] = match;
  if (!isMediaBucket(bucket)) return stored;
  return mediaUrl(bucket, decodeURIComponent(rawPath));
}

/** A media URL is relative; AI providers and server-side fetches need it absolute. */
export function absolutizeMediaUrl(url: string, origin: string): string {
  return url.startsWith("/api/media/") ? `${origin}${url}` : url;
}

/**
 * SSRF guard for URLs the SERVER itself will fetch (reference images handed to
 * image providers). The only legitimate targets are our own media route and
 * Supabase storage — everything a user submits as a reference resolves to one
 * of those. Anything else (arbitrary http(s), cloud-metadata IPs like
 * 169.254.169.254, internal hostnames) is rejected, so a crafted
 * attachment_reference_url can't turn a generation into a server-side request
 * against an internal address.
 */
export function isAllowedFetchUrl(url: string, appOrigin: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  let appHost = "";
  try {
    appHost = new URL(appOrigin).hostname.toLowerCase();
  } catch {
    /* origin unparseable — fall through to the https allowlist */
  }
  const host = u.hostname.toLowerCase();
  if (appHost && host === appHost) return true; // our own /api/media route, any scheme (dev included)
  if (u.protocol !== "https:") return false;
  return host === "supabase.co" || host.endsWith(".supabase.co");
}

/** True for anything the UI can render directly: absolute http(s) or our media route. */
export function isRenderableUrl(url: string | null | undefined): boolean {
  return Boolean(url && (url.startsWith("http") || url.startsWith("/api/media/")));
}

// ---------------------------------------------------------------------------
// Thumbnails
// ---------------------------------------------------------------------------
//
// Galleries used to load the full generated PNG for every tile — often ~2MB
// each, a dozen at a time, on a phone. The media route can now resize on the
// way out (see api/media/[...key]/route.ts), so grids ask for a small WebP and
// only the opened image, the download and anything sent to an AI provider use
// the original bytes.
//
// The widths are a closed set on purpose: `w` isn't part of the URL signature,
// so an open range would let one file be requested at ten thousand sizes and
// evict everything else from the CDN cache. Two sizes cover every grid we
// have (a phone-width tile and a retina/desktop one).
export const THUMB_WIDTHS = [320, 640] as const;
export type ThumbWidth = (typeof THUMB_WIDTHS)[number];

export function isThumbWidth(value: number): value is ThumbWidth {
  return (THUMB_WIDTHS as readonly number[]).includes(value);
}

/**
 * Small version of one of OUR media URLs, for grid and list tiles.
 *
 * Anything else — an external provider URL, a null, an already-absolute link —
 * passes straight through untouched, so this is always safe to wrap around a
 * URL of unknown origin. Never use it for downloads, full-size viewing, or
 * anything handed to a model: those need the real file.
 */
export function thumbUrl(
  url: string | null | undefined,
  width: ThumbWidth = 640,
): string | null {
  if (!url) return null;
  if (!url.startsWith("/api/media/")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}w=${width}`;
}
