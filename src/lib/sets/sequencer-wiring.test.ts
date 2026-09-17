import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The sequencer on the set page (cut B), read as source: the timeline
// takes the film dock's place under the viewport on the frame, the phone
// keeps its dock, the previz and the reel drive the playhead, Stop retires
// a previz run, and the dock's Film tab edits the beat in hand.

const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
const panel = readFileSync(join(__dirname, "../../components/sets/sequencer.tsx"), "utf8");

describe("the sequencer on the set page", () => {
  it("stands under the viewport on the frame while the film is open, and the phone keeps its dock", () => {
    expect(view).toContain("{wide && filmOpen && (\n          <Sequencer");
    expect(view).toContain("{!wide && filmOpen && (");
    // Under the viewport, not floating over it: after the stage's box, before the phone's panels.
    const stageEnd = view.indexOf("{/* The sequencer (canvas page J, board J1; cut B)");
    expect(stageEnd).toBeGreaterThan(view.indexOf("{/* The film dock (canvas page H)"));
    expect(stageEnd).toBeLessThan(view.indexOf("On a phone the rig is its own panel"));
  });

  it("drives the playhead from the previz and the reel, and Stop retires the run", () => {
    const play = view.slice(view.indexOf("async function playMove()"), view.indexOf("function stopPlayback()"));
    expect(play).toContain("const run = ++previzRunRef.current;");
    expect(play).toContain("const alive = () => previzRunRef.current === run;");
    expect(play).toContain("if (!alive()) break;");
    expect(play).toContain("setPlayhead(timeOf(spans, bi, e));");
    expect(play).toContain("if (alive()) setPreviz(false);");
    const stop = view.slice(view.indexOf("function stopPlayback()"), view.indexOf("function filmSeek("));
    expect(stop).toContain("previzRunRef.current += 1;");
    expect(stop).toContain("setReel(null);");
    expect(view).toContain("onTimeUpdate={(e) => {");
    expect(view).toContain("setPlayhead(timeOf(beatSpans(film), i, v.currentTime / v.duration));");
  });

  it("scrubs the previz along the beat's own move, from the frame the beat opens on", () => {
    const seek = view.slice(view.indexOf("function filmSeek("), view.indexOf("function filmToStart()"));
    expect(seek).toContain("beatAtTime(spans, t)");
    expect(seek).toContain("const from = at.index > 0 ? film.beats[at.index - 1].end : (startPose ?? beat.end);");
    expect(seek).toContain("poseAlong(beat.move, from, beat.end, at.u)");
    expect(seek).toContain("setFilmSel(at.index);");
  });

  it("keeps every control the dock had: the start, the engine, play, download, render, keyframe, and the beat's words, end, figure and hour", () => {
    for (const prop of ["onStartMenu", "onEngine", "onPlayFilm", "onDownload", "onRender", "onAddKeyframe", "onSeek", "onPlayTake", "onShotList"]) expect(panel).toContain(`p.${prop}`);
    const filmTab = view.slice(view.indexOf('{dockTab === "film" && ('), view.indexOf('{(dockTab === "camera" || dockTab === "light"'));
    for (const piece of ["filmSetBeatEnd(filmSel)", "s.filmRemoveBeat", "placeholder={s.filmBeatWords}", "s.filmFigureHere", "s.filmHourSet"]) expect(filmTab).toContain(piece);
    expect(view).toContain('onShotList={() => setDockTab("film")}');
  });

  it("draws the five tracks, a ruler, keyframes and a playhead, and lets a done take play", () => {
    for (const marker of ["data-lanes", "data-playhead", "data-keyframe={sp.index}", "data-take={state}", 'data-transport="play"']) expect(panel).toContain(marker);
    expect(panel).toContain("SEQUENCER_TRACKS.map((t) =>");
    expect(panel).toContain('if (state === "done") p.onPlayTake(sp.index);');
  });
});
