import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import itMsgs from "../i18n/messages/it";
import { localizeServerText, MAPPED_SERVER_STRINGS } from "../i18n/server-text";
import { SET_TAKE_ELEMENT_DROPPED, SET_TAKE_LOOK_CANT, SET_TAKE_LOOK_DROPPED, SET_TAKE_OFF_FACE, SET_TAKE_OFF_FACE_KEPT_END, SET_TAKE_OFF_FACE_REFUNDED } from "./messages";

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
    // A picked look that can never be made says so, not "try again" (2026-09-25).
    expect(shoot).toContain("return { error: LASTING_LOOK_DROPS.has(lookDropReason) ? SET_TAKE_LOOK_CANT : SET_TAKE_LOOK_DROPPED };");
  });

  it("keeps every reason it dropped, and the lasting ones let the film's own opening still render without it", () => {
    // The cut and the sheet (a Look-menu photo's own branch went with R1, 2026-09-21).
    expect(shoot.match(/lookDropped = true;\n\s*lookDropReason = (cut|sheet)\.reason;/g)).toHaveLength(2);
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
    // Said as it is (2026-09-25): refunded when the frame's row says so,
    // charged when it doesn't or can't be read, and nothing for a kept end.
    const offFace = take.indexOf("const offFace = endGen?.credits_used === 0 ? SET_TAKE_OFF_FACE_REFUNDED : SET_TAKE_OFF_FACE;");
    expect(offFace).toBeGreaterThan(-1);
    const read = take.indexOf('.select("result_url, credits_used")');
    expect(read).toBeGreaterThan(-1);
    expect(read).toBeLessThan(offFace);
    expect(take).toContain('return { error: null, still, reusedEnd: false, takeGenerationId: null, takeError: offFace, stopped: "face" };');
    expect(take).toContain('.select("match_score")');
    expect(take).toContain('return { error: null, still: { ...still, score }, reusedEnd: true, takeGenerationId: null, takeError: SET_TAKE_OFF_FACE_KEPT_END, stopped: "face" };');
    // Before the clip is asked for.
    expect(take.indexOf('stopped: "face"')).toBeGreaterThan(-1);
    expect(take.indexOf('stopped: "face"')).toBeLessThan(take.indexOf("runGeneration(fd)"));
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
      [SET_TAKE_ELEMENT_DROPPED, "setTakeElementDropped"],
      [SET_TAKE_OFF_FACE, "setTakeOffFace"],
      [SET_TAKE_OFF_FACE_REFUNDED, "setTakeOffFaceRefunded"],
      [SET_TAKE_OFF_FACE_KEPT_END, "setTakeOffFaceKeptEnd"],
      [SET_TAKE_LOOK_CANT, "setTakeLookCant"],
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
    expect(SET_TAKE_OFF_FACE_REFUNDED).toContain("refunded");
    expect(SET_TAKE_OFF_FACE_REFUNDED).not.toContain("charged");
    expect(SET_TAKE_OFF_FACE_KEPT_END).toContain("nothing was charged");
    expect(SET_TAKE_LOOK_CANT).toContain("Nothing was charged");
    expect(SET_TAKE_LOOK_CANT).not.toContain("try again");
  });
});
