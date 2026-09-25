import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import itMsgs from "../i18n/messages/it";
import { SET_TAKE_END_FAILED, SET_TAKE_FAILED } from "./messages";

// "The film does not generate videos, the buttons do not work, test all
// buttons" (2026-09-21). Every button on the set page was pressed in the
// ui-check harness, in Film, Shoot, Cut and Build; what did not answer is
// pinned here, read as source like the page's other tests.

const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
const seq = readFileSync(join(__dirname, "../../components/sets/sequencer.tsx"), "utf8");
const actions = readFileSync(join(__dirname, "actions.ts"), "utf8");
const between = (from: string, to: string) => view.slice(view.indexOf(from), view.indexOf(to, view.indexOf(from)));

describe("Render renders, or says why it cannot", () => {
  it("never stops before its first beat while the page is on screen", () => {
    // The flag the loop reads is set on every mount (see film-leave.test.ts).
    const render = between("async function renderFilm(", "async function retryClip(");
    expect(render).toContain("if (!aliveRef.current) break;");
    expect(view).toMatch(/aliveRef\.current = true;\s*return \(\) => \{\s*aliveRef\.current = false;/);
  });

  it("has one reason for every way it cannot start, in the order a person would fix them", () => {
    const why = view.slice(view.indexOf("const filmRenderWhy: string | null ="), view.indexOf(": null;", view.indexOf("const filmRenderWhy")));
    // The film's own person (2026-09-21): the opening still's, and gone when they are no longer a character.
    const order = ["!takesOn", "!ready", "!filmCharacterId", "filmPersonGone", "!film.startId", "film.beats.length === 0", "filmPlan.again && filmPlan.rendering", "shooting || matching"];
    let at = -1;
    for (const cond of order) {
      const i = why.indexOf(cond);
      expect(i, cond).toBeGreaterThan(at);
      at = i;
    }
    for (const word of ["s.filmWhyLoading", "s.filmWhyWho", "s.filmWhyPersonGone", "s.filmWhyStart", "s.filmPickStill", "s.filmWhyBeats", "s.filmClipsRendering", "s.filmWhyShooting"]) {
      expect(why, word).toContain(word);
    }
  });

  it("stays pressable on every face — the sequencer, the phone's film panel and the Cut strip — shut only while rendering", () => {
    expect(view).toContain("renderDisabled={Boolean(filmBusy)}\n            renderWhy={filmRenderWhy}");
    expect(view).toContain("note={filmRenderWhy}");
    expect(view.split("onClick={() => void renderFilm()}\n                  disabled={Boolean(filmBusy)}\n                  title={filmRenderWhy ?? undefined}").length - 1).toBe(2);
    expect(seq).toContain("title={p.renderWhy ?? undefined}");
    // The old silent rule is gone from all three.
    expect(view).not.toContain("(filmPlan.again && filmPlan.rendering)\n");
  });

  it("starts on the newest finished still when the film has none, the moment Film or Cut opens", () => {
    expect(view).toContain('const newestFinishedStill = shots.find((sh) => sh.kind === "still" && sh.status === "succeeded")?.generationId ?? null;');
    expect(view).toContain("if (!(filmOpen || cutOpen) || film.startId || !newestFinishedStill) return;");
    expect(view).toContain("editFilm((f) => (f.startId ? f : { ...f, startId: newestFinishedStill }));");
  });

  it("says an error on two lines when it must, announced, never cut to one", () => {
    expect(seq).toContain('<span className="line-clamp-2 min-w-0 text-red-400" title={p.error} role="alert">{p.error}</span>');
    expect(seq).toContain("flex min-h-6 flex-none items-center");
  });
});

describe("a move picked mid-flight takes over", () => {
  const pick = between("function filmMove(move: FilmMove) {", "\n  }\n");

  it("is never ignored for the last flight: it stops it, and lays from where that flight began", () => {
    expect(pick).not.toContain("|| previz ||");
    expect(pick).toContain("const flyingFrom = pickFlightRef.current?.run === previzRunRef.current ? pickFlightRef.current.from : null;");
    expect(pick.indexOf("const flyingFrom")).toBeLessThan(pick.indexOf("if (previz) stopPlayback();"));
    expect(pick).toContain("layFilmMove(api, move, flyingFrom ?? api.pose())");
  });

  it("owns the stage only while it is the latest flight", () => {
    expect(pick).toContain("const run = ++previzRunRef.current;");
    expect(pick).toContain("pickFlightRef.current = { run, from };");
    expect(pick).toContain("void tweenPose(api, from, end, MOVE_FLIGHT_MS, move, alive).then(() => {");
    expect(pick).toContain("if (!alive()) return;");
  });
});

describe("a still that does not pass says why, wherever it was shot", () => {
  it("carries the render's own reason back from the server — a brand rule's words and fix first", () => {
    const helper = actions.slice(actions.indexOf("function stillFailure("), actions.indexOf("/**\n * One still in a Set"));
    expect(helper.indexOf("result.rulesBlock")).toBeLessThan(helper.indexOf("summarizeFailureDetail(result.attempts)"));
    expect(helper).toContain('(triggered by: "${r.evidence}"');
    expect(actions).toContain("failure: result.succeeded ? null : stillFailure(result),");
  });

  it("stops a take whose end frame failed with the truth, not with 'the end frame is in'", () => {
    expect(actions).toContain("if (!still.succeeded) return { error: null, still, reusedEnd: false, takeGenerationId: null, takeError: SET_TAKE_END_FAILED };");
    expect(SET_TAKE_END_FAILED).not.toMatch(/is in/);
    expect(SET_TAKE_FAILED).toMatch(/end frame is in/);
    // And says the clip wasn't charged, asking for the clip, not the take,
    // which would shoot and charge a new end frame (2026-09-25).
    expect(SET_TAKE_FAILED).not.toMatch(/try the take again/);
    expect(SET_TAKE_FAILED).toContain("wasn't charged");
  });

  it("says it on the page: the still, the take and the film's beat", () => {
    expect(view).toContain('if (result.failure) setError(`${s.stillFailedWhy} ${result.failure}`);');
    expect(view).toContain('if (!result.still.succeeded) setError(`${s.takeEndFailed}${result.still.failure ? ` ${result.still.failure}` : ""}`);');
    expect(view).toContain('setFilmError(`${formatMsg(s.filmEndFailed, { n: i + 1 })}${result.still.failure ? ` ${result.still.failure}` : ""}`);');
  });
});

describe("the words", () => {
  it("exist in every language, and the Hour button's tooltip is a sentence, never a placeholder", () => {
    for (const m of [en, es, pt, itMsgs]) {
      const s = m.sets;
      for (const key of ["filmWhyLoading", "filmWhyWho", "filmWhyStart", "filmWhyBeats", "filmWhyShooting", "filmEndFailed", "takeEndFailed", "stillFailedWhy"] as const) {
        expect(s[key], key).toBeTruthy();
      }
      expect(s.filmEndFailed).toContain("{n}");
      expect(s.filmHourHere).not.toContain("{");
      expect(m.serverText.setTakeEndFailed).toBeTruthy();
    }
  });
});
