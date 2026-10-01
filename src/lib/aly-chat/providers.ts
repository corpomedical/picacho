// GPT and Gemini, streamed (2026-09-29). Plain fetch, like every other
// OpenAI and Google call in this codebase (shot-words.ts, judge.ts), so there
// is no new package and each is testable with a fake fetch. Relative imports
// only.
//
// Neither gets tools in this version: they answer from the conversation and
// its files. Searching the web, writing documents, remembering and preparing
// pictures are Claude's (the lane that has Aly's hands).

import { fromGemini, fromOpenAI, GEMINI_MODEL, GPT_MODEL, NO_USAGE, type Usage } from "./brains";
import type { GeminiContent, OpenAIMessage } from "./history";

export type LaneEvent = { type: "text"; text: string };
export type LaneResult = { usage: Usage; model: string; text: string };

type Fetch = typeof fetch;

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly kind: "not_configured" | "refused" | "busy" | "unavailable",
  ) {
    super(message);
  }
}

export function kindForStatus(status: number): ProviderError["kind"] {
  if (status === 401 || status === 403) return "unavailable";
  if (status === 429 || status >= 500) return "busy";
  return "refused";
}

/** Server-sent events, one `data:` payload at a time. */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i).replace(/^\r?\n\r?\n/, "");
      const data = chunk
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""))
        .join("\n");
      if (data) yield data;
    }
  }
  const tail = buf
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).replace(/^ /, ""))
    .join("\n");
  if (tail) yield tail;
}

// ---------------------------------------------------------------------------
// GPT-6 Sol on Chat Completions (developers.openai.com, read 2026-09-29:
// streaming, `reasoning_effort` none…max, images and PDF `file` parts; tools
// on Chat Completions only at reasoning none — none are sent here).

export async function* streamGpt(
  a: { messages: OpenAIMessage[]; harder: boolean; maxOutput: number; signal: AbortSignal; apiKey?: string; fetchFn?: Fetch },
): AsyncGenerator<LaneEvent, LaneResult> {
  const key = a.apiKey ?? process.env.OPENAI_API_KEY;
  if (!key) throw new ProviderError("GPT isn't set up", null, "not_configured");
  const res = await (a.fetchFn ?? fetch)("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: GPT_MODEL,
      messages: a.messages,
      stream: true,
      stream_options: { include_usage: true },
      reasoning_effort: a.harder ? "high" : "low",
      max_completion_tokens: a.maxOutput,
      store: false,
    }),
    signal: a.signal,
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new ProviderError(`GPT answered ${res.status}: ${detail.slice(0, 200)}`, res.status, kindForStatus(res.status));
  }
  let usage: Usage = NO_USAGE;
  let text = "";
  let model = GPT_MODEL;
  for await (const data of sseData(res.body)) {
    if (data === "[DONE]") break;
    let j: {
      model?: string;
      choices?: { delta?: { content?: string | null; refusal?: string | null } }[];
      usage?: Parameters<typeof fromOpenAI>[0];
    };
    try {
      j = JSON.parse(data);
    } catch {
      continue;
    }
    if (typeof j.model === "string") model = j.model.startsWith(GPT_MODEL) ? GPT_MODEL : j.model;
    const delta = j.choices?.[0]?.delta;
    const piece = delta?.content ?? delta?.refusal ?? "";
    if (piece) {
      text += piece;
      yield { type: "text", text: piece };
    }
    if (j.usage) usage = fromOpenAI(j.usage);
  }
  return { usage, model, text };
}

// ---------------------------------------------------------------------------
// Gemini 3.8 Flash on generateContent, streamed as SSE (ai.google.dev, read
// 2026-09-29). The key goes in the x-goog-api-key header, never the URL
// (same rule as product-lock/judge.ts). A 400 naming the thinking setting is
// retried once without it, so an API change can't take the lane down.

export const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export async function* streamGemini(
  a: {
    system: string;
    contents: GeminiContent[];
    harder: boolean;
    maxOutput: number;
    signal: AbortSignal;
    apiKey?: string;
    fetchFn?: Fetch;
  },
): AsyncGenerator<LaneEvent, LaneResult> {
  const key = a.apiKey ?? process.env.GEMINI_API_KEY;
  if (!key) throw new ProviderError("Gemini isn't set up", null, "not_configured");
  const call = (withThinking: boolean) =>
    (a.fetchFn ?? fetch)(`${GEMINI_ENDPOINT}/${GEMINI_MODEL}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: a.system }] },
        contents: a.contents,
        generationConfig: {
          maxOutputTokens: a.maxOutput,
          ...(withThinking ? { thinkingConfig: { thinkingLevel: a.harder ? "high" : "low" } } : {}),
        },
      }),
      signal: a.signal,
    });
  let res = await call(true);
  if (res.status === 400) {
    const detail = await res.clone().text().catch(() => "");
    if (/thinking/i.test(detail)) res = await call(false);
  }
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new ProviderError(`Gemini answered ${res.status}: ${detail.slice(0, 200)}`, res.status, kindForStatus(res.status));
  }
  let usage: Usage = NO_USAGE;
  let text = "";
  let blocked: string | null = null;
  for await (const data of sseData(res.body)) {
    let j: {
      candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
      usageMetadata?: Parameters<typeof fromGemini>[0];
      promptFeedback?: { blockReason?: string };
    };
    try {
      j = JSON.parse(data);
    } catch {
      continue;
    }
    if (j.promptFeedback?.blockReason) blocked = j.promptFeedback.blockReason;
    for (const part of j.candidates?.[0]?.content?.parts ?? []) {
      if (part.thought || !part.text) continue;
      text += part.text;
      yield { type: "text", text: part.text };
    }
    if (j.usageMetadata) usage = fromGemini(j.usageMetadata);
  }
  if (!text && blocked) throw new ProviderError(`Gemini declined (${blocked})`, 200, "refused");
  return { usage, model: GEMINI_MODEL, text };
}
