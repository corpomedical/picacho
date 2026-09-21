import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import itMsgs from "../i18n/messages/it";
import { localizeServerText, MAPPED_SERVER_STRINGS } from "../i18n/server-text";
import { SET_TAKE_LOOK_DROPPED, SET_TAKE_OFF_FACE, SET_TAKE_PHOTO_DROPPED } from "./messages";

// The first real film (2026-09-21) paid for every clip between two frames
// that did not match. A film's beat now stops before it pays for such a
// clip. Read as source, like the page's other tests.

const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
const actions = readFileSync(join(__dirname, "actions.ts"), "utf8");
const shoot = actions.slice(actions.indexOf("export async function shootInSet("), actions.indexOf("export async function takeInSet("));
const take = actions.slice(actions.indexOf("export async function takeInSet("), actions.indexOf("// Delete\n"));

describe("a beat whose look could not be made", () => {
  it("stops before anything is uploaded, shot or charged", () => {
    const stop = shoot.indexOf("if (lookDropped && (input.lookRequired === \"picked\" || (input.lookRequired === \"default\" && !LASTING_LOOK_DROPS.has(lookDropReason)))) {");
    expect(stop).toBeGreaterThan(shoot.indexOf("const framePath = setFramePath(userId, crypto.randomUUID());"));
    expect(stop).toBeLessThan(shoot.indexOf(".upload(framePath"));
    expect(stop).toBeLessThan(shoot.indexOf("runGeneration("));
    expect(shoot).toContain("return { error: refAsked ? SET_TAKE_PHOTO_DROPPED : SET_TAKE_LOOK_DROPPED };");
  });

  it("keeps every reason it dropped, and the lasting ones let the film's own opening still render without it", () => {
    expect(shoot.match(/lookDropped = true;\n\s*lookDropReason = (cut|sheet)\.reason;/g)).toHaveLength(3);
    for (const reason of ["nothing to cut", "no camera", "person in cutout", "sheet refused"]) expect(actions).toContain(`"${reason}"`);
    expect(actions).toMatch(/const LASTING_LOOK_DROPS = new Set\(\[[^\]]*"nothing to cut"[^\]]*\]\);/);
  });

  it("is required only for a film's named look: picked stops on anything, the default on what may pass next time", () => {
    expect(take).toContain('lookRequired: input.lookPicked === true ? ("picked" as const) : ("default" as const),');
    expect(view).toContain("lookPicked: filmLook.key !== undefined,");
  });
});

describe("a film's end frame under the identity bar", () => {
  it("makes no clip, in a new frame and in one kept from an earlier render", () => {
    expect(take).toContain("if (input.film === true && still.score !== null) {");
    expect(take).toContain("const bar = await readIdentityThreshold(access.supabase);");
    expect(take).toContain('return { error: null, still, reusedEnd: false, takeGenerationId: null, takeError: SET_TAKE_OFF_FACE, stopped: "face" };');
    expect(take).toContain('.select("match_score")');
    expect(take).toContain('return { error: null, still: { ...still, score }, reusedEnd: true, takeGenerationId: null, takeError: SET_TAKE_OFF_FACE, stopped: "face" };');
    // Before the clip is asked for.
    expect(take.indexOf("SET_TAKE_OFF_FACE, stopped")).toBeLessThan(take.indexOf("runGeneration(fd)"));
  });

  it("is never kept as the beat's end, so the next render shoots it whole", () => {
    expect(view).toContain("if (result.stopped) ends[i] = null;");
    expect(view).toContain("ends: [...upTo(kept.ends, i), result.still.succeeded && !result.stopped ? result.still.generationId : null],");
  });
});

describe("the words", () => {
  it("are server sentences the page translates, in every language", () => {
    for (const [msg, key] of [
      [SET_TAKE_LOOK_DROPPED, "setTakeLookDropped"],
      [SET_TAKE_PHOTO_DROPPED, "setTakePhotoDropped"],
      [SET_TAKE_OFF_FACE, "setTakeOffFace"],
    ] as const) {
      expect(MAPPED_SERVER_STRINGS).toContain(msg);
      for (const m of [en, es, pt, itMsgs]) {
        expect(m.serverText[key], key).toBeTruthy();
        expect(localizeServerText(msg, m), key).toBe(m.serverText[key]);
      }
      expect(en.serverText[key]).toBe(msg);
    }
    expect(SET_TAKE_LOOK_DROPPED).toContain("Nothing was charged");
    expect(SET_TAKE_OFF_FACE).toContain("only the frame was charged");
  });
});
