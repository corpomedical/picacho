// Reading the chat stream, split out so it can be tested.
//
// Alias-free on purpose — the same reason refund-rules.ts and
// video-resolution.ts are: vitest runs here with no config, so anything
// importing through "@/" can't be unit-tested at all.
//
// The bug this exists to prevent is quiet rather than loud. A network chunk
// boundary falls wherever TCP puts it, so a frame arrives split in half far
// more often on a slow phone connection than on a desktop, and a parser that
// assumes whole frames drops a word here and there instead of failing. That
// is not something a manual click-through finds.

export type AgentStreamEvent = { kind: "delta"; text: string } | { kind: "error"; error: string };

export type SseParseResult = {
  /** Frames that were complete in this buffer, in order. */
  events: AgentStreamEvent[];
  /** The unterminated tail, to be prepended to the next chunk. */
  rest: string;
};

/**
 * Pulls whole SSE frames out of an accumulating buffer.
 *
 * Frames are separated by a blank line; anything after the last separator is
 * incomplete and comes back as `rest`. Unrecognised frames (the `done` event,
 * comment lines, anything a future version adds) are skipped rather than
 * treated as an error — a stream that breaks when the server learns a new
 * event type is a stream that breaks on the next deploy.
 */
export function parseSseFrames(buffer: string): SseParseResult {
  const frames = buffer.split("\n\n");
  const rest = frames.pop() ?? "";
  const events: AgentStreamEvent[] = [];

  for (const frame of frames) {
    const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
    if (!dataLine) continue;
    let payload: { text?: unknown; error?: unknown } | null = null;
    try {
      payload = JSON.parse(dataLine.slice(5).trim());
    } catch {
      // A malformed frame is dropped, not thrown on. The alternative is one
      // bad byte ending an answer that was otherwise arriving fine.
      continue;
    }
    if (typeof payload?.error === "string") {
      events.push({ kind: "error", error: payload.error });
    } else if (typeof payload?.text === "string") {
      events.push({ kind: "delta", text: payload.text });
    }
  }

  return { events, rest };
}
