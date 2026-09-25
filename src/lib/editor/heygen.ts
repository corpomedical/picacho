// HeyGen's HyperFrames cloud renderer — where an edit made on the Edit Bay
// timeline is drawn (Export). Opus renders its own cuts in its sandbox; a
// customer's timeline edit needs no Opus at all, so it goes here: restored
// from v1 (git f7dd771^), which proved it live on the first real edit.
//
// Why not on Vercel: a local render ran at ~5.4× real time on the operator's
// Mac (12 s of video in 65 s, 2026-09-24), so a one-minute edit is minutes of
// headless Chrome — past a 300 s function, and Chrome plus ffmpeg would not
// fit the function bundle anyway.
//
// The calls are HeyGen's own, read from the CLI's client (hyperframes 0.8.72,
// src/cloud/upload.ts and the generated API client) because the public page
// does not spell out the upload fields:
//   POST /v3/assets/direct-uploads {filename, content_type, size_bytes, checksum_sha256}
//     → {asset_id, upload_url, upload_headers}
//   PUT  upload_url (the zip bytes, content-type application/zip + upload_headers)
//   POST /v3/assets/{asset_id}/complete {checksum_sha256}   (409 = not ready yet, retry)
//   POST /v3/hyperframes/renders {project:{type:"asset_id",asset_id}, fps, quality, resolution, aspect_ratio, callback_url?, callback_id?}
//     → {render_id}
//   GET  /v3/hyperframes/renders/{id} → {status: queued|rendering|completed|failed, video_url, duration, failure_message}
// Every reply is wrapped as {data: …}; errors as {error: {code, message}}.
// Auth: the `x-api-key` header, HEYGEN_API_KEY.
//
// A callback is only ever a NUDGE to poll: its body is never trusted for the
// outcome, the render is re-read with our key. That leaves nothing to forge.

import { createHash } from "node:crypto";
/** The shapes HeyGen renders. */
export type Aspect = "16:9" | "9:16" | "1:1";

const BASE = process.env.HEYGEN_API_URL || "https://api.heygen.com";
/** HeyGen's direct-upload ceiling for a project archive. */
export const HEYGEN_MAX_BUNDLE_BYTES = 200 * 1024 * 1024;
const COMPLETE_TRIES = 5;

export type RenderStatus = "queued" | "rendering" | "completed" | "failed";
export type RenderState = {
  status: RenderStatus;
  videoUrl: string | null;
  duration: number | null;
  failure: string | null;
};

export class HeygenError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
  ) {
    super(message);
  }
}

export function heygenConfigured(): boolean {
  return Boolean(process.env.HEYGEN_API_KEY);
}

type Fetch = typeof fetch;

async function call<T>(method: string, path: string, body: unknown, opts: { fetchFn?: Fetch; idempotencyKey?: string } = {}): Promise<T> {
  const key = process.env.HEYGEN_API_KEY;
  if (!key) throw new HeygenError("HEYGEN_API_KEY is not set", 0);
  const headers: Record<string, string> = { "x-api-key": key };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  const res = await (opts.fetchFn ?? fetch)(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const err = (parsed as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    const message = typeof err?.message === "string" ? err.message : `HTTP ${res.status}`;
    throw new HeygenError(`HeyGen ${method} ${path}: ${message}`, res.status, typeof err?.code === "string" ? err.code : null);
  }
  const envelope = parsed as { data?: unknown } | null;
  return (envelope && typeof envelope === "object" && "data" in envelope ? envelope.data : parsed) as T;
}

/** Upload a project .zip; returns the asset id to render from. */
export async function uploadBundle(zip: Uint8Array, opts: { filename: string; idempotencyKey?: string; fetchFn?: Fetch }): Promise<string> {
  if (zip.byteLength > HEYGEN_MAX_BUNDLE_BYTES) {
    throw new HeygenError(`bundle is ${(zip.byteLength / 1e6).toFixed(1)} MB; HeyGen takes at most 200 MB`, 413);
  }
  const checksum = createHash("sha256").update(zip).digest("hex");
  const init = await call<{ asset_id: string; upload_url: string; upload_headers?: Record<string, unknown> }>(
    "POST",
    "/v3/assets/direct-uploads",
    { filename: opts.filename, content_type: "application/zip", size_bytes: zip.byteLength, checksum_sha256: checksum },
    { fetchFn: opts.fetchFn, idempotencyKey: opts.idempotencyKey },
  );
  const headers: Record<string, string> = { "content-type": "application/zip" };
  for (const [k, v] of Object.entries(init.upload_headers ?? {})) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") headers[k] = String(v);
  }
  const put = await (opts.fetchFn ?? fetch)(init.upload_url, { method: "PUT", headers, body: zip as BodyInit, signal: AbortSignal.timeout(240_000) });
  if (!put.ok) throw new HeygenError(`bundle upload PUT answered ${put.status}`, put.status);
  for (let attempt = 0; ; attempt++) {
    try {
      const done = await call<{ asset_id: string }>("POST", `/v3/assets/${encodeURIComponent(init.asset_id)}/complete`, { checksum_sha256: checksum }, { fetchFn: opts.fetchFn });
      return done.asset_id;
    } catch (err) {
      if (!(err instanceof HeygenError) || err.status !== 409 || attempt >= COMPLETE_TRIES - 1) throw err;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

export async function startRender(
  assetId: string,
  opts: { aspect: Aspect; fps?: 24 | 30 | 60; quality?: "draft" | "standard" | "high"; title?: string; callbackUrl?: string; callbackId?: string; idempotencyKey?: string; fetchFn?: Fetch },
): Promise<string> {
  const body: Record<string, unknown> = {
    project: { type: "asset_id", asset_id: assetId },
    fps: opts.fps ?? 30,
    quality: opts.quality ?? "high",
    format: "mp4",
    resolution: "1080p",
    aspect_ratio: opts.aspect,
  };
  if (opts.title) body.title = opts.title.slice(0, 500);
  if (opts.callbackUrl) body.callback_url = opts.callbackUrl;
  if (opts.callbackId) body.callback_id = opts.callbackId.slice(0, 256);
  const out = await call<{ render_id: string }>("POST", "/v3/hyperframes/renders", body, { fetchFn: opts.fetchFn, idempotencyKey: opts.idempotencyKey });
  return out.render_id;
}

export async function readRender(renderId: string, opts: { fetchFn?: Fetch } = {}): Promise<RenderState> {
  const d = await call<{ status?: unknown; video_url?: unknown; duration?: unknown; failure_message?: unknown }>(
    "GET",
    `/v3/hyperframes/renders/${encodeURIComponent(renderId)}`,
    undefined,
    opts,
  );
  const status: RenderStatus =
    d.status === "completed" || d.status === "failed" || d.status === "rendering" ? d.status : "queued";
  return {
    status,
    videoUrl: typeof d.video_url === "string" ? d.video_url : null,
    duration: typeof d.duration === "number" ? d.duration : null,
    failure: typeof d.failure_message === "string" ? d.failure_message : null,
  };
}
