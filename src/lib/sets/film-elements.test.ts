import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import itMsgs from "../i18n/messages/it";
import { DEFAULT_SET_RIG } from "./rig";
import { filmContextKey } from "./film";

// A film carries the things' photos in every painted frame (R1, 2026-09-21):
// the film's key knows the photos, every beat plans its sheets in one
// film-wide order, the sheets are drawn after the credits and before any of
// the film is touched, and an opening still older than the photos stops the
// render. The page is read as source; the key is the real one.

const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
const between = (from: string, to: string) => {
  const a = view.indexOf(from);
  expect(a, from).toBeGreaterThan(-1);
  const b = view.indexOf(to, a + from.length);
  expect(b, to).toBeGreaterThan(a);
  return view.slice(a, b);
};

describe("the film's key", () => {
  const base = { characterId: "c1", rig: DEFAULT_SET_RIG, mark: { x: 1, z: 2, facingDeg: 0 }, setKey: "s" };
  it("is unchanged for a film with no photos on its things", () => {
    expect(filmContextKey({ ...base, elements: undefined })).toBe(filmContextKey(base));
    expect(filmContextKey({ ...base, elements: "" })).toBe(filmContextKey(base));
  });
  it("changes when a thing's photos change, so the film renders again", () => {
    const a = filmContextKey({ ...base, elements: "c_1=aaa" });
    expect(a).not.toBe(filmContextKey(base));
    expect(filmContextKey({ ...base, elements: "c_1=bbb" })).not.toBe(a);
    expect(filmContextKey({ ...base, elements: "c_1=aaa" })).toBe(a);
  });
  it("is fed the photos as each thing's key and sheet, sorted", () => {
    expect(view).toContain("look: filmLook.key, elements: elementsKey || undefined });");
    const key = between("const elementsKey = useMemo(", "[resolved],");
    expect(key).toContain(".map((h) => `${h.key}=${h.sheetHash}`)");
    expect(key).toContain(".sort()");
  });
});

describe("a render", () => {
  const render = between("async function renderFilm() {", "async function retryClip(");
  it("draws the sheets after the credits and before any of the film is touched, and a missing one stops it free", () => {
    const credits = render.indexOf("checkFilmCredits(");
    const draw = render.indexOf("const unsheeted = await drawSheetsFor(sheetsNeeded, setFilmError);");
    expect(credits).toBeGreaterThan(-1);
    expect(draw).toBeGreaterThan(credits);
    expect(draw).toBeLessThan(render.indexOf("keep(kept);"));
    expect(render).toContain("setFilmError(fill(cast.filmSheetBlocked, { name: elementName(unsheeted[0]) }));");
    // Only the beats whose end frames are shot need sheets.
    expect(render).toContain("plan.jobs.filter((j) => j.end === null).flatMap((j) => filmBeatRides[j.beat] ?? [])");
  });
  it("tells every beat the film's one order", () => {
    expect(render).toContain("elementOrder: filmOrder,");
    const order = between("const filmOrder = useMemo(", "const filmBeatRides = useMemo(");
    expect(order).toContain("most.set(p.key, Math.max(most.get(p.key) ?? 0, p.share))");
    // The person's order first (the strip), then the most of the frame, then the key.
    expect(order).toContain(".sort((a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1] || a[0].localeCompare(b[0]))");
    expect(view).toContain("planFor(b.end, filmStagesNow[i]?.figure ?? mark, filmOrder, filmBeatSpecs[i]).riding");
  });
});

describe("an opening still older than the photos", () => {
  it("stops the render and names the thing; a single take only says so", () => {
    const rule = between("function newerPhotosIn(", "const filmOpeningOldKey");
    expect(rule).toContain("if (place.seen && heldOf.get(place.key)?.photos.some((ph) => ph.at > shotAt)) return place.key;");
    expect(view).toContain("? fill(cast.filmOpeningOld, { name: elementName(filmOpeningOldKey) })");
    expect(view).toContain("data-take-start-old");
  });
});

describe("the words", () => {
  it("exist in every language with their placeholders", () => {
    for (const m of [en, es, pt, itMsgs]) {
      for (const key of ["filmNote", "filmBeat", "filmOpeningOld", "filmSheetBlocked", "takeStartOld"] as const) {
        expect(m.sets.cast[key], key).toBeTruthy();
        for (const ph of en.sets.cast[key].match(/\{\w+\}/g) ?? []) expect(m.sets.cast[key], `${key} ${ph}`).toContain(ph);
      }
    }
  });
});
