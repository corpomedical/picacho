// The dry runs' model answers, so the whole check runs for free (spec §6.4,
// step 13; Helios Cut 2, 2026-09-25 — operator: "Run, keep going.").
//
// THE PERFECT READER writes, for each phrase, exactly what the phrase's own
// `expected` block asks, in the reader's wire format — nothing more. It
// exercises the parser, the plan, every reply string in the phrase's own
// language and the grader on all 100 phrases; it says nothing about how the
// model reads, which only the live check does. Where the reply a phrase
// expects needs a key its expectations only ALLOW (the Sets home's build
// turn needs its set change to say "built from these words"), the key is
// in dry-extras.json, beside the corpus, so corpus.json stays the spec's.
//
// THE GARBAGE READER answers every phrase four wrong ways, each built to
// trip particular hard gates, and says which gates each MUST trip on that
// phrase (garbageGates): the grader is tested against a bad reader too, and
// a gate that stays quiet when it should fire fails the dry run.
//
// Pure.

import { WIRE_KEYS } from "./grade.mts";
import { alternativesOf, type CorpusEntry, type Fixture } from "./corpus.mts";

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** Keys the reader writes as lists. */
const LIST_KEYS = new Set(["rig", "steps", "ask", "textures"]);

/** Neutral options for a phrase that expects suggestions: valid act keys only, nothing that spends. */
const SUGGESTIONS: Record<string, unknown>[] = [
  { size: "medium", height: "low" },
  { size: "wide", rig: ["time:night"] },
  { lens_mm: 85, rig: ["stop:2"] },
];

/** The phrase as a model would quote it: without its closing full stop. */
const quoted = (phrase: string) => phrase.trim().replace(/[.!?]+$/u, "");

/** One value that meets an expectation: the value itself, the first of anyOf, the low end of a range, the candidates' list. */
function valueFor(exp: unknown): unknown {
  if (!isObject(exp)) return exp;
  if (Array.isArray(exp.anyOf)) return valueFor(exp.anyOf[0]);
  if (Array.isArray(exp.candidates)) return [...exp.candidates];
  if (typeof exp.min === "number") return exp.min;
  if (typeof exp.max === "number") return exp.max;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(exp)) out[k] = valueFor(v);
  return out;
}

export class Unsatisfiable extends Error {}

/**
 * The perfect reader's answer to one phrase, as the JSON text the model
 * would write. Throws Unsatisfiable when the expectation asks for words the
 * phrase (or NOW) doesn't have: a corpus error, not a reader's.
 */
export function perfectAnswer(entry: CorpusEntry, nowDirection: string, extras: Record<string, unknown> | undefined): string {
  const exp = alternativesOf(entry.expected)[0] ?? {};
  const phrase = quoted(entry.phrase);
  const out: Record<string, unknown> = {};
  for (const [key, e] of Object.entries(exp)) {
    switch (key) {
      case "direction":
      case "set_change_gloss":
        break;
      case "set_change": {
        const terms = isObject(e) && Array.isArray(e.includes) ? e.includes : [];
        for (const t of terms) if (typeof t !== "string" || !phrase.toLowerCase().includes(t.toLowerCase())) throw new Unsatisfiable(`${entry.id}: set_change needs "${String(t)}"`);
        const g = exp.set_change_gloss;
        const gloss = isObject(g) && Array.isArray(g.includes) ? g.includes.join(" ") : null;
        out.set_change = gloss ? { said: phrase, gloss } : { said: phrase };
        break;
      }
      case "near": {
        const v = isObject(e) ? e : {};
        out.near = { thing: valueFor(v.thing), side: typeof v.side === "string" ? v.side : "beside" };
        break;
      }
      case "gaze":
      case "facing":
        out[key] = isObject(e) && "thing" in e ? { thing: valueFor(e.thing) } : valueFor(e);
        break;
      case "nudge": {
        const v = valueFor(e) as Record<string, unknown>;
        out.nudge = { right: v.right ?? 0, toward: v.toward ?? 0 };
        break;
      }
      case "cant": {
        const codes = Array.isArray(e) ? e : [valueFor(e)];
        // Their own words when the phrase is short enough to quote whole; else "part of that".
        const said = Array.from(phrase).length <= 60 ? phrase : null;
        out.cant = codes.map((code) => ({ code, said }));
        break;
      }
      case "suggest": {
        const n = isObject(e) && typeof e.minItems === "number" ? e.minItems : 1;
        out.suggest = SUGGESTIONS.slice(0, Math.max(1, Math.min(3, n)));
        break;
      }
      default: {
        const v = valueFor(e);
        out[key] = LIST_KEYS.has(key) && !Array.isArray(v) ? [v] : v;
      }
    }
  }
  // What happens: NOW's own words where they hold a word it expects, the phrase where it does.
  const d = exp.direction;
  if (isObject(d) && Array.isArray(d.includes)) {
    const keep: string[] = [];
    const add: string[] = [];
    for (const t of d.includes) {
      const term = String(t).toLowerCase();
      if (nowDirection.toLowerCase().includes(term)) {
        const piece = quoted(nowDirection);
        if (!keep.includes(piece)) keep.push(piece);
      } else if (phrase.toLowerCase().includes(term)) {
        if (!add.includes(phrase)) add.push(phrase);
      } else throw new Unsatisfiable(`${entry.id}: direction needs "${term}"`);
    }
    out.happens = { ...(keep.length ? { keep } : {}), ...(add.length ? { add } : {}) };
  }
  for (const [k, v] of Object.entries(extras ?? {})) out[k] = v;
  for (const k of Object.keys(out)) if (!(WIRE_KEYS as readonly string[]).includes(k)) throw new Unsatisfiable(`${entry.id}: the perfect answer would write "${k}"`);
  return JSON.stringify(out);
}

// ---------------------------------------------------------------------------
// The garbage reader.
// ---------------------------------------------------------------------------

/** The hard gates, by the name the dry run counts them under (grade.mts says each in words). */
export type GateName = "forbidden-who" | "forbidden-shoot" | "forbidden-undo" | "shot" | "lens-stock" | "dropped" | "invented-quote" | "not-json";

export type Garbage = { name: string; text: string; gates: GateName[] };

/** A hard-gate line, as grade.mts writes it, under its name. */
export function gateName(line: string): GateName | "other" {
  if (line.startsWith("who swapped")) return "forbidden-who";
  if (line === "shoot where none is allowed") return "forbidden-shoot";
  if (line === "undo where none is allowed") return "forbidden-undo";
  if (line.startsWith("shot a ")) return "shot";
  if (line === "lens_mm beside a film stock") return "lens-stock";
  if (line.startsWith("parts dropped")) return "dropped";
  if (line.startsWith("a “not yet” quote")) return "invented-quote";
  if (line === "the answer was not a JSON object") return "not-json";
  return "other";
}

/**
 * The four wrong answers for one phrase, and the gates each must trip
 * there. `named` is what the phrase expects or allows (those keys are not
 * forbidden); a chat-armed take or Just talking holds a shot by design, so
 * "shot" is only owed where neither does.
 */
export function garbageAnswers(entry: CorpusEntry, fx: Fixture): Garbage[] {
  const named = new Set([...alternativesOf(entry.expected).flatMap((a) => Object.keys(a)), ...(entry.allow ?? [])]);
  const forbidden = (k: string) => !named.has(k) || (entry.forbid ?? []).includes(k);
  const nowWho = entry.context?.now?.who !== undefined ? entry.context.now.who : fx.now.who;
  const other = fx.characters.find((c) => c.alias !== nowWho && c.hasPhoto)?.alias ?? "p1";
  const mode = entry.context?.now?.mode ?? fx.now.mode;
  const take = entry.context?.now?.takeStart !== undefined ? entry.context.now.takeStart : fx.now.takeStart;
  const expectShoot = entry.expectShoot ?? "none";

  const swap: GateName[] = [];
  if (forbidden("who")) swap.push("forbidden-who");
  if (forbidden("shoot")) swap.push("forbidden-shoot");
  if (expectShoot === "none" && mode !== "talk" && take?.armedBy !== "chat") swap.push("shot");

  const stock: GateName[] = [];
  if (!named.has("lens_mm")) stock.push("lens-stock");
  if (forbidden("undo")) stock.push("forbidden-undo");

  return [
    { name: "swap-and-shoot", text: JSON.stringify({ who: other, shoot: true }), gates: swap },
    {
      name: "invented-words",
      text: JSON.stringify({
        set_change: { said: "paint the whole place gold", gloss: "gold everywhere" },
        happens: { add: ["she dances on the roof"] },
        cant: [{ code: "weather", said: "a storm nobody asked for" }],
      }),
      gates: ["dropped", "invented-quote"],
    },
    { name: "stock-as-lens", text: JSON.stringify({ rig: ["stock:film35"], lens_mm: 35, undo: true }), gates: stock },
    { name: "not-json", text: "Sure! I'll make it night and move her closer.", gates: ["not-json"] },
  ];
}
