import { describe, expect, it } from "vitest";
import { parseSseFrames } from "./sse";

// Feeds a string to the parser one chunk at a time, the way a ReadableStream
// hands it over, and returns everything that came out. Chunk boundaries are
// the whole point of these tests.
function readInChunks(payload: string, size: number) {
  let buffer = "";
  const text: string[] = [];
  const errors: string[] = [];
  for (let i = 0; i < payload.length; i += size) {
    buffer += payload.slice(i, i + size);
    const { events, rest } = parseSseFrames(buffer);
    buffer = rest;
    for (const event of events) {
      if (event.kind === "delta") text.push(event.text);
      else errors.push(event.error);
    }
  }
  return { text: text.join(""), errors, leftover: buffer };
}

const STREAM =
  'event: delta\ndata: {"text":"Your Anna "}\n\n' +
  'event: delta\ndata: {"text":"take scored 61%"}\n\n' +
  'event: delta\ndata: {"text":", which is low for a "}\n\n' +
  'event: delta\ndata: {"text":"first-frame model."}\n\n' +
  'event: done\ndata: {"units":2,"mode":"faster"}\n\n';

const EXPECTED = "Your Anna take scored 61%, which is low for a first-frame model.";

describe("parseSseFrames", () => {
  it("reads a whole stream delivered in one chunk", () => {
    expect(readInChunks(STREAM, STREAM.length).text).toBe(EXPECTED);
  });

  it("reads the same stream no matter where the chunks fall", () => {
    // Every chunk size from 1 byte up. A parser that assumes whole frames
    // passes the big sizes and quietly loses text on the small ones.
    for (let size = 1; size <= STREAM.length; size++) {
      expect(readInChunks(STREAM, size).text).toBe(EXPECTED);
    }
  });

  it("leaves nothing behind once the stream ends", () => {
    expect(readInChunks(STREAM, 7).leftover).toBe("");
  });

  it("ignores event types it does not know", () => {
    // The `done` frame carries units, not text. It must not appear in the
    // answer, and it must not be mistaken for a failure.
    const { text, errors } = readInChunks(STREAM, 13);
    expect(text).not.toContain("units");
    expect(errors).toEqual([]);
  });

  it("surfaces a server error frame", () => {
    const withError =
      'event: delta\ndata: {"text":"Checking"}\n\n' +
      'event: error\ndata: {"error":"That didn\'t go through. Try again."}\n\n';
    const { text, errors } = readInChunks(withError, 5);
    expect(text).toBe("Checking");
    expect(errors).toEqual(["That didn't go through. Try again."]);
  });

  it("drops a malformed frame without losing the ones around it", () => {
    const broken =
      'event: delta\ndata: {"text":"before "}\n\n' +
      "event: delta\ndata: {not json}\n\n" +
      'event: delta\ndata: {"text":"after"}\n\n';
    expect(readInChunks(broken, 9).text).toBe("before after");
  });

  it("holds back a frame that has not finished arriving", () => {
    const { events, rest } = parseSseFrames('event: delta\ndata: {"text":"half');
    expect(events).toEqual([]);
    expect(rest).toContain("half");
  });

  it("keeps text that happens to contain a blank line", () => {
    // JSON escapes the newlines, so a two-paragraph answer stays one frame.
    const frame = "event: delta\ndata: " + JSON.stringify({ text: "one\n\ntwo" }) + "\n\n";
    expect(readInChunks(frame, 4).text).toBe("one\n\ntwo");
  });
});
