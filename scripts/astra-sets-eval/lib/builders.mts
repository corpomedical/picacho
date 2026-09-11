// What each builder is sent, and how its answer is read.
//
// ASTRA. The product's own text-build request (sets/astra-request.ts
// setAstraRequest), with only the arm's effort changed, built into a body by
// the product's own buildAstraRequestBody. The model id comes in with that
// body (providers/astra.ts is the only file that names it); this runner never
// writes it. A Batch line is that body with `background` removed — Batch is
// itself asynchronous — and nothing else changed: store:false, tools:[],
// the strict schema, the effort clamp, max_output_tokens, safety_identifier
// and prompt_cache_options all stay. If Batch rejects one of them, `a --probe`
// says which. In a full run, a batch that fails validation stops the run
// (exit 2, every attempt still pending for --resume), and a line rejected
// with a 400 is not_run:rejected — outside the validity denominator, so the
// A bars can only pass if they hold whatever it would have done. The runner
// never quietly drops a product field.
//
// A PHOTO BUILD is the product's own photoBuildRequest (the first attempt)
// or retryBuildRequest (the one retry: the photo again, its notes, then the
// feedback), with only the arm's effort changed: the photo caps, the photo
// inline at detail high. It never goes on Batch: a Batch line is a line of
// an uploaded input file, and a photo in it would sit in OpenAI's Files
// storage, which the product never does. batchLineBody refuses any input
// that is not plain text.
//
// THE SAFETY IDENTIFIER is evalSafetyId(part): sha256 of a fixed label and
// the part — the production shape (64 hex), no secret, no real account. It
// is never rotated: if OpenAI acts on Part D's identifier, that isolation
// from real users is the point.
//
// BASELINES. gpt-5.4-mini on the Responses API (same instructions, same
// strict schema, no reasoning or temperature fields: the model's defaults),
// read through the same pollAstraJob interpreter via a locally served
// response — but priced from its own usage, never Astra's. claude-sonnet-5 on
// the Messages API, with the schema as structured output (`format`) or
// appended to the system prompt (`prompt`); no temperature (the model
// rejects it, anthropic.ts). Both go through the same advanceBuild, retry
// rules and words gate as Astra.

import { buildAstraRequestBody, type AstraEffort, type AstraJobRequest } from "../../../src/lib/generations/providers/astra.ts";
import { SET_BUILDER_INSTRUCTIONS, SET_SPEC_JSON_SCHEMA, SET_SPEC_SCHEMA_NAME } from "../../../src/lib/sets/set-builder-prompt.ts";
import { photoBuildRequest, retryBuildRequest, setAstraRequest } from "../../../src/lib/sets/astra-request.ts";
import { SET_BUILD_MAX_OUTPUT_TOKENS } from "../../../src/lib/sets/set-config.ts";
import type { BuildState, TransportResult } from "./build-flow.mts";
import { BASELINE_MODELS } from "./prices.mts";
import { isRecord, sha256 } from "./util.mts";

export function evalSafetyId(part: string): string {
  return sha256(`picacho:eval:astra-sets:v1:${part}`);
}

export function astraJobRequest(input: string, effort: AstraEffort, part: string): AstraJobRequest {
  // Exactly what a text build sends (instructions, schema, caps), so a
  // product change reaches the eval without a copy to update; only the
  // effort is the arm's own.
  return { ...setAstraRequest(input, evalSafetyId(part), "text"), effort };
}

/**
 * The request for a photo build's attempt in s.next: the product's
 * photoBuildRequest or retryBuildRequest over the photo's bytes (as a data
 * URL, the ones first sent: PhotoStore.dataUrlFor), with the arm's effort.
 */
export function photoJobRequest(s: BuildState, photoDataUrl: string, effort: AstraEffort, part: string): AstraJobRequest {
  if (!s.photo || !s.next) throw new Error(`${s.buildId}: not a photo build with an attempt to send`);
  const sid = evalSafetyId(part);
  if (s.next.kind === "first") return { ...photoBuildRequest(photoDataUrl, s.photo.notes, sid), effort };
  if (!s.next.retry) throw new Error(`${s.buildId}: a photo retry without its reason`);
  const req = retryBuildRequest({ kind: "photo", notes: s.photo.notes, photo: photoDataUrl }, s.next.retry, sid);
  // Null only when there is no photo to resend, and the photo is in hand.
  if (!req) throw new Error(`${s.buildId}: the product would not resend this photo`);
  return { ...req, effort };
}

/**
 * The product body minus `background`, for a Batch line. Plain text only: a
 * photo in a Batch input file would be uploaded to OpenAI's Files storage.
 */
export function batchLineBody(req: AstraJobRequest): Record<string, unknown> {
  if (typeof req.input !== "string") throw new Error("a Batch line carries plain text only: a photo would be uploaded to OpenAI's Files storage, which the product never does");
  const body = { ...buildAstraRequestBody(req) };
  delete body.background;
  return body;
}

export function customIdFor(buildId: string, attempt: number): string {
  return `${buildId}-a${attempt}`;
}

export function parseCustomId(id: string): { buildId: string; attempt: number } | null {
  const m = /^(.+)-a(\d)$/.exec(id);
  return m ? { buildId: m[1], attempt: Number(m[2]) } : null;
}

export function batchLine(customId: string, body: Record<string, unknown>) {
  return { custom_id: customId, method: "POST" as const, url: "/v1/responses" as const, body };
}

/** An HTTP error, mapped the way submitAstraJob maps one. */
export function mapHttpError(status: number, code: string | undefined): "refused" | "config" | "rate_limited" | "unavailable" | "bad_request" {
  if (code === "misalignment_policy_violation") return "refused";
  if (status === 401 || status === 403) return "config";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "unavailable";
  return "bad_request";
}

export const MINI_MODEL = BASELINE_MODELS["mini-5.4"];
export const SONNET_MODEL = BASELINE_MODELS["sonnet-5"];

export function miniRequestBody(input: string): Record<string, unknown> {
  return {
    model: MINI_MODEL,
    instructions: SET_BUILDER_INSTRUCTIONS,
    input,
    text: { format: { type: "json_schema", name: SET_SPEC_SCHEMA_NAME, schema: SET_SPEC_JSON_SCHEMA, strict: true } },
    max_output_tokens: SET_BUILD_MAX_OUTPUT_TOKENS,
    store: false,
  };
}

export const SONNET_SCHEMA_LEAD = "\n\nAnswer with ONLY one JSON object that matches this JSON schema, and nothing else:\n";

export function sonnetRequestBody(input: string, mode: "format" | "prompt"): Record<string, unknown> {
  if (mode === "format") {
    return {
      model: SONNET_MODEL,
      max_tokens: SET_BUILD_MAX_OUTPUT_TOKENS,
      system: SET_BUILDER_INSTRUCTIONS,
      messages: [{ role: "user", content: input }],
      output_config: { format: { type: "json_schema", schema: SET_SPEC_JSON_SCHEMA }, effort: "low" },
    };
  }
  return {
    model: SONNET_MODEL,
    max_tokens: SET_BUILD_MAX_OUTPUT_TOKENS,
    system: SET_BUILDER_INSTRUCTIONS + SONNET_SCHEMA_LEAD + JSON.stringify(SET_SPEC_JSON_SCHEMA),
    messages: [{ role: "user", content: input }],
    output_config: { effort: "low" },
  };
}

/** A Messages API answer as a transport result. */
export function interpretSonnet(body: unknown): TransportResult {
  if (!isRecord(body)) return { state: "failed", kind: "failed", detail: "unreadable answer", usage: null };
  const usage = isRecord(body.usage) ? body.usage : null;
  const blocks = Array.isArray(body.content) ? body.content : [];
  const text = blocks
    .filter((b): b is Record<string, unknown> => isRecord(b) && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
  switch (body.stop_reason) {
    case "end_turn":
      return text ? { state: "done", text, usage } : { state: "failed", kind: "failed", detail: "empty answer", usage };
    case "max_tokens":
      return { state: "failed", kind: "incomplete", detail: "max_tokens", usage };
    case "refusal":
      return { state: "failed", kind: "refused", detail: "model refusal", usage };
    default:
      return { state: "failed", kind: "failed", detail: `stop_reason ${String(body.stop_reason)}`, usage };
  }
}
