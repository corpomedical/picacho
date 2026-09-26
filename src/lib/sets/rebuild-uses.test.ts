import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import it_ from "../i18n/messages/it";
import { astraCardCanGo, astraCardKind, rebuildUsesLine } from "./astra-card";

// The rebuild button says what it uses (Helios Cut 4, step A10; operator,
// 2026-09-26: "resume"). A rebuild from photos is one of the month's Astra
// changes, counted only if it saves, exactly as a change to the set is; the
// button said nothing of it. Now its line comes from the Astra card's own
// kinds and count, before THING_REBUILD_OPEN_TO_ALL flips.

const LANGS = { en, es, pt, it: it_ } as const;
const line = (t: typeof en, over: { editsLeft: number | null; editsCap: number; paused?: boolean }) => {
  const kind = astraCardKind({ editsLeft: over.editsLeft, editsCap: over.editsCap, tooBig: false, paused: over.paused ?? false });
  return { kind, text: rebuildUsesLine(t.sets.cast, { kind, editsLeft: over.editsLeft, editsCap: over.editsCap, paused: t.serverText.setEditTriesUsed }), canGo: astraCardCanGo(kind) };
};

describe("what a rebuild uses, under its button", () => {
  it("says the month's count, only if it saves, and offers the press", () => {
    expect(line(en, { editsLeft: 3, editsCap: 4 })).toEqual({ kind: "ask", text: "Uses 1 of your 3 Astra changes left this month, only if it saves.", canGo: true });
    expect(line(en, { editsLeft: 1, editsCap: 4 })).toEqual({ kind: "askLast", text: "Uses your last Astra change this month, only if it saves.", canGo: true });
    expect(line(en, { editsLeft: null, editsCap: 4 }).text).toBe("Uses 1 of your 4 Astra changes this month, only if it saves; how many are left couldn't be read.");
  });

  it("says the month is used up, or Astra paused in the server's own words, and holds the press", () => {
    expect(line(en, { editsLeft: 0, editsCap: 4 })).toEqual({ kind: "none", text: en.sets.cast.rebuildUsesNone, canGo: false });
    expect(line(en, { editsLeft: 0, editsCap: 0 }).canGo).toBe(false);
    expect(line(en, { editsLeft: 2, editsCap: 4, paused: true })).toEqual({ kind: "paused", text: en.serverText.setEditTriesUsed, canGo: false });
  });

  it("says nothing for an account with no cap (admins), and never 'too big': a rebuild sends its thing, not the set", () => {
    expect(line(en, { editsLeft: null, editsCap: -1 })).toEqual({ kind: "askOpen", text: null, canGo: true });
    expect(rebuildUsesLine(en.sets.cast, { kind: "tooBig", editsLeft: 3, editsCap: 4, paused: "" })).toBeNull();
  });

  it("is said in every language, with nothing left unfilled", () => {
    for (const [name, t] of Object.entries(LANGS)) {
      for (const over of [{ editsLeft: 3, editsCap: 4 }, { editsLeft: 1, editsCap: 4 }, { editsLeft: null, editsCap: 4 }, { editsLeft: 0, editsCap: 4 }]) {
        const text = line(t, over).text;
        expect(text, `${name} ${JSON.stringify(over)}`).toBeTruthy();
        expect(text, name).not.toMatch(/[{}]/);
      }
      expect(line(t, { editsLeft: 3, editsCap: 4 }).text, name).toContain("3");
      expect(line(t, { editsLeft: null, editsCap: 4 }).text, name).toContain("4");
    }
    for (const t of [es, pt, it_]) {
      for (const k of ["rebuildUses", "rebuildUsesLast", "rebuildUsesUnknown", "rebuildUsesNone"] as const) expect(t.sets.cast[k], k).not.toBe(en.sets.cast[k]);
    }
  });
});

describe("the card and the page (read as source)", () => {
  const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
  const card = readFileSync(join(__dirname, "../../components/sets/element-card.tsx"), "utf8");

  it("holds the button when a press can come to nothing, and says the line before the press", () => {
    expect(card).toContain("disabled={rebuild.working || rebuild.held || busy || !rebuild.canGo}");
    expect(card).toContain("{rebuild.photos > 0 && rebuild.uses && !rebuild.working && (");
    expect(card).toContain("data-el-rebuild-uses");
  });

  it("reads the Astra card's kind with the page's own count, cap and pause, never the set's size", () => {
    expect(view).toContain("const rebuildKind = astraCardKind({ editsLeft, editsCap: astraEditsCap, tooBig: false, paused: triesSpent });");
    expect(view).toContain("line: rebuildUsesLine(cast, { kind: rebuildKind, editsLeft, editsCap: astraEditsCap, paused: t.serverText.setEditTriesUsed }),");
    expect(view).toContain("canGo: astraCardCanGo(rebuildKind),");
    const prop = view.slice(view.indexOf("        rebuild={"), view.indexOf("        drive={"));
    expect(prop).toContain("uses: rebuildUses.line,");
    expect(prop).toContain("canGo: rebuildUses.canGo,");
  });
});
