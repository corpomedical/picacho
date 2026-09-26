import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import it_ from "../i18n/messages/it";

// Plain-truth lines (Helios Cut 4, step A7; operator, 2026-09-26: "resume"):
// what a still will and won't show, said before the press or right after
// the change, for every account, with no change to what any still receives.
// - the frame card's Time row for every account, not only reader v2's;
// - the stills' own brand rule, up front, beside what happens and the composer;
// - after an Astra change, when the rig's hour or plot draws over its light
//   or sky, or a thing it touched is drawn from its own photos — read from
//   the two copies (time-of-day.ts rigHidesEdit, elements.ts
//   photoThingsChanged), never from words;
// - after "Use my words as what happens", on every press, that the words
//   don't turn or pose the figure — never by scanning them.
//
// Read as source: the page needs a browser and a stage.

const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
const bodyOf = (source: string, signature: string, end = "\n  }\n") => {
  const at = source.indexOf(signature);
  expect(at, signature).toBeGreaterThan(-1);
  return source.slice(at, source.indexOf(end, at));
};
const between = (source: string, from: string, to: string) => {
  const start = source.indexOf(from);
  expect(start, from).toBeGreaterThan(-1);
  const end = source.indexOf(to, start + from.length);
  expect(end, to).toBeGreaterThan(start);
  return source.slice(start, end);
};
const LANGS = { en, es, pt, it: it_ } as const;
const REPLY_KEYS = ["noteRigHourHides", "noteRigPlotHides", "noteOwnPhotos", "noteWordsDontMove", "noteWordsDontMoveStage"] as const;

describe("the frame card says the hour for every account", () => {
  it("drops reader v2's gate from the Time row", () => {
    const row = between(view, 'rowLabel(s.rig.rowTime, "time")', "</dd>");
    expect(row).toContain("{timeLabel(rig.time)}");
    expect(view).toContain("{rig.time !== null && (\n                            <>\n                              {rowLabel(s.rig.rowTime, \"time\")}");
  });
});

describe("the brand rule, said up front", () => {
  it("rides the Happens row and the composer while there are words", () => {
    const happens = between(view, 'rowLabel(s.rowHappens, "happens")', "</dd>");
    expect(happens).toContain("{s.brandLine}");
    const composer = between(view, "{formatMsg(s.reply.composerCount", "<div className=\"mt-2 flex flex-wrap items-center gap-1.5\">");
    expect(composer).toContain('{draft.trim() !== "" && (');
    expect(composer).toContain("{s.brandLine}");
    // Everyone's: never behind reader v2 or an admin switch.
    expect(composer).not.toMatch(/v2On|isAdmin|readerV2/);
  });

  it("says what the stills' own sentence bans, in all four languages", () => {
    expect(en.sets.brandLine).toBe("Brand names and logos come back as look-alikes; signs and written words stay blank.");
    const setShot = readFileSync(join(__dirname, "set-shot-prompt.ts"), "utf8");
    expect(setShot).toContain('const NO_TEXT_SENTENCE = "No text, logos or brand names anywhere in the picture.";');
    // The look-alike wording of each catalog's own brand line (reply.cant.brand).
    expect(es.sets.brandLine).toContain("parecidos genéricos");
    expect(pt.sets.brandLine).toContain("parecidos genéricos");
    expect(it_.sets.brandLine).toContain("somiglianti generici");
    for (const t of [es, pt, it_]) expect(t.sets.brandLine).not.toBe(en.sets.brandLine);
  });
});

describe("after an Astra change, what stills won't show of it", () => {
  it("keeps the two copies of the change that landed, and forgets them on a rebuild", () => {
    const edit = between(view, "    const apply = (next: SetSpec, changed: number, undo: EditUndo | null, seal: EditUndo | null) => {", "    };");
    expect(edit).toContain("setLandedEdit({ before, after: next });");
    const rebuild = between(view, "    const apply = (next: SetSpec, changed: number, to: { key: string; blocks: number } | null, seal: EditUndo | null) => {", "    };");
    expect(rebuild).toContain("setLandedEdit(null);");
  });

  it("reads them key by key under the rig as it is now, only while the set is still that copy", () => {
    const memo = between(view, "  const editHides = useMemo(() => {", "}, [landedEdit, spec, rig, els, elementPhotos]);");
    expect(memo).toContain("if (!landedEdit || landedEdit.after !== spec) return null;");
    expect(memo).toContain("rigHidesEdit(landedEdit.before, landedEdit.after, rig)");
    expect(memo).toContain("photoThingsChanged(elementsOf(landedEdit.before), els, elementPhotos)");
  });

  it("says each under the changed line, only for a change that changed something", () => {
    const block = between(view, "{setChanged !== null && setChanged > 0 && editHides !== null", "{/* An Astra answer that changed nothing");
    expect(block).toContain("formatMsg(s.reply.noteRigHourHides, { time: timeLabel(rig.time) })");
    expect(block).toContain("formatMsg(s.reply.noteRigPlotHides, { light: s.rig.lights[rig.light.scheme] })");
    expect(block).toContain("fill(s.reply.noteOwnPhotos, { thing: elementName(key) })");
  });

  it("names the rig panel's own labels in every language", () => {
    for (const [name, t] of Object.entries(LANGS)) {
      expect(t.sets.reply.noteRigHourHides, name).toContain(`${t.sets.rig.time} → ${t.sets.rig.timeAsBuilt}`);
      expect(t.sets.reply.noteRigHourHides, name).toContain("{time}");
      expect(t.sets.reply.noteRigPlotHides, name).toContain(`${t.sets.rig.light} → ${t.sets.rig.asBuilt}`);
      expect(t.sets.reply.noteRigPlotHides, name).toContain("{light}");
      expect(t.sets.reply.noteOwnPhotos, name).toContain("{thing}");
    }
  });
});

describe("'Use my words as what happens' says what the words can't do, on every press", () => {
  it("sets the note in the press itself, never by reading the words", () => {
    const own = bodyOf(view, "  function wordsAsHappens(message: string) {");
    expect(own).toContain("setWordsNote(true);");
    expect(own).not.toMatch(/\.test\(|\.match\(|includes\(|indexOf\(|RegExp/);
    expect(bodyOf(view, '  async function send(text: string, opts?: { origin?: "build"; home?: boolean }) {')).toContain("setWordsNote(false);");
  });

  it("points reader v2 at the chat and reader v1 at the stage, naming the person", () => {
    const line = between(view, "{wordsNote && (", "</p>");
    expect(line).toContain("formatMsg(v2On ? s.reply.noteWordsDontMove : s.reply.noteWordsDontMoveStage, { name: characterName })");
    for (const [name, t] of Object.entries(LANGS)) {
      expect(t.sets.reply.noteWordsDontMove, name).toContain("{name}");
      expect(t.sets.reply.noteWordsDontMoveStage, name).toContain("{name}");
      expect(t.sets.reply.noteWordsDontMoveStage, name).toContain(t.sets.pose);
      expect(t.sets.reply.noteWordsDontMoveStage, name).toContain("↺ ↻");
    }
  });
});

describe("the new lines are in all four languages", () => {
  it("as non-empty strings, translated", () => {
    for (const [name, t] of Object.entries(LANGS)) {
      expect(t.sets.brandLine.trim().length, name).toBeGreaterThan(0);
      for (const k of REPLY_KEYS) expect(t.sets.reply[k].trim().length, `${name} ${k}`).toBeGreaterThan(0);
    }
    for (const t of [es, pt, it_]) for (const k of REPLY_KEYS) expect(t.sets.reply[k], k).not.toBe(en.sets.reply[k]);
  });
});
