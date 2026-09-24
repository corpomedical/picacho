import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// One keystroke, one render (Admin report, 2026-09-24: React #185 thrown in
// the prompt textarea's onChange on /app/generate).
//
// An effect keyed on `prompt` that calls a state setter unconditionally
// queues a second render behind every keystroke, even when the updater hands
// back the same value: right after a commit React cannot bail out early.
// React 19 counts a commit that finishes with work still waiting toward its
// 50-deep update limit, so keys arriving faster than the composer re-renders
// (automated typing, a slow phone) crossed it, and the character whose
// setState tripped it was lost, about one in every 51. Measured on the
// composer: two commits per key before the fix, 2 of 136 characters lost in
// a burst; one commit per key after, 136 of 136 and 488 of 488.
//
// Source-text checks, the same pattern composer-slate and generate-stage-b
// use: the component is 10,000 lines and there is no DOM test runner here.

const form = readFileSync(join(__dirname, "generate-form.tsx"), "utf8");

/** Every useEffect / useLayoutEffect whose dependency list names `prompt`, as [first statement, whole body]. */
function effectsKeyedOnPrompt(src: string): { first: string; body: string }[] {
  const out: { first: string; body: string }[] = [];
  // The effect closes on the first line back at its opener's indentation:
  // "}, [deps]);" or, with no dependency list, "});".
  const opener = /^( *)(?:React\.)?use(?:Layout)?Effect\(\(\) => \{\n/gm;
  let m: RegExpExecArray | null;
  while ((m = opener.exec(src))) {
    const start = m.index + m[0].length;
    const closing = new RegExp(`\\n${m[1]}\\}(?:, \\[([^\\]]*)\\])?\\);`);
    const end = closing.exec(src.slice(start));
    if (!end) continue;
    const body = src.slice(start, start + end.index);
    const deps = end[1] ?? "";
    if (!/\bprompt\b/.test(deps)) continue;
    const first = body.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("//")) ?? "";
    out.push({ first, body });
  }
  return out;
}

describe("typing in the composer", () => {
  it("finds the effects keyed on the prompt (the check below is not vacuous)", () => {
    expect(effectsKeyedOnPrompt(form).length).toBeGreaterThanOrEqual(2);
  });

  it("no effect keyed on the prompt opens with an unconditional state update", () => {
    for (const { first, body } of effectsKeyedOnPrompt(form)) {
      expect(first, `an effect keyed on prompt sets state on every keystroke:\n${body}`).not.toMatch(/^set[A-Z]\w*\(/);
    }
  });

  it("the stale-question effect sets state only when a question is pending", () => {
    expect(form).toContain("if (modeQuery !== null && modeQuery !== prompt) setModeQuery(null);");
    expect(form).not.toContain("setModeQuery((q) => (q !== null && q !== prompt ? null : q));");
  });
});
