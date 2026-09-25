import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import itMsgs from "../i18n/messages/it";

// The Sets home tells the truth about what a press does (Helios Cut 3,
// 2026-09-26; operator: "Pushed, keep going."). Read as source: the page
// needs a browser.

const home = readFileSync(join(__dirname, "../../components/sets/sets-home.tsx"), "utf8");
const homePage = readFileSync(join(__dirname, "../../app/app/sets/page.tsx"), "utf8");
const setPage = readFileSync(join(__dirname, "../../app/app/sets/[id]/page.tsx"), "utf8");
const data = readFileSync(join(__dirname, "data.ts"), "utf8");
const actions = readFileSync(join(__dirname, "actions.ts"), "utf8");
const LANGS = [
  ["en", en],
  ["es", es],
  ["pt", pt],
  ["it", itMsgs],
] as const;
const bodyOf = (source: string, signature: string, end = "\n  }\n") => {
  const at = source.indexOf(signature);
  expect(at, signature).toBeGreaterThan(-1);
  return source.slice(at, source.indexOf(end, at));
};

describe("a delete says what it does to the month's builds (step 4)", () => {
  it("the confirm is picked by the set's status", () => {
    const remove = bodyOf(home, "  async function remove(id: string, status: SetStatus) {");
    expect(remove).toContain(
      'const question = status === "building" ? s.deleteConfirmBuilding : status === "failed" ? s.deleteConfirmFailed : s.deleteConfirm;',
    );
    expect(remove).toContain("if (!window.confirm(question)) return;");
    expect(home).toContain("onClick={() => void remove(x.id, x.status)}");
    expect(home).not.toContain("window.confirm(s.deleteConfirm)");
  });

  it("rests on the count's own rule: a failed build never counts, a deleted one still does", () => {
    const count = bodyOf(data, "export async function countSetBuildsThisMonth(", "\n}\n");
    expect(count).toContain('.neq("status", "failed")');
    // Deleted rows are not filtered out of the count.
    expect(count).not.toContain("deleted_at");
    // A delete leaves the status as it was: a build still running keeps counting.
    const del = bodyOf(actions, "export async function deleteSet(", "\n}\n");
    expect(del).toContain("deleted_at: now,");
    expect(del).not.toMatch(/status: "(failed|ready)"/);
  });

  it("says so in every language", () => {
    for (const [loc, t] of LANGS) {
      for (const k of ["deleteConfirm", "deleteConfirmBuilding", "deleteConfirmFailed"] as const) {
        expect(t.sets[k].trim().length, `${loc} sets.${k}`).toBeGreaterThan(0);
      }
    }
    expect(en.sets.deleteConfirm).toContain("doesn't give its build back");
    expect(en.sets.deleteConfirm).toContain("stay in History");
    expect(en.sets.deleteConfirmBuilding).toContain("still counts");
    expect(en.sets.deleteConfirmFailed).toContain("never counted");
  });
});

describe("a failed build from words offers Try again (step 5)", () => {
  it("the card shows it only where tryAgainWords says, held while a send is out", () => {
    expect(home).toContain("const again = tryAgainWords(x);");
    const chip = home.indexOf("onClick={() => tryAgain(again)}");
    expect(chip).toBeGreaterThan(-1);
    expect(home.slice(chip, chip + 260)).toContain("disabled={submitting}");
    expect(home.slice(chip, chip + 260)).toContain("title={s.buildTryAgainHint}");
    // Only in the branch after a ready set's Shoot, and only when there are words to put back.
    expect(home).toContain(") : again !== null ? (");
  });

  it("puts the words back and spends nothing: no call, no push, and never over a send that is out", () => {
    const tryAgain = bodyOf(home, "  function tryAgain(words: string) {");
    expect(tryAgain).toContain("if (submitting) return;");
    expect(tryAgain.indexOf("if (submitting) return;")).toBeLessThan(tryAgain.indexOf("setBrief("));
    expect(tryAgain).toContain("setBrief(words.slice(0, SHOT_WORDS_MAX_CHARS));");
    expect(tryAgain).toContain("setSetPick(null);");
    expect(tryAgain).toContain('setMode("describe");');
    expect(tryAgain).not.toMatch(/submitSet|readSetRequest|router\.push|send\(/);
  });

  it("the failed set's page links back with ?again=, and the home reads it once", () => {
    expect(setPage).toContain("{set && tryAgainWords(set) !== null && (");
    expect(setPage).toContain("href={`/app/sets?again=${set.id}`}");
    expect(homePage).toContain("againId={first(query.again)}");
    // Only a failed card of this person's that can be tried again fills the box, on the first render.
    expect(home).toContain("const failed = againId ? initialSets.find((x) => x.id === againId) : undefined;");
    expect(home).toContain("return failed ? tryAgainWords(failed) : null;");
    expect(home).toContain('const [brief, setBrief] = useState(() => (againWords ?? "").slice(0, SHOT_WORDS_MAX_CHARS));');
    // And the address forgets it.
    expect(home).toContain('url.searchParams.delete("again");');
  });

  it("says what it does in every language", () => {
    for (const [loc, t] of LANGS) {
      expect(t.sets.buildTryAgain.trim().length, loc).toBeGreaterThan(0);
      expect(t.sets.buildTryAgainHint.trim().length, loc).toBeGreaterThan(0);
    }
    expect(en.sets.buildTryAgainHint).toContain("uses one of this month's builds");
    expect(en.sets.buildTryAgainHint).toContain("never counted");
  });
});
