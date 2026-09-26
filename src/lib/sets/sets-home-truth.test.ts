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
const types = readFileSync(join(__dirname, "types.ts"), "utf8");
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

  it("names where the box is, which is true on the Sets home and on the failed set's own page (review of Cut 3)", () => {
    // The set's page has no box above its Try again: the words go to the Sets home's.
    expect(setPage).toContain("title={s.buildTryAgainHint}");
    expect(en.sets.buildTryAgainHint).toContain("the box at the top of Helios 3D");
    for (const [loc, t] of LANGS) {
      expect(t.sets.buildTryAgainHint, loc).toContain("Helios 3D");
      expect(t.sets.buildTryAgainHint, loc).not.toMatch(/box above|de arriba\.|caixa acima|qui sopra/);
    }
  });
});

describe("the build button says what it spends, and the Set chip starts on the latest set (step 6)", () => {
  it("the usage line hidden below 640 px is gone; the button's words show at every width", () => {
    expect(home).not.toContain('<span className="hidden text-xs tabular-nums text-atelier-muted sm:inline">');
    expect(home).not.toMatch(/hidden[^"]*sm:inline/);
    const words = home.slice(home.indexOf("{sendWords !== null && ("), home.indexOf("<SendIcon", home.indexOf("{sendWords !== null && (")));
    expect(words).toContain("{sendWords}");
    // No "hidden" class on the words (aria-hidden is fine: the button carries them as its name).
    expect(words).not.toMatch(/[\s"`]hidden[\s"`]/);
    expect(words).toContain("title={sendLabel}");
    expect(words).toContain("aria-label={sendLabel}");
  });

  it("the words are picked by what is left this month", () => {
    expect(home).toContain("const left = Math.max(0, monthlyLimit - used);");
    const label = home.slice(home.indexOf("const buildLabel = starting"), home.indexOf("const sendWords"));
    expect(label).toContain("? s.starting");
    expect(label).toContain("monthlyLimit < 0 || !usedKnown");
    expect(label).toContain("? s.buildThisPlace");
    expect(label).toContain("? s.buildNoneLeft");
    expect(label).toContain("formatMsg(s.buildThisPlaceLeft, { left, limit: monthlyLimit })");
    // One left in the singular (review of Cut 3): "queda 1 de 1", never "quedan 1 de 1".
    expect(label).toContain("left === 1\n          ? formatMsg(s.buildThisPlaceLeftOne, { limit: monthlyLimit })");
    // At the cap a new place stays unsendable (the button is disabled), exactly as before.
    expect(home).toContain("const canSend = brief.trim().length > 0 && !submitting && (setPick !== null || !atCap);");
    expect(home).toContain("disabled={!canSend}");
  });

  it("a count that could not be read says no number", () => {
    expect(types).toContain("usedKnown: boolean;");
    expect(data).toContain("usedThisMonth: used ?? 0,");
    expect(data).toContain("usedKnown: used !== null,");
    expect(homePage).toContain("usedKnown={data.usedKnown}");
  });

  it("the Set chip starts on the latest set, and moves to the latest of the rest when that one goes", () => {
    expect(home).toContain("const [setPick, setSetPick] = useState<string | null>(() => (againWords ? null : latestSetId(initialSets)));");
    expect(bodyOf(home, "  async function remove(id: string, status: SetStatus) {")).toContain(
      "if (setPick === id) setSetPick(latestSetId(sets.filter((x) => x.id !== id)));",
    );
    expect(home).toContain(
      'if (setPick !== null && !initialSets.some((x) => x.id === setPick && x.status === "ready")) setSetPick(latestSetId(initialSets));',
    );
    expect(home).toContain("placeholder={setPick ? s.homePlaceholderSet : s.homePlaceholder}");
  });

  it("says it in every language, with the numbers filled", () => {
    for (const [loc, t] of LANGS) {
      for (const k of ["buildThisPlace", "buildThisPlaceLeft", "buildNoneLeft", "homePlaceholderSet", "emptyBody"] as const) {
        expect(t.sets[k].trim().length, `${loc} sets.${k}`).toBeGreaterThan(0);
      }
      expect(t.sets.buildThisPlaceLeft, loc).toContain("{left}");
      expect(t.sets.buildThisPlaceLeft, loc).toContain("{limit}");
      expect(t.sets.buildThisPlaceLeft.startsWith(t.sets.buildThisPlace), loc).toBe(true);
    }
    expect(en.sets.buildThisPlaceLeft).toBe("Build this place · {left} of {limit} left this month");
    // The singular, filled as the home fills it, agrees with its one build in every language.
    for (const [loc, t] of LANGS) {
      expect(t.sets.buildThisPlaceLeftOne, loc).toContain("{limit}");
      expect(t.sets.buildThisPlaceLeftOne, loc).not.toContain("{left}");
      expect(t.sets.buildThisPlaceLeftOne.startsWith(t.sets.buildThisPlace), loc).toBe(true);
    }
    const one = (t: { sets: { buildThisPlaceLeftOne: string } }) => t.sets.buildThisPlaceLeftOne.replace("{limit}", "1");
    expect(one(en)).toBe("Build this place · 1 of 1 left this month");
    expect(one(es)).toBe("Construir este lugar · queda 1 de 1 este mes");
    expect(one(pt)).toBe("Construir este lugar · resta 1 de 1 este mês");
    expect(one(itMsgs)).toBe("Costruisci questo luogo · ne resta 1 di 1 questo mese");
    // The empty list no longer walks the person through marks and stand-ins by hand.
    expect(en.sets.emptyBody).not.toMatch(/\bmark\b|stand-in/);
  });
});
