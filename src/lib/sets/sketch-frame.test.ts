import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The frame the image model reads is the flat sketch, not the full stage
// (2026-09-17): the set page swaps the live stage to the sketch around the
// one render it takes, at the sketch's own lift, and swaps it back before
// the browser shows a frame. That drawing is drawSketch, which api.frame()
// takes a still from and the rehearsal records every frame through
// (rehearsal.ts, 2026-09-23) — one recipe, so a recorded frame and a shot
// one are the same set, lens and lift. Read from the source, as the take
// tests read actions.ts: the page needs a browser to run.
describe("the frame the image model reads (set-view.tsx frame)", () => {
  const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
  const frame = view.slice(view.indexOf("        const drawSketch = ("), view.indexOf("        let recording:"));

  it("renders the sketch, at the sketch's lift and the rig's exposure, and puts the stage back", () => {
    expect(frame.length).toBeGreaterThan(0);
    const on = frame.indexOf("sketchStage(scene, built.root, true);");
    const render = frame.indexOf("renderer.render(scene, cam);");
    const off = frame.indexOf("sketchStage(scene, built.root, false);");
    expect(on).toBeGreaterThan(-1);
    expect(render).toBeGreaterThan(on);
    expect(off).toBeGreaterThan(render);
    expect(frame).toContain("renderer.toneMappingExposure = sketchLift.exposure * exposureGainNow;");
    expect(frame).toContain("renderer.toneMappingExposure = lift.exposure * exposureGainNow;");
    // The sketch's neutral lift light on for the render, the stage's off, and back.
    expect(frame).toContain("if (sketchFill) sketchFill.intensity = sketchFillOn;");
    expect(frame).toContain("if (stageFill) stageFill.intensity = stageFillOn;");
    // Only a full build's stage light is turned off: a basic build has one
    // lift light, which IS the sketch's, so turning it off would send a
    // dark sketch (a phone, or any coarse pointer).
    expect(frame).toContain("if (full && stageFill) stageFill.intensity = 0;");
    expect(frame).not.toMatch(/(?<!full && )if \(stageFill\) stageFill\.intensity = 0;/);
    // The stage comes back even when the render throws.
    expect(frame.slice(render, off)).toContain("finally");
  });

  it("paints the band's strips dark on the frame the model reads, and not on the band picture", () => {
    // The strips land where they land in the canvas being drawn into: a
    // still's is the render's own size (k is 1), the recorder's is smaller.
    expect(frame).toContain("for (const r of letterbox(fr)) ctx.fillRect((r.x - sx) * k, (r.y - sy) * k, r.w * k, r.h * k);");
    expect(frame.slice(frame.indexOf("if (!band) {"), frame.indexOf("for (const r of letterbox(fr))"))).toContain('ctx.fillStyle = "#0a0a0a";');
    // And the shot's words say what they are (actions.ts → set-shot-prompt.ts).
    const actions = readFileSync(join(__dirname, "actions.ts"), "utf8");
    expect(actions).toContain("band: bandSide(rigFrame),");
  });

  it("measures the sketch's lift on the sketch, before the stage's own", () => {
    const start = view.indexOf("let sketchLift = NO_LIFT;");
    const lifts = view.slice(start, view.indexOf("raf = requestAnimationFrame(loop);", start));
    expect(lifts.length).toBeGreaterThan(0);
    const sketchOn = lifts.indexOf("sketchStage(scene, built.root, true);");
    // Measured for whichever set is drawn (2026-09-18: measureLift runs again
    // on every rebuild — an hour, a light plot, an Astra change — so the
    // sketch the prompt describes is the sketch that was measured).
    const sketchLift = lifts.indexOf("sketchLift = liftSet(THREE, renderer, scene, forSpec, farPlane);");
    const sketchOff = lifts.indexOf("sketchStage(scene, built.root, false);");
    const stageLift = lifts.indexOf("lift = liftSet(THREE, renderer, scene, forSpec, farPlane);", sketchLift + 1);
    expect(sketchOn).toBeGreaterThan(-1);
    expect(sketchLift).toBeGreaterThan(sketchOn);
    expect(sketchOff).toBeGreaterThan(sketchLift);
    expect(stageLift).toBeGreaterThan(sketchOff);
    // The sketch's light is renamed and turned off before the stage is measured.
    expect(lifts).toContain('sketchFill.name = "lift-fill-sketch";');
    expect(lifts.indexOf("sketchFill.intensity = 0;")).toBeLessThan(stageLift);
    // A basic build has one lift, shared.
    expect(lifts).toContain("if (!full) sketchLift = lift;");
    // And it is measured again whenever the stage is rebuilt, with the lights
    // the last measurement left freed first.
    expect(view).toContain("measureLift(spec, built.farPlane);");
    expect(view).toContain("measureLift(next, fresh.farPlane);");
    expect(lifts).toContain("scene.remove(old);");
  });

  it("tells the prompt about the sketch's lift, not the stage's", () => {
    expect(view).toContain("lifted: sketchLift.fill > 1 || sketchLift.exposure > BASE_EXPOSURE,");
    expect(view).not.toContain("lifted: lift.fill > 1 || lift.exposure > BASE_EXPOSURE,");
  });
});

describe("the squeeze, and the lift that follows the set", () => {
  const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
  const frame = view.slice(view.indexOf("        const drawSketch = ("), view.indexOf("        let recording:"));

  it("draws the negative the squeeze widened, at the band it widened", () => {
    // It used to scale the projection's x, so the model was sent the
    // negative, squashed (2026-09-18).
    expect(frame).toContain("const fr = formatFrame(rigRef.current.format, rigRef.current.squeeze);");
    expect(frame).toContain("fovDeg: widenFovDeg(pose.fovDeg, rigRef.current.squeeze)");
    expect(view).not.toContain("squeezeProjection");
  });

  it("measures the lift again whenever the set is rebuilt", () => {
    const rebuild = view.slice(view.indexOf("          rebuild(next) {"), view.indexOf("          setFilmOverlay("));
    expect(rebuild).toContain("measureLift(next, fresh.farPlane);");
    // One measurement, one place: the hour, the plot, an edit and a beat all
    // rebuild, and nothing else lifts.
    expect(view.match(/liftSet\(/g)).toHaveLength(2);
  });
});
