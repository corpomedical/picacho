import { describe, expect, it } from "vitest";
import {
  FILM_MAX_BEATS,
  filmAfterEdit,
  filmContextKey,
  filmRendered,
  filmJobCount,
  filmJobs,
  filmRenderPlan,
  filmSeconds,
  filmStages,
  filmShotIds,
  normaliseSetFilm,
  textKey,
  type FilmPose,
  type SetFilm,
} from "./film";
import { DEFAULT_SET_RIG, normaliseSetRig, type SetRig } from "./rig";
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
    const added = { ...f, beats: [...f.beats, { words: "three", end: pose(1), move: null, textures: [], figure: null, time: null, rack: null, gaze: null, path: [] }] };
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

describe("filmShotIds", () => {
  it("names the opening still and every clip, once each, and nothing for a film with neither", () => {
    expect(filmShotIds(two())).toEqual([A, B]);
    const again = normaliseSetFilm({ startId: A, beats: [{ end: goodPose }, { end: goodPose }], clips: [B, B] });
    expect(filmShotIds(again)).toEqual([A, B]);
    expect(filmShotIds(normaliseSetFilm({ beats: [{ end: goodPose }], clips: [null] }))).toEqual([]);
    expect(filmShotIds(null)).toEqual([]);
  });
});

// Rendering only what changed (2026-09-16): a film re-rendered after one
// beat changed renders that beat and the ones after it, opening on the
// still the beat before closed on — never a mixed film.

const C = "cccccccc-1111-2222-3333-444444444444";
const D = "dddddddd-1111-2222-3333-444444444444";
const E1 = "eeeeeee1-1111-2222-3333-444444444444";
const E2 = "eeeeeee2-1111-2222-3333-444444444444";
const E3 = "eeeeeee3-1111-2222-3333-444444444444";
const CTX = "abc123";
const three = (over: Partial<Pick<SetFilm, "clips" | "ends" | "context">> = {}): SetFilm => ({
  ...normaliseSetFilm({
    startId: A,
    beats: [
      { words: "one", end: goodPose },
      { words: "two", end: goodPose },
      { words: "three", end: goodPose },
    ],
  }),
  clips: [B, C, D],
  ends: [E1, E2, E3],
  context: CTX,
  ...over,
});
const all = { clip: () => true, end: () => true };

describe("a film's end stills and context, stored", () => {
  it("keeps end stills like clips, and a context only as a short key", () => {
    const f = normaliseSetFilm({ beats: [{ end: goodPose }, { end: goodPose }], ends: [E1, "junk", E3], context: "Deadbeef" });
    expect(f.ends).toEqual([E1, null]);
    expect(f.context).toBeNull();
    expect(normaliseSetFilm({ beats: [{ end: goodPose }], context: "0f1e2d" }).context).toBe("0f1e2d");
    expect(normaliseSetFilm({ beats: [{ end: goodPose }], context: "x".repeat(40) }).context).toBeNull();
  });

  it("an edit keeps the end stills in step with the clips, and the context as it was", () => {
    const f = three();
    const edited = filmAfterEdit(f, { ...f, beats: [f.beats[0], { ...f.beats[1], words: "two, again" }, f.beats[2]] });
    expect(edited.clips).toEqual([B]);
    expect(edited.ends).toEqual([E1]);
    expect(edited.context).toBe(CTX);
    expect(filmAfterEdit(f, { ...f, engine: "veo" }).ends).toEqual([]);
  });

  it("names the end stills among the shots the page must load", () => {
    expect(filmShotIds(three())).toEqual([A, B, C, D, E1, E2, E3]);
  });
});

describe("filmJobs", () => {
  const whole = (...beats: number[]) => beats.map((beat) => ({ beat, end: null }));

  it("renders every beat whole when nothing is rendered, and nothing when all is", () => {
    expect(filmJobs(three({ clips: [], ends: [] }), CTX, all)).toEqual(whole(0, 1, 2));
    expect(filmJobs(three(), CTX, all)).toEqual([]);
  });

  it("renders whole from the first beat that needs a new end frame — a changed beat and the ones after it", () => {
    expect(filmJobs(three({ clips: [B, C], ends: [E1, E2] }), CTX, all)).toEqual(whole(2));
    expect(filmJobs(three({ clips: [B], ends: [E1] }), CTX, all)).toEqual(whole(1, 2));
    // A beat whose end still failed, and so whose clip never started.
    expect(filmJobs(three({ clips: [B, null], ends: [E1, null] }), CTX, all)).toEqual(whole(1, 2));
  });

  it("renders a failed clip alone on the end frame it has, and leaves the beats after it", () => {
    const failed = (bad: string[]) => ({ clip: (id: string) => !bad.includes(id), end: () => true });
    expect(filmJobs(three(), CTX, failed([C]))).toEqual([{ beat: 1, end: E2 }]);
    expect(filmJobs(three(), CTX, failed([B, D]))).toEqual([
      { beat: 0, end: E1 },
      { beat: 2, end: E3 },
    ]);
    // A failed first clip and a changed last beat: the clip alone, then the last beat whole.
    expect(filmJobs(three({ clips: [B, C], ends: [E1, E2] }), CTX, failed([B]))).toEqual([{ beat: 0, end: E1 }, ...whole(2)]);
    // A clip that never started is as gone as one that failed.
    expect(filmJobs(three({ clips: [B, null, D] }), CTX, all)).toEqual([{ beat: 1, end: E2 }]);
  });

  it("counts a clip still rendering as rendered", () => {
    expect(filmJobs(three(), CTX, { clip: () => true, end: () => true })).toEqual([]);
  });

  it("renders the beat before whole when a beat that needs work has nothing to open on", () => {
    const noE1 = (bad: string[]) => ({ clip: (id: string) => !bad.includes(id), end: (id: string) => id !== E1 });
    // Beat 2's clip failed and beat 1's end still is gone: beat 1 must make a new one.
    expect(filmJobs(three(), CTX, noE1([C]))).toEqual(whole(0, 1, 2));
    // …and a clip-alone job planned before that point gives way to the whole run.
    expect(filmJobs(three(), CTX, { clip: (id) => id !== B && id !== D, end: (id) => id !== E2 })).toEqual([
      { beat: 0, end: E1 },
      ...whole(1, 2),
    ]);
  });

  it("leaves a finished film alone although an end still nothing needs has gone", () => {
    expect(filmJobs(three(), CTX, { clip: () => true, end: (id) => id !== E1 })).toEqual([]);
    expect(filmJobs(three({ ends: [E1, null, E3] }), CTX, all)).toEqual([]);
  });

  it("renders whole from the top for a film rendered under another context, or none", () => {
    expect(filmJobs(three(), "other", all)).toEqual(whole(0, 1, 2));
    expect(filmJobs(three({ context: null }), CTX, all)).toEqual(whole(0, 1, 2));
  });
});

describe("filmContextKey", () => {
  const rig = (over: Partial<SetRig> = {}): SetRig => normaliseSetRig({ ...DEFAULT_SET_RIG, format: "scope", stock: "film35", ...over });
  const mark = { x: 1, z: 2, facingDeg: 90 };
  const key = (over: Partial<Parameters<typeof filmContextKey>[0]> = {}) =>
    filmContextKey({ characterId: A, rig: rig(), mark, setKey: "s1", ...over });

  it("is the same for the same film, however the rig object was put together", () => {
    const r = rig();
    const reordered = Object.fromEntries(Object.entries(r).reverse()) as SetRig;
    expect(key({ rig: reordered })).toBe(key({ rig: r }));
  });

  it("changes with who is in it, the rig's look, the light, the mark and the set", () => {
    const base = key();
    expect(key({ characterId: B })).not.toBe(base);
    expect(key({ rig: rig({ format: "wide" }) })).not.toBe(base);
    expect(key({ rig: rig({ palette: "silver-print" }) })).not.toBe(base);
    expect(key({ rig: rig({ light: { scheme: "moonlight", azimuthDeg: 40, elevationDeg: 30 } }) })).not.toBe(base);
    expect(key({ mark: { ...mark, facingDeg: 180 } })).not.toBe(base);
    expect(key({ setKey: "s2" })).not.toBe(base);
  });

  it("ignores what never reaches the picture: the genre and the stage's grade", () => {
    expect(key({ rig: rig({ genre: "noir" }) })).toBe(key());
    expect(key({ rig: rig({ gradeStage: false }) })).toBe(key());
  });

  it("names every field the rig has, so a new control cannot slip past it", () => {
    // A new SetRig field must either change the picture — and then join the
    // key in film.ts — or be added here as one that does not.
    expect(Object.keys(DEFAULT_SET_RIG).sort()).toEqual(
      // In the key: format, era, stock, lens, stop, palette, light, sensor,
      // squeeze, shutterDeg, iso, ev, blades. Not in it: genre (suggests
      // only), gradeStage and overlays (the stage's own view, never the sketch).
      ["blades", "era", "ev", "format", "genre", "gradeStage", "iso", "lens", "light", "overlays", "palette", "sensor", "shutterDeg", "squeeze", "stock", "stop", "time"].sort(),
    );
  });
});

describe("textKey", () => {
  it("is short, stable and tells texts apart", () => {
    expect(textKey("the race track")).toBe(textKey("the race track"));
    expect(textKey("the race track")).not.toBe(textKey("the race track."));
    expect(textKey("x".repeat(200_000))).toMatch(/^[0-9a-f]{1,14}$/);
  });
});

describe("filmRenderPlan", () => {
  const states = (m: Record<string, string>) => (id: string) => m[id] ?? null;
  const done = { [B]: "succeeded", [C]: "succeeded", [D]: "succeeded", [E1]: "succeeded", [E2]: "succeeded", [E3]: "succeeded" };
  const everyBeat = [0, 1, 2].map((beat) => ({ beat, end: null }));

  it("renders the whole film again once every clip has landed", () => {
    expect(filmRenderPlan(three(), CTX, states(done))).toEqual({ jobs: everyBeat, again: true, rendering: false });
  });

  it("offers nothing while the clips are still on their way — a second press would pay for the film twice", () => {
    const plan = filmRenderPlan(three(), CTX, states({ ...done, [C]: "generating", [D]: "generating" }));
    expect(plan).toEqual({ jobs: everyBeat, again: true, rendering: true });
  });

  it("renders a failed clip alone while the others render", () => {
    const plan = filmRenderPlan(three(), CTX, states({ ...done, [C]: "generating", [D]: "failed" }));
    expect(plan).toEqual({ jobs: [{ beat: 2, end: E3 }], again: false, rendering: true });
  });

  it("counts a clip the page does not hold as gone, and an end still only once it is finished", () => {
    expect(filmRenderPlan(three(), CTX, (id) => (id === D ? null : states(done)(id))).jobs).toEqual([{ beat: 2, end: E3 }]);
    expect(filmRenderPlan(three({ clips: [B] }), CTX, states({ ...done, [E1]: "generating" })).jobs).toEqual(everyBeat);
  });
});

describe("filmJobCount", () => {
  it("counts a clip for every job and a still for every beat rendered whole", () => {
    expect(filmJobCount([])).toEqual({ clips: 0, stills: 0 });
    expect(
      filmJobCount([
        { beat: 0, end: "00000000-0000-4000-8000-000000000001" },
        { beat: 1, end: null },
        { beat: 2, end: null },
      ]),
    ).toEqual({ clips: 3, stills: 2 });
  });
});

describe("the people and sun tracks (cut 5)", () => {
  const pose = { position: [0, 1.6, 6] as [number, number, number], target: [0, 1.4, 0] as [number, number, number], fovDeg: 40 };
  it("keep where the figure stands and the hour at a beat's end, and drop what they cannot read", () => {
    const f = normaliseSetFilm({
      beats: [
        { words: "", end: pose, figure: { x: 2, z: -1, facingDeg: 450, pose: "sit" }, time: 17.6 },
        { words: "", end: pose, figure: { x: "far" }, time: "noon" },
        { words: "", end: pose },
      ],
    });
    expect(f.beats[0].figure).toEqual({ x: 2, z: -1, facingDeg: 90, pose: "sit" });
    expect(f.beats[0].time).toBe(17.5);
    expect(f.beats[1].figure).toBeNull();
    expect(f.beats[1].time).toBeNull();
    expect(f.beats[2].figure).toBeNull();
    expect(f.beats[2].time).toBeNull();
    expect(normaliseSetFilm({ beats: [{ words: "", end: pose, figure: { x: 1, z: 1, pose: "fly" } }] }).beats[0].figure?.pose).toBe("stand");
  });

  it("make a beat another beat: a moved figure or a changed hour drops its clip", () => {
    const before = normaliseSetFilm({ beats: [{ words: "a", end: pose }], clips: ["00000000-0000-0000-0000-000000000001"], ends: ["00000000-0000-0000-0000-000000000002"] });
    const moved = { ...before, beats: [{ ...before.beats[0], figure: { x: 1, z: 1, facingDeg: 0, pose: "walk" as const } }] };
    expect(filmAfterEdit(before, moved).clips).not.toContain(before.clips[0]);
    const hour = { ...before, beats: [{ ...before.beats[0], time: 12 }] };
    expect(filmAfterEdit(before, hour).clips).not.toContain(before.clips[0]);
    const same = { ...before, beats: [{ ...before.beats[0] }] };
    expect(filmAfterEdit(before, same).clips).toEqual(before.clips);
  });
});

describe("filmStages (the stage each beat is shot on)", () => {
  const arrangement = { mark: { x: 1, z: 2, facingDeg: 90 }, pose: "stand" as const, time: 12 };
  const beat = (over: Partial<Parameters<typeof filmStages>[0][number]> = {}) => ({ figure: null, time: null, gaze: null, ...over });

  it("keeps the figure where the film left it, and takes the rig's hour where a beat sets none", () => {
    const stages = filmStages(
      [
        beat({ figure: { x: 4, z: 3, facingDeg: 180, pose: "sit" }, time: 18 }),
        beat(),
        beat({ time: 7 }),
      ],
      arrangement,
    );
    // Beat 1 walks the figure and sets its own hour.
    expect(stages[0]).toEqual({ figure: { x: 4, z: 3, facingDeg: 180 }, pose: "sit", time: 18, gaze: null });
    // Beat 2 says nothing: the figure stays where beat 1 left it (the beat's
    // own words), and the hour goes back to the rig's (the sun track's).
    expect(stages[1]).toEqual({ figure: { x: 4, z: 3, facingDeg: 180 }, pose: "sit", time: 12, gaze: null });
    expect(stages[2].time).toBe(7);
  });

  it("gives a beat whose hour is the rig's that hour, whatever the beat before it drew", () => {
    // The render used to compare a beat's hour with the RIG's: a noon→18:00
    // film whose second beat is also 18:00 was shot at noon (2026-09-17).
    const stages = filmStages([beat({ time: 12 }), beat({ time: 18 })], { ...arrangement, time: 18 });
    expect(stages.map((x) => x.time)).toEqual([12, 18]);
  });

  it("takes the beat's own eye-line, never the arrangement's", () => {
    const gaze = { at: "camera" } as const;
    const stages = filmStages([beat({ gaze }), beat()], arrangement);
    expect(stages[0].gaze).toEqual(gaze);
    expect(stages[1].gaze).toBeNull();
  });

  it("stands the first beat where the arrangement does", () => {
    expect(filmStages([beat()], arrangement)[0]).toEqual({ figure: { x: 1, z: 2, facingDeg: 90 }, pose: "stand", time: 12, gaze: null });
  });
});
