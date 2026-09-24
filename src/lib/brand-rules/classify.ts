// Phase 3 of the brand rulebook: semantic checking of prohibitions with
// EVIDENCE — rebuilt 2026-08-24 after a live false positive (operator's
// trailer prompt blocked three times by "No before-and-after imagery",
// then generated fine with rules off; the block named no trigger and
// offered no fix).
//
// Two lessons baked in:
//   * The checker must QUOTE the exact words it is flagging, and the quote
//     is verified against the prompt server-side. A "violation" whose
//     evidence isn't really in the prompt is a hallucinated one, and is
//     DISCARDED. This is the structural guard that makes the checker
//     trustworthy rather than vibes-based.
//   * A block must carry its own fix: the rule, the trigger words, and a
//     one-line rewording suggestion travel to the UI, so the person can
//     repair the prompt instead of staring at a verdict.
//
// One classifier call per generation, on a path that already makes model
// calls. For something whose entire value is being trustworthy, correctness
// beats saving a fraction of a cent.

import { reviewWithOpenAI } from "@/lib/generations/providers/openai";
import type { BrandRule } from "@/lib/brand-rules/types";

export type ProhibitionViolation = {
  id: string;
  label: string;
  /** Verbatim words from the prompt that triggered the rule. */
  evidence: string;
  /** One-line suggested rewording, from the checker. May be empty. */
  fix: string;
};

export type ProhibitionVerdict = {
  violations: ProhibitionViolation[];
  // False when the classifier couldn't be reached and the caller should fall
  // back to word matching. Never means "nothing was violated".
  checked: boolean;
};

export async function classifyProhibitions(
  prompt: string,
  rules: BrandRule[],
): Promise<ProhibitionVerdict> {
  if (rules.length === 0) return { violations: [], checked: true };

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
    `Calibration — read carefully:\n` +
    `- The prompt describes a scene featuring a FICTIONAL CHARACTER. Describing the ` +
    `character's appearance, face, body, build, physique, clothing, or attractiveness is ` +
    `normal scene description and is never, by itself, a violation of any rule.\n` +
    `- Apply each rule exactly as written and scoped. A rule about "the viewer" or the ` +
    `audience concerns messaging directed AT the audience (e.g. text implying the viewer ` +
    `should change), not how a character in the scene is depicted or described.\n` +
    `- Only flag a rule when the prompt clearly and unambiguously violates it — when any ` +
    `reasonable compliance reviewer would agree. If it is debatable, borderline, or merely ` +
    `adjacent, do NOT flag it. A wrongly blocked generation costs the customer a paid ` +
    `attempt; uncertainty means "none".\n` +
    `- Cinematic structure — cuts, transitions, montage pacing, "slow burn then explosive ` +
    `finale" — is film language, not a before/after comparison or a claim.\n` +
    `- Name the rule whose meaning the words actually break. Words that break one rule do ` +
    `not also break its neighbour in the list.\n\n` +
    `Rules:\n${numbered}\n\n` +
    `Prompt:\n${prompt}\n\n` +
    `Reply with ONLY a JSON array, nothing else. One entry per ACTUAL violation:\n` +
    `[{"rule": <number>, "label": "<that rule's name, copied exactly from the list>", ` +
    `"evidence": "<the EXACT words copied verbatim from the prompt that ` +
    `violate the rule>", "fix": "<one short sentence: how to reword the prompt to comply>"}]\n` +
    `The evidence MUST be copied character-for-character from the prompt — if you cannot ` +
    `point to exact words, the rule is not violated. Reply with exactly [] if no rule is violated.`;

  let raw: string;
  try {
    raw = await reviewWithOpenAI(instructions);
  } catch {
    // Deliberately reports "not checked" rather than "clean". Compliance
    // must never fail open on a network blip — the caller falls back to the
    // word matcher, which is weaker but not nothing.
    return { violations: [], checked: false };
  }

  const trimmed = raw.trim();
  // Tolerate a fenced or prefixed reply — grab the first JSON array in it.
  const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return { violations: [], checked: true };

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return { violations: [], checked: true };
  }
  if (!Array.isArray(parsed)) return { violations: [], checked: true };

  const promptLower = prompt.toLowerCase();
  const violations: ProhibitionViolation[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const n = Number((entry as { rule?: unknown }).rule);
    const evidence = String((entry as { evidence?: unknown }).evidence ?? "").trim();
    const fix = String((entry as { fix?: unknown }).fix ?? "").trim().slice(0, 300);
    const label = String((entry as { label?: unknown }).label ?? "");
    const rule = resolveRule(rules, n, label);
    if (!rule) continue;
    // THE EVIDENCE GATE: the quoted trigger must genuinely appear in the
    // prompt (case-insensitive). A flag whose evidence can't be located is a
    // hallucination and is dropped — this single check is what turned the
    // checker from "vibes" into something falsifiable.
    if (!evidence || evidence.length < 3 || !promptLower.includes(evidence.toLowerCase())) continue;
    if (violations.some((v) => v.id === rule.id)) continue;
    violations.push({ id: rule.id, label: rule.label, evidence: evidence.slice(0, 200), fix });
  }

  return { violations, checked: true };
}

const labelKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

// Which rule an answer means. The number alone slipped: a Ferrari F40 on a
// set, a clear "No third-party trademarks" case, came back as rule numbers
// for "No real public figures", "No copyrighted characters" and "No
// prescription brand names" — the neighbours in the list (Reports,
// 2026-09-19/20). The block was right, the reason it named was not, and the
// reason is what the person reads. So the answer also names the rule, and a
// name that is one of the listed rules wins over a number pointing
// elsewhere; among rules sharing that name (two packs can both carry "No
// competitor brands") the one nearest the number is kept. A name that
// matches nothing is a paraphrase, and the number stands as before.
export function resolveRule(rules: BrandRule[], n: number, label: string): BrandRule | null {
  const byNumber = Number.isInteger(n) && n >= 1 && n <= rules.length ? rules[n - 1] : null;
  const key = labelKey(label);
  if (!key) return byNumber;
  if (byNumber && labelKey(byNumber.label) === key) return byNumber;
  const named = rules
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => labelKey(r.label) === key);
  if (named.length === 0) return byNumber;
  const target = byNumber ? n - 1 : 0;
  named.sort((a, b) => Math.abs(a.i - target) - Math.abs(b.i - target));
  return named[0].r;
}
