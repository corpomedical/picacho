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
