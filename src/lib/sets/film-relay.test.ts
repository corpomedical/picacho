import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import itMsgs from "../i18n/messages/it";

// The first real film (2026-09-21, "the camera moved differently from what
// was selected"): beat 1's arc was laid from another still than the one the
// film opened on, and beat 3's dolly zoom lost its move to the viewfinder
// button. The page is read as source, like its other tests.

const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
const between = (from: string, to: string) => {
  const a = view.indexOf(from);
  expect(a, from).toBeGreaterThan(-1);
  return view.slice(a, view.indexOf(to, a + from.length));
};

describe("a move follows where its beat starts", () => {
  it("is laid again whenever the opening still, a beat's end, the beats or the figure change", () => {
    expect(view).toContain("const filmStartPose = shots.find((sh) => sh.generationId === film.startId)?.pose ?? null;");
    const relay = between("const filmStartPose = ", "}, [ready, film.beats, filmStartPose, mark, spec.bounds, editFilm]);");
    // Never while the film renders, and only once the stage can say where a camera has room.
    expect(relay).toContain("if (!ready || !api || filmBusyRef.current) return;");
    expect(relay).toContain("relayMoves(film.beats, filmStartPose, mark, spec.bounds, (p) => api.roomFor(p))");
    // An edit made meanwhile is never written over.
    expect(relay).toContain("editFilm((f) => (f.beats === film.beats ? { ...f, beats: [...beats] } : f));");
  });

  it("is laid by a pick the same way it is laid again", () => {
    const lay = between("function layFilmMove(", "\n  }\n");
    expect(lay).toContain("layBeatMove(move, from, layoutRef.current.mark, spec.bounds, (p) => api.roomFor(p))");
  });
});

describe("the viewfinder on a beat", () => {
  it("keeps the beat's move when the view is the end the move already laid", () => {
    const set = between("function filmSetBeatEnd(i: number) {", "\n  }\n");
    expect(set).toContain("j === i && !samePose(pose, b.end) ? { ...b, end: pose, move: null } : b");
  });
});

describe("a beat that jumps across the set with no move", () => {
  it("is worked out from where each beat starts, only for beats with no move", () => {
    const jumps = between("const filmJumps = film.beats.map((b, i) => {", "});");
    expect(jumps).toContain("const from = i === 0 ? filmStartPose : film.beats[i - 1].end;");
    expect(jumps).toContain("return b.move === null && from !== null && beatJumps(from, b.end, mark);");
  });

  it("is said beside the beat, in the beat's card, and in the Film tab before any beat is picked", () => {
    expect(view.match(/formatMsg\(s\.filmBeatJumps, \{ n: (i|filmSel) \+ 1 \}\)/g)).toHaveLength(3);
    expect(view.match(/data-film-jump/g)).toHaveLength(3);
  });

  it("has its words in every language, naming the beat", () => {
    for (const m of [en, es, pt, itMsgs]) expect(m.sets.filmBeatJumps).toContain("{n}");
    expect(en.sets.filmBeatJumps).toContain("cross-fade");
  });
});

describe("the timeline strip", () => {
  const seq = readFileSync(join(__dirname, "../../components/sets/sequencer.tsx"), "utf8");

  it("marks a jumping beat's take and says why under the lanes, after an error or why Render cannot start", () => {
    expect(view).toContain("jumps={filmJumps}");
    expect(view).toContain("jumpNote={filmLookNone ? s.filmLookNone : filmJumps.indexOf(true) >= 0 ? formatMsg(s.filmBeatJumps, { n: filmJumps.indexOf(true) + 1 }) : null}");
    expect(seq).toContain('data-jump={p.jumps?.[sp.index] ? "" : undefined}');
    const line = seq.slice(seq.indexOf("{(p.note || p.error || p.hint || p.jumpNote) && ("));
    expect(line.indexOf("p.error ?")).toBeLessThan(line.indexOf("p.note ?"));
    expect(line.indexOf("p.note ?")).toBeLessThan(line.indexOf("p.jumpNote ?"));
  });

  it("never stops Render: a jump is a warning", () => {
    const render = view.slice(view.indexOf("renderDisabled={"), view.indexOf("renderDisabled={") + 200);
    expect(render).not.toContain("filmJumps");
  });
});
