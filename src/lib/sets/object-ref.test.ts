import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import raceTrack from "./fixtures-race-track.json";
import showroomOpen from "./fixtures-showroom-open.json";
import { ELEMENT_KEY_RE, setElements } from "./elements";
import { GAZE_KEY_RE, gazeWords, type Gaze } from "./people";
import { rackWords, type FilmRack } from "./furniture";
import { LAYOUT_ELEMENT_KEY_RE, normaliseSetSpec, type SetObject, type SetSpec, type Vec3 } from "./set-spec";
import { atThingNow, findThingNow, followObjectRef, followRefs, followRefsBack, largestBlockOf, onThingNow, refRows, rowOfRef, rowRef, thingOfBlock } from "./object-ref";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import it_ from "../i18n/messages/it";

// Eye-lines and focus pulls that follow the thing (Helios Cut 4, step A9;
// operator, 2026-09-26: "resume"): stored by block number with the thing's
// key beside it, followed through a change to the set by the photos' own
// rules, rollback-safe, and never moved by words.

const load = (raw: unknown): SetSpec => {
  const n = normaliseSetSpec(raw);
  if (!n.ok) throw new Error("fixture");
  return n.spec;
};
const race = load(raceTrack);
const room = load(showroomOpen);
const side = (spec: SetSpec) => ({ spec, els: setElements(spec) });
const car = setElements(race)[0];
const carBlocks = [...new Set(car.members.map(([o]) => o))];
const onCar = (i: number) => carBlocks.includes(i);
/** The race track rewritten whole with its objects in the opposite order, as a whole-set Astra answer can. */
const reversed: SetSpec = { ...race, objects: [...race.objects].reverse() };
const flip = (i: number) => race.objects.length - 1 - i;
const recolour = (spec: SetSpec, pick: (i: number) => boolean): SetSpec => ({ ...spec, objects: spec.objects.map((o, i) => (pick(i) ? { ...o, color: "#aa2222" } : o)) });
const without = (spec: SetSpec, pick: (i: number) => boolean): SetSpec => ({ ...spec, objects: spec.objects.filter((_, i) => !pick(i)) });
const structure = race.objects.findIndex((_, i) => !onCar(i));

describe("the key a ref keeps", () => {
  it("is the elements' key pattern, copied where a module can't import it", () => {
    expect(GAZE_KEY_RE.source).toBe(ELEMENT_KEY_RE.source);
    expect(LAYOUT_ELEMENT_KEY_RE.source).toBe(ELEMENT_KEY_RE.source);
  });

  // A menu's pick (Helios Cut 4, step B2: one row per thing) is held in refRows' tests below.
  it("is the thing's for a block of a thing, and none for the set itself", () => {
    const rows = refRows(race, setElements(race));
    expect(rowRef(null, rowOfRef(rows, carBlocks[3])!)).toMatchObject({ key: car.key });
    expect(rowRef(null, rowOfRef(rows, structure)!)).toEqual({ index: structure });
    expect(thingOfBlock(setElements(race), carBlocks[3])?.key).toBe(car.key);
    expect(thingOfBlock(setElements(race), structure)).toBeNull();
  });
});

describe("followObjectRef: a whole-set rewrite that reorders the objects", () => {
  it("keeps the eye-line on the car's very block, keyed or not", () => {
    for (const i of [carBlocks[0], largestBlockOf(car, race.objects)!, carBlocks[carBlocks.length - 1]]) {
      expect(followObjectRef({ index: i }, side(race), side(reversed))).toEqual({ index: flip(i) });
      expect(followObjectRef({ index: i, key: car.key }, side(race), side(reversed))).toEqual({ index: flip(i), key: car.key });
      // Today's index would have landed on whatever block now stands there.
      expect(onCar(flip(i)) || reversed.objects[i] !== race.objects[i]).toBe(true);
    }
  });

  it("names the same block in the still's words after the rewrite", () => {
    const mark = { x: 0, z: 0, facingDeg: 0 };
    const i = carBlocks[2];
    const moved = followObjectRef({ index: i }, side(race), side(reversed))!;
    expect(gazeWords({ at: "object", index: moved.index }, reversed, mark)).toBe(gazeWords({ at: "object", index: i }, race, mark));
    expect(rackWords({ to: "object", index: moved.index }, reversed)).toBe(rackWords({ to: "object", index: i }, race));
  });

  it("keeps a block of the set itself on that block, found by what it is (critic item 7)", () => {
    expect(followObjectRef({ index: structure }, side(race), side(reversed))).toEqual({ index: flip(structure) });
  });

  // Names on things (Helios Cut 4, step B1): a block named since is still that very block.
  it("finds the very block when the rewrite also named it", () => {
    const named: SetSpec = { ...reversed, objects: reversed.objects.map((o) => ({ ...o, name: "named since" })) };
    const i = carBlocks[2];
    expect(followObjectRef({ index: i, key: car.key }, side(race), side(named))).toEqual({ index: flip(i), key: car.key });
    expect(followObjectRef({ index: structure }, side(race), side(named))).toEqual({ index: flip(structure) });
  });
});

describe("followObjectRef: a change to the thing itself", () => {
  it("follows a recoloured car to the block the words name the same, with the car's new key", () => {
    const red = recolour(race, onCar);
    const i = carBlocks[4];
    const followed = followObjectRef({ index: i, key: car.key }, side(race), side(red))!;
    expect(followed.index).toBe(i);
    expect(followed.key).not.toBe(car.key);
    expect(followed.key).toBe(setElements(red)[0].key);
    // A ref stored without a key keeps none.
    expect(followObjectRef({ index: i }, side(race), side(red))).toEqual({ index: i });
  });

  it("follows a car that moved as a whole", () => {
    const moved: SetSpec = { ...race, objects: race.objects.map((o, i) => (onCar(i) ? { ...o, position: [o.position[0] + 3, o.position[1], o.position[2]] as Vec3 } : o)) };
    const i = carBlocks[5];
    expect(followObjectRef({ index: i, key: car.key }, side(race), side(moved))).toEqual({ index: i, key: setElements(moved)[0].key });
  });

  it("lands on the thing's largest block when none of its blocks is the one it was on", () => {
    // The car rebuilt where it stood: every block a new shape (a rebuild from photos).
    const rebuilt: SetSpec = { ...race, objects: race.objects.map((o, i) => (onCar(i) ? { ...o, size: [o.size[0] * 1.3, o.size[1], o.size[2] * 1.1] as Vec3 } : o)) };
    const after = side(rebuilt);
    const el = after.els.find((e) => e.kind === "car")!;
    const followed = followObjectRef({ index: carBlocks[1], key: car.key }, side(race), after);
    expect(followed).toEqual({ index: largestBlockOf(el, rebuilt.objects), key: el.key });
  });

  it("is lost when the thing is gone", () => {
    const gone = without(race, onCar);
    expect(followObjectRef({ index: carBlocks[0], key: car.key }, side(race), side(gone))).toBeNull();
    expect(followObjectRef({ index: carBlocks[0] }, side(race), side(gone))).toBeNull();
  });

  it("tells apart two things made of the same blocks by the key alone", () => {
    const els = setElements(room);
    const twins = els.filter((e) => e.fingerprint === els.find((x) => els.filter((y) => y.fingerprint === x.fingerprint).length > 1)?.fingerprint);
    expect(twins).toHaveLength(2);
    const shared = twins[1].members[0][0];
    expect(twins[0].members.some(([o]) => o === shared)).toBe(true);
    // By number alone it would be the first; with the second's key, it stays the second.
    expect(findThingNow(twins[1].key, els)?.key).toBe(twins[1].key);
    expect(followObjectRef({ index: shared, key: twins[1].key }, side(room), side(room))).toEqual({ index: shared, key: twins[1].key });
  });
});

// The menus' rows (Helios Cut 4, step B2, 2026-09-26): one per thing, then
// the set itself, so a wall or the grandstand stays reachable for everyone
// (critic item 7); a thing's row stores its largest block with its key.
describe("refRows: the eye-line's and a beat's focus's menus", () => {
  it("has one row per thing, pointing at its largest block with its key: the words then name that block", () => {
    const rows = refRows(race, setElements(race));
    expect(rows.things).toHaveLength(setElements(race).length);
    const row = rows.things[0];
    expect(row).toMatchObject({ kind: "thing", value: `t:${car.key}`, key: car.key, index: largestBlockOf(car, race.objects) });
    // Picked with nothing on it: the largest block, keyed, whichever block of the car the eye-line was near.
    expect(rowRef(null, row)).toEqual({ index: largestBlockOf(car, race.objects), key: car.key });
    const mark = { x: 0, z: 0, facingDeg: 0 };
    expect(gazeWords({ at: "object", ...rowRef(null, row) }, race, mark)).toBe(gazeWords({ at: "object", index: largestBlockOf(car, race.objects)! }, race, mark));
  });

  it("keeps every block of the set itself reachable, for everyone: named parts first, then each block without a name", () => {
    const plain = refRows(race, setElements(race));
    const all = [...plain.things, ...plain.parts];
    // Every block of the set is in exactly one row.
    for (let i = 0; i < race.objects.length; i++) expect(all.filter((r) => r.objects.includes(i)), String(i)).toHaveLength(1);
    expect(plain.parts.every((r) => r.kind === "part" && r.name === null && r.objects.length === 1)).toBe(true);
    expect(plain.parts.map((r) => r.index)).toContain(structure);
    // Named: one row for the part, at its largest block.
    const own = plain.parts.map((r) => r.index);
    const named: SetSpec = { ...race, objects: race.objects.map((o, i) => (i === own[0] || i === own[1] ? { ...o, name: "grandstand" } : o)) };
    const rows = refRows(named, setElements(named));
    expect(rows.parts[0]).toMatchObject({ kind: "part", name: "grandstand", objects: [own[0], own[1]] });
    expect(rows.parts).toHaveLength(plain.parts.length - 1);
    for (let i = 0; i < named.objects.length; i++) expect([...rows.things, ...rows.parts].filter((r) => r.objects.includes(i)), String(i)).toHaveLength(1);
  });

  it("finds a stored ref's row by its block, and a pick of the row it is in changes nothing (a beat keeps its clip)", () => {
    const rows = refRows(race, setElements(race));
    const onWheel = { index: carBlocks[0], key: car.key };
    expect(rowOfRef(rows, onWheel.index)?.value).toBe(`t:${car.key}`);
    expect(rowRef(onWheel, rows.things[0])).toBe(onWheel);
    const unkeyed = { index: carBlocks[1] };
    expect(rowRef(unkeyed, rows.things[0])).toBe(unkeyed);
    expect(rowOfRef(rows, structure)?.value).toBe(`o${structure}`);
    expect(rowRef(null, rowOfRef(rows, structure)!)).toEqual({ index: structure });
    expect(rowOfRef(rows, race.objects.length + 5)).toBeNull();
  });
});

describe("followRefs: the page's eye-line and the film's beats", () => {
  const gaze: Gaze = { at: "object", index: carBlocks[0], key: car.key };
  const beats: { rack: FilmRack | null; gaze: Gaze | null }[] = [
    { rack: { to: "object", index: carBlocks[1] }, gaze: { at: "camera" } },
    { rack: { to: "figure" }, gaze: { at: "point", x: 1, z: 2 } },
    { rack: null, gaze: { at: "object", index: structure } },
  ];

  it("hands back what it was given, value for value, when nothing moved", () => {
    const r = followRefs(race, race, gaze, beats);
    expect(r.changed).toBe(false);
    expect(r.gaze).toBe(gaze);
    r.beats.forEach((b, i) => {
      expect(b.rack).toBe(beats[i].rack);
      expect(b.gaze).toBe(beats[i].gaze);
    });
    expect(r.lost).toEqual({ gaze: false, rack: false });
  });

  it("follows every ref on a block, and leaves the camera, a point and the figure alone", () => {
    const r = followRefs(race, reversed, gaze, beats);
    expect(r.changed).toBe(true);
    expect(r.gaze).toEqual({ at: "object", index: flip(carBlocks[0]), key: car.key });
    expect(r.beats[0]).toEqual({ rack: { to: "object", index: flip(carBlocks[1]) }, gaze: { at: "camera" } });
    expect(r.beats[1]).toBe(r.beats[1]);
    expect(r.beats[1].rack).toBe(beats[1].rack);
    expect(r.beats[1].gaze).toBe(beats[1].gaze);
    expect(r.beats[2].gaze).toEqual({ at: "object", index: flip(structure) });
  });

  it("clears what was on a thing that is gone, and says which", () => {
    const r = followRefs(race, without(race, onCar), gaze, beats);
    expect(r.gaze).toBeNull();
    expect(r.beats[0].rack).toBeNull();
    expect(r.lost).toEqual({ gaze: true, rack: true });
  });
});

describe("followRefsBack: an Undo puts back exactly what was there", () => {
  it("restores each ref the change followed and nothing moved since, as the very value it was", () => {
    // Two identical blocks, one on the other, make one thing; the eye-line is on the second.
    const box = (x: number): SetObject => ({ ...race.objects[structure], shape: "box", size: [0.5, 0.5, 0.5], position: [x, 0.25, 30], rotation: [0, 0, 0], repeat: null });
    const base: SetSpec = { ...race, objects: [...race.objects, box(20), box(20)] };
    const second = base.objects.length - 1;
    const el = setElements(base).find((e) => e.members.some(([o]) => o === second))!;
    const shuffled: SetSpec = { ...base, objects: [base.objects[second], ...base.objects.slice(0, second)] };
    const was = { gaze: { at: "object", index: second, key: el.key } as Gaze, beats: [{ rack: { to: "object", index: second } as FilmRack, gaze: null }] };
    const fwd = followRefs(base, shuffled, was.gaze, was.beats);
    const now = { gaze: fwd.gaze, beats: fwd.beats };
    const back = followRefsBack(shuffled, base, now, { was, now });
    expect(back.gaze).toBe(was.gaze);
    expect(back.beats[0].rack).toBe(was.beats[0].rack);
    expect(back.lost).toEqual({ gaze: false, rack: false });
  });

  it("brings back an eye-line the change cleared, and follows back one moved since", () => {
    const gone = without(race, onCar);
    const was = { gaze: { at: "object", index: carBlocks[0] } as Gaze, beats: [] };
    const fwd = followRefs(race, gone, was.gaze, was.beats);
    expect(fwd.gaze).toBeNull();
    const back = followRefsBack(gone, race, { gaze: null, beats: [] }, { was, now: { gaze: fwd.gaze, beats: fwd.beats } });
    expect(back.gaze).toBe(was.gaze);
    // Moved since the change (picked again): followed back, not restored.
    const moved = followRefsBack(reversed, race, { gaze: { at: "object", index: flip(structure) }, beats: [] }, { was, now: { gaze: { at: "object", index: 3 }, beats: [] } });
    expect(moved.gaze).toEqual({ at: "object", index: structure });
  });

  it("leaves the eye-line a turn's Undo already put back", () => {
    const g: Gaze = { at: "object", index: 3 };
    const back = followRefsBack(reversed, race, { gaze: g, beats: [] }, null, true);
    expect(back.gaze).toBe(g);
    expect(back.changed).toBe(false);
  });
});

describe("atThingNow: the server reads a ref's key against the saved set", () => {
  const els = setElements(race);

  it("reads a block number that drifted off its thing as the thing's largest block", () => {
    expect(atThingNow({ index: structure, key: car.key }, els, race.objects)).toEqual({ index: largestBlockOf(car, race.objects), key: car.key });
    expect(onThingNow({ at: "object", index: structure, key: car.key }, els, race.objects)).toEqual({ at: "object", index: largestBlockOf(car, race.objects), key: car.key });
    expect(onThingNow({ to: "object", index: structure, key: car.key }, els, race.objects)).toEqual({ to: "object", index: largestBlockOf(car, race.objects), key: car.key });
  });

  it("reads every other ref by its number, as before", () => {
    const same = [{ index: carBlocks[2], key: car.key }, { index: structure }, { index: structure, key: "c_00000000_0_0" }];
    for (const r of same) expect(atThingNow(r, els, race.objects)).toBe(r);
    for (const g of [null, { at: "camera" } as const, { at: "point", x: 1, z: 1 } as const, { at: "object", index: 4 } as const]) expect(onThingNow<Gaze>(g, els, race.objects)).toBe(g);
    const fig: FilmRack = { to: "figure" };
    expect(onThingNow<FilmRack>(fig, els, race.objects)).toBe(fig);
  });
});

describe("the page and the server", () => {
  const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
  const actions = readFileSync(join(__dirname, "actions.ts"), "utf8");
  const between = (source: string, from: string, to: string) => {
    const start = source.indexOf(from);
    expect(start, from).toBeGreaterThan(-1);
    const end = source.indexOf(to, start + from.length);
    expect(end, to).toBeGreaterThan(start);
    return source.slice(start, end);
  };

  it("follows the refs when an Astra change or a rebuild lands, and puts them back on its Undo", () => {
    const edit = between(view, "    const apply = (next: SetSpec, changed: number, undo: EditUndo | null, seal: EditUndo | null) => {", "    };");
    expect(edit).toContain("followEditRefs(before, next);");
    const rebuild = between(view, "    const apply = (next: SetSpec, changed: number, to: { key: string; blocks: number } | null, seal: EditUndo | null) => {", "    };");
    expect(rebuild).toContain("followEditRefs(before, next);");
    const undo = between(view, "  async function undoSetEdit(inTurn = false)", "\n  }\n");
    expect(undo).toContain("const back = followRefsBack(spec, saved.spec, refsNow(), followed, inTurn);");
  });

  it("writes the beats straight onto the film, never through filmAfterEdit, so their clips stay", () => {
    const put = between(view, "  function putRefs(r: RefsState) {", "\n  }\n");
    expect(put).toContain("setFilm((f) =>");
    expect(put).not.toContain("editFilm(");
    expect(put).not.toContain("filmAfterEdit");
    expect(put).toContain("!filmBusyRef.current");
  });

  it("stores the thing's key on every pick: the menus and the chat", () => {
    // The menus' rows are things and parts of the set (Helios Cut 4, step B2): a row's pick keeps the ref already in it, else its block with the thing's key.
    expect(view).toContain('setGaze({ at: "object", ...rowRef(gaze?.at === "object" ? gaze : null, row) });');
    expect(view).toContain('{ to: "object" as const, ...rowRef(had?.to === "object" ? had : null, row) }');
    expect(view).toContain('{ at: "object", ...rowRef(had?.at === "object" ? had : null, row) }');
    expect(view).toContain('if (el && oi !== null) gaze = { at: "object", index: oi, key: el.key };');
  });

  it("says a lost eye-line with the person's name, and a lost focus pull", () => {
    const block = between(view, "{refsLost && (", "{/* An Astra answer that changed nothing");
    expect(block).toContain("formatMsg(s.reply.noteGazeLost, { name: characterName })");
    expect(block).toContain("{s.reply.noteRackLost}");
    for (const [name, t] of Object.entries({ en, es, pt, it: it_ })) {
      expect(t.sets.reply.noteGazeLost, name).toContain("{name}");
      expect(t.sets.reply.noteGazeLost, name).not.toMatch(/\bher\b|\bhis\b/i);
      expect(t.sets.reply.noteRackLost.trim().length, name).toBeGreaterThan(0);
    }
    for (const t of [es, pt, it_]) {
      expect(t.sets.reply.noteGazeLost).not.toBe(en.sets.reply.noteGazeLost);
      expect(t.sets.reply.noteRackLost).not.toBe(en.sets.reply.noteRackLost);
    }
  });

  it("the server reads the key against the saved set for a still's eye-line and a take's rack and eye-line", () => {
    expect(actions).toContain("gazeWords(onThingNow(layout.gaze, els, owned.spec.objects), shown,");
    expect(actions).toContain("rackWords(onThingNow(normaliseRack(input.rack, owned.spec.objects.length), endEls, owned.spec.objects), endShown)");
    expect(actions).toContain("gazeWords(onThingNow(normaliseGaze(input.gaze, owned.spec.objects.length), endEls, owned.spec.objects), endShown,");
  });
});
