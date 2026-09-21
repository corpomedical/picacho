import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import itMsgs from "../i18n/messages/it";
import { localizeServerText, MAPPED_SERVER_STRINGS } from "../i18n/server-text";
import { SET_TAKE_OTHER_PERSON } from "./messages";

// The second real film (2026-09-21): it opened on a still of Eva with Anubis
// picked on the page, every end frame was drawn with Anubis, and beat 1
// morphed one into the other. A film is now of the person in its opening
// still. Read as source, like the page's other tests.

const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
const actions = readFileSync(join(__dirname, "actions.ts"), "utf8");
const data = readFileSync(join(__dirname, "data.ts"), "utf8");
const take = actions.slice(actions.indexOf("export async function takeInSet("), actions.indexOf("// Delete\n"));

describe("who a film is of", () => {
  it("each still knows its person: loaded from its generation, and when shot or taken on the page", () => {
    expect(data).toContain('characterId: typeof g.character_profile_id === "string" ? g.character_profile_id : null,');
    expect(view.match(/takeFrom: null,\n\s*characterId,\n/g)).toHaveLength(2);
    expect(view).toContain("takeFrom: null,\n            characterId: filmCharacterId,");
  });

  it("is the opening still's person, or the character picked above when that is not known", () => {
    expect(view).toContain("const filmStartPerson = filmStartShot0?.characterId ?? null;");
    expect(view).toContain("const filmPersonGone = filmStartPerson !== null && !characters.some((c) => c.id === filmStartPerson);");
    expect(view).toContain("const filmCharacterId = filmStartPerson !== null && !filmPersonGone ? filmStartPerson : characterId;");
  });

  it("is who every beat is shot with, and part of what the film was rendered with", () => {
    expect(view).toContain("characterId: filmCharacterId,\n");
    expect(view).toContain("filmContextKey({ characterId: filmCharacterId, rig, mark, setKey, pose, look: filmLook.key, elements: elementsKey || undefined })");
    const render = view.slice(view.indexOf("async function renderFilm() {"), view.indexOf("async function retryClip("));
    expect(render).not.toMatch(/\n\s*characterId,\n/);
  });

  it("is said when it is not the character picked above, and Render stops when they are gone", () => {
    expect(view).toContain("formatMsg(s.filmPersonOther, { name: filmPersonOther })");
    expect(view).toContain("data-film-person");
    expect(view).toMatch(/jumpNote=\{\s*filmPersonOther\s*\? formatMsg\(s\.filmPersonOther, \{ name: filmPersonOther \}\)/);
    expect(view).toContain(": filmPersonGone\n          ? s.filmWhyPersonGone");
    for (const m of [en, es, pt, itMsgs]) {
      expect(m.sets.filmPersonOther).toContain("{name}");
      expect(m.sets.filmWhyPersonGone).toBeTruthy();
    }
  });
});

describe("the server holds a film's beat to its start still's person", () => {
  it("before anything is counted, shot or charged", () => {
    const check = take.indexOf("if (startPerson !== null && startPerson !== input.characterId) return { error: SET_TAKE_OTHER_PERSON };");
    expect(check).toBeGreaterThan(take.indexOf("if (!startUrl) return { error: SET_TAKE_BAD_START };"));
    expect(check).toBeLessThan(take.indexOf("checkGenerationAllowance("));
    expect(check).toBeLessThan(take.indexOf('rateLimited(userId, "set-take"'));
    expect(take).toContain("if (input.film === true) {\n    const { data: startGen } = await access.supabase");
  });

  it("says so in every language", () => {
    expect(MAPPED_SERVER_STRINGS).toContain(SET_TAKE_OTHER_PERSON);
    for (const m of [en, es, pt, itMsgs]) expect(localizeServerText(SET_TAKE_OTHER_PERSON, m)).toBe(m.serverText.setTakeOtherPerson);
    expect(SET_TAKE_OTHER_PERSON).toContain("nothing was charged");
  });
});
