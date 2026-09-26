import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import raceTrack from "./fixtures-race-track.json";
import showroomOpen from "./fixtures-showroom-open.json";
import { setElements, setOwnBlocks, setParts, thingNameOf } from "./elements";
import {
  NAME_FRAMING_TOKENS,
  NAME_INPUT_MAX_CHARS,
  NAME_INSTRUCTIONS,
  NAME_MAX_COMPLETION,
  NAME_MAX_LINES,
  NAME_SET_MAX_USD,
  NAME_WORST_CHARS_PER_TOKEN,
  applyNames,
  nameInput,
  nameMessages,
  parseNameAnswer,
} from "./name-prompt";
import { READER_PRICES } from "./reader-prices";
import { SET_LIMITS, normaliseSetSpec, type SetObject, type SetSpec } from "./set-spec";
import { SHOT_READER_FALLBACK_MAX_COMPLETION } from "./shot-words";

// The naming pass's words (Helios Cut 4, step B4, 2026-09-26): what the
// model is shown, held to its cap; its answer, read strictly; the names
// put on the set; and what a press costs at worst.

const specOf = (json: unknown): SetSpec => {
  const n = normaliseSetSpec(json);
  if (!n.ok) throw new Error("fixture");
  return n.spec;
};
const race = specOf(raceTrack);
/** The objects without their names. */
const nameless = (objects: readonly SetObject[]) =>
  objects.map((o) => {
    const copy = { ...o };
    delete copy.name;
    return copy;
  });
const showroom = specOf(showroomOpen);

describe("the instructions", () => {
  it("are one fixed literal, under 2,000 characters, pinned", () => {
    expect(NAME_INSTRUCTIONS.length).toBeLessThanOrEqual(2000);
    expect(NAME_INSTRUCTIONS.length).toBe(815);
    const source = readFileSync(join(__dirname, "name-prompt.ts"), "utf8");
    const at = source.indexOf("export const NAME_INSTRUCTIONS = `");
    const body = source.slice(at + "export const NAME_INSTRUCTIONS = `".length, source.indexOf("`;", at));
    expect(body).toBe(NAME_INSTRUCTIONS);
    expect(body).not.toContain("${");
  });

  it("say what a name may and may not be, and ask for the JSON the parser reads", () => {
    for (const phrase of [
      "in 1–3 words, in the language of the set's title",
      "Never a brand, a model, a real place, a business or a person.",
      "Use null for loose clutter or when you cannot tell.",
      "Blocks that together make one part take the same name",
      "Answer only with the JSON",
    ]) {
      expect(NAME_INSTRUCTIONS, phrase).toContain(phrase);
    }
    // The shape it shows is the shape the parser takes.
    const example = NAME_INSTRUCTIONS.slice(NAME_INSTRUCTIONS.indexOf('{"names"'));
    expect(parseNameAnswer(example, ["t1", "o4"])).toEqual({ names: new Map([["t1", "red sports car"], ["o4", null]]), dropped: 0 });
  });
});

describe("the input", () => {
  it("numbers the race track's things first, then the blocks of the set itself largest first, in Picacho's own words", () => {
    const { text, lines } = nameInput(race, "A race track at golden hour with a red car");
    expect(lines).toHaveLength(25);
    expect(lines[0]).toEqual({ alias: "t1", objects: [...new Set(setElements(race)[0].members.map(([o]) => o))] });
    // Every block of the set itself, once each.
    expect(lines.slice(1).map((l) => l.alias).sort()).toEqual(setOwnBlocks(race, setElements(race)).map((i) => `o${i}`).sort());
    expect(lines[1]).toEqual({ alias: "o48", objects: [48] });
    expect(text.split("\n").slice(0, 4)).toEqual([
      "TITLE: Scarlet Apex Circuit",
      `DESCRIPTION: ${race.description}`,
      "BRIEF: A race track at golden hour with a red car",
      "PIECES (alias: what it is, colour, size, where, height of its top):",
    ]);
    expect(text).toContain("\nt1: car, red, 2.4 × 1.5 × 4.7 m, at x 0 z -0.1, 48 blocks\n");
    expect(text).toContain("\no4: box, grey, 0.7 × 1.4 × 120 m, 2 copies over 28.7 × 1.4 × 120 m, at x 0 z 0, top 1.4 m\n");
    // The race track's whole input, as measured for the typical cost (name-prompt.ts THE MONEY).
    expect(NAME_INSTRUCTIONS.length + text.length).toBe(3287);
    expect(nameMessages({ text })).toEqual([
      { role: "system", content: NAME_INSTRUCTIONS },
      { role: "user", content: text },
    ]);
  });

  it("never shows a name the set already carries: the words are Picacho's", () => {
    const named = { ...race, objects: race.objects.map((o, i) => (i === 11 ? { ...o, name: "grandstand" } : o)) };
    expect(nameInput(named, null).text).toBe(nameInput(race, null).text);
    expect(nameInput(race, null).text).toContain("BRIEF: none");
  });

  it("holds a 300-object set, with the longest words a set can have, to sixty lines and 13,060 characters", () => {
    const objects: SetObject[] = Array.from({ length: SET_LIMITS.maxObjects }, (_, i) => ({
      shape: i % 2 ? "cylinder" : "box",
      position: [-(i % 30) * 3.333, 0.5 + (i % 7), -(Math.floor(i / 30) * 7.777)],
      rotation: [0, 0, 0],
      size: [12.345, 3.21 + (i % 5), 17.89],
      color: "#8a5a2b",
      roughness: 0.8,
      metalness: 0,
      emissive: null,
      emissiveIntensity: 0,
      castShadow: true,
      repeat: { count: 3, offset: [0, 0, -1.111] },
      material: "concrete",
    }));
    const big = specOf({ ...race, title: "T".repeat(200), description: "D".repeat(900), bounds: { x: 200, z: 200, height: 30 }, objects });
    expect(big.objects.length).toBe(SET_LIMITS.maxObjects);
    const { text, lines } = nameInput(big, "B".repeat(900));
    expect(lines.length).toBe(NAME_MAX_LINES);
    expect(NAME_INSTRUCTIONS.length + text.length).toBeLessThanOrEqual(NAME_INPUT_MAX_CHARS);
    expect(NAME_INPUT_MAX_CHARS).toBe(13_060);
  });
});

describe("the answer, read strictly", () => {
  const ALIASES = ["t1", "o4", "o11"];
  const one = (names: unknown[]) => JSON.stringify({ names });

  it("takes one object with exactly `names`, a list, or nothing at all", () => {
    expect(parseNameAnswer("not json", ALIASES)).toBeNull();
    expect(parseNameAnswer("[]", ALIASES)).toBeNull();
    expect(parseNameAnswer(JSON.stringify({ names: {} }), ALIASES)).toBeNull();
    expect(parseNameAnswer(JSON.stringify({ names: [], note: "x" }), ALIASES)).toBeNull();
    expect(parseNameAnswer(JSON.stringify({ Names: [] }), ALIASES)).toBeNull();
    expect(parseNameAnswer(one([]), ALIASES)).toEqual({ names: new Map(), dropped: 0 });
  });

  it("keeps an entry only with exactly an alias it was given, once, and a name or null", () => {
    const got = parseNameAnswer(
      one([
        { alias: "t1", name: "red sports car" },
        { alias: "o4", name: null },
        { alias: "o11", name: "  grand   stand  " },
        { alias: "t1", name: "car again" },
        { alias: "t9", name: "ghost" },
        { alias: "o4", name: "x", note: "extra" },
        { alias: "o4" },
        { alias: "o4", name: 7 },
        "t1",
      ]),
      ALIASES,
    );
    expect(got).toEqual({
      names: new Map<string, string | null>([
        ["t1", "red sports car"],
        ["o4", null],
        ["o11", "grand stand"],
      ]),
      dropped: 6,
    });
  });

  it("cleans and caps a name as a saved name is, and reads a blank one as null", () => {
    const got = parseNameAnswer(one([{ alias: "t1", name: "x".repeat(50) }, { alias: "o4", name: "   " }]), ALIASES)!;
    expect(got.names.get("t1")).toBe("x".repeat(SET_LIMITS.nameChars));
    expect(got.names.get("o4")).toBeNull();
  });
});

describe("the names on the set", () => {
  it("go on every block of a named thing and on each named block of the set itself, never taking a name away", () => {
    const { lines } = nameInput(race, null);
    const names = new Map<string, string | null>([
      ["t1", "red sports car"],
      ["o11", "grandstand"],
      ["o16", "grandstand"],
      ["o4", "barriers"],
      ["o7", null],
    ]);
    const before = { ...race, objects: race.objects.map((o, i) => (i === 7 ? { ...o, name: "pit garages" } : o)) };
    const { spec, named } = applyNames(before, lines, names);
    expect(named).toBe(4);
    const els = setElements(spec);
    expect(thingNameOf(els[0], spec)).toBe("red sports car");
    // A line answered null keeps the name its block had.
    expect(spec.objects[7].name).toBe("pit garages");
    expect(setParts(spec, els).map((p) => [p.name, p.objects])).toEqual([
      ["barriers", [4]],
      ["pit garages", [7]],
      ["grandstand", [11, 16]],
    ]);
    // Nothing but names: every block where it was, and the same keys.
    expect(nameless(spec.objects)).toEqual(nameless(race.objects));
    expect(els.map((e) => e.key)).toEqual(setElements(race).map((e) => e.key));
    expect(applyNames(race, lines, new Map([["t1", null]]))).toEqual({ spec: race, named: 0 });
  });

  it("names the showroom's car and its loose things by line", () => {
    const { lines } = nameInput(showroom, null);
    const things = lines.filter((l) => l.alias.startsWith("t"));
    expect(things.map((l) => l.alias)).toEqual(setElements(showroom).map((_, i) => `t${i + 1}`));
    const { spec } = applyNames(showroom, lines, new Map(things.map((l, i) => [l.alias, i === 0 ? "crimson sports coupe" : `prop ${i}`])));
    expect(thingNameOf(setElements(spec)[0], spec)).toBe("crimson sports coupe");
  });
});

describe("one response format, pinned (critic item 19)", () => {
  it("the pass goes through the reader's own client, which asks for a JSON object with reasoning_effort pinned, and its one retry is capped", () => {
    const words = readFileSync(join(__dirname, "shot-words.ts"), "utf8");
    const client = words.slice(words.indexOf("export async function askShotReader("), words.indexOf("export async function askShotWords("));
    expect(client).toContain('response_format: { type: "json_object" },');
    expect(client).not.toContain("json_schema");
    expect(client).toContain('...(pinned ? { reasoning_effort: "none" } : {}),');
    expect(client).toContain("max_completion_tokens: pinned ? opts.maxCompletionTokens : SHOT_READER_FALLBACK_MAX_COMPLETION,");
    const action = readFileSync(join(__dirname, "name-actions.ts"), "utf8");
    expect(action).toContain('askShotReader(nameMessages(input), { maxCompletionTokens: NAME_MAX_COMPLETION, reader: "naming" })');
  });
});

describe("the money", () => {
  it("a press at worst: every character at 1.9 a token plus the framing, and the whole answer cap, at gpt-5.4-mini's rates", () => {
    expect(NAME_WORST_CHARS_PER_TOKEN).toBe(1.9);
    expect(NAME_FRAMING_TOKENS).toBe(16);
    expect(NAME_MAX_COMPLETION).toBe(2000);
    // ceil(13,060 / 1.9) = 6,874 + 16 = 6,890 × $0.75/1M = $0.0051675; 2,000 × $4.50/1M = $0.009.
    expect(Math.ceil(NAME_INPUT_MAX_CHARS / NAME_WORST_CHARS_PER_TOKEN)).toBe(6874);
    expect(NAME_SET_MAX_USD).toBeCloseTo(0.0141675, 12);
    expect(NAME_SET_MAX_USD).toBeCloseTo((6890 * READER_PRICES.inputPer1M + 2000 * READER_PRICES.outputPer1M) / 1e6, 12);
    // The button rounds it up to a tenth of a cent.
    expect(Math.ceil(NAME_SET_MAX_USD * 1000) / 1000).toBe(0.015);
    // The reader's retry without reasoning_effort is capped lower: the pinned path is the worst.
    expect(SHOT_READER_FALLBACK_MAX_COMPLETION).toBeLessThan(NAME_MAX_COMPLETION);
  });
});
