// Reading the Producer's stream in the browser (2026-09-24). Alias-free, pure.
//
// Unlike the chat assistant's parser this keeps the EVENT NAME: the Producer
// sends five kinds (delta, status, card, error, done) and the sheet treats
// each differently. Unknown events and malformed frames are skipped, never
// thrown on — one bad byte must not end an answer that was arriving fine.

export type ProducerEvent = { event: string; data: Record<string, unknown> };

export function parseProducerFrames(buffer: string): { events: ProducerEvent[]; rest: string } {
  const frames = buffer.split("\n\n");
  const rest = frames.pop() ?? "";
  const events: ProducerEvent[] = [];
  for (const frame of frames) {
    let event = "message";
    let dataLine: string | null = null;
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLine = line.slice(5).trim();
    }
    if (dataLine === null) continue;
    try {
      const data = JSON.parse(dataLine);
      if (data && typeof data === "object" && !Array.isArray(data)) events.push({ event, data });
    } catch {
      continue;
    }
  }
  return { events, rest };
}
