// The set chat hands a question to the Producer (Helios Cut 2, step 12,
// 2026-09-25 — operator: "Run, keep going."; the owner's decision 6: hand
// off, don't merge). A set's chat acts on that set; the Producer knows the
// account. When someone asks the set chat about something outside the set
// (their plan, their credits) and the Producer's lamp is on the page, the
// reply's [Ask the Producer] opens the lamp with their words in its field,
// UNSENT: the Producer runs on the owner's bill, so a turn there is always
// the person's own press, never the set chat's.
//
// One direction only, as decided: nothing here lets the Producer write into
// the set chat (its `prepare_send` kind "set" stays deferred, spec §8).
//
// Client-safe and pure apart from askProducer's dispatch: the set page
// sends, producer-lamp.tsx listens, the tests read both ends.

export const PRODUCER_ASK_EVENT = "producer:ask";

/** The most the lamp's own field takes (producer-lamp.tsx, its textarea's maxLength). */
export const PRODUCER_ASK_MAX_CHARS = 5000;

export type ProducerAsk = { text: string };

/** The words an ask carries, held to the lamp's field; null for anything that isn't one. */
export function producerAskText(e: unknown): string | null {
  if (!e || typeof e !== "object" || !("detail" in e)) return null;
  const detail = (e as { detail: unknown }).detail;
  if (!detail || typeof detail !== "object") return null;
  const text = (detail as { text?: unknown }).text;
  return typeof text === "string" ? text.slice(0, PRODUCER_ASK_MAX_CHARS) : null;
}

/**
 * What the lamp's field holds after an ask: the words, or — when the
 * person had started writing there — their draft kept, the words after it.
 */
export function producerAskDraft(current: string, text: string): string {
  const kept = current.trimEnd();
  return (kept ? `${kept}\n\n${text}` : text).slice(0, PRODUCER_ASK_MAX_CHARS);
}

/** Opens the Producer's lamp with these words in its field, unsent. */
export function askProducer(text: string): void {
  window.dispatchEvent(new CustomEvent<ProducerAsk>(PRODUCER_ASK_EVENT, { detail: { text } }));
}
