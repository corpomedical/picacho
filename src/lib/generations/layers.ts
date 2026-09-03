// Layers — split an image into named, transparent, z-ordered layers
// (Seedream 5 Pro layerize on fal, endpoint bytedance/seedream/v5/pro/layerize).
// Operator: "Lets add what Higgsfield has 'Layers' … It must be 10x better"
// (2026-09-03), shape B picked; every engine below was probed live before
// this file existed — see docs/LAYERS_ACHIEVABILITY.md, "Measured".
//
// Its own alias-free module, like upscale.ts, so the page (which decides
// what to show), the action (which decides whether to take the money) and
// the tests all run the same rules.
//
// MONEY (read from fal's model page 2026-09-03): billed PER DELIVERED LAYER —
// $0.03375 per layer when the output area is under 1536×1536, $0.0675 per
// layer up to 2048×2048; the provider returns between 2 and 17 layers and
// takes no count parameter, so the bill is unknown until it finishes. The
// price here is a fixed tier price at the house $0.28/credit basis that
// covers up to SIXTEEN layers at cost; the seventeenth would lose us about
// two cents, which is documented rather than hidden behind a ceiling quote.
// Probed on a real take: 6 layers at 2K in 96 s, 6–7 at 1K in 59–76 s.
//   1K: 2 credits ($0.56) · typical 6 layers cost $0.20 · 16 layers $0.54
//   2K: 4 credits ($1.12) · typical 6 layers cost $0.41 · 16 layers $1.08
// Higgsfield's published example: 2K, 8 layers, 24 credits ($1.20).
export const LAYERIZE_ENDPOINT = "bytedance/seedream/v5/pro/layerize";
export const LAYERIZE_LABEL = "Seedream 5 Pro Layerize";
// The model id the split row records. Not in IMAGE_MODELS — a post-process
// lane, never a composer choice (same reasoning as UPSCALE_MODEL_ID).
export const LAYERS_MODEL_ID = "seedream-layerize";

export type LayersTier = "1k" | "2k";
export const LAYERS_TIERS: Record<
  LayersTier,
  { imageSize: "auto_1K" | "auto_2K"; credits: number; label: string; providerUsdPerLayer: number }
> = {
  "1k": { imageSize: "auto_1K", credits: 2, label: "1K", providerUsdPerLayer: 0.03375 },
  "2k": { imageSize: "auto_2K", credits: 4, label: "2K", providerUsdPerLayer: 0.0675 },
};
export const LAYERS_TIER_ORDER: LayersTier[] = ["1k", "2k"];
/** fal's stated maximum for one call (the minimum is 2). */
export const LAYERS_MAX_LAYERS = 17;
/** The layer count the fixed price covers at cost — audited by the tests. */
export const LAYERS_COVERED_LAYERS = 16;

// Upload-lane caps, enforced here BEFORE any money moves and at the bucket
// as the backstop (pending-2026-09-03/layers.sql). 20 MB and the three
// browser image types; a short side under 512 px produces layers too soft
// to be worth 2 credits.
export const LAYERS_MAX_BYTES = 20 * 1024 * 1024;
export const LAYERS_MIN_SHORT_SIDE = 512;
export const LAYERS_UPLOAD_MIME = ["image/png", "image/jpeg", "image/webp"] as const;

/**
 * Where a layer sits on the base canvas, as the provider returns it: two
 * [x1, y1, x2, y2] boxes, absolute pixels and per-mille of the base. The
 * delivered PNG is that region at the box's aspect (often upscaled — the
 * probe returned a 296×578 armchair box as a 1107×2163 image), so a
 * composite places each layer at its normalized box and stretches to fit;
 * the base (z 0) has no box and covers the canvas.
 */
export type LayerBox = { absolute: [number, number, number, number]; normalized: [number, number, number, number] };

export function parseLayerBox(raw: unknown): LayerBox | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { absolute?: unknown; normalized?: unknown };
  const quad = (v: unknown): [number, number, number, number] | null =>
    Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === "number" && Number.isFinite(n))
      ? [v[0], v[1], v[2], v[3]]
      : null;
  const absolute = quad(r.absolute);
  const normalized = quad(r.normalized);
  return absolute && normalized ? { absolute, normalized } : null;
}

/** One file name for a layer wherever it is downloaded — singly or in the
 *  ZIP — so a folder of them sorts in z order. */
export function layerFileName(zIndex: number, name: string | null): string {
  const slug = (name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `z${String(zIndex).padStart(2, "0")}${slug ? "-" + slug : ""}.png`;
}

export function layersCreditCost(tier: LayersTier): number {
  return LAYERS_TIERS[tier].credits;
}

export type LayersIneligibility = "not-image" | "not-succeeded" | "already-layered";

/**
 * Whether a finished image may be split. Pure, shared by the page (show the
 * action?) and the action (take the money?). No splitting a split: the
 * base layer of a split IS its source, so a second pass would pay again
 * for the same decomposition.
 */
export function takeLayersIneligibility(row: {
  content_type: string | null;
  status: string | null;
  model_id?: string | null;
  source_generation_id?: string | null;
}): LayersIneligibility | null {
  if (row.content_type !== "image") return "not-image";
  if (row.status !== "succeeded") return "not-succeeded";
  if (row.model_id === LAYERS_MODEL_ID) return "already-layered";
  return null;
}

/** Upload-lane validation. null = eligible. */
export function uploadLayersIneligibility(meta: {
  bytes: number;
  mimeType: string;
  width: number;
  height: number;
}): "not-image" | "too-big" | "too-small" | null {
  if (!(LAYERS_UPLOAD_MIME as readonly string[]).includes(meta.mimeType)) return "not-image";
  if (meta.bytes <= 0 || meta.bytes > LAYERS_MAX_BYTES) return "too-big";
  if (Math.min(meta.width, meta.height) < LAYERS_MIN_SHORT_SIDE) return "too-small";
  return null;
}

/** Storage path for one delivered layer. Under the owner's folder because
 *  the generated-images bucket's RLS is keyed on it; the media route itself
 *  checks only the HMAC capability, so a layer URL is shareable exactly like
 *  every other generated image — ownership is enforced by the pages and the
 *  ZIP route, never by /api/media. */
export function layerStoragePath(userId: string, generationId: string, zIndex: number): string {
  return `${userId}/layers/${generationId}/z${zIndex}.png`;
}
