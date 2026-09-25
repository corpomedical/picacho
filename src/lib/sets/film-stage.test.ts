import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// What a credit buys is what the previz showed (found reviewing Helios,
// 2026-09-17). The render drew a beat's hour only when it differed from the
// RIG's, so a beat whose hour matched the rig kept whatever the beat before
// it had drawn — a noon → 18:00 film shot its second beat at noon, and a
// partial render differed from a whole one. And every end frame was
// described with the arrangement's figure, pose and eye-line while the
// sketch showed the beat's. film.ts filmStages is the one rule; the page
// draws from it, and the server is told the frame is a beat's, so the
// beat's figure is not saved as the set's arrangement.
//
// Read as source: the page needs a browser, and the actions are "use server".

const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
const actions = readFileSync(join(__dirname, "actions.ts"), "utf8");
const bodyOf = (source: string, signature: string, end: string) => {
  const at = source.indexOf(signature);
  expect(at, signature).toBeGreaterThan(-1);
  return source.slice(at, source.indexOf(end, at));
};

describe("a film beat's stage", () => {
  it("the render draws each beat from the film's own rule, against what the stage is drawing", () => {
    const render = bodyOf(view, "  async function renderFilm(", "\n  }\n");
    expect(render).toContain("const stages = filmStages(film.beats, { mark: layoutRef.current.mark, pose: layoutRef.current.pose, time: rigRef.current.time });");
    expect(render).toContain("const staged = stages[i];");
    // Redrawn when the hour or the figure differ from what is drawn — the
    // plot and the sun both stand round the figure.
    // And what this beat has moved (movers.ts): a beat that drives a thing is always redrawn.
    expect(render).toContain("if (staged.time !== drawn.time || figure.x !== drawn.figure.x || figure.z !== drawn.figure.z || movedHere !== drawn.movers) {");
    expect(render).toContain("drawn = { time: staged.time, figure, movers: movedHere };");
    expect(render).not.toContain("beat.time !== rigRef.current.time");
  });

  it("the frame's words are the frame's: the beat's figure, pose and eye-line", () => {
    const render = bodyOf(view, "  async function renderFilm(", "\n  }\n");
    expect(render).toContain("layout: { ...layoutRef.current, camera: beat.end, mark: staged.figure, pose: staged.pose, gaze: staged.gaze },");
    expect(render).not.toContain("layout: { ...layoutRef.current, camera: beat.end },");
  });

  it("the previz and a jump to a beat read the same rule", () => {
    const play = bodyOf(view, "  async function playMove(", "\n  }\n");
    expect(play).toContain("const stages = filmStages(film.beats,");
    expect(play).toContain("if (staged.time !== hourNow) {");
    const goTo = bodyOf(view, "  function filmGoTo(", "\n  }\n");
    expect(goTo).toContain("filmStages(film.beats, { mark: layoutRef.current.mark, pose: layoutRef.current.pose, time: rigRef.current.time })[i]");
    expect(goTo).toContain("api.setPose(staged.pose);");
    // And the path is walked from where the film leaves the figure.
    expect(view).toContain("? filmStages(film.beats, { mark, pose, time: rig.time })[filmSel - 1].figure");
  });

  it("a beat's frame is not saved as the set's arrangement", () => {
    expect(actions).toContain("if (layout && input.beat !== true) {");
    // To the delete: takeInSet is a wrapper round takeWork since 2026-09-25 (Cut 1).
    const take = bodyOf(actions, "export async function takeInSet(", "// Delete\n");
    expect(take).toContain("beat: input.film === true,");
  });
});
