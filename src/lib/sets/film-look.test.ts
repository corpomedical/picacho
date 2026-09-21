import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import itMsgs from "../i18n/messages/it";

// The first real film (2026-09-21): each beat borrowed its look from the end
// still before it, so the car was drawn afresh every beat and drifted. A film
// now carries ONE look through every beat. Read as source, like the page's
// other tests.

const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
const actions = readFileSync(join(__dirname, "actions.ts"), "utf8");

describe("the film's one look", () => {
  it("is a still picked, else the opening still — a thing's own photos ride as its sheet instead (R1)", () => {
    const look = view.slice(view.indexOf("const filmLook: {"), view.indexOf("const filmStartShot0 ="));
    expect(look).not.toContain("ref");
    expect(look).toContain("lookPinned && lookShot && lookShot.generationId !== film.startId");
    expect(look).toContain(": { still: film.startId, key: undefined };");
    // The pin as state, set wherever the ref is, so nothing reads a ref while drawing.
    expect(view.match(/lookPinnedRef\.current = true;\n\s*setLookPinned\(true\);/g)).toHaveLength(1);
  });

  it("rides every beat of a render, and changing it renders the film again", () => {
    expect(view).toContain("lookGenerationId: filmLook.still,\n            lookPicked: filmLook.key !== undefined,");
    expect(view).toContain("filmContextKey({ characterId: filmCharacterId, rig, mark, setKey, pose, look: filmLook.key, elements: elementsKey || undefined })");
    // Never the beat before's end still.
    const render = view.slice(view.indexOf("async function renderFilm() {"), view.indexOf("async function retryClip("));
    expect(render).not.toMatch(/lookGenerationId: (startId|kept\.ends)/);
  });

  it("is what the take's end still carries; a single take keeps its start still as its look", () => {
    const take = actions.slice(actions.indexOf("export async function takeInSet("), actions.indexOf("// Delete\n"));
    expect(take).toContain("...(input.lookGenerationId !== undefined");
    expect(take).not.toContain("lookRefId");
    expect(take).toContain(": { lookGenerationId: startId }),");
  });

  it("says so when the opening still has nothing to lend, in every language", () => {
    expect(view).toContain("const filmLookNone = filmLook.key === undefined && filmStartShot0 !== null && !canBeLook(filmStartShot0);");
    expect(view).toContain("data-film-look-none");
    for (const m of [en, es, pt, itMsgs]) expect(m.sets.filmLookNone).toBeTruthy();
    expect(es.sets.filmLookNone).toContain("Aspecto");
    expect(pt.sets.filmLookNone).toContain("Visual");
    expect(itMsgs.sets.filmLookNone).toContain("Aspetto");
  });
});
