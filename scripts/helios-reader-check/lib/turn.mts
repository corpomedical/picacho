// One reading, through the page's own code (Helios Cut 2, step 13,
// 2026-09-25 — operator: "Run, keep going."): the model's answer held to
// the set (parseShotReading), planned (planTurn), the shot decided
// (shootDecision), the reply composed in the phrase's language
// (composeReply, said as planned, since no stage runs here), then graded.
// The same path for the perfect reader, the garbage reader and the live
// model — only where the answer comes from differs.
//
// Pure: the model's text is handed in.

import en, { type Messages } from "../../../src/lib/i18n/messages/en.ts";
import es from "../../../src/lib/i18n/messages/es.ts";
import it from "../../../src/lib/i18n/messages/it.ts";
import pt from "../../../src/lib/i18n/messages/pt.ts";
import { parseShotReading, type ReaderWhy } from "../../../src/lib/sets/shot-reading.ts";
import { parseShotWords } from "../../../src/lib/sets/shot-words.ts";
import { planTurn, shootDecision, type ShootDecision, type TurnPlan } from "../../../src/lib/sets/turn-plan.ts";
import { composeReply, plannedFacts, replyText, replyWordsOf, type ReplyModel, type ReplyWords } from "../../../src/lib/sets/turn-reply.ts";
import type { Locale } from "./corpus.mts";
import { factsOf, type PreparedEntry } from "./fixtures.mts";
import { grade, v1WireOf, wireOf, type CallFacts, type Grade, type Wire } from "./grade.mts";

/**
 * A catalog as its module's default export. Run under tsx, a .ts module is
 * loaded as CommonJS and its default arrives one level down; under vitest
 * it arrives as written.
 */
const catalog = (m: Messages): Messages => ("sets" in m ? m : (m as unknown as { default: Messages }).default);

export const WORDS: Record<Locale, ReplyWords> = {
  en: replyWordsOf(catalog(en)),
  es: replyWordsOf(catalog(es)),
  pt: replyWordsOf(catalog(pt)),
  it: replyWordsOf(catalog(it)),
};

export type Reading = {
  raw: Record<string, unknown> | null;
  wire: Wire | null;
  dropped: string[];
  why: ReaderWhy;
  plan: TurnPlan;
  decision: ShootDecision;
  reply: ReplyModel;
  replyText: string;
};

/** The answer's JSON object, as the parser finds it (the text between the first { and the last }), or null. */
export function rawObject(text: string | null): Record<string, unknown> | null {
  if (typeof text !== "string") return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v: unknown = JSON.parse(text.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * A v2 answer (null when none came back) on its prepared phrase: what the
 * page would do and say. An answer that does not parse is the action's
 * "down" (words-actions.ts readShotTurn): nothing moves, nothing shoots.
 */
export function readV2(p: PreparedEntry, text: string | null): Reading {
  const parsed = text === null ? null : parseShotReading(text, { spec: p.spec, aliases: p.aliases, message: p.message, nowHappens: p.now.direction });
  const why: ReaderWhy = parsed ? "ok" : "down";
  const state = { ...p.state, why, dropped: parsed?.dropped ?? [] };
  const plan = planTurn(parsed?.reading ?? null, state);
  const decision = shootDecision(plan, state);
  const words = WORDS[p.locale];
  const facts = plannedFacts(plan, factsOf(p, words, decision));
  const reply = composeReply(plan, null, facts, words);
  return {
    raw: rawObject(text),
    wire: parsed ? wireOf(parsed.reading, p.aliases, p.now.direction) : null,
    dropped: parsed?.dropped ?? [],
    why,
    plan,
    decision,
    reply,
    replyText: replyText(reply),
  };
}

export function gradeV2(p: PreparedEntry, r: Reading, defaultForbid: readonly string[], call?: CallFacts | null): Grade {
  return grade({
    entry: p.entry,
    defaultForbid,
    message: p.message,
    nowWho: p.nowWhoAlias,
    raw: r.raw,
    wire: r.wire,
    dropped: r.dropped,
    plan: { plan: r.plan, decision: r.decision },
    reply: { text: r.replyText, lines: r.reply.lines.length },
    call,
  });
}

/** v1's answer on the same phrase (spec §7.4's before/after table): its fields only; v1 has no plan or reply to grade. */
export function gradeV1(p: PreparedEntry, text: string | null, defaultForbid: readonly string[], call?: CallFacts | null): { grade: Grade; wire: Wire | null } {
  const words = text === null ? null : parseShotWords(text, { spec: p.spec, askPlace: false });
  const wire = words ? v1WireOf(words, p.message, p.now.direction) : null;
  return {
    wire,
    grade: grade({ entry: p.entry, defaultForbid, message: p.message, nowWho: p.nowWhoAlias, raw: rawObject(text), wire, dropped: [], plan: null, reply: null, call }),
  };
}
