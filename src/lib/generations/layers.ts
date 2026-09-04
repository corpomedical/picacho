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

// ---------------------------------------------------------------------------
// Stage 2 — re-rendering ONE layer from a prompt, with the character's face
// verified if that layer is the character. This is the part a generic image
// editor cannot do: measured 2026-09-03, our FLUX.2 edit lane held identity
// at 96 against the character photo where Seedream 5 Pro scored 86 and Nano
// Banana Pro 83 — the two engines Higgsfield's Layers runs on.
//
// THE PIPELINE, and why it has three steps rather than one. A layer is a
// TRANSPARENT crop of its bounding box; the edit endpoint returns an OPAQUE
// image at its own dimensions. Measured on a real layer (2026-09-04, a
// 605×1088 hiker): the edit came back 592×1088 and fully opaque, having
// invented a background. So the edit is re-cut with BiRefNet (Portrait, 2K —
// 1.1 s, clean hair edges) and then resized back to the layer's exact pixel
// size. Registration after that: 0.1% drift, opaque coverage 38.1% → 38.8%,
// and the scorer called the result the same person at 100. The original
// bounding box is therefore still correct and is carried over unchanged.
//
// MONEY (fal pages, read 2026-09-03): flux-2-pro/edit is $0.03 for the first
// megapixel of output plus $0.015 per extra megapixel of input and output —
// about $0.045 for a layer this size — and birefnet/v2 is fractions of a
// cent. One credit ($0.28) covers the edit, the re-cut, the score, and the
// gate's one free retry (~$0.095 worst case) with room over.
export const LAYER_RECUT_ENDPOINT = "fal-ai/birefnet/v2";
export const LAYER_RECUT_MODEL = "Portrait";
export const LAYER_RECUT_RESOLUTION = "2048x2048";
export const LAYER_EDIT_CREDITS = 1;
/** Longest prompt accepted for one layer edit. */
export const LAYER_EDIT_MAX_PROMPT = 500;

export type LayerEditIneligibility = "no-prompt" | "prompt-too-long" | "not-succeeded" | "base-layer";

/**
 * Whether one layer may be re-rendered. Pure, so the stack (which decides
 * whether to offer the control) and the action (which decides whether to
 * take the credit) run the same rule.
 *
 * The base layer is excluded: z 0 is the flattened original that every other
 * layer sits on top of, so editing it would change the picture underneath a
 * stack that still shows the old elements over it.
 */
export function layerEditIneligibility(input: {
  prompt: string;
  zIndex: number;
  parentStatus: string | null;
}): LayerEditIneligibility | null {
  const prompt = input.prompt.trim();
  if (!prompt) return "no-prompt";
  if (prompt.length > LAYER_EDIT_MAX_PROMPT) return "prompt-too-long";
  if (input.parentStatus !== "succeeded") return "not-succeeded";
  if (input.zIndex === 0) return "base-layer";
  return null;
}

/** The newest version of each layer, which is what the stack renders. */
export function newestLayers<T extends { zIndex: number; version: number }>(rows: T[]): T[] {
  const best = new Map<number, T>();
  for (const row of rows) {
    const current = best.get(row.zIndex);
    if (!current || row.version > current.version) best.set(row.zIndex, row);
  }
  return [...best.values()].sort((a, b) => a.zIndex - b.zIndex);
}
