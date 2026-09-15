import { describe, expect, it } from "vitest";
import { FILM_MAX_BEATS, filmSeconds, normaliseSetFilm } from "./film";
import { SET_TAKE_ENGINES, SET_TAKES_PER_10_MIN } from "./take";

// The film's one door: whatever is stored or sent becomes a usable film or
// an empty one — never a throw, never a beat with half a pose.

const goodPose = { position: [1, 2, 3], target: [0, 1, 0], fovDeg: 40 };

describe("normaliseSetFilm", () => {
  it("turns junk into the empty film", () => {
    for (const junk of [null, undefined, 7, "film", []]) {
      const f = normaliseSetFilm(junk);
      expect(f.beats).toEqual([]);
      expect(f.startId).toBeNull();
      expect(f.engine).toBe("omni");
    }
  });

  it("keeps a real film whole, cleaned", () => {
    const f = normaliseSetFilm({
      engine: "veo",
      startId: "AAAAAAAA-1111-2222-3333-444444444444",
      beats: [{ words: "she  walks   away", end: goodPose }],
    });
    expect(f.engine).toBe("veo");
    expect(f.startId).toBe("aaaaaaaa-1111-2222-3333-444444444444");
    expect(f.beats).toHaveLength(1);
    expect(f.beats[0].words).toBe("she walks away");
    expect(f.beats[0].end.fovDeg).toBe(40);
  });

  it("drops what does not parse: bad engines, non-uuid starts, poseless beats", () => {
    const f = normaliseSetFilm({
      engine: "kling",
      startId: "not-a-uuid",
      beats: [
        { words: "kept", end: goodPose },
        { words: "no pose", end: { position: [1, 2], target: [0, 0, 0], fovDeg: 40 } },
        { words: "bad number", end: { position: [1, 2, Infinity], target: [0, 0, 0], fovDeg: 40 } },
      ],
    });
    expect(f.engine).toBe("omni");
    expect(f.startId).toBeNull();
    expect(f.beats.map((b) => b.words)).toEqual(["kept"]);
  });

  it("cuts at the ceiling, and the ceiling leaves one take spare in the limiter", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ words: String(i), end: goodPose }));
    expect(normaliseSetFilm({ beats: many }).beats).toHaveLength(FILM_MAX_BEATS);
    // A film is one take per beat: the whole film must fit the take
    // limiter with room for one more take by hand.
    expect(FILM_MAX_BEATS).toBeLessThan(SET_TAKES_PER_10_MIN);
  });

  it("clamps a pose's lens to something a camera has", () => {
    const f = normaliseSetFilm({ beats: [{ words: "", end: { ...goodPose, fovDeg: 400 } }] });
    expect(f.beats[0].end.fovDeg).toBe(120);
  });
});

describe("filmSeconds", () => {
  it("is beats times the engine's one length", () => {
    const two = normaliseSetFilm({ engine: "veo", beats: [{ end: goodPose }, { end: goodPose }] });
    expect(filmSeconds(two)).toBe(2 * SET_TAKE_ENGINES.veo.seconds);
    expect(filmSeconds(normaliseSetFilm(null))).toBe(0);
  });
});

describe("a beat's move (Helios Cinema)", () => {
  it("keeps a known move and its textures, once each; drops the rest", () => {
    const f = normaliseSetFilm({
      beats: [
        { words: "", end: goodPose, move: "dolly-zoom", textures: ["handheld", "handheld", "jitter", "slow-motion"] },
        { words: "", end: goodPose, move: "rack-focus" },
      ],
    });
    expect(f.beats[0].move).toBe("dolly-zoom");
    expect(f.beats[0].textures).toEqual(["handheld", "slow-motion"]);
    expect(f.beats[1].move).toBeNull();
    expect(f.beats[1].textures).toEqual([]);
  });
});

