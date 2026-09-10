// THE ONLY gpt-6-astra CLIENT (2026-09-10). Every Astra request in the
// product is built by buildAstraRequestBody and sent from this file; the
// astra-guard test fails the suite if the model name appears anywhere else
// in src/, or if a request stops carrying the fixed parts below.
//
// What every request carries, and why:
//   background: true   A set build takes ~90 s (measured 2026-09-10) — far
//                      past what one server action should hold open. Submit
//                      returns at once; the page polls pollAstraJob.
//   store: false       The brief is not kept at OpenAI beyond the ~10
//                      minutes background mode needs to hand the answer back.
//   tools: []          Astra's hosted tools include an image generator, a
//                      code sandbox and web search. None of them may make
//                      pixels, run code or spend money outside our lanes, so
//                      the request offers none.
//   strict json_schema The answer is data for normaliseSetSpec, never prose
//                      and never code.
//   safety_identifier  So OpenAI can act on one account, not our org.
//   effort low|medium  Reasoning bills as output at $50/M; xhigh and max are
//                      refused here, whatever a caller asks for.
//   no temperature, top_p or seed — the model rejects them.
//
// Measured on our key, 2026-09-10, with the set schema: background mode
// with store:false, strict json_schema, safety_identifier and
// prompt_cache_options.ttl were all accepted; 90.5 s, 1,626 input and 5,593
// output tokens, $0.296.
//
// Relative imports only: the guard test imports this module directly.

import { fetchWithTimeout } from "./fetch-with-timeout";
import { costOfAstraUsageUsd, type AstraUsage } from "../../astra/prices";

export const ASTRA_MODEL = "gpt-6-astra";

const RESPONSES_URL = "https://api.openai.com/v1/responses";
const MISALIGNMENT = "misalignment_policy_violation";
const RESPONSE_ID_RE = /^resp_[A-Za-z0-9]{8,200}$/;

export type AstraEffort = "low" | "medium";

export type AstraJobRequest = {
  instructions: string;
  input: string;
  schemaName: string;
  schema: Record<string, unknown>;
  maxOutputTokens: number;
  effort: AstraEffort;
  safetyIdentifier: string | undefined;
};

export function buildAstraRequestBody(req: AstraJobRequest): Record<string, unknown> {
  const effort: AstraEffort = req.effort === "medium" ? "medium" : "low";
  return {
    model: ASTRA_MODEL,
    background: true,
    store: false,
    instructions: req.instructions,
    input: req.input,
    text: { format: { type: "json_schema", name: req.schemaName, schema: req.schema, strict: true } },
    reasoning: { effort },
    max_output_tokens: Math.max(256, Math.min(32_000, Math.floor(req.maxOutputTokens))),
    tools: [],
    ...(req.safetyIdentifier ? { safety_identifier: req.safetyIdentifier } : {}),
    prompt_cache_options: { ttl: "30m" },
  };
}

export type AstraSubmitResult =
  | { ok: true; responseId: string }
  | { ok: false; kind: "config" | "refused" | "rate_limited" | "unavailable" | "bad_request"; detail: string };

export async function submitAstraJob(req: AstraJobRequest): Promise<AstraSubmitResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, kind: "config", detail: "OPENAI_API_KEY is missing" };
  let res: Response;
  try {
    res = await fetchWithTimeout(
      RESPONSES_URL,
      {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify(buildAstraRequestBody(req)),
      },
      30_000,
    );
  } catch (err) {
    return { ok: false, kind: "unavailable", detail: err instanceof Error ? err.message : String(err) };
  }
  const body = (await res.json().catch(() => null)) as { id?: string; error?: { code?: string; message?: string } } | null;
  if (!res.ok) {
    const detail = `${res.status} ${body?.error?.code ?? ""} ${(body?.error?.message ?? "").slice(0, 200)}`.trim();
    // Only OpenAI's misalignment block is a refusal of what was asked. A 403
    // also means an unsupported region, or a project without access to the
    // model — our configuration, not the person's words, and it must never be
    // logged as a safety refusal of their brief.
    if (body?.error?.code === MISALIGNMENT) return { ok: false, kind: "refused", detail };
    if (res.status === 401 || res.status === 403) return { ok: false, kind: "config", detail };
    if (res.status === 429) return { ok: false, kind: "rate_limited", detail };
    if (res.status >= 500) return { ok: false, kind: "unavailable", detail };
    return { ok: false, kind: "bad_request", detail };
  }
  if (!body?.id || !RESPONSE_ID_RE.test(body.id)) {
    return { ok: false, kind: "unavailable", detail: "no response id" };
  }
  return { ok: true, responseId: body.id };
}

export type AstraPollResult =
  | { state: "working" }
  | { state: "done"; text: string; usage: AstraUsage | null; costUsd: number }
  | {
      state: "failed";
      /** refused: a safety stop, never retried. expired: the answer is gone. */
      kind: "refused" | "incomplete" | "failed" | "expired" | "cancelled";
      detail: string;
      usage: AstraUsage | null;
      costUsd: number;
    };

type ResponseBody = {
  status?: string;
  usage?: AstraUsage | null;
  error?: { code?: string; message?: string } | null;
  incomplete_details?: { reason?: string } | null;
  output?: { type?: string; content?: { type?: string; text?: string; refusal?: string }[] }[];
};

export async function pollAstraJob(responseId: string): Promise<AstraPollResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !RESPONSE_ID_RE.test(responseId)) {
    return { state: "failed", kind: "failed", detail: "cannot poll", usage: null, costUsd: 0 };
  }
  let res: Response;
  try {
    res = await fetchWithTimeout(`${RESPONSES_URL}/${responseId}`, { headers: { authorization: `Bearer ${key}` } }, 15_000);
  } catch {
    // The wire, not the job. The caller's staleness limit bounds how long
    // "working" can be the answer.
    return { state: "working" };
  }
  const body = (await res.json().catch(() => null)) as ResponseBody | null;
  if (res.status === 404) {
    return { state: "failed", kind: "expired", detail: "response no longer exists", usage: null, costUsd: 0 };
  }
  if (body?.error?.code === MISALIGNMENT) {
    return { state: "failed", kind: "refused", detail: `${res.status} ${MISALIGNMENT}`, usage: body?.usage ?? null, costUsd: costOfAstraUsageUsd(body?.usage) };
  }
  if (res.status === 401 || res.status === 403) {
    return { state: "failed", kind: "failed", detail: `${res.status} ${body?.error?.code ?? ""}`.trim(), usage: null, costUsd: 0 };
  }
  if (!res.ok || !body) return { state: "working" };

  const usage = body.usage ?? null;
  const costUsd = costOfAstraUsageUsd(usage);
  switch (body.status) {
    case "queued":
    case "in_progress":
      return { state: "working" };
    case "completed": {
      const parts = (body.output ?? []).filter((o) => o.type === "message").flatMap((o) => o.content ?? []);
      const refusal = parts.find((p) => p.type === "refusal");
      if (refusal) return { state: "failed", kind: "refused", detail: "model refusal", usage, costUsd };
      const text = parts
        .filter((p) => p.type === "output_text")
        .map((p) => p.text ?? "")
        .join("");
      if (!text) return { state: "failed", kind: "failed", detail: "empty answer", usage, costUsd };
      return { state: "done", text, usage, costUsd };
    }
    case "incomplete": {
      const reason = body.incomplete_details?.reason ?? "unknown";
      return {
        state: "failed",
        kind: reason === "content_filter" ? "refused" : "incomplete",
        detail: reason,
        usage,
        costUsd,
      };
    }
    case "cancelled":
      return { state: "failed", kind: "cancelled", detail: "cancelled", usage, costUsd };
    case "failed":
    default:
      return {
        state: "failed",
        kind: body.error?.code === MISALIGNMENT ? "refused" : "failed",
        detail: `${body.status ?? "?"} ${body.error?.code ?? ""}`.trim(),
        usage,
        costUsd,
      };
  }
}

/** Best-effort: stop a job nobody will collect. Never throws. */
export async function cancelAstraJob(responseId: string): Promise<void> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !RESPONSE_ID_RE.test(responseId)) return;
  try {
    await fetchWithTimeout(`${RESPONSES_URL}/${responseId}/cancel`, { method: "POST", headers: { authorization: `Bearer ${key}` } }, 10_000);
  } catch {
    // Nothing to do: an uncancelled job finishes and is discarded.
  }
}
