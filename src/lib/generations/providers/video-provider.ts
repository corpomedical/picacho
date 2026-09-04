// WHICH provider runs a video — the decision alone, with no client imports.
//
// Split from video-queue.ts (which does the dispatching) for one practical
// reason: this repo runs vitest with no config, so a test can only import
// modules that avoid the "@/" path alias, and both provider clients use it.
// Keeping the decision pure means the rules below are actually covered by
// tests — and they are the rules that decide whether live customer renders
// change provider, so they are the part that most needs covering.
export type VideoProvider = "fal" | "byteplus";

/**
 * The catalogue ids ModelArk can run. Kept here rather than derived from
 * byteplus.ts's ARK_MODELS so this module stays import-free; video-queue.ts
 * carries a compile-time check that the two lists cannot drift apart.
 */
export const BYTEPLUS_MODEL_IDS = ["seedance", "seedance-2"] as const;
export type ByteplusModelId = (typeof BYTEPLUS_MODEL_IDS)[number];

export function isByteplusCapable(modelId: string): modelId is ByteplusModelId {
  // includes() on a frozen literal list, deliberately not `modelId in
  // ARK_MODELS`: a plain object's prototype would answer true for
  // "toString" and send that to ModelArk as a model id.
  return (BYTEPLUS_MODEL_IDS as readonly string[]).includes(modelId);
}

/**
 * The single decision. BOTH switches are required:
 *
 *   BYTEPLUS_ARK_API_KEY   authenticates (byteplus.ts throws without it)
 *   BYTEPLUS_SEEDANCE_LANE exactly "on" — routes
 *
 * Two rather than one, on purpose. The key has to exist before anyone can
 * make the first proving call against ModelArk, and that call must not be
 * paid for by a customer whose render silently changed provider the moment
 * the key landed in Vercel. Flip the flag once the lane has been watched
 * working; remove it to go back to fal without deploying code.
 */
export function videoProviderFor(modelId: string): VideoProvider {
  if (!isByteplusCapable(modelId)) return "fal";
  if (process.env.BYTEPLUS_SEEDANCE_LANE !== "on") return "fal";
  if (!process.env.BYTEPLUS_ARK_API_KEY) return "fal";
  return "byteplus";
}

/** The env var this model's provider needs, for the pre-credit key gate. */
export function providerKeyNameFor(modelId: string): "FAL_KEY" | "BYTEPLUS_ARK_API_KEY" {
  return videoProviderFor(modelId) === "byteplus" ? "BYTEPLUS_ARK_API_KEY" : "FAL_KEY";
}

/**
 * Which provider is holding an already-queued render.
 *
 * Read from the job row's `payload` — a jsonb column that already carried the
 * model label, so this needed no migration. More usefully: a row written
 * before this lane existed has no `provider` key and reads as "fal", which is
 * what it is. Renders in flight across the deploy keep being polled against
 * the provider that actually has them. Anything unrecognised reads as "fal"
 * too: polling fal for a row fal does not have returns a clean failure, while
 * polling ModelArk for one it never accepted would look like a lost task.
 */
export function providerFromPayload(payload: unknown): VideoProvider {
  const p = (payload as { provider?: unknown } | null | undefined)?.provider;
  return p === "byteplus" ? "byteplus" : "fal";
}
