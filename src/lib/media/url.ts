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

/** True for anything the UI can render directly: absolute http(s) or our media route. */
export function isRenderableUrl(url: string | null | undefined): boolean {
  return Boolean(url && (url.startsWith("http") || url.startsWith("/api/media/")));
}
