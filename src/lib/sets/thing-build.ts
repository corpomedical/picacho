// A thing's 3D model built from its photo, inside Helios (2026-09-24, "Can
// we add trellis feature on helios? Everything should be done under one
// roof."). Until now a model came from outside: Microsoft's TRELLIS.2 page,
// a downloaded .glb, then "Load a model file" on the card. Here the card
// builds it: the thing's front photo goes to TRELLIS.2 — Microsoft's open
// model (MIT licence) — run on fal's GPUs, and the .glb it answers with is
// kept with the set exactly as a loaded file is (thing-model.ts), fitted to
// where the thing's blocks stand.
//
// Not a bought model: TRELLIS.2 is open weights we may run anywhere; fal
// only rents the GPU per build, as the proof kit in scripts/model-proof
// would on RunPod. Moving it onto our own GPU later changes this file's
// endpoint, nothing else.
//
// THE MONEY (fal's own page for fal-ai/trellis-2, read 2026-09-24 — re-read
// before quoting again): "$0.25 for 512p resolution, $0.3 for 1024p
// resolution and $0.35 for 1536p resolution". We build at 1024: $0.30 a
// model. The multi-photo endpoint (fal-ai/trellis-2/multi) says only "$0.05
// per unit" without naming the unit, so it is not used until that is known.
//
// Pure and relative-import only: the tests hold the request and the checks.

export const THING_BUILD_ENDPOINT = "fal-ai/trellis-2";
export const THING_BUILD_RESOLUTION = 1024;
/** fal's stated price at THING_BUILD_RESOLUTION, read 2026-09-24. */
export const THING_BUILD_USD = 0.3;
/**
 * Vertices the mesh is brought down to. fal's default is 500,000 and its own
 * page says 20k–50k for web and mobile; the stage draws one car beside
 * dozens of blocks, on phones too, so a car keeps its shape at 100,000.
 */
export const THING_BUILD_VERTICES = 100_000;
/** The texture baked onto it: fal's default. */
export const THING_BUILD_TEXTURE = 2048;
/** Builds a person may start an hour: each is paid for. */
export const THING_BUILDS_PER_HOUR = 10;
/** How long the page waits for a build before it says so: TRELLIS.2 at 1024 is ~17 s on an H100 (the model's own card), fal's queue adds its wait. */
export const THING_BUILD_WAIT_MS = 6 * 60 * 1000;
/** How often the page asks. */
export const THING_BUILD_POLL_MS = 4_000;

/** What TRELLIS.2 is sent: the photo's own bytes as a data URI, never a link to our storage. */
export function thingBuildInput(photoDataUri: string): Record<string, unknown> {
  return {
    image_url: photoDataUri,
    resolution: THING_BUILD_RESOLUTION,
    decimation_target: THING_BUILD_VERTICES,
    texture_size: THING_BUILD_TEXTURE,
    remesh: true,
  };
}

/** A build's queue handle as the page holds it between polls. */
export type ThingBuildHandle = { requestId: string; statusUrl: string; responseUrl: string };

// fal's queue host, about one request of THIS endpoint — never an arbitrary
// URL the page could send back (the angle stage's stance, angle-stage.ts).
const QUEUE_URL_RE = /^https:\/\/queue\.fal\.run\/fal-ai\/trellis-2\/requests\/[a-z0-9-]+(\/status)?$/i;

/** The handle fal answered a submit with, or null. */
export function readBuildHandle(job: unknown): ThingBuildHandle | null {
  const j = (job ?? {}) as { request_id?: unknown; status_url?: unknown; response_url?: unknown };
  if (typeof j.request_id !== "string" || !/^[a-z0-9-]{8,80}$/i.test(j.request_id)) return null;
  if (typeof j.status_url !== "string" || typeof j.response_url !== "string") return null;
  if (!QUEUE_URL_RE.test(j.status_url) || !QUEUE_URL_RE.test(j.response_url)) return null;
  return { requestId: j.request_id, statusUrl: j.status_url, responseUrl: j.response_url };
}

/** A handle sent back by the page: only fal's queue, only this endpoint, only one request. */
export function buildHandleAllowed(h: unknown): h is ThingBuildHandle {
  const x = (h ?? {}) as Partial<ThingBuildHandle>;
  return (
    typeof x.requestId === "string" &&
    typeof x.statusUrl === "string" &&
    typeof x.responseUrl === "string" &&
    QUEUE_URL_RE.test(x.statusUrl) &&
    QUEUE_URL_RE.test(x.responseUrl) &&
    x.statusUrl.includes(`/requests/${x.requestId}`) &&
    x.responseUrl.includes(`/requests/${x.requestId}`)
  );
}

/** The .glb fal made, if the answer names one on fal's own file host. */
export function builtModelUrl(result: unknown): { url: string; size: number | null } | null {
  const glb = (result as { model_glb?: { url?: unknown; file_size?: unknown } } | null)?.model_glb;
  if (!glb || typeof glb.url !== "string") return null;
  let host: string;
  try {
    const u = new URL(glb.url);
    if (u.protocol !== "https:") return null;
    host = u.hostname;
  } catch {
    return null;
  }
  if (host !== "fal.media" && !host.endsWith(".fal.media")) return null;
  return { url: glb.url, size: typeof glb.file_size === "number" ? glb.file_size : null };
}
