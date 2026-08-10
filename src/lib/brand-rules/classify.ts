// Phase 2 of the brand rulebook (see BRAND_RULEBOOK_DESIGN.md): semantic
// checking of prohibitions.
//
// Phase 1 matched words, which is right for requirements ("did the
// paraphrase keep 'freckles'?") and useless for prohibitions. Verified with
// the real matcher on 2026-08-10: a rule forbidding "guaranteed results"
// correctly blocked "guaranteed results after one session" and completely
// missed "results you can count on" — the same claim, reworded. A rule
// anyone can evade by rephrasing is not a compliance feature.
//
// One classifier call per generation, on a path that already makes two model
// calls. For something whose entire value is being trustworthy, correctness
// beats saving a fraction of a cent.

import { reviewWithOpenAI } from "@/lib/generations/providers/openai";
import type { BrandRule } from "@/lib/brand-rules/types";

export type ProhibitionVerdict = {
  violatedIds: string[];
  // False when the classifier couldn't be reached and the caller should fall
  // back to word matching. Never means "nothing was violated".
  checked: boolean;
};

export async function classifyProhibitions(
  prompt: string,
  rules: BrandRule[],
): Promise<ProhibitionVerdict> {
  if (rules.length === 0) return { violatedIds: [], checked: true };

  // Numbered rather than passing raw uuids: short indices are far less prone
  // to being garbled in a generated response, and they're mapped back here.
  const numbered = rules.map((r, i) => `${i + 1}. ${r.label} — ${r.value}`).join("\n");

  const instructions =
    `You are a compliance checker for AI-generated marketing content. Below is a list of ` +
    `rules describing things that must NEVER appear, followed by a prompt that is about to be ` +
    `sent to an image or video generator.\n\n` +
    `Decide which rules the prompt would violate. Judge meaning, not wording — a rule against ` +
    `"guaranteed results" is violated by "results you can count on" just as much as by the ` +
    `literal phrase. Do not flag a rule merely because the prompt is about a related topic; ` +
    `only flag an actual violation.\n\n` +
    `Rules:\n${numbered}\n\n` +
    `Prompt:\n${prompt}\n\n` +
    `Reply with ONLY the numbers of the violated rules, comma-separated, and nothing else. ` +
    `Reply with exactly "none" if the prompt violates no rules.`;

  let raw: string;
  try {
    raw = await reviewWithOpenAI(instructions);
  } catch {
    // Deliberately reports "not checked" rather than "clean". Compliance
    // must never fail open on a network blip — the caller falls back to the
    // word matcher, which is weaker but not nothing.
    return { violatedIds: [], checked: false };
  }

  const answer = raw.trim().toLowerCase();
  if (!answer || answer.startsWith("none")) return { violatedIds: [], checked: true };

  const violatedIds = Array.from(answer.matchAll(/\d+/g))
    .map((m) => Number(m[0]) - 1)
    .filter((i) => i >= 0 && i < rules.length)
    .map((i) => rules[i].id);

  return { violatedIds: Array.from(new Set(violatedIds)), checked: true };
}
