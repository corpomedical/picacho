import { describe, expect, it } from "vitest";
import {
  FILM_MAX_BEATS,
  filmAfterEdit,
  filmContextKey,
  filmRendered,
  filmRenderFrom,
  filmRenderPlan,
  filmSeconds,
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

describe("filmRenderFrom", () => {
  it("renders the whole film when nothing is rendered", () => {
    expect(filmRenderFrom(three({ clips: [], ends: [] }), CTX, all)).toEqual({ from: 0, startId: A });
  });

  it("says so when every beat is rendered", () => {
    expect(filmRenderFrom(three(), CTX, all)).toEqual({ from: 3, startId: null });
  });

  it("picks up at the first beat without a clip, opening on the end still before it", () => {
    expect(filmRenderFrom(three({ clips: [B, C], ends: [E1, E2] }), CTX, all)).toEqual({ from: 2, startId: E2 });
    expect(filmRenderFrom(three({ clips: [B], ends: [E1] }), CTX, all)).toEqual({ from: 1, startId: E1 });
  });

  it("renders a beat again when its clip failed or was deleted, but not one still rendering", () => {
    const failedC = { clip: (id: string) => id !== C, end: () => true };
    expect(filmRenderFrom(three(), CTX, failedC)).toEqual({ from: 1, startId: E1 });
    // The page counts a clip still rendering as good: it is on its way.
    expect(filmRenderFrom(three(), CTX, all).from).toBe(3);
  });

  it("steps back to the beat whose end still is gone, since the next one has nothing to open on", () => {
    const noE1 = { clip: () => true, end: (id: string) => id !== E1 };
    expect(filmRenderFrom(three({ clips: [B, C], ends: [E1, E2] }), CTX, noE1)).toEqual({ from: 2, startId: E2 });
    expect(filmRenderFrom(three({ clips: [B], ends: [E1] }), CTX, noE1)).toEqual({ from: 0, startId: A });
    expect(filmRenderFrom(three({ clips: [B, C], ends: [E1, null] }), CTX, all)).toEqual({ from: 1, startId: E1 });
  });

  it("does not render a finished film's last beat again for want of an end nothing opens on", () => {
    expect(filmRenderFrom(three({ ends: [E1, E2, null] }), CTX, all)).toEqual({ from: 3, startId: null });
  });

  it("starts from the top for a film rendered under another context, or none", () => {
    expect(filmRenderFrom(three(), "other", all)).toEqual({ from: 0, startId: A });
    expect(filmRenderFrom(three({ context: null }), CTX, all)).toEqual({ from: 0, startId: A });
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
      ["era", "format", "genre", "gradeStage", "lens", "light", "palette", "stock", "stop"].sort(),
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

  it("renders the whole film again once every clip has landed", () => {
    expect(filmRenderPlan(three(), CTX, states(done))).toEqual({ from: 0, startId: A, again: true, rendering: false });
  });

  it("offers nothing while the clips are still on their way — a second press would pay for the film twice", () => {
    const plan = filmRenderPlan(three(), CTX, states({ ...done, [C]: "generating", [D]: "generating" }));
    expect(plan).toEqual({ from: 0, startId: A, again: true, rendering: true });
  });

  it("still picks up after a failed clip while the others render", () => {
    const plan = filmRenderPlan(three(), CTX, states({ ...done, [C]: "generating", [D]: "failed" }));
    expect(plan).toEqual({ from: 2, startId: E2, again: false, rendering: true });
  });

  it("counts a clip the page does not hold as gone, and an end still only once it is finished", () => {
    expect(filmRenderPlan(three(), CTX, states({ ...done, [D]: undefined as unknown as string })).from).toBe(2);
    expect(filmRenderPlan(three({ clips: [B] }), CTX, states({ ...done, [E1]: "generating" }))).toEqual({
      from: 0,
      startId: A,
      again: false,
      rendering: false,
    });
  });
});
