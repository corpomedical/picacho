import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import raceTrack from "./fixtures-race-track.json";
import { normaliseSetLayout, normaliseSetSpec, type SetSpec } from "./set-spec";
import { safeReturnTo } from "../characters/return-to";

// "Who plays this person?" (R1, 2026-09-21): the figure's cast is kept with
// the arrangement; a new character is made in the character form, which
// comes back to the set with them cast — only ever to a set's own page.

const spec = (() => {
  const n = normaliseSetSpec(raceTrack);
  if (!n.ok) throw new Error("fixture");
  return n.spec as SetSpec;
})();
const layout = { markId: spec.marks[0].id, mark: { x: 0, z: 0, facingDeg: 0 }, camera: null, pose: "stand", gaze: null };
const ID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

describe("the cast in the arrangement", () => {
  it("keeps a character's id, and nothing that isn't one", () => {
    expect(normaliseSetLayout({ ...layout, castId: ID }, spec)?.castId).toBe(ID);
    expect(normaliseSetLayout({ ...layout, castId: "../x" }, spec)).not.toHaveProperty("castId");
    expect(normaliseSetLayout(layout, spec)).not.toHaveProperty("castId");
  });
});

describe("the way back from the character form", () => {
  it("is a set's own page only", () => {
    expect(safeReturnTo(`/app/sets/${ID}`)).toBe(`/app/sets/${ID}`);
    for (const bad of ["//evil.com", "/app/sets/../admin", `https://evil.com/app/sets/${ID}`, "/app/sets/x", `/app/sets/${ID}/../..`, `/app/sets/${ID}?x=1`, undefined, 7]) {
      expect(safeReturnTo(bad), String(bad)).toBeNull();
    }
  });
});

describe("the page and the form", () => {
  const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
  const form = readFileSync(join(__dirname, "../../components/character-form.tsx"), "utf8");
  const actions = readFileSync(join(__dirname, "../characters/actions.ts"), "utf8");
  it("saves the arrangement before leaving for the form", () => {
    const go = view.slice(view.indexOf("async function castNewCharacter("), view.indexOf("function showElement("));
    expect(go.indexOf("await saveSetLayout(setId, { ...layoutRef.current, camera: api.pose() });")).toBeGreaterThan(-1);
    expect(go.indexOf("await saveSetLayout(")).toBeLessThan(go.indexOf("router.push(newCharacterHref);"));
  });
  it("seeds the cast from the address, then the saved cast, then the first; and names one that can't play", () => {
    expect(view).toContain("characters.find((c) => c.id === initialLayout?.castId)?.id ??");
    expect(view).toContain("formatMsg(t.sets.cast.notCastable, { name: asked.name })");
    expect(view).toContain("layoutRef.current = { ...layoutRef.current, castId: characterId };");
  });
  it("hands the new character's id back", () => {
    expect(actions).toContain('.insert(row).select("id").single();');
    expect(form).toContain("window.location.assign(returnTo && result.error === null ? `${returnTo}?character=${result.id}` :");
    expect(form).toContain("data-back-to-set");
  });
});
