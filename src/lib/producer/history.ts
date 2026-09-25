// Keeping a stored conversation valid (2026-09-24). Alias-free, pure.
//
// The conversation is append-only (producer.sql says why), so a turn that
// dies half-way can't be tidied by deleting its tail — the tail has to be
// CLOSED by appending what the API needs to see next. Two shapes a crash can
// leave behind:
//
//   1. It ends on the app's system note (the process died after saving the
//      person's words and before any answer). The API accepts a mid-
//      conversation system message only when an assistant turn follows it or
//      it is last, so the next user message would be refused. Closing it: a
//      short assistant line saying the answer didn't arrive.
//   2. It ends on an assistant turn that asked for tools whose results were
//      never saved. Every tool_use needs its tool_result in the very next
//      message. Closing it: one error result per unanswered call.
//
// Both are ordinary messages, so the repair itself is append-only.

export type StoredBlock = { type: string; [k: string]: unknown };
export type StoredMessage = { role: "user" | "assistant" | "system"; content: StoredBlock[] | string };

// Worded (2026-09-25) so it doesn't tell the model to wait to be asked
// again: the unanswered message is handed back with the next turn
// (unansweredBefore, below) and answered then. The old wording, "That answer
// didn't arrive. Ask again and I'll pick it up from here.", made it drop the
// first of two questions asked in a row.
export const INTERRUPTED_ANSWER = "(Cut off before I answered.)";

/** What must be appended before a new user message can follow `messages`. */
export function closeTail(messages: StoredMessage[]): StoredMessage[] {
  const last = messages[messages.length - 1];
  if (!last) return [];

  if (last.role === "system") {
    return [{ role: "assistant", content: [{ type: "text", text: INTERRUPTED_ANSWER }] }];
  }

  if (last.role === "assistant" && Array.isArray(last.content)) {
    const calls = last.content.filter((b) => b.type === "tool_use" && typeof b.id === "string");
    if (calls.length > 0) {
      return [
        {
          role: "user",
          content: calls.map((b) => ({
            type: "tool_result",
            tool_use_id: b.id as string,
            is_error: true,
            content: "Interrupted before this ran.",
          })),
        },
      ];
    }
  }

  return [];
}

// ---------------------------------------------------------------------------
// Effort, per turn (2026-09-25, operator: "make it faster at responses").
//
// A spoken turn runs at LOW effort — less thinking before the first word —
// and a typed one at the conversation's usual MEDIUM. Opus 5.5 takes the
// change as an effort-only system message (beta mid-conversation-output-
// config-2026-07-01): empty content, the level in output_config. It holds
// from the next user turn until another one changes it, and — unlike moving
// the request's top-level effort — leaves the cached prefix intact, so a
// voice conversation doesn't re-pay the whole history on every switch.
// Checked with a real call on 2026-09-25 (with the fallbacks beta alongside).
//
// Stored like any other message (append-only): role "system", content [],
// display { kind: "effort", effort }. The level lives in `display` because
// the table has no column for it; toApiMessage puts it back where the API
// wants it.

export type Effort = "low" | "medium";
export const TOP_LEVEL_EFFORT: Effort = "medium";

type Row = { role: "user" | "assistant" | "system"; content: unknown; display?: Record<string, unknown> | null };

function effortOf(row: Row): Effort | null {
  const d = row.display;
  if (row.role !== "system" || d?.kind !== "effort") return null;
  return d.effort === "low" || d.effort === "medium" ? d.effort : null;
}

/** The level the stored conversation is at now: its last effort message's, else the request's top level. */
export function currentEffort(rows: Row[]): Effort {
  for (let i = rows.length - 1; i >= 0; i--) {
    const e = effortOf(rows[i]);
    if (e) return e;
  }
  return TOP_LEVEL_EFFORT;
}

/** The message that moves the conversation to `effort`, as stored. */
export function effortMessage(effort: Effort) {
  return { role: "system" as const, content: [] as StoredBlock[], display: { kind: "effort", effort } };
}

/** One stored message as the API takes it (an effort message carries its level in output_config). */
export function toApiMessage(row: Row, withEffort: boolean): Record<string, unknown> | null {
  const effort = effortOf(row);
  if (effort) return withEffort ? { role: "system", content: [], output_config: { effort } } : null;
  return { role: row.role, content: row.content };
}

// ---------------------------------------------------------------------------
// Several things at once (2026-09-25, operator: "it looks like the assistant
// cant handle several questions at once. check the data"). The data showed
// the shape: "…the same content she has." then, two seconds later, "But for
// Picacho." — the second message cut the first answer off before it began,
// and the first question was never answered. Now a message that arrives
// while an answer is under way still cuts it off (as in a conversation), but
// nothing said is dropped: what was already said is kept (the route stores a
// cut-off answer as far as it got, marked `cut`), and whatever the person
// said that never got an answer is handed back with the next turn.

/** A shown answer that was cut off part-way (the route stores it with display.cut). */
export const CUT_MARK = " —";

/**
 * The person's messages, oldest first, that came after the last answer they
 * were shown — the ones a cut-off turn never answered. Tool rounds and
 * repairs (display null) and the app's notes don't count as answers.
 */
export function unansweredBefore(rows: Row[], max = 4): string[] {
  const out: string[] = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.role === "assistant" && r.display) break;
    if (r.role === "user" && typeof r.display?.text === "string" && r.display.text.trim()) {
      out.unshift(r.display.text.trim());
    }
  }
  return out.slice(-max);
}

/** The last answer the person was shown, if it was cut off part-way. */
export function lastAnswerCut(rows: Row[]): string | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.role === "assistant" && r.display) {
      return r.display.cut === true && typeof r.display.text === "string" ? r.display.text : null;
    }
  }
  return null;
}

// What the judge of a spoken message reads (gate.ts), and when a message
// spoken over an answer waits for that answer to be saved (route.ts).

type TimedRow = Row & { created_at?: string };

/** The conversation's last few shown lines, oldest first, for the judge. */
export function recentLines(rows: TimedRow[], max = 6): { who: "person" | "assistant"; text: string }[] {
  const out: { who: "person" | "assistant"; text: string }[] = [];
  for (let i = rows.length - 1; i >= 0 && out.length < max; i--) {
    const r = rows[i];
    const text = typeof r.display?.text === "string" ? r.display.text.trim() : "";
    if (!text) continue;
    if (r.role === "user") out.unshift({ who: "person", text });
    else if (r.role === "assistant") out.unshift({ who: "assistant", text });
  }
  return out;
}

/** Seconds since the Producer last said something the person saw (null: never). */
export function secondsSinceAssistant(rows: TimedRow[], now: number): number | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.role === "assistant" && typeof r.display?.text === "string" && r.display.text.trim() && r.created_at) {
      const t = Date.parse(r.created_at);
      return Number.isFinite(t) ? Math.max(0, (now - t) / 1000) : null;
    }
  }
  return null;
}

/**
 * An answer is still being written: the conversation doesn't end on one of
 * the Producer's own messages (it ends on the app's note, or mid-way through
 * a tool round).
 */
export function answerPending(rows: Row[]): boolean {
  const last = rows[rows.length - 1];
  if (!last) return false;
  if (last.role !== "assistant") return true;
  return Array.isArray(last.content) && (last.content as StoredBlock[]).some((b) => b.type === "tool_use");
}

/** The text a person should see from one assistant message's blocks. */
export function visibleText(content: StoredBlock[] | string): string {
  if (typeof content === "string") return content;
  return content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("")
    .trim();
}
