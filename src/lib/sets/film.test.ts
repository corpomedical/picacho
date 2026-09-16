import { describe, expect, it } from "vitest";
import { FILM_MAX_BEATS, filmAfterEdit, filmRendered, filmSeconds, normaliseSetFilm, type FilmPose } from "./film";
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


// The reel's clips (2026-09-16): a film the person paid to render is kept on
// the film itself, so it can be watched again after the page closes — and
// dropped the moment an edit makes it a clip of a different film.

const A = "aaaaaaaa-1111-2222-3333-444444444444";
const B = "bbbbbbbb-1111-2222-3333-444444444444";
const pose = (x: number): FilmPose => ({ position: [x, 2, 3], target: [0, 1, 0], fovDeg: 40 });
const two = () => normaliseSetFilm({ startId: A, beats: [{ words: "one", end: goodPose }, { words: "two", end: goodPose }], clips: [A, B] });

describe("a film's clips", () => {
  it("keeps the clips a stored film remembers, as uuids", () => {
    expect(two().clips).toEqual([A, B]);
    expect(normaliseSetFilm({ beats: [{ end: goodPose }], clips: ["nope"] }).clips).toEqual([null]);
  });

  it("never keeps more clips than there are beats", () => {
    const f = normaliseSetFilm({ beats: [{ end: goodPose }], clips: [A, B] });
    expect(f.clips).toEqual([A]);
  });

  it("is rendered only when every beat has a clip", () => {
    expect(filmRendered(two())).toBe(true);
    expect(filmRendered(normaliseSetFilm({ beats: [{ end: goodPose }, { end: goodPose }], clips: [A] }))).toBe(false);
    expect(filmRendered(normaliseSetFilm({ beats: [{ end: goodPose }], clips: [null] }))).toBe(false);
    expect(filmRendered(normaliseSetFilm(null))).toBe(false);
  });
});

describe("filmAfterEdit", () => {
  it("leaves the clips alone when nothing about the beats changed", () => {
    const f = two();
    expect(filmAfterEdit(f, { ...f }).clips).toEqual([A, B]);
  });

  it("drops the changed beat's clip and every clip after it", () => {
    const f = two();
    const edited = { ...f, beats: [f.beats[0], { ...f.beats[1], words: "two, differently" }] };
    expect(filmAfterEdit(f, edited).clips).toEqual([A]);
    const first = { ...f, beats: [{ ...f.beats[0], move: "push-in" as const }, f.beats[1]] };
    expect(filmAfterEdit(f, first).clips).toEqual([]);
  });

  it("drops a clip when the beat is reframed, not only reworded", () => {
    const f = two();
    const moved = { ...f, beats: [{ ...f.beats[0], end: pose(9) }, f.beats[1]] };
    expect(filmAfterEdit(f, moved).clips).toEqual([]);
  });

  it("drops every clip when the engine or the opening still changes: a different film", () => {
    const f = two();
    expect(filmAfterEdit(f, { ...f, engine: "veo" }).clips).toEqual([]);
    expect(filmAfterEdit(f, { ...f, startId: B }).clips).toEqual([]);
  });

  it("keeps the clips of the beats before a new one, and the film is no longer rendered", () => {
    const f = two();
    const added = { ...f, beats: [...f.beats, { words: "three", end: pose(1), move: null, textures: [] }] };
    const next = filmAfterEdit(f, added);
    expect(next.clips).toEqual([A, B]);
    expect(filmRendered(next)).toBe(false);
  });

  it("drops the clip of a beat that was removed from the middle", () => {
    const f = two();
    const cut = { ...f, beats: [f.beats[1]] };
    expect(filmAfterEdit(f, cut).clips).toEqual([]);
  });
});
