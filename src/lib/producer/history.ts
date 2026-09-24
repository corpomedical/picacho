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

export const INTERRUPTED_ANSWER = "That answer didn't arrive. Ask again and I'll pick it up from here.";

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

/** The text a person should see from one assistant message's blocks. */
export function visibleText(content: StoredBlock[] | string): string {
  if (typeof content === "string") return content;
  return content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("")
    .trim();
}
