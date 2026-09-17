import { describe, expect, it } from "vitest";
import {
  askRecceRead,
  parseRecceRead,
  RECCE_FRAME_COUNT,
  RECCE_READ_MODEL,
  RECCE_TAIL_MAX_CHARS,
  recceReadInstructions,
  recceTail,
  sampleTimes,
  type RecceRead,
} from "./recce-read";

// The Recce's read (board K cut 1, 2026-09-17): fields or nothing, clamps
// on every number, and the one hard promise — the person in the clip is
// never described in what travels on to Astra.

const times = sampleTimes(10, RECCE_FRAME_COUNT);

const palaceAnswer = JSON.stringify({
  shots: [
    {
      from_s: 0,
      to_s: 10,
      place: "An opulent ballroom and grand staircase inside a palace-like mansion.",
      camera: { height: "eye", size: "wide", words: "The camera follows the woman through the room and tracks her toward the staircase." },
    },
  ],
  person: {
    who: "red-haired woman in a flowing gown",
    pose: "walk",
    start: { x: -0.5, z: 4.5 },
    end: { x: 1.2, z: 12 },
  },
  light: "Warm golden light from chandeliers and daylight from high windows.",
  place_frame: 0,
  confidence: "high",
});

describe("sampleTimes", () => {
  it("samples the middle of each slice", () => {
    expect(sampleTimes(10, 4)).toEqual([1.25, 3.75, 6.25, 8.75]);
    expect(sampleTimes(10, RECCE_FRAME_COUNT)).toHaveLength(RECCE_FRAME_COUNT);
  });
});

describe("recceReadInstructions", () => {
  it("asks for cuts, the coordinate convention and the place frame", () => {
    const text = recceReadInstructions(times, 10);
    expect(text).toContain("a hard cut starts a new one");
    expect(text).toContain("x to its right, z ahead");
    expect(text).toContain("place_frame");
    expect(text).toContain("never a close-up");
    // The camera's true motion is words, not a forced pick from a list.
    expect(text).toContain('"words": string');
  });
});

describe("parseRecceRead", () => {
  it("reads the palace answer into fields", () => {
    const read = parseRecceRead(palaceAnswer, RECCE_FRAME_COUNT, 10);
    expect(read).not.toBeNull();
    expect(read!.shots[0].size).toBe("wide");
    expect(read!.person!.pose).toBe("walk");
    expect(read!.person!.end.z).toBe(12);
    expect(read!.placeFrame).toBe(0);
    expect(read!.confidence).toBe("high");
  });

  it("clamps every number and bounds the place frame", () => {
    const wild = JSON.parse(palaceAnswer);
    wild.person.start = { x: 999, z: -5 };
    wild.person.end = { x: -999, z: 999 };
    wild.place_frame = 99;
    wild.shots[0].from_s = -3;
    wild.shots[0].to_s = 99;
    const read = parseRecceRead(JSON.stringify(wild), RECCE_FRAME_COUNT, 10);
    expect(read!.person!.start).toEqual({ x: 30, z: 0.5 });
    expect(read!.person!.end).toEqual({ x: -30, z: 40 });
    expect(read!.placeFrame).toBe(RECCE_FRAME_COUNT - 1);
    expect(read!.shots[0].fromS).toBe(0);
    expect(read!.shots[0].toS).toBe(10);
  });

  it("answers null for what is not the shape", () => {
    expect(parseRecceRead("not json", 12, 10)).toBeNull();
    expect(parseRecceRead("[]", 12, 10)).toBeNull();
    expect(parseRecceRead(JSON.stringify({ shots: [] }), 12, 10)).toBeNull();
    expect(parseRecceRead(JSON.stringify({ shots: [{ place: "" }] }), 12, 10)).toBeNull();
  });

  it("keeps the shot when the person is malformed", () => {
    const noPerson = JSON.parse(palaceAnswer);
    noPerson.person = { who: "someone", start: { x: "a" } };
    const read = parseRecceRead(JSON.stringify(noPerson), 12, 10);
    expect(read).not.toBeNull();
    expect(read!.person).toBeNull();
  });
});

describe("recceTail", () => {
  const read = parseRecceRead(palaceAnswer, RECCE_FRAME_COUNT, 10)!;

  it("gives Astra the place, the light, and marks on the path", () => {
    const tail = recceTail(read, 10);
    expect(tail).toContain("10-second clip");
    expect(tail).toContain("opulent ballroom");
    expect(tail).toContain("mark 1 where they start");
    expect(tail).toContain("mark 2 where they end");
    expect(tail).toContain("4.5 m ahead");
    expect(tail.length).toBeLessThanOrEqual(RECCE_TAIL_MAX_CHARS);
  });

  it("never describes the person — one person, a path, nothing else", () => {
    const tail = recceTail(read, 10);
    expect(tail).toContain("One person");
    expect(tail).not.toContain("woman");
    expect(tail).not.toContain("gown");
    expect(tail).not.toContain(read.person!.who);
  });

  it("asks for one mark when the person holds still, and none with no person", () => {
    const still: RecceRead = { ...read, person: { ...read.person!, end: { ...read.person!.start } } };
    expect(recceTail(still, 10)).toContain("Put mark 1 there.");
    expect(recceTail(still, 10)).not.toContain("mark 2");
    const empty: RecceRead = { ...read, person: null };
    expect(recceTail(empty, 10)).not.toContain("mark");
  });
});

describe("askRecceRead", () => {
  it("sends every frame with its timestamp and hands back the answer", async () => {
    let body: Record<string, unknown> | null = null;
    const fetchFn = (async (_url: unknown, init: { body: string }) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: palaceAnswer } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const frames = ["data:image/jpeg;base64,AAAA", "data:image/jpeg;base64,BBBB"];
    process.env.OPENAI_API_KEY ||= "test-key";
    const answer = await askRecceRead(recceReadInstructions([1, 2], 4), frames, [1, 2], { fetchFn });
    expect(answer).toBe(palaceAnswer);
    expect(body!.model).toBe(RECCE_READ_MODEL);
    expect((body!.response_format as { type: string }).type).toBe("json_object");
    const content = (body!.messages as { content: unknown }[])[1].content as { type: string }[];
    expect(content.filter((c) => c.type === "image_url")).toHaveLength(2);
  });

  it("fails open as null on a bad status", async () => {
    const fetchFn = (async () => new Response("busy", { status: 500 })) as unknown as typeof fetch;
    process.env.OPENAI_API_KEY ||= "test-key";
    expect(await askRecceRead("i", ["data:image/jpeg;base64,AAAA"], [1], { fetchFn })).toBeNull();
  });
});
