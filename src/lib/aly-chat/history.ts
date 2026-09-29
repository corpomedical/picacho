// One conversation, three brains (2026-09-29). Relative imports only; tested.
//
// A chat is stored ONCE, append-only (aly_chat_messages), and rebuilt for
// whichever brain answers next:
//
//   CLAUDE gets its own turns back exactly as it wrote them — thinking,
//   tool calls, search results — because Opus 5.5 binds its thinking to the
//   exact conversation before it (the API rejects an edited history for new
//   accounts), and the prompt cache is a prefix match: the same bytes every
//   time is what makes the tenth message cheap. A turn another brain wrote
//   reaches Claude as plain text.
//
//   GPT and GEMINI get the words of every turn.
//
// Nothing already sent is ever changed. The one field written after the
// fact is a compare turn's `kept`, and only while it is the last message.

import type { Brain } from "./brains";
import type { FileKind } from "./file-types";

export type FileRef = { id: string; name: string; mime: string; kind: FileKind };

/** A Claude API message, stored exactly as sent/received. */
export type ClaudeMessage = { role: "user" | "assistant"; content: unknown[] };

export type Source = { url: string; title: string };

export type Lane = {
  text: string;
  model: string;
  /** Claude's own messages for this turn (assistant ↔ tool results), verbatim. */
  claude?: ClaudeMessage[];
  sources?: Source[];
  error?: string;
};

export type UserContent = {
  text: string;
  files: FileRef[];
  /** The app's note for this turn (today's date), stored so replay is byte-identical. */
  note?: string;
};

export type AssistantContent = {
  /** One answer (single brain), or several (Ask all three). */
  lanes: Partial<Record<Brain, Lane>>;
  /** Which lane the conversation continues from. */
  kept: Brain;
  /** Documents written or changed in this turn (the side panel). */
  docs?: { id: string; title: string; version: number }[];
  /** Pictures and clips prepared in this turn (render cards). */
  renders?: unknown[];
  units?: number;
};

export type StoredRow =
  | { seq: number; role: "user"; content: UserContent; created_at?: string }
  | { seq: number; role: "assistant"; brain: Brain | "all" | null; content: AssistantContent; created_at?: string };

/** A file's contents, loaded for the turn. */
export type LoadedFile = { ref: FileRef; base64?: string; text?: string };
export type FileLoader = (id: string) => LoadedFile | undefined;

const NO_ANSWER = "(No answer was given to this message.)";

export function keptLane(c: AssistantContent): Lane | undefined {
  return c.lanes[c.kept] ?? Object.values(c.lanes).find(Boolean);
}

export function keptText(c: AssistantContent): string {
  return keptLane(c)?.text?.trim() || NO_ANSWER;
}

function fileLabel(f: FileRef): string {
  return `Attached file: ${f.name}`;
}

// ---------------------------------------------------------------------------
// Claude

function claudeUserBlocks(c: UserContent, load: FileLoader): unknown[] {
  const blocks: unknown[] = [];
  for (const ref of c.files) {
    const f = load(ref.id);
    if (!f) {
      blocks.push({ type: "text", text: `${fileLabel(ref)} (no longer available)` });
      continue;
    }
    if (ref.kind === "pdf" && f.base64) {
      blocks.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: f.base64 },
        title: ref.name,
        citations: { enabled: true },
      });
    } else if (ref.kind === "image" && f.base64) {
      blocks.push({ type: "text", text: fileLabel(ref) });
      blocks.push({ type: "image", source: { type: "base64", media_type: ref.mime, data: f.base64 } });
    } else {
      blocks.push({ type: "text", text: `${fileLabel(ref)}\n<file name="${ref.name}">\n${f.text ?? ""}\n</file>` });
    }
  }
  if (c.note) blocks.push({ type: "text", text: c.note });
  blocks.push({ type: "text", text: c.text || "(See the attached files.)" });
  return blocks;
}

/** The whole conversation as Claude's messages, oldest first. */
export function toClaude(rows: StoredRow[], load: FileLoader): ClaudeMessage[] {
  const out: ClaudeMessage[] = [];
  for (const row of rows) {
    if (row.role === "user") {
      out.push({ role: "user", content: claudeUserBlocks(row.content, load) });
      continue;
    }
    const lane = keptLane(row.content);
    if (row.content.kept === "claude" && lane?.claude?.length) {
      for (const m of lane.claude) out.push(m);
    } else {
      out.push({ role: "assistant", content: [{ type: "text", text: keptText(row.content) }] });
    }
  }
  return mergeSameRole(out);
}

/**
 * Two user messages in a row (a turn that failed and got no answer) become
 * one: every provider accepts that, and doing it here keeps it deterministic.
 */
function mergeSameRole(msgs: ClaudeMessage[]): ClaudeMessage[] {
  const out: ClaudeMessage[] = [];
  for (const m of msgs) {
    const last = out[out.length - 1];
    if (last && last.role === m.role && m.role === "user") {
      out[out.length - 1] = { role: "user", content: [...last.content, ...m.content] };
    } else {
      out.push({ role: m.role, content: [...m.content] });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// GPT (Chat Completions)

export type OpenAIMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: unknown[] }
  | { role: "assistant"; content: string };

export function toOpenAI(system: string, rows: StoredRow[], load: FileLoader): OpenAIMessage[] {
  const out: OpenAIMessage[] = [{ role: "system", content: system }];
  for (const row of rows) {
    if (row.role === "assistant") {
      out.push({ role: "assistant", content: keptText(row.content) });
      continue;
    }
    const parts: unknown[] = [];
    for (const ref of row.content.files) {
      const f = load(ref.id);
      if (!f) {
        parts.push({ type: "text", text: `${fileLabel(ref)} (no longer available)` });
      } else if (ref.kind === "pdf" && f.base64) {
        parts.push({ type: "file", file: { filename: ref.name, file_data: `data:application/pdf;base64,${f.base64}` } });
      } else if (ref.kind === "image" && f.base64) {
        parts.push({ type: "text", text: fileLabel(ref) });
        parts.push({ type: "image_url", image_url: { url: `data:${ref.mime};base64,${f.base64}` } });
      } else {
        parts.push({ type: "text", text: `${fileLabel(ref)}\n<file name="${ref.name}">\n${f.text ?? ""}\n</file>` });
      }
    }
    if (row.content.note) parts.push({ type: "text", text: row.content.note });
    parts.push({ type: "text", text: row.content.text || "(See the attached files.)" });
    const last = out[out.length - 1];
    if (last.role === "user") last.content.push(...parts);
    else out.push({ role: "user", content: parts });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Gemini (generateContent)

export type GeminiContent = { role: "user" | "model"; parts: unknown[] };

export function toGemini(rows: StoredRow[], load: FileLoader): GeminiContent[] {
  const out: GeminiContent[] = [];
  for (const row of rows) {
    let msg: GeminiContent;
    if (row.role === "assistant") {
      msg = { role: "model", parts: [{ text: keptText(row.content) }] };
    } else {
      const parts: unknown[] = [];
      for (const ref of row.content.files) {
        const f = load(ref.id);
        if (!f) {
          parts.push({ text: `${fileLabel(ref)} (no longer available)` });
        } else if ((ref.kind === "pdf" || ref.kind === "image") && f.base64) {
          parts.push({ text: fileLabel(ref) });
          parts.push({ inline_data: { mime_type: ref.mime, data: f.base64 } });
        } else {
          parts.push({ text: `${fileLabel(ref)}\n<file name="${ref.name}">\n${f.text ?? ""}\n</file>` });
        }
      }
      if (row.content.note) parts.push({ text: row.content.note });
      parts.push({ text: row.content.text || "(See the attached files.)" });
      msg = { role: "user", parts };
    }
    const last = out[out.length - 1];
    if (last && last.role === msg.role) last.parts.push(...msg.parts);
    else out.push(msg);
  }
  return out;
}

// ---------------------------------------------------------------------------

/** Every file id the conversation refers to, for loading before a turn. */
export function fileIdsIn(rows: StoredRow[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) if (row.role === "user") for (const f of row.content.files) ids.add(f.id);
  return [...ids];
}

/** Only the last message may have its kept lane changed. */
export function canChangeKept(rows: { seq: number }[], seq: number): boolean {
  return rows.length > 0 && rows[rows.length - 1].seq === seq;
}

export function parseRow(raw: { seq: number; role: string; brain?: string | null; content: unknown; created_at?: string }): StoredRow | null {
  const c = raw.content as Record<string, unknown> | null;
  if (!c || typeof c !== "object") return null;
  if (raw.role === "user") {
    return {
      seq: raw.seq,
      role: "user",
      content: {
        text: typeof c.text === "string" ? c.text : "",
        files: Array.isArray(c.files) ? (c.files as FileRef[]) : [],
        note: typeof c.note === "string" ? c.note : undefined,
      },
      created_at: raw.created_at,
    };
  }
  if (raw.role === "assistant") {
    const lanes = (c.lanes && typeof c.lanes === "object" ? c.lanes : {}) as AssistantContent["lanes"];
    const kept = (typeof c.kept === "string" ? c.kept : "claude") as Brain;
    return {
      seq: raw.seq,
      role: "assistant",
      brain: (raw.brain ?? null) as Brain | "all" | null,
      content: { ...(c as unknown as AssistantContent), lanes, kept },
      created_at: raw.created_at,
    };
  }
  return null;
}
