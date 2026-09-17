import { describe, expect, it } from "vitest";
import { fovForLens } from "./build-scene";
import { normaliseSetFilm, type FilmBeat, type SetFilm } from "./film";
import { SEQUENCER_TRACKS, beatAtTime, beatSpans, filmClock, filmDuration, keyframeAt, rulerSeconds, sunHours, takeState, timeOf } from "./sequencer";

// The sequencer (board J1, cut B): beats along the seconds, the clock, the
// playhead's beat, the takes' states and the sun's hours.

const beat = (over: Partial<FilmBeat> = {}): FilmBeat => ({
  words: "",
  end: { position: [4, 1.3, 6], target: [0, 1, 0], fovDeg: fovForLens(35) },
  move: null,
  textures: [],
  figure: null,
  time: null,
  ...over,
});
const film = (engine: SetFilm["engine"], beats: FilmBeat[]): SetFilm => normaliseSetFilm({ engine, startId: null, beats, clips: [], ends: [], context: null });

describe("beats along the seconds", () => {
  it("lays each beat at its engine's length, one after the other", () => {
    expect(beatSpans(film("omni", [beat(), beat()]))).toEqual([
      { index: 0, start: 0, end: 5 },
      { index: 1, start: 5, end: 10 },
    ]);
    expect(beatSpans(film("veo", [beat()]))).toEqual([{ index: 0, start: 0, end: 8 }]);
    expect(filmDuration(film("veo", [beat(), beat(), beat()]))).toBe(24);
    expect(filmDuration(film("omni", []))).toBe(0);
  });

  it("finds the beat under a time, clamped to the film's ends", () => {
    const spans = beatSpans(film("omni", [beat(), beat()]));
    expect(beatAtTime(spans, -1)).toEqual({ index: 0, u: 0 });
    expect(beatAtTime(spans, 2.5)).toEqual({ index: 0, u: 0.5 });
    expect(beatAtTime(spans, 5)).toEqual({ index: 1, u: 0 });
    expect(beatAtTime(spans, 12)).toEqual({ index: 1, u: 1 });
    expect(beatAtTime([], 3)).toBeNull();
    expect(timeOf(spans, 1, 0.5)).toBe(7.5);
    expect(timeOf(spans, 1, 2)).toBe(10);
    expect(timeOf(spans, 9, 0.5)).toBe(0);
  });

  it("has the five drawn tracks and a ruler a second apart", () => {
    expect(SEQUENCER_TRACKS).toEqual(["camera", "figure", "sun", "light", "takes"]);
    expect(rulerSeconds(10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(rulerSeconds(0)).toEqual([0, 1]);
    expect(rulerSeconds(7.2)).toHaveLength(9);
  });
});

describe("the transport's words", () => {
  it("shows the clock as minutes, seconds and hundredths", () => {
    expect(filmClock(0)).toBe("00:00.00");
    expect(filmClock(3.12)).toBe("00:03.12");
    expect(filmClock(65.5)).toBe("01:05.50");
    expect(filmClock(-2)).toBe("00:00.00");
  });

  it("reads a keyframe's lens and height off its pose", () => {
    expect(keyframeAt({ position: [4, 1.3, 6], target: [0, 1, 0], fovDeg: fovForLens(35) })).toEqual({ lensMm: 35, heightM: 1.3 });
    expect(keyframeAt({ position: [0, 2.64, 0], target: [0, 1, 0], fovDeg: fovForLens(85) })).toEqual({ lensMm: 85, heightM: 2.6 });
  });
});

describe("the tracks", () => {
  it("says what state each take is in", () => {
    expect(takeState(null, false)).toBe("not-shot");
    expect(takeState(undefined, true)).toBe("rendering");
    expect(takeState("generating", false)).toBe("rendering");
    expect(takeState("succeeded", false)).toBe("done");
    expect(takeState("failed", false)).toBe("failed");
    expect(takeState("succeeded", true)).toBe("rendering");
  });

  it("chains the sun's hours: each beat's hour comes from the beat before, or the rig", () => {
    const f = film("omni", [beat({ time: 16.75 }), beat(), beat({ time: 17.25 })]);
    expect(sunHours(f, null)).toEqual([
      { index: 0, from: null, to: 16.75 },
      { index: 2, from: 16.75, to: 17.25 },
    ]);
    expect(sunHours(f, 12)[0]).toEqual({ index: 0, from: 12, to: 16.75 });
    expect(sunHours(film("omni", [beat()]), 12)).toEqual([]);
  });
});
