// Which earlier still a Set's shot may take its look from (2026-09-11).
//
// The shot action reads the still's row itself — the browser only names it
// by id — and cuts the set's objects out of its picture for the render's
// "look" reference (look-cutout-store.ts; set-shot-prompt.ts says what to
// take from it). This is the one check on what that row points at: a
// finished picture in generated-images, inside the person's own folder. The
// signature the row carries is never trusted or passed on.
//
// A still can be a look only when its objects can be cut out of it: its
// camera and figure were recorded with it (shot-camera.ts), without which
// nobody can say where its objects and its person are, and objects showed
// clear of the person (look-cutout.ts seesLookObjects) — a still with none
// would fail every shot that took it. The server says which (hasLookObjects);
// the page offers, and defaults to, only such stills (canBeLook, newestLook).
//
// Relative imports only: tested without the "@/" alias.

import type { SetShot } from "./types";

const MEDIA_IMAGE_RE = /^\/api\/media\/generated-images\/([^?#]+)/;

/** A still on the contact sheet that can lend its objects: finished, with its picture, with objects to cut out of it. */
export function canBeLook(shot: Pick<SetShot, "status" | "resultUrl" | "hasLookObjects">): boolean {
  return shot.status === "succeeded" && Boolean(shot.resultUrl) && shot.hasLookObjects === true;
}

/** The look's default: the newest still that can be one (a set's shots come newest first). */
export function newestLook(shots: readonly Pick<SetShot, "generationId" | "status" | "resultUrl" | "hasLookObjects">[]): string | null {
  return shots.find(canBeLook)?.generationId ?? null;
}

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
