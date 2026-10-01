// GPT-6 Luna, Aly's everyday brain on her own page, with her hands
// (2026-10-01, operator: "Adopt the round 2 table": the everyday chat
// allowance is costed at $0.0006 a message, which only holds on Luna).
//
// OpenAI's Responses API, streamed, with plain fetch like providers.ts.
// Relative imports only, so it is unit-tested with a fake fetch.
//
// THE SAME ALY. The chat's saved setup goes out as it is: her rules and the
// catalogue as `instructions`, the per-chat part (what she's called, her
// notes, the project) as the first developer message, so the long part every
// chat shares stays one cacheable prefix. Her tools are translated one for
// one: each of her own tools becomes a function with the same schema (strict
// where Claude's is), her notes (Claude's memory tool) a `memory` function
// with the same commands, and web search OpenAI's hosted web_search. The
// route runs every call through the same runners as Claude's, so a card, a
// document, an opened page or a started render is the same thing whichever
// brain asked for it.
//
// APPEND-ONLY, LIKE CLAUDE'S TURNS. Luna's own items for a turn (reasoning,
// tool calls, our tool outputs, her message) are stored verbatim and sent
// back unchanged on later turns (store: false with reasoning.encrypted_content,
// so OpenAI keeps nothing and her reasoning still carries across tool calls).

import {
  LUNA_MODEL,
  NO_USAGE,
  WEB_SEARCH_MAX_USES,
  WEB_SEARCH_USD,
  addUsage,
  costUsd,
  fromResponses,
  type Usage,
} from "./brains";
import { ProviderError, kindForStatus, sseData } from "./providers";
import { hostOf, type Source } from "../producer/sources";

export const RESPONSES_URL = "https://api.openai.com/v1/responses";

/** Everyday answers think a little; "Think harder" is Claude Opus 5.5, never Luna. */
export const LUNA_EFFORT = "low";

type Fetch = typeof fetch;
type Json = Record<string, unknown>;

function rec(v: unknown): Json {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
}

// ---------------------------------------------------------------------------
// Her tools, as Luna's

const nullableText = (description: string) => ({ type: ["string", "null"], description });

/** Claude's memory tool (memory_20250818) as a function: the same commands, run by the same notes runner. */
export const LUNA_MEMORY_TOOL = {
  type: "function",
  name: "memory",
  description:
    "Your notes about the person, kept under /memories. They carry across every chat and the lamp on other pages, and the person can read, edit and delete each one. view: a note, or /memories to list them all. create: write a whole note (it replaces one at that path). str_replace: change one exact passage. insert: add lines after a line number. delete: remove one note. rename: move a note. Pass null for every field the command doesn't use.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["command", "path", "file_text", "old_str", "new_str", "insert_line", "insert_text", "old_path", "new_path"],
    properties: {
      command: { type: "string", enum: ["view", "create", "str_replace", "insert", "delete", "rename"] },
      path: nullableText("The note's path, e.g. /memories/brand.md, or /memories to list every note. Null for rename."),
      file_text: nullableText("create: the note's whole text. Null otherwise."),
      old_str: nullableText("str_replace: the exact text to replace; it must appear once. Null otherwise."),
      new_str: nullableText("str_replace: the new text. Null otherwise."),
      insert_line: { type: ["integer", "null"], description: "insert: the line to insert after (0 = at the top). Null otherwise." },
      insert_text: nullableText("insert: the text to insert. Null otherwise."),
      old_path: nullableText("rename: the note's current path. Null otherwise."),
      new_path: nullableText("rename: its new path. Null otherwise."),
    },
  },
} as const;

/**
 * A chat's saved tool list (Claude's shape) as Luna's. A tool this doesn't
 * know how to translate is left out rather than guessed at.
 */
export function lunaTools(tools: readonly unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const t of tools) {
    const o = rec(t);
    const type = typeof o.type === "string" ? o.type : "";
    if (type.startsWith("memory_")) {
      out.push(LUNA_MEMORY_TOOL);
    } else if (type.startsWith("web_search_")) {
      out.push({ type: "web_search" });
    } else if (!type && typeof o.name === "string" && o.input_schema && typeof o.input_schema === "object") {
      out.push({
        type: "function",
        name: o.name,
        description: typeof o.description === "string" ? o.description : "",
        parameters: o.input_schema,
        // Strict where Claude's is. search_renders isn't (Claude's 16-union
        // limit); left unset, the Responses API makes it strict if it can.
        ...(o.strict === true ? { strict: true } : {}),
      });
    }
  }
  return out;
}

/** A memory call without the fields its command doesn't use (the notes runner reads only the ones it needs). */
export function lunaToolInput(name: string, input: unknown): unknown {
  if (name !== LUNA_MEMORY_TOOL.name) return input;
  return Object.fromEntries(Object.entries(rec(input)).filter(([, v]) => v !== null));
}

/** The chat's saved system parts as Luna reads them. */
export function lunaPrompt(system: readonly string[]): { instructions: string; head: unknown[] } {
  const [rules = "", reference = "", ...perChat] = system;
  const chat = perChat.filter((s) => s.trim()).join("\n\n");
  return {
    instructions: [rules, reference].filter((s) => s.trim()).join("\n\n"),
    head: chat ? [{ role: "developer", content: chat }] : [],
  };
}

/** A tool result as the runners write it (Claude's shape) → a function_call_output's output. */
export function lunaToolOutput(content: unknown, isError = false): string | unknown[] {
  const flag = (text: string) => (isError ? `Error: ${text}` : text);
  if (typeof content === "string") return flag(content);
  if (!Array.isArray(content)) return flag("");
  const parts: unknown[] = [];
  for (const block of content) {
    const b = rec(block);
    if (b.type === "text" && typeof b.text === "string") {
      parts.push({ type: "input_text", text: parts.length === 0 ? flag(b.text) : b.text });
    } else if (b.type === "image") {
      const src = rec(b.source);
      if (src.type === "base64" && typeof src.media_type === "string" && typeof src.data === "string") {
        parts.push({ type: "input_image", image_url: `data:${src.media_type};base64,${src.data}` });
      }
    }
  }
  return parts;
}

/** The distinct pages Luna's answer cites (url_citation), first cited first, at most `max` — as the chat shows Claude's. */
export function lunaSources(items: readonly unknown[], max = 5): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const item of items) {
    const it = rec(item);
    if (it.type !== "message" || !Array.isArray(it.content)) continue;
    for (const part of it.content) {
      const annotations = rec(part).annotations;
      if (!Array.isArray(annotations)) continue;
      for (const a of annotations) {
        const ann = rec(a);
        const url = ann.url;
        if (ann.type !== "url_citation" || typeof url !== "string" || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
        seen.add(url);
        const title = typeof ann.title === "string" && ann.title.trim() ? ann.title.trim().slice(0, 120) : hostOf(url);
        out.push({ url, title });
        if (out.length >= max) return out;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// One call, streamed

export type LunaEvent = { type: "text"; text: string } | { type: "tool"; name: string };

export type LunaCall = {
  status: string;
  /** Why it stopped short ("max_output_tokens", …), or null. */
  incomplete: string | null;
  /** The response's items, verbatim. */
  output: Json[];
  usage: Usage;
  model: string;
  /** Web searches this call ran ($10 per 1,000, OpenAI's pricing page). */
  searches: number;
};

export async function* streamLuna(a: {
  instructions: string;
  input: readonly unknown[];
  tools: readonly unknown[];
  toolChoice: "auto" | "none";
  maxOutput: number;
  signal: AbortSignal;
  effort?: "none" | "low" | "medium" | "high";
  safetyId?: string | null;
  apiKey?: string;
  fetchFn?: Fetch;
}): AsyncGenerator<LunaEvent, LunaCall> {
  const key = a.apiKey ?? process.env.OPENAI_API_KEY;
  if (!key) throw new ProviderError("Luna isn't set up", null, "not_configured");
  const res = await (a.fetchFn ?? fetch)(RESPONSES_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: LUNA_MODEL,
      instructions: a.instructions,
      input: a.input,
      tools: a.tools,
      tool_choice: a.toolChoice,
      // Built-in tool calls (web searches) per call, as Claude's max_uses.
      max_tool_calls: WEB_SEARCH_MAX_USES,
      reasoning: { effort: a.effort ?? LUNA_EFFORT },
      max_output_tokens: a.maxOutput,
      store: false,
      include: ["reasoning.encrypted_content"],
      stream: true,
      ...(a.safetyId ? { safety_identifier: a.safetyId } : {}),
    }),
    signal: a.signal,
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new ProviderError(`Luna answered ${res.status}: ${detail.slice(0, 200)}`, res.status, kindForStatus(res.status));
  }
  let final: Json | null = null;
  for await (const data of sseData(res.body)) {
    let j: Json;
    try {
      j = rec(JSON.parse(data));
    } catch {
      continue;
    }
    switch (j.type) {
      case "response.output_text.delta":
      case "response.refusal.delta":
        if (typeof j.delta === "string" && j.delta) yield { type: "text", text: j.delta };
        break;
      case "response.output_item.added": {
        const item = rec(j.item);
        if (item.type === "function_call" && typeof item.name === "string") yield { type: "tool", name: item.name };
        else if (item.type === "web_search_call") yield { type: "tool", name: "web_search" };
        break;
      }
      case "response.completed":
      case "response.incomplete":
      case "response.failed":
        final = rec(j.response);
        break;
      case "error":
        throw new ProviderError(`Luna's stream broke: ${String(j.message ?? j.code ?? "").slice(0, 200)}`, null, "busy");
    }
  }
  if (!final) throw new ProviderError("Luna's answer ended before it finished", null, "busy");
  if (final.status === "failed") {
    const err = rec(final.error);
    const code = String(err.code ?? "");
    throw new ProviderError(
      `Luna failed: ${code} ${String(err.message ?? "").slice(0, 200)}`.trim(),
      null,
      /rate_limit|server_error|overloaded/i.test(code) ? "busy" : "refused",
    );
  }
  const output = Array.isArray(final.output) ? (final.output as unknown[]).map(rec) : [];
  const model = typeof final.model === "string" && final.model ? (final.model.startsWith(LUNA_MODEL) ? LUNA_MODEL : final.model) : LUNA_MODEL;
  return {
    status: String(final.status ?? ""),
    incomplete: typeof rec(final.incomplete_details).reason === "string" ? String(rec(final.incomplete_details).reason) : null,
    output,
    usage: fromResponses(rec(final.usage) as Parameters<typeof fromResponses>[0]),
    model,
    // Every search item is counted, open_page and find_in_page too: if
    // those turn out to be free, the error is on the safe side.
    searches: output.filter((i) => i.type === "web_search_call").length,
  };
}

// ---------------------------------------------------------------------------
// One turn: calls and tool rounds until she answers

export type LunaToolCall = { id: string; name: string; input: unknown };
export type LunaToolResult = { content: unknown; isError?: boolean };

export type LunaTurn = {
  text: string;
  model: string;
  /** This turn's items in order (her output and our tool outputs), stored verbatim and replayed. */
  items: unknown[];
  usage: Usage;
  costUsd: number;
  searches: number;
  sources: Source[];
};

export async function* lunaTurn(a: {
  instructions: string;
  /** The conversation so far (lunaPrompt's head + toLuna), this message last. */
  history: readonly unknown[];
  tools: readonly unknown[];
  maxOutput: number;
  /** Stop starting new tool rounds once the turn has cost this much. */
  brakeUsd: number;
  maxRounds: number;
  signal: AbortSignal;
  runTool: (call: LunaToolCall) => Promise<LunaToolResult>;
  /** Told each call's cost as it lands, so a later failure can't lose it. */
  onCost?: (usd: number, usage: Usage) => void;
  safetyId?: string | null;
  apiKey?: string;
  fetchFn?: Fetch;
}): AsyncGenerator<LunaEvent, LunaTurn> {
  const items: unknown[] = [];
  let text = "";
  let usage: Usage = NO_USAGE;
  let cost = 0;
  let searches = 0;
  let model = LUNA_MODEL;

  for (let round = 0; round < a.maxRounds; round++) {
    const answerNow = round === a.maxRounds - 1 || cost >= a.brakeUsd;
    const gen = streamLuna({
      instructions: a.instructions,
      input: [...a.history, ...items],
      tools: a.tools,
      toolChoice: answerNow ? "none" : "auto",
      maxOutput: a.maxOutput,
      signal: a.signal,
      safetyId: a.safetyId,
      apiKey: a.apiKey,
      fetchFn: a.fetchFn,
    });
    // A later round's words start a new paragraph, as Claude's do.
    let separate = text.length > 0;
    let step = await gen.next();
    while (!step.done) {
      const ev = step.value;
      if (ev.type === "text") {
        if (separate) {
          text += "\n\n";
          yield { type: "text", text: "\n\n" };
          separate = false;
        }
        text += ev.text;
      }
      yield ev;
      step = await gen.next();
    }
    const call = step.value;
    const callCost = costUsd(call.usage, call.model) + call.searches * WEB_SEARCH_USD;
    model = call.model;
    usage = addUsage(usage, call.usage);
    cost += callCost;
    searches += call.searches;
    a.onCost?.(callCost, call.usage);
    items.push(...call.output);

    const calls = call.output.filter((i) => i.type === "function_call");
    if (calls.length === 0 || answerNow) break;
    for (const fc of calls) {
      if (a.signal.aborted) throw new Error("luna: stopped during the tool round");
      const name = String(fc.name ?? "");
      let input: unknown;
      try {
        input = JSON.parse(String(fc.arguments ?? ""));
      } catch {
        input = undefined;
      }
      const result: LunaToolResult =
        input === undefined
          ? { content: "Those arguments weren't valid JSON. Call the tool again.", isError: true }
          : await a.runTool({ id: String(fc.call_id ?? ""), name, input: lunaToolInput(name, input) });
      items.push({ type: "function_call_output", call_id: fc.call_id, output: lunaToolOutput(result.content, result.isError) });
    }
  }
  return { text, model, items, usage, costUsd: cost, searches, sources: lunaSources(items) };
}

// ---------------------------------------------------------------------------
// A short answer with no tools and no reasoning (a chat's title)

export async function lunaText(a: {
  instructions: string;
  input: string;
  maxOutput: number;
  signal?: AbortSignal;
  apiKey?: string;
  fetchFn?: Fetch;
}): Promise<{ text: string; usage: Usage; model: string }> {
  const key = a.apiKey ?? process.env.OPENAI_API_KEY;
  if (!key) throw new ProviderError("Luna isn't set up", null, "not_configured");
  const res = await (a.fetchFn ?? fetch)(RESPONSES_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: LUNA_MODEL,
      instructions: a.instructions,
      input: a.input,
      reasoning: { effort: "none" },
      max_output_tokens: a.maxOutput,
      store: false,
    }),
    signal: a.signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ProviderError(`Luna answered ${res.status}: ${detail.slice(0, 200)}`, res.status, kindForStatus(res.status));
  }
  const j = rec(await res.json());
  const output = Array.isArray(j.output) ? (j.output as unknown[]).map(rec) : [];
  const text = output
    .filter((i) => i.type === "message" && Array.isArray(i.content))
    .flatMap((i) => (i.content as unknown[]).map(rec))
    .filter((p) => p.type === "output_text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("");
  const model = typeof j.model === "string" && j.model.startsWith(LUNA_MODEL) ? LUNA_MODEL : String(j.model ?? LUNA_MODEL);
  return { text, usage: fromResponses(rec(j.usage) as Parameters<typeof fromResponses>[0]), model };
}
