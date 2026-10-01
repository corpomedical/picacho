// The 3D-model engines Helios Studio's prompt bar offers (2026-10-01, operator:
// "Finalizing the UI to look and work like this" — Higgsfield's Blender
// add-on, whose 3D Model tab lists several engines grouped Text / Image /
// Multi-view with Rigging, Quad/Tri and a target polycount). One registry:
// each engine's fal endpoints, the options it really takes (its own API
// schema, read the same day), what it is sent, how its answer names the .glb,
// and its price — every dollar below is the sentence fal's own model page
// says, quoted with the day it was read. An engine whose price could not be
// read is not in the list (Tripo's text-to-3d page read "$ 0 per compute
// second", TRELLIS.2's multi-view page names no unit: neither is offered).
//
// Re-read the pages before quoting again; a price that moved changes its
// constant here and nothing else.
//
// Pure and relative-import only: the tests hold the prices, the requests and
// the checks.

import { THING_BUILD_TEXTURE, THING_BUILD_VERTICES } from "./thing-build";

export type ModelEngineId = "trellis-2" | "hunyuan-3.1-pro" | "tripo-2.5" | "meshy-7.1";
/** What the build starts from: words, one photo, or up to four views of the same thing. */
export type ModelInputKind = "text" | "image" | "multi";
/** The four views a multi-view build takes, in the order fal's multi endpoints read them. */
export const MODEL_VIEWS = ["front", "back", "left", "right"] as const;
export type ModelView = (typeof MODEL_VIEWS)[number];

/** Textures: none (grey clay), standard, or HD (Tripo only). */
export type ModelTextures = "none" | "standard" | "hd";

/** The options the bar shows, as one shape; each engine reads only the ones it has. */
export type ModelBuildOptions = {
  /** TRELLIS.2's resolution. */
  detail: 512 | 1024 | 1536;
  textures: ModelTextures;
  /** PBR maps (metallic, roughness, normal): Hunyuan only (the one engine whose page prices it). */
  pbr: boolean;
  /** Quad topology instead of triangles (Tripo, Meshy). */
  quad: boolean;
  /** A target polygon (or, for TRELLIS.2, vertex) count; null = the engine's own. */
  polycount: number | null;
  /** Rigged as a humanoid with walk and run (Meshy only). */
  rig: boolean;
};

export const MODEL_DEFAULT_OPTIONS: ModelBuildOptions = { detail: 1024, textures: "standard", pbr: false, quad: false, polycount: null, rig: false };

// ---------------------------------------------------------------------------
// THE MONEY — fal's own model pages, read 2026-10-01 (each quoted)
// ---------------------------------------------------------------------------

/**
 * fal-ai/trellis-2, read 2026-10-01: "Your request will cost 0.25 $ for 512p resolution, 0.3 $ for 1024p resolution
 * and 0.35 $ for 1536p resolution." (The same sentence thing-build.ts read on 2026-09-24.)
 */
export const TRELLIS_USD: Record<512 | 1024 | 1536, number> = { 512: 0.25, 1024: 0.3, 1536: 0.35 };

/**
 * fal-ai/hunyuan-3d/v3.1/pro/image-to-3d and …/text-to-3d, read 2026-10-01 (both pages, the same words): "Your
 * request will cost $0.375 per generation. For $1.00, you can run this model 2 times. Enabling PBR materials adds
 * $0.15. Using multi-view images adds $0.15. Custom face count adds $0.15."
 */
export const HUNYUAN_USD = { base: 0.375, pbr: 0.15, multiView: 0.15, faceCount: 0.15 } as const;

/**
 * tripo3d/tripo/v2.5/image-to-3d and …/multiview-to-3d, read 2026-10-01 (both pages): "Your request will cost $0.2
 * (without textures), $0.3 (with standard textures), or $0.4 (with HD textures), plus an additional $0.05 each for
 * Style and quad options if selected." (Style is deprecated in its API and never sent.)
 */
export const TRIPO_USD = { none: 0.2, standard: 0.3, hd: 0.4, quad: 0.05 } as const;

/**
 * meshy/v7.1/image-to-3d, …/multi-image-to-3d and …/text-to-3d, read 2026-10-01 (all three pages): "A base model
 * without textures costs $0.80. Adding textures brings the total to $1.20. Optional auto-rigging adds $0.20, and
 * animation adds $0.12 per call. A textured model with auto-rigging and animation costs $1.52." (Animation is not
 * offered: the Studio animates the figure itself.)
 */
export const MESHY_USD = { untextured: 0.8, textured: 1.2, rig: 0.2 } as const;

/** The day the prices above were read, said beside them in the bar. */
export const MODEL_PRICES_READ = "2026-10-01";

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

type Range = { min: number; max: number; step: number; label: "vertices" | "faces" | "polygons" };

export type ModelEngine = {
  id: ModelEngineId;
  /** As the bar lists it (brand names stay in every language). */
  name: string;
  /** fal endpoint per kind it takes; a kind it doesn't take is absent. */
  endpoints: Partial<Record<ModelInputKind, string>>;
  /** Which of the bar's options it has. */
  has: { detail: boolean; textures: ModelTextures[]; pbr: boolean; quad: boolean; rig: boolean; polycount: Range | null };
  /** Longest words it takes (text builds). */
  promptMax: number;
  /** One line under the picker. */
  note: string;
};

export const MODEL_ENGINES: readonly ModelEngine[] = [
  {
    id: "hunyuan-3.1-pro",
    name: "Hunyuan 3D v3.1 Pro",
    endpoints: {
      text: "fal-ai/hunyuan-3d/v3.1/pro/text-to-3d",
      image: "fal-ai/hunyuan-3d/v3.1/pro/image-to-3d",
      multi: "fal-ai/hunyuan-3d/v3.1/pro/image-to-3d",
    },
    has: { detail: false, textures: ["standard", "none"], pbr: true, quad: false, rig: false, polycount: { min: 40_000, max: 1_500_000, step: 10_000, label: "faces" } },
    promptMax: 1024,
    note: "Tencent's model: detailed shapes and textures; PBR materials on request.",
  },
  {
    id: "meshy-7.1",
    name: "Meshy 7.1",
    endpoints: { text: "meshy/v7.1/text-to-3d", image: "meshy/v7.1/image-to-3d", multi: "meshy/v7.1/multi-image-to-3d" },
    has: { detail: false, textures: ["standard", "none"], pbr: false, quad: true, rig: true, polycount: { min: 100, max: 300_000, step: 1_000, label: "polygons" } },
    promptMax: 600,
    note: "Clean topology, quads or triangles, and auto-rigging for people (walk and run included).",
  },
  {
    id: "tripo-2.5",
    name: "Tripo v2.5",
    endpoints: { image: "tripo3d/tripo/v2.5/image-to-3d", multi: "tripo3d/tripo/v2.5/multiview-to-3d" },
    has: { detail: false, textures: ["standard", "hd", "none"], pbr: false, quad: true, rig: false, polycount: { min: 1_000, max: 500_000, step: 1_000, label: "faces" } },
    promptMax: 0,
    note: "Fast and light; HD textures or quads on request.",
  },
  {
    id: "trellis-2",
    name: "TRELLIS.2",
    endpoints: { image: "fal-ai/trellis-2" },
    has: { detail: true, textures: ["standard"], pbr: false, quad: false, rig: false, polycount: { min: 5_000, max: 2_000_000, step: 5_000, label: "vertices" } },
    promptMax: 0,
    note: "Microsoft's open model, the set page's own build.",
  },
];

/** The picker's groups, in the add-on's order: Text, Image, Multi-view. */
export const MODEL_KIND_GROUPS: readonly { kind: ModelInputKind; label: string }[] = [
  { kind: "text", label: "Text" },
  { kind: "image", label: "Image" },
  { kind: "multi", label: "Multi-view" },
];

export function modelEngine(id: unknown): ModelEngine | null {
  return MODEL_ENGINES.find((e) => e.id === id) ?? null;
}

/** "Hunyuan 3D v3.1 Pro · Text to 3D": the picker's line for one engine and kind. */
export function modelEngineLabel(engine: ModelEngine, kind: ModelInputKind): string {
  return `${engine.name} · ${kind === "text" ? "Text to 3D" : kind === "image" ? "Image to 3D" : "Multi-view to 3D"}`;
}

/** Every choice the picker lists, grouped by kind. */
export function modelChoices(): { kind: ModelInputKind; label: string; engines: ModelEngine[] }[] {
  return MODEL_KIND_GROUPS.map((g) => ({ ...g, engines: MODEL_ENGINES.filter((e) => !!e.endpoints[g.kind]) }));
}

/** The options kept to what this engine takes, every number inside its range. */
export function normaliseModelOptions(engine: ModelEngine, raw: unknown): ModelBuildOptions {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof ModelBuildOptions, unknown>>;
  const detail = o.detail === 512 || o.detail === 1536 ? o.detail : 1024;
  const textures = engine.has.textures.includes(o.textures as ModelTextures) ? (o.textures as ModelTextures) : engine.has.textures[0];
  const r = engine.has.polycount;
  const n = typeof o.polycount === "number" && Number.isFinite(o.polycount) ? Math.round(o.polycount) : null;
  return {
    detail: engine.has.detail ? detail : 1024,
    textures,
    pbr: engine.has.pbr && o.pbr === true && textures !== "none",
    quad: engine.has.quad && o.quad === true,
    polycount: r && n !== null ? Math.max(r.min, Math.min(r.max, n)) : null,
    rig: engine.has.rig && o.rig === true,
  };
}

/** One line of the price: what it is and its dollars. */
export type PriceLine = { what: string; usd: number };

/** The build's price, line by line, from the constants above: the Generate button's total is their sum. */
export function modelBuildPrice(engine: ModelEngine, kind: ModelInputKind, opts: ModelBuildOptions): PriceLine[] {
  switch (engine.id) {
    case "trellis-2":
      return [{ what: `TRELLIS.2 at ${opts.detail}p`, usd: TRELLIS_USD[opts.detail] }];
    case "hunyuan-3.1-pro": {
      const lines: PriceLine[] = [{ what: "Hunyuan 3D v3.1 Pro", usd: HUNYUAN_USD.base }];
      if (opts.pbr) lines.push({ what: "PBR materials", usd: HUNYUAN_USD.pbr });
      if (kind === "multi") lines.push({ what: "Multi-view images", usd: HUNYUAN_USD.multiView });
      if (opts.polycount !== null) lines.push({ what: "Custom face count", usd: HUNYUAN_USD.faceCount });
      return lines;
    }
    case "tripo-2.5": {
      const lines: PriceLine[] = [{ what: opts.textures === "none" ? "Tripo v2.5, no textures" : opts.textures === "hd" ? "Tripo v2.5, HD textures" : "Tripo v2.5, standard textures", usd: TRIPO_USD[opts.textures] }];
      if (opts.quad) lines.push({ what: "Quad mesh", usd: TRIPO_USD.quad });
      return lines;
    }
    case "meshy-7.1": {
      const lines: PriceLine[] = [opts.textures === "none" ? { what: "Meshy 7.1, no textures", usd: MESHY_USD.untextured } : { what: "Meshy 7.1, textured", usd: MESHY_USD.textured }];
      if (opts.rig) lines.push({ what: "Auto-rigging", usd: MESHY_USD.rig });
      return lines;
    }
  }
}

/** The total in dollars, to the cent (the lines are exact quarters and fifths of a dollar, summed in thousandths). */
export function modelBuildUsd(engine: ModelEngine, kind: ModelInputKind, opts: ModelBuildOptions): number {
  return Math.round(modelBuildPrice(engine, kind, opts).reduce((s, l) => s + Math.round(l.usd * 1000), 0)) / 1000;
}

/** Dollars as fal writes them, never rounded: "$0.375", "$0.675", "$1.40". */
export function usdText(usd: number): string {
  const mills = Math.round(usd * 1000);
  return `$${(mills / 1000).toFixed(mills % 10 === 0 ? 2 : 3)}`;
}

// ---------------------------------------------------------------------------
// What each engine is sent
// ---------------------------------------------------------------------------

/** The images of one build: one for "image", up to four named views for "multi" (front first, and required). */
export type ModelImages = Partial<Record<ModelView, string>>;

export type ModelBuildInput = { kind: ModelInputKind; prompt: string; images: ModelImages; options: ModelBuildOptions };

/** Why a build can't be asked for, in the words the bar says, or null. */
export function modelInputProblem(engine: ModelEngine, input: ModelBuildInput): string | null {
  if (!engine.endpoints[input.kind]) return `${engine.name} doesn't build from ${input.kind === "text" ? "words" : input.kind === "image" ? "a photo" : "several views"}.`;
  if (input.kind === "text") {
    const p = input.prompt.trim();
    if (!p) return "Describe the model first.";
    if (p.length > engine.promptMax) return `Keep the description under ${engine.promptMax} characters.`;
    return null;
  }
  if (!input.images.front) return input.kind === "multi" ? "Add the front view first." : "Add a photo first.";
  if (input.kind === "multi" && MODEL_VIEWS.filter((v) => input.images[v]).length < 2) return "Add at least one more view (back, left or right), or build from the one photo.";
  return null;
}

/** The endpoint and body for this build. Throws on an input modelInputProblem refuses (the caller asks it first). */
export function modelBuildRequest(engine: ModelEngine, input: ModelBuildInput): { endpoint: string; body: Record<string, unknown> } {
  const endpoint = engine.endpoints[input.kind];
  if (!endpoint || modelInputProblem(engine, input)) throw new Error("model build input refused");
  const o = input.options;
  const views = MODEL_VIEWS.filter((v) => input.images[v]).map((v) => input.images[v] as string);
  switch (engine.id) {
    case "trellis-2":
      return {
        endpoint,
        body: { image_url: input.images.front, resolution: o.detail, decimation_target: o.polycount ?? THING_BUILD_VERTICES, texture_size: THING_BUILD_TEXTURE, remesh: true },
      };
    case "hunyuan-3.1-pro": {
      const body: Record<string, unknown> = { generate_type: o.textures === "none" ? "Geometry" : "Normal", enable_pbr: o.pbr };
      if (o.polycount !== null) body.face_count = o.polycount;
      if (input.kind === "text") body.prompt = input.prompt.trim();
      else {
        body.input_image_url = input.images.front;
        if (input.kind === "multi") {
          if (input.images.back) body.back_image_url = input.images.back;
          if (input.images.left) body.left_image_url = input.images.left;
          if (input.images.right) body.right_image_url = input.images.right;
        }
      }
      return { endpoint, body };
    }
    case "tripo-2.5": {
      const body: Record<string, unknown> = { texture: o.textures === "hd" ? "HD" : o.textures === "none" ? "no" : "standard", quad: o.quad };
      if (o.polycount !== null) body.face_limit = o.polycount;
      if (input.kind === "multi") {
        body.front_image_url = input.images.front;
        if (input.images.back) body.back_image_url = input.images.back;
        if (input.images.left) body.left_image_url = input.images.left;
        if (input.images.right) body.right_image_url = input.images.right;
      } else body.image_url = input.images.front;
      return { endpoint, body };
    }
    case "meshy-7.1": {
      const body: Record<string, unknown> = {
        topology: o.quad ? "quad" : "triangle",
        enable_rigging: o.rig,
        enable_animation: false,
        enable_pbr: false,
      };
      if (o.polycount !== null) body.target_polycount = o.polycount;
      if (o.rig) body.pose_mode = "a-pose";
      if (input.kind === "text") {
        body.prompt = input.prompt.trim();
        body.mode = o.textures === "none" ? "preview" : "full";
      } else {
        body.should_texture = o.textures !== "none";
        if (input.kind === "multi") body.image_urls = views;
        else body.image_url = input.images.front;
      }
      return { endpoint, body };
    }
  }
}

// ---------------------------------------------------------------------------
// fal's queue, for exactly these endpoints, and the .glb in its answer
// ---------------------------------------------------------------------------

export type ModelBuildHandle = { requestId: string; statusUrl: string; responseUrl: string };

const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * fal's queue host, about one request of THIS endpoint — never an arbitrary URL the page could send back. fal names a
 * sub-endpoint's queue by its owner and app (…/fal-ai/hunyuan-3d/requests/…, …/tripo3d/tripo/requests/…); the rest
 * of the endpoint's own path is allowed too, so a build answered either way is still collected after it was paid.
 */
export function queueUrlPattern(endpoint: string): RegExp {
  const parts = endpoint.split("/");
  const app = parts.slice(0, 2).map(reEsc).join("\\/");
  const rest = parts.slice(2).map(reEsc).join("\\/");
  return new RegExp(`^https:\\/\\/queue\\.fal\\.run\\/${app}${rest ? `(\\/${rest})?` : ""}\\/requests\\/[a-z0-9-]+(\\/status)?$`, "i");
}

/** The handle fal answered a submit to `endpoint` with, or null. */
export function readModelHandle(endpoint: string, job: unknown): ModelBuildHandle | null {
  const j = (job ?? {}) as { request_id?: unknown; status_url?: unknown; response_url?: unknown };
  if (typeof j.request_id !== "string" || !/^[a-z0-9-]{8,80}$/i.test(j.request_id)) return null;
  const h = { requestId: j.request_id, statusUrl: j.status_url, responseUrl: j.response_url };
  return modelHandleAllowed(endpoint, h) ? h : null;
}

/** A handle sent back by the page: only fal's queue, only this endpoint, only one request. */
export function modelHandleAllowed(endpoint: string, h: unknown): h is ModelBuildHandle {
  const x = (h ?? {}) as Partial<ModelBuildHandle>;
  const re = queueUrlPattern(endpoint);
  return (
    typeof x.requestId === "string" &&
    /^[a-z0-9-]{8,80}$/i.test(x.requestId) &&
    typeof x.statusUrl === "string" &&
    typeof x.responseUrl === "string" &&
    re.test(x.statusUrl) &&
    re.test(x.responseUrl) &&
    x.statusUrl.includes(`/requests/${x.requestId}`) &&
    x.responseUrl.includes(`/requests/${x.requestId}`)
  );
}

/** A file on fal's own file host, or null. */
function falFile(v: unknown): { url: string; size: number | null } | null {
  const f = v as { url?: unknown; file_size?: unknown } | null | undefined;
  if (!f || typeof f.url !== "string") return null;
  try {
    const u = new URL(f.url);
    if (u.protocol !== "https:" || (u.hostname !== "fal.media" && !u.hostname.endsWith(".fal.media"))) return null;
  } catch {
    return null;
  }
  return { url: f.url, size: typeof f.file_size === "number" ? f.file_size : null };
}

/**
 * The .glb an engine's answer names (each engine's own output schema, read 2026-10-01): model_glb for TRELLIS.2,
 * Hunyuan and Meshy — Meshy's rigged_character_glb first when it was asked to rig — and model_mesh for Tripo.
 */
export function modelResultGlb(engine: ModelEngine, rig: boolean, result: unknown): { url: string; size: number | null } | null {
  const r = (result ?? {}) as Record<string, unknown>;
  if (engine.id === "tripo-2.5") return falFile(r.model_mesh);
  if (engine.id === "meshy-7.1" && rig) return falFile(r.rigged_character_glb) ?? falFile(r.model_glb);
  return falFile(r.model_glb);
}
