import { describe, expect, it, vi } from "vitest";
import {
  askRecastRead,
  parseRecastRead,
  RECAST_READ_MODEL,
  reboundRecastRead,
  recastReadInstructions,
  recastSampleTimes,
  recastWarnings,
  type RecastRead,
} from "./recast-read";

// The read's bounds. What comes back from a model is fields or nothing, and
// what comes back through a BROWSER is bounded again — the door is shown the
// read and can change what is ticked, so its copy makes a round trip.

const full = {
  title: "slow turn to camera",
  motion: "She turns from the window and crosses her arms.",
  world: "A white studio, flat daylight.",
  people: [
    { tag: "Z", where: "centre, facing camera", does: "turns and crosses her arms", lead: false },
    { tag: "Z", where: "behind, walks in at 0:04", does: "walks past and exits right", lead: true },
  ],
  keeps: [
    { what: "a wristwatch on the left wrist", kind: "accessory" },
    { what: "the caption 'BEFORE' bottom centre", kind: "text" },
  ],
  cuts: [4.32, 0.05, 99],
  framing: "medium",
  sound: "speech",
  head_visible: true,
  confidence: "high",
};

describe("the instructions", () => {
  it("ask for fields, and forbid describing anyone", () => {
    const text = recastReadInstructions(recastSampleTimes(8, 4), 8);
    expect(text).toContain('"people"');
    expect(text).toContain('"keeps"');
    expect(text).toContain('"cuts"');
    expect(text).toMatch(/Never describe anyone's face, body, hair, age, skin, or clothing/);
    // Position and action are what it may say.
    expect(text).toContain("where they are in the frame and what they do");
  });

  it("samples the middle of each slice, in order", () => {
    expect(recastSampleTimes(10, 5)).toEqual([1, 3, 5, 7, 9]);
    expect(recastSampleTimes(3, 1)).toEqual([1.5]);
  });
});

describe("parsing the answer", () => {
  it("keeps the fields and renumbers the people itself", () => {
    const read = parseRecastRead(JSON.stringify(full), 10)!;
    expect(read.title).toBe("slow turn to camera");
    // The reader's own tags are ignored: the chips, the brief and the cast key on ours.
    expect(read.people.map((p) => p.tag)).toEqual(["A", "B"]);
    // Exactly one lead, and it is the one that claimed it.
    expect(read.people.filter((p) => p.lead)).toHaveLength(1);
    expect(read.people[1].lead).toBe(true);
    expect(read.keeps).toHaveLength(2);
    // Cuts outside the clip are dropped and the rest sorted.
    expect(read.cuts).toEqual([4.3]);
    expect(read.sound).toBe("speech");
  });

  it("gives the lead to the first person when nobody claims it", () => {
    const read = parseRecastRead(JSON.stringify({ ...full, people: [{ where: "left", does: "waves", lead: false }] }), 10)!;
    expect(read.people[0].lead).toBe(true);
  });

  it("refuses an answer that says nothing about the performance", () => {
    expect(parseRecastRead("not json", 10)).toBeNull();
    expect(parseRecastRead(JSON.stringify({ ...full, motion: "" }), 10)).toBeNull();
    expect(parseRecastRead(JSON.stringify([1, 2]), 10)).toBeNull();
  });

  it("falls back rather than trusting an unknown word", () => {
    const read = parseRecastRead(JSON.stringify({ ...full, framing: "enormous", sound: "telepathy", confidence: "certain" }), 10)!;
    expect(read.framing).toBe("medium");
    expect(read.sound).toBe("ambient");
    expect(read.confidence).toBe("low");
  });

  it("bounds a read that came back through a browser exactly as it bounds the model's", () => {
    const read = parseRecastRead(JSON.stringify(full), 10)!;
    const round = reboundRecastRead(JSON.parse(JSON.stringify(read)), 10)!;
    expect(round).toEqual(read);
    // A forged one is cut down to the same shape.
    const forged = reboundRecastRead(
      { motion: "x".repeat(900), people: Array.from({ length: 40 }, () => ({ where: "a", does: "b" })), keeps: Array.from({ length: 40 }, (_, i) => ({ what: `k${i}` })), cuts: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
      10,
    )!;
    expect(forged.motion.length).toBeLessThanOrEqual(220);
    expect(forged.people.length).toBeLessThanOrEqual(4);
    expect(forged.keeps.length).toBeLessThanOrEqual(6);
    expect(forged.cuts.length).toBeLessThanOrEqual(8);
    expect(reboundRecastRead(null, 10)).toBeNull();
    expect(reboundRecastRead({ motion: "" }, 10)).toBeNull();
  });
});

describe("the warnings", () => {
  const read = (over: Partial<RecastRead>): RecastRead => ({
    title: "t",
    motion: "m",
    world: "w",
    people: [{ tag: "A", where: "centre", does: "turns", lead: true }],
    keeps: [],
    cuts: [],
    framing: "medium",
    sound: "ambient",
    headVisible: true,
    confidence: "high",
    ...over,
  });

  it("say what will disappoint, and nothing when nothing will", () => {
    expect(recastWarnings(read({}))).toEqual([]);
    expect(recastWarnings(read({ cuts: [3] }))).toContain("cuts");
    expect(recastWarnings(read({ headVisible: false }))).toContain("no-head");
    expect(recastWarnings(read({ framing: "wide" }))).toContain("wide");
    expect(
      recastWarnings(
        read({
          people: [
            { tag: "A", where: "left", does: "a", lead: true },
            { tag: "B", where: "right", does: "b", lead: false },
          ],
        }),
      ),
    ).toContain("crowd");
  });
});

describe("the reader call", () => {
  it("sends the frames to the small model as pictures, and asks for JSON", async () => {
    const seen: { url: string; body: Record<string, unknown> }[] = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      seen.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const key = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test";
    try {
      const answer = await askRecastRead("do the thing", ["data:image/jpeg;base64,AA", "data:image/jpeg;base64,BB"], [1, 3], { fetchFn });
      expect(answer).toBe("{}");
    } finally {
      if (key === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = key;
    }
    expect(seen[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(seen[0].body.model).toBe(RECAST_READ_MODEL);
    expect(seen[0].body.response_format).toEqual({ type: "json_object" });
    const content = (seen[0].body.messages as { role: string; content: unknown }[])[1].content as { type: string }[];
    expect(content.filter((c) => c.type === "image_url")).toHaveLength(2);
  });

  it("fails open with no key, so nothing is spent and the take can still be taken", async () => {
    const key = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      expect(await askRecastRead("x", ["y"], [1])).toBeNull();
    } finally {
      if (key !== undefined) process.env.OPENAI_API_KEY = key;
    }
  });
});
