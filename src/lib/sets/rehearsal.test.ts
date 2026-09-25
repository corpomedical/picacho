import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REHEARSAL_FPS, REHEARSAL_MAX_EDGE, REHEARSAL_MAX_SECONDS, REHEARSAL_MIMES, clipSize, easeFlight, flightSteps, recordSize, rehearsalFits, rehearsalSeconds } from "./rehearsal";

// The rehearsal (2026-09-23, "I want Helios to work the same way"): the
// film's flight recorded off the stage as a clip, frame by frame. The plan
// is pure — which frames, how far through their beat — so the recording is
// the same on any machine, and the clip runs the film's own length.

describe("the frame plan", () => {
  it("gives every beat the seconds its clip will be, at 24 frames a second", () => {
    const steps = flightSteps(2, 5, REHEARSAL_FPS);
    expect(steps).toHaveLength(2 * 5 * 24);
    expect(steps[0]).toEqual({ beat: 0, e: 0, t: 0, opens: true, closes: false });
    expect(steps.at(-1)).toMatchObject({ beat: 1, e: 1, closes: true });
    // The clip's last frame sits one frame short of its full length.
    expect(steps.at(-1)!.t).toBeCloseTo(10 - 1 / 24, 5);
    expect(rehearsalSeconds(2, 5)).toBe(10);
  });

  it("opens and closes each beat exactly once, and runs 0 → 1 through the move", () => {
    const steps = flightSteps(3, 1, 4);
    expect(steps.filter((x) => x.opens).map((x) => x.beat)).toEqual([0, 1, 2]);
    expect(steps.filter((x) => x.closes).map((x) => x.beat)).toEqual([0, 1, 2]);
    for (const beat of [0, 1, 2]) {
      const own = steps.filter((x) => x.beat === beat);
      expect(own[0].e).toBe(0);
      expect(own.at(-1)!.e).toBe(1);
      // Never goes backwards inside a beat.
      for (let i = 1; i < own.length; i++) expect(own[i].e).toBeGreaterThanOrEqual(own[i - 1].e);
    }
  });

  it("is the previz's own easing, so a recorded frame lands where the played one does", () => {
    expect(easeFlight(0)).toBe(0);
    expect(easeFlight(0.5)).toBe(0.5);
    expect(easeFlight(1)).toBe(1);
    expect(easeFlight(0.25)).toBeCloseTo(0.125, 6);
    expect(easeFlight(-1)).toBe(0);
    expect(easeFlight(2)).toBe(1);
    // The page's own flight uses the same curve (set-view.tsx tweenPose).
    const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
    expect(view).toContain("const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;");
  });

  it("holds a film with no beats, and a single frame beat", () => {
    expect(flightSteps(0, 5)).toEqual([]);
    expect(flightSteps(1, 0, 24)).toHaveLength(1);
    expect(flightSteps(1, 0, 24)[0]).toMatchObject({ e: 1, opens: true, closes: true });
  });

  it("records the film's shape, small enough to draw and encode in time, on even edges", () => {
    // A wide film, cut down but kept wide: 2.39:1 in and 2.39:1 out.
    const wide = recordSize(1536, 643);
    expect(Math.max(wide.width, wide.height)).toBe(REHEARSAL_MAX_EDGE);
    expect(wide.width / wide.height).toBeCloseTo(1536 / 643, 2);
    // H.264 refuses an odd edge.
    expect(wide.width % 2).toBe(0);
    expect(wide.height % 2).toBe(0);
    expect(recordSize(1080, 1350).height).toBe(REHEARSAL_MAX_EDGE);
    // Already small enough: left as it is, on even edges.
    expect(recordSize(640, 361)).toEqual({ width: 640, height: 362 });
  });

  it("says the clip's weight rather than a frame count the file does not have", () => {
    expect(clipSize(900)).toBe("900 B");
    expect(clipSize(213442)).toBe("208 KB");
    expect(clipSize(3_500_000)).toBe("3.3 MB");
    const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
    expect(view).toContain("{ s: rehearsal.seconds, size: clipSize(rehearsal.bytes) }");
  });

  it("says what an engine that holds a clip's motion will take", () => {
    expect(REHEARSAL_MAX_SECONDS).toBe(15);
    expect(rehearsalFits(15)).toBe(true);
    expect(rehearsalFits(16)).toBe(false);
    expect(rehearsalFits(0)).toBe(false);
    // MP4 first: the re-shoot lane sends it as it is; anything else is converted first (recast.ts recastFormatConverts).
    expect(REHEARSAL_MIMES[0]).toContain("video/mp4");
  });
});

describe("the page's recorder", () => {
  const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
  const record = view.slice(view.indexOf("async function recordRehearsal("), view.indexOf("/** The sequencer's Stop"));
  it("draws every frame through the still's own sketch recipe, and keeps the clip's length on a slow machine", () => {
    expect(view).toContain("const drawSketch = (");
    // The still and the recorder share it: frame() draws through it too.
    expect(view).toMatch(/frame\(opts\) \{\s*const drawn = drawSketch\(opts\);/);
    expect(view).toContain("drawSketch({ from: pose, cut: true }, live.out);");
    expect(record).toContain("if (now > due + 1000 / REHEARSAL_FPS && !step.closes) {");
    expect(record).toContain("api.recordFrame(pose);");
  });
  it("gives the browser the thread back every frame, or the recorder never opens", () => {
    // The loop and the recorder share one thread: a frame that waits with a
    // message (never throttled) lets the recorder open and hand over its
    // slices. A loop that only waits when it is early records nothing on a
    // machine that is always late (2026-09-23: 142 frames, no bytes).
    expect(record).toContain("ch.port2.postMessage(0);");
    expect(record).toContain("await waitUntil(due);");
    // The dropped frame waits too — it is the one that is always late.
    expect(record).toMatch(/!step\.closes\) \{\s*await tick\(\);\s*continue;/);
  });
  it("flies the film's own moves and walks the figure, and puts the stage back", () => {
    expect(record).toContain("const pose = poseAlong(beat.move, from, beat.end, step.e);");
    expect(record).toContain("const at = alongPath(figureFrom, beat.path, to, step.e);");
    expect(record).toContain('api.holdFilmOverlay("previz", true);');
    expect(record).toContain('api.holdFilmOverlay("previz", false);');
    expect(record).toContain("api.placeMark(layoutRef.current.mark);");
  });
  it("asks for frames itself, so a throttled tab cannot thin the clip", () => {
    expect(view).toContain("const stream = out.captureStream(0);");
    expect(view).toContain("live.track.requestFrame();");
    expect(view).toContain("rec.start(250);");
    // The stage is drawn at its own size and scaled into the recorder's
    // canvas, never cropped to it.
    expect(view).toContain("ctx.drawImage(renderer.domElement, sx, sy, srcW, srcH, 0, 0, out.width, out.height);");
    expect(view).toContain("const size = recordSize(band ? fr.bandW : fr.renderW, band ? fr.bandH : fr.renderH);");
  });
  it("spends nothing: no action, no credits, no engine", () => {
    expect(record).not.toMatch(/shootInSet|takeInSet|checkFilmCredits|runGeneration|fetch\(/);
  });
});
