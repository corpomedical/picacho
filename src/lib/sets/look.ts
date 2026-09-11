// Which earlier still a Set's shot may take its look from (2026-09-11).
//
// The shot action reads the still's row itself — the browser only names it
// by id — and hands its picture to the render as a "look" reference
// (set-shot-prompt.ts says what to take from it). This is the one check on
// what that row points at: a finished picture in generated-images, inside
// the person's own folder. The action re-signs the path (media/url.ts); the
// signature the row carries is never trusted or passed on.
//
// Relative imports only: tested without the "@/" alias.

const MEDIA_IMAGE_RE = /^\/api\/media\/generated-images\/([^?#]+)/;

/** The storage path of a still's picture, or null if it is not the person's own finished image. */
export function lookStoragePath(resultUrl: unknown, userId: string): string | null {
  if (typeof resultUrl !== "string" || !userId) return null;
  const match = MEDIA_IMAGE_RE.exec(resultUrl);
  if (!match) return null;
  let path: string;
  try {
    path = match[1]
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  } catch {
    return null;
  }
  if (!path.startsWith(`${userId}/`)) return null;
  if (path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  return path;
}

/**
 * Whether a character's saved outfit photo rides their renders — the rule
 * runGeneration applies (a saved photo inside the person's own folder; a
 * Set's shot never turns it off). When it does, the outfit photo decides
 * what they wear, and a same-character look must not also promise the
 * earlier still's clothes: two clothing instructions, and the model picks
 * one at random (review, 2026-09-11).
 */
export function hasSavedOutfit(outfitImageUrls: unknown, userId: string): boolean {
  return (
    Boolean(userId) &&
    Array.isArray(outfitImageUrls) &&
    outfitImageUrls.some((p) => typeof p === "string" && p.startsWith(`${userId}/`))
  );
}
