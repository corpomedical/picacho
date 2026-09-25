// The finished still or take as a file on disk (2026-09-25, Cut 1).
//
// The set page's only download saved the stage's grey sketch, even while a
// finished still was on screen (the audit's first-use moment 5: after the
// first good still, the download icon saved the sketch, not the photo). The
// still or take in the viewer now downloads as itself: the untouched
// original, as History's Download saves it, never the 640 or 1600 copy the
// strip and the viewer show.
//
// Pure and client-safe, relative imports only. It must never import
// media/url.ts, which is server-only: the resized copies are that module's
// thumbUrl with a `w=` parameter on the stored url, which is not part of its
// signature, so taking `w=` off gives back the original (still-file.test.ts
// pins the round trip against thumbUrl itself).

import type { SetShot } from "./types";

/** A stored media url without the resize parameter thumbUrl adds; any other url unchanged. */
export function originalMediaUrl(url: string): string {
  if (!url.startsWith("/api/media/")) return url;
  const q = url.indexOf("?");
  if (q < 0) return url;
  const kept = url
    .slice(q + 1)
    .split("&")
    .filter((p) => p !== "" && !p.startsWith("w=") && p !== "w");
  return kept.length > 0 ? `${url.slice(0, q)}?${kept.join("&")}` : url.slice(0, q);
}

/**
 * The file a finished shot downloads as: a take's raw clip, a still's
 * original picture. Null for anything not finished.
 */
export function shotFileUrl(shot: Pick<SetShot, "kind" | "status" | "resultUrl" | "viewUrl">): string | null {
  if (shot.status !== "succeeded") return null;
  const url = shot.kind === "take" ? shot.resultUrl : (shot.viewUrl ?? shot.resultUrl);
  return url ? originalMediaUrl(url) : null;
}

/** `<set>-still-<n>.png` or `<set>-take-<n>.mp4`, the extension the stored file has. */
export function shotFileName(title: string, kind: "still" | "take", n: number, url: string): string {
  // The page's own slug for the set (downloadFrame's).
  const slug = (title || "set").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const found = /\.(png|jpe?g|webp|mp4|mov|webm)$/i.exec(url.split("?")[0]);
  const ext = found ? found[1].toLowerCase() : kind === "take" ? "mp4" : "png";
  return `${slug}-${kind}-${n}.${ext}`;
}
