import { describe, expect, it, vi } from "vitest";
import {
  askRecastRead,
  parseRecastRead,
  RECAST_MARK_MAX_CHARS,
  RECAST_MARK_MAX_WORDS,
  RECAST_READ_MODEL,
  reboundRecastRead,
  recastMark,
  recastReadInstructions,
  recastSampleTimes,
  recastWarnings,
  type RecastRead,
} from "./recast-read";
import { readRecastRecipe, recastRow } from "./store";

// The read's bounds. What comes back from a model is fields or nothing, and
// what comes back through a BROWSER is bounded again — the door is shown the
// read and can change what is ticked, so its copy makes a round trip.

const full = {
  title: "slow turn to camera",
  motion: "She turns from the window and crosses her arms.",
  world: "A white studio, flat daylight.",
  people: [
    { tag: "Z", where: "centre, facing camera", does: "turns and crosses her arms", lead: false, many: false, mark: "in the white shirt at the centre" },
    { tag: "Z", where: "behind, walks in at 0:04", does: "walks past and exits right", lead: true, many: false },
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
    // The ban as it stands since the mark was allowed (2026-09-23): clothing
    // left this list, and every other word of it stayed. Each is named, so
    // that a later rewording of the rule cannot quietly drop one of them.
    for (const banned of ["face", "body", "build", "age", "skin", "ethnicity", "hair"]) {
      expect(text).toMatch(new RegExp(`Never describe anyone's[^.]*\\b${banned}\\b`));
    }
    expect(text).toMatch(/never give anyone a name/);
    // Position and action are what it may say.
    expect(text).toContain("where they are in the frame and what they do");
    // THE BAN IS SCOPED, AND THE MARK IS ITS ONE EXCEPTION (2026-09-23,
    // round 2). The absolute sentence — "clothing may appear in keeps ONLY …
    // never as a description of the person" — stood AFTER the paragraph that
    // asks for a mark, and a mark is clothing used to tell a person apart:
    // the model read the exception and then read it cancelled. It says
    // "outside mark" now, and it comes first, so the exception is the last
    // word on it.
    expect(text).toContain('Outside "mark", clothing may appear only in "keeps"');
    expect(text.indexOf('Outside "mark"')).toBeLessThan(text.indexOf('"mark" is the one exception'));
  });

  it("allow the mark, narrowly, and say what it may not be", () => {
    const text = recastReadInstructions(recastSampleTimes(8, 4), 8);
    expect(text).toContain('"mark"');
    // What it is for, and the only two things it may say.
    expect(text).toContain("WEARING");
    expect(text).toContain("WHERE they stand");
    expect(text).toContain(`At most ${RECAST_MARK_MAX_WORDS} words`);
    // THE SHAPE, not just the content (round 2): a phrase that finishes the
    // brief's own sentence, for one person and for a group. Asked for as the
    // sentence it lands in, because "white shirt, front of the row" answers
    // the old question perfectly and composes an order to replace a shirt.
    expect(text).toContain('a phrase that finishes the sentence "Replace the person ..."');
    expect(text).toContain('"Replace every single person ..."');
    // Shown right and wrong, because a rule with no example is a rule the
    // reader interprets: the right ones complete the sentence, one of them
    // for a group; the wrong ones are a body read and a name.
    expect(text).toContain('"in the white shirt at the front" is right');
    expect(text).toContain('"in the navy blazers in the back rows" is right for a group');
    expect(text).toContain('"tall older man, short hair" is wrong');
    // The comma is asked for as well as enforced (recastMark), because the
    // TASK's list of swaps is comma-separated.
    expect(text).toContain("and no commas");
    // And it may be left out, which is the honest answer for a uniform crowd.
    expect(text).toMatch(/Leave "mark" out entirely/);
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
    // The mark rides the person it belongs to, and only where there was one.
    expect(read.people[0].mark).toBe("in the white shirt at the centre");
    expect(read.people[1].mark).toBeUndefined();
    // Cuts outside the clip are dropped and the rest sorted.
    expect(read.cuts).toEqual([4.3]);
    expect(read.sound).toBe("speech");
  });

  it("gives the lead to the first person when nobody claims it", () => {
    const read = parseRecastRead(JSON.stringify({ ...full, people: [{ where: "left", does: "waves", lead: false, many: false }] }), 10)!;
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

  it("cuts a mark to eight words on the way in AND on the way back", () => {
    const long = "a tall older man in a dark blue blazer standing at the far left of the back row";
    const person = { where: "left", does: "waves", lead: true, many: false, mark: long };
    const parsed = parseRecastRead(JSON.stringify({ ...full, people: [person] }), 10)!;
    // Eight words, and nothing the model wrote past them. (Eight, not six,
    // since the mark started completing "the person …" and had to pay for
    // its own preposition and articles — recast-read.ts's bound.)
    expect(parsed.people[0].mark!.split(" ")).toHaveLength(RECAST_MARK_MAX_WORDS);
    expect(parsed.people[0].mark).toBe("a tall older man in a dark blue");
    // The door can edit the read, so the bound is met again on the way back
    // — a forged one is cut exactly as the model's own was.
    const forged = reboundRecastRead({ ...full, people: [{ ...person, mark: long }] }, 10)!;
    expect(forged.people[0].mark).toBe("a tall older man in a dark blue");
  });
});

describe("the mark's bound", () => {
  it("keeps eight words, and sixty characters however few words they are", () => {
    expect(recastMark("in the white shirt at the front")).toBe("in the white shirt at the front");
    expect(recastMark("  in the   white shirt,\n front row  ")).toBe("in the white shirt front row");
    // THE COMMAS GO (2026-09-23, round 2). The mark lands in the TASK's own
    // comma-separated list of swaps, where a comma inside one mark reads as
    // one more thing to replace; the phrase asked for needs none.
    expect(recastMark("white shirt, front of the row")).toBe("white shirt front of the row");
    expect(recastMark("in the white shirt; at the front")).toBe("in the white shirt at the front");
    // Words past the bound go, and the cut lands between words.
    expect(recastMark("in the white shirt at the front of the row")).toBe("in the white shirt at the front of");
    // Eight words that are all enormous still meet the character bound, and
    // are cut by whole words rather than left with half of one.
    const huge = recastMark(Array.from({ length: RECAST_MARK_MAX_WORDS }, () => "x".repeat(20)).join(" "));
    expect(Array.from(huge).length).toBeLessThanOrEqual(RECAST_MARK_MAX_CHARS);
    expect(huge.split(" ").every((w) => w === "x".repeat(20))).toBe(true);
    // One word longer than the whole bound is cut where it must be.
    expect(recastMark("y".repeat(200))).toBe("y".repeat(RECAST_MARK_MAX_CHARS));
    // Nothing usable is nothing at all, so the key is simply left off.
    expect(recastMark("")).toBe("");
    expect(recastMark(null)).toBe("");
    expect(recastMark(42)).toBe("");
  });
});

describe("the mark has no field of its own in a recipe", () => {
  // A recipe keeps no ACCOUNT OF THE PEOPLE in someone's footage: a tag for
  // who was replaced, never a line about anybody. So no mark arrives as a
  // field, and none is kept for anyone nobody was cast over. Pinned here
  // because that leak would be silent — a `people` key copied into the row
  // would simply work.
  //
  // What a recipe DOES keep is the composed brief, and the brief names the
  // person the take replaces in the words the read gave (recast-brief.ts's
  // markFor). Those six or eight words sit on the row for as long as the row
  // does, and in the pipeline log with it. That is stated in recast-read.ts's
  // header and pinned below, so that nobody reads the first paragraph as a
  // promise the product does not make.
  const row = (over: Partial<Parameters<typeof recastRow>[0]> = {}) =>
    recastRow({
      source: { kind: "upload", clipId: "c1", container: "mp4" },
      job: "scene",
      engine: "kling-edit",
      keeps: [{ what: "the caption 'BEFORE' bottom centre", kind: "text" }],
      direction: "dress her as Cleopatra",
      castTag: "A",
      brief: "TASK\nReplace Person A in @Video1 with @Element1.",
      lock: true,
      groupId: null,
      window: null,
      fromClipId: null,
      ...over,
    });

  it("never lands in a stored recipe as a field, however it is offered", () => {
    const read = parseRecastRead(JSON.stringify(full), 10)!;
    const stored = row();
    expect(Object.keys(stored)).not.toContain("people");
    expect(JSON.stringify(stored)).not.toContain(read.people[0].mark!);
    // And a row that somehow arrived carrying people is read back without
    // them: the recipe is rebuilt field by field, never spread.
    const back = readRecastRecipe({ ...stored, people: read.people })!;
    expect(back).not.toBeNull();
    expect(Object.keys(back)).not.toContain("people");
    expect(JSON.stringify(back)).not.toContain("white shirt");
  });

  it("but the brief that carries it is kept whole, which is where it does persist", () => {
    // The honest half. If this is ever scrubbed before the row is written,
    // this is the assertion that says so out loud.
    const stored = row({ brief: "TASK\nReplace the person in the white shirt at the front (Person A) in @Video1 with @Element1." });
    expect(stored.brief).toContain("the person in the white shirt at the front");
    expect(readRecastRecipe(stored)!.brief).toContain("the person in the white shirt at the front");
  });
});

describe("the warnings", () => {
  const read = (over: Partial<RecastRead>): RecastRead => ({
    title: "t",
    motion: "m",
    world: "w",
    people: [{ tag: "A", where: "centre", does: "turns", lead: true, many: false }],
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
            { tag: "A", where: "left", does: "a", lead: true, many: false },
            { tag: "B", where: "right", does: "b", lead: false, many: false },
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

  it("brings a mark back from the model, bounded, ready for the brief to point with", async () => {
    // The school courtyard that started this (2026-09-23): the man to be
    // replaced has his back turned among forty boys in the same blazer, and
    // "centre of frame" fits all of them. What the reader says about his
    // shirt is the whole of what tells him apart.
    const answer = JSON.stringify({
      title: "a slow bow",
      motion: "A man at the centre of a courtyard bows, and the boys around him follow.",
      world: "A school courtyard in flat noon light.",
      people: [
        { tag: "A", where: "centre, back to camera", does: "bows at the end", lead: true, many: false, mark: "in the white shirt, among the dark blazers" },
        { tag: "B", where: "all around him", does: "stand and follow the bow", lead: false, many: true, mark: "in the dark blazers and striped ties" },
      ],
      keeps: [{ what: "the school crest on the blazers", kind: "logo" }],
      cuts: [],
      framing: "wide",
      sound: "ambient",
      head_visible: false,
      confidence: "medium",
    });
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ choices: [{ message: { content: answer } }] }), { status: 200 }),
    ) as unknown as typeof fetch;
    const key = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test";
    let back: string | null;
    try {
      back = await askRecastRead(recastReadInstructions([1, 8, 14], 15), ["data:image/jpeg;base64,AA"], [1, 8, 14], { fetchFn });
    } finally {
      if (key === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = key;
    }
    const read = parseRecastRead(back!, 15)!;
    // The comma the model wrote anyway is gone, and what is left finishes
    // the brief's own sentence: "Replace the person in the white shirt among
    // the dark blazers (Person A) …".
    expect(read.people[0].mark).toBe("in the white shirt among the dark blazers");
    expect(read.people[1].mark).toBe("in the dark blazers and striped ties");
    // Everything else the read says about him is unchanged by the mark.
    expect(read.people[0].where).toBe("centre, back to camera");
    expect(read.people[1].many).toBe(true);
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
