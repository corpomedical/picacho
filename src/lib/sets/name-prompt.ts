// The naming pass's words (Helios Cut 4, step B4, 2026-09-26 — operator:
// "resume").
//
// WHAT. A set Astra built has blocks, never names: its grandstand is six
// boxes and its car is 25. The naming pass shows gpt-5.4-mini the set's
// things (elements.ts setElements) and the blocks of the set itself, one
// numbered line each, largest first, with Picacho's own closed words for
// what each is — its shape or kind, its colour word, its size and where it
// stands — and the set's title, description and brief. The model answers
// with a name for each line, in 1–3 words, or null. The names go on the
// objects (set-spec.ts SetObject.name), where the page, the chat reader and
// Aly show them. They never reach a paint prompt (the owner's decision D2):
// a still's words stay Picacho's closed words.
//
// ONE RESPONSE FORMAT, PINNED (critic item 19). The call goes through the
// chat reader's own client (shot-words.ts askShotReader), which asks for
// `response_format: {type: "json_object"}` with `reasoning_effort: "none"`
// pinned, and retries once without it, capped at 1,500 tokens, if the API
// ever refuses the parameter. So the shape is not held by the API but here:
// parseNameAnswer reads the answer strictly — one object with exactly one
// key, `names`, a list of `{alias, name}` with exactly those two keys, each
// alias one of the lines given, once, each name a string or null — and an
// answer of any other shape names nothing. NAME_INSTRUCTIONS shows the
// model that shape.
//
// THE MONEY (reader-prices.ts, gpt-5.4-mini, read 2026-09-25). The whole
// input, instructions included, is held to NAME_INPUT_MAX_CHARS (13,060):
// lines past it are left out, smallest first. Priced at 1.9 characters a
// token — lower than the 2.24 the Astra figures use, since these lines are
// numbers much like JSON, whose own measured figure is 1.94 (critic item
// 4) — plus 16 tokens for the two messages' framing: ceil(13,060 / 1.9) +
// 16 = 6,890 tokens × $0.75/1M = $0.0051675, and the answer's whole cap,
// 2,000 tokens × $4.50/1M = $0.009 (the refused-effort retry is capped
// lower, at 1,500): NAME_SET_MAX_USD = $0.0141675 a press at worst, before
// the content check on the names, whose price is not in code. At the
// spec's 2.24 it would be $0.0134. The race track's whole input is 3,287
// characters (815 of instructions, 2,472 of the set: 25 lines), about
// 1,470 tokens at 2.24 × $0.75/1M = $0.0011, plus an answer of about 300
// tokens × $4.50/1M = $0.0014: about $0.0025 typical (not measured).
//
// Pure, relative imports only: the action and the tests share it.

import { colourWord } from "./colour-words";
import { setElements, setOwnBlocks, type ElementKind } from "./elements";
import { placedCopies } from "./look-cutout";
import { READER_PRICES } from "./reader-prices";
import { SET_BRIEF_MAX_CHARS } from "./set-config";
import { SET_LIMITS, cleanText, type SetObject, type SetSpec } from "./set-spec";

/** The fixed instructions, the first message, byte-identical every time (pinned). */
export const NAME_INSTRUCTIONS = `You name the pieces of a small 3D film set. Each numbered line below is one piece: a thing (t…), such as a car or a loose object, or a block of the set itself (o…), such as a wall, a stand, a roof or the ground. Name each in 1–3 words, in the language of the set's title: what it is, as a person on the set would call it ("red sports car", "grandstand", "pit wall"). Blocks that together make one part take the same name: the seats, the roof and the steps of a grandstand are all "grandstand". Never a brand, a model, a real place, a business or a person. No article ("grandstand", not "the grandstand"). Use null for loose clutter or when you cannot tell. Answer only with the JSON, one entry for every line, in the order given: {"names": [{"alias": "t1", "name": "red sports car"}, {"alias": "o4", "name": null}]}`;

/** The whole input, instructions and the set's lines together, at most (pinned; spec §4 B4). */
export const NAME_INPUT_MAX_CHARS = 13_060;
/** Lines one pass shows, at most: the largest pieces. */
export const NAME_MAX_LINES = 60;
/** The answer's cap, visible text and hidden reasoning together. */
export const NAME_MAX_COMPLETION = 2_000;
/** Characters a token, counted low for the worst case: see the header. */
export const NAME_WORST_CHARS_PER_TOKEN = 1.9;
/** The two messages' framing, tokens, on top of their characters. */
export const NAME_FRAMING_TOKENS = 16;

/** One press at worst, in dollars, before the content check on the names: see the header. */
export const NAME_SET_MAX_USD =
  ((Math.ceil(NAME_INPUT_MAX_CHARS / NAME_WORST_CHARS_PER_TOKEN) + NAME_FRAMING_TOKENS) * READER_PRICES.inputPer1M + NAME_MAX_COMPLETION * READER_PRICES.outputPer1M) / 1_000_000;

/** One numbered line: its alias, and the objects a name for it goes on. */
export type NameLine = { alias: string; objects: number[] };

const r1 = (n: number) => String(Math.round(n * 10) / 10 || 0);
const size3 = (x: number, y: number, z: number) => `${r1(x)} × ${r1(y)} × ${r1(z)} m`;
/** How much of the set a piece takes, for "largest first": each side at least half a metre, so a long flat road still ranks by its reach. */
const bulk = (min: readonly number[], max: readonly number[]) => [0, 1, 2].reduce((v, i) => v * Math.max(0.5, max[i] - min[i]), 1);

const KIND_WORDS: Record<ElementKind, string> = { car: "car", vehicle: "vehicle", object: "loose object" };

/**
 * The second message, and the lines it numbers: the set's title,
 * description and brief (≤ 500), then one line per thing (t1… in the set's
 * own order, as the chat reader numbers them), then one per block of the
 * set itself (o and its index in the set), largest first; at most sixty
 * lines. Held with the instructions to NAME_INPUT_MAX_CHARS, the last lines
 * left out first. Picacho's words only: no name the set already carries.
 */
export function nameInput(spec: SetSpec, brief: string | null): { text: string; lines: NameLine[] } {
  const els = setElements(spec);
  const placed = placedCopies(spec.objects, spec.bounds);
  type Row = { line: NameLine; text: string; bulk: number };
  const things: Row[] = [];
  const blocks: Row[] = [];

  els.forEach((e, i) => {
    const objects = [...new Set(e.members.map(([o]) => o))];
    let largest = objects[0];
    let volume = -1;
    for (const o of objects) {
      const s = spec.objects[o].size;
      if (s[0] * s[1] * s[2] > volume) {
        volume = s[0] * s[1] * s[2];
        largest = o;
      }
    }
    const alias = `t${i + 1}`;
    const text = `${alias}: ${KIND_WORDS[e.kind]}, ${colourWord(spec.objects[largest].color)}, ${size3(e.max[0] - e.min[0], e.max[1] - e.min[1], e.max[2] - e.min[2])}, at x ${r1(e.centre[0])} z ${r1(e.centre[2])}, ${e.members.length} blocks`;
    things.push({ line: { alias, objects }, text, bulk: bulk(e.min, e.max) });
  });

  for (const i of setOwnBlocks(spec, els)) {
    const o: SetObject = spec.objects[i];
    const copies = placed.filter((c) => c.object === i);
    if (copies.length === 0) continue;
    const min = [0, 1, 2].map((k) => Math.min(...copies.map((c) => c.min[k])));
    const max = [0, 1, 2].map((k) => Math.max(...copies.map((c) => c.max[k])));
    const alias = `o${i}`;
    const repeat = copies.length > 1 ? `, ${copies.length} copies over ${size3(max[0] - min[0], max[1] - min[1], max[2] - min[2])}` : "";
    const material = o.material ? `, ${o.material}` : "";
    const text = `${alias}: ${o.shape}, ${colourWord(o.color)}${material}, ${size3(o.size[0], o.size[1], o.size[2])}${repeat}, at x ${r1((min[0] + max[0]) / 2)} z ${r1((min[2] + max[2]) / 2)}, top ${r1(max[1])} m`;
    blocks.push({ line: { alias, objects: [i] }, text, bulk: bulk(min, max) });
  }

  // The things first, in the set's own order — a car is small beside a
  // grandstand, and the painted lines of a track outrank it by reach — then
  // the set's own blocks, largest first (between equals, the set's order).
  const largestFirst = blocks.map((r, at) => ({ r, at })).sort((a, b) => b.r.bulk - a.r.bulk || a.at - b.at).map((x) => x.r);
  const ordered = [...things, ...largestFirst].slice(0, NAME_MAX_LINES);
  const head = [
    `TITLE: ${cleanText(spec.title, SET_LIMITS.titleChars) || "none"}`,
    `DESCRIPTION: ${cleanText(spec.description, SET_LIMITS.descriptionChars) || "none"}`,
    `BRIEF: ${cleanText(brief ?? "", SET_BRIEF_MAX_CHARS) || "none"}`,
    "PIECES (alias: what it is, colour, size, where, height of its top):",
  ];
  const compose = (rs: readonly Row[]) => [...head, ...rs.map((r) => r.text)].join("\n");
  let kept = ordered;
  let text = compose(kept);
  while (NAME_INSTRUCTIONS.length + text.length > NAME_INPUT_MAX_CHARS && kept.length > 0) {
    kept = kept.slice(0, -1);
    text = compose(kept);
  }
  return { text, lines: kept.map((r) => r.line) };
}

/** The messages one pass sends: the fixed instructions first (the provider's cached prefix), then the set. */
export function nameMessages(input: { text: string }): { role: "system" | "user"; content: string }[] {
  return [
    { role: "system", content: NAME_INSTRUCTIONS },
    { role: "user", content: input.text },
  ];
}

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const exactKeys = (v: Record<string, unknown>, keys: readonly string[]) => {
  const own = Object.keys(v);
  return own.length === keys.length && keys.every((k) => own.includes(k));
};

/**
 * The model's answer, read strictly (the header): null unless it is one
 * JSON object with exactly the key `names`, holding a list. In the list,
 * an entry is kept only when it has exactly `alias` and `name`, the alias
 * is one of `aliases` and not already answered, and the name is a string
 * or null; a name is cleaned and capped as a saved name is (32 characters),
 * and one left blank is null. Every other entry is dropped and counted.
 */
export function parseNameAnswer(text: string, aliases: readonly string[]): { names: Map<string, string | null>; dropped: number } | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(v) || !exactKeys(v, ["names"]) || !Array.isArray(v.names)) return null;
  const names = new Map<string, string | null>();
  let dropped = 0;
  for (const entry of v.names) {
    if (!isObject(entry) || !exactKeys(entry, ["alias", "name"]) || typeof entry.alias !== "string" || !aliases.includes(entry.alias) || names.has(entry.alias)) {
      dropped += 1;
      continue;
    }
    if (entry.name === null) names.set(entry.alias, null);
    else if (typeof entry.name === "string") names.set(entry.alias, cleanText(entry.name, SET_LIMITS.nameChars) || null);
    else dropped += 1;
  }
  return { names, dropped };
}

/**
 * The names put on the set: each line answered with a name gives it to
 * every object the line numbers — a thing's blocks, or the one block of the
 * set itself. A line answered null, or not at all, leaves its objects as
 * they were: the pass never takes a name away. `named` counts the lines
 * that gave a name.
 */
export function applyNames(spec: SetSpec, lines: readonly NameLine[], names: ReadonlyMap<string, string | null>): { spec: SetSpec; named: number } {
  const give = new Map<number, string>();
  let named = 0;
  for (const line of lines) {
    const name = names.get(line.alias);
    if (!name) continue;
    named += 1;
    for (const o of line.objects) give.set(o, name);
  }
  if (give.size === 0) return { spec, named: 0 };
  return { spec: { ...spec, objects: spec.objects.map((o, i) => (give.has(i) ? { ...o, name: give.get(i)! } : o)) }, named };
}
