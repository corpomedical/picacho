import { beforeEach, describe, expect, it, vi } from "vitest";
import raceTrack from "../sets/fixtures-race-track.json";
import { normaliseSetSpec, type SetSpec } from "../sets/set-spec";
import { setElements } from "../sets/elements";
import { turnThing, uprightOf } from "../sets/thing-fix";

// The Helios session check and the Build editor's own save are stubbed (they
// read the request's cookies); everything else runs as in the route.
const saved: { setId: string; spec: unknown }[] = [];
const cleared: string[] = [];
vi.mock("../sets/access", () => ({
  UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  setsAccess: async () => ({ error: null, userId: "u1" }),
}));
vi.mock("../sets/editor-actions", () => ({
  saveSetEdit: async (setId: string, spec: unknown) => {
    saved.push({ setId, spec });
    return { error: null };
  },
  clearSetEdit: async (setId: string) => {
    cleared.push(setId);
    return { error: null };
  },
}));
vi.mock("../sets/thing-model-store", () => ({ listThingModels: async () => [] }));

const { fixSetTool, readSetTool, undoSetTool } = await import("./set-tools");

const SET = "11111111-2222-4333-8444-555555555555";
function spec(): SetSpec {
  const n = normaliseSetSpec(raceTrack);
  if (!n.ok) throw new Error("fixture");
  return n.spec;
}
function upsideDown(): SetSpec {
  const s = spec();
  const car = setElements(s).find((e) => e.kind === "car")!;
  const r = turnThing(s, car, "z", 180);
  if (!r.ok) throw new Error("flip");
  return r.spec;
}

// A tiny stand-in for the admin client: each table answers from `db`.
type Row = Record<string, unknown>;
function fakeAdmin(db: Record<string, Row[]>) {
  return {
    from(table: string) {
      let rows = [...(db[table] ?? [])];
      const q = {
        select: () => q,
        eq: (col: string, v: unknown) => {
          rows = rows.filter((r) => (col.includes("->>") ? (r.display as Row | null)?.[col.split("->>")[1]] === v : r[col] === v));
          return q;
        },
        is: (col: string, v: unknown) => {
          rows = rows.filter((r) => (r[col] ?? null) === v);
          return q;
        },
        order: (col: string, o: { ascending: boolean }) => {
          rows.sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (o.ascending ? 1 : -1));
          return q;
        },
        limit: (n: number) => {
          rows = rows.slice(0, n);
          return Object.assign(Promise.resolve({ data: rows, error: null }), q);
        },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      };
      return q;
    },
  } as never;
}

beforeEach(() => {
  saved.length = 0;
  cleared.length = 0;
});

describe("the Producer's hands in Helios", () => {
  const setRow = (edited: SetSpec | null) => ({
    id: SET,
    user_id: "u1",
    title: "Yellow Coupe on Closed Track",
    status: "ready",
    spec: spec(),
    edited_spec: edited,
    deleted_at: null,
    created_at: "2026-09-25T10:00:00Z",
  });

  it("reads the set their newest still came from, and sees the car is upside down", async () => {
    const admin = fakeAdmin({
      location_set_shots: [{ set_id: SET, user_id: "u1", generation_id: "g1", created_at: "2026-09-25T11:00:00Z" }],
      location_sets: [setRow(upsideDown())],
    });
    const r = await readSetTool({ admin, userId: "u1" }, { set_id: null });
    expect(r.isError).toBeUndefined();
    expect(r.text).toContain('Set "Yellow Coupe on Closed Track"');
    expect(r.text).toMatch(/Car[^\n]*UPSIDE DOWN/);
    expect(r.text).toContain("g1");
  });

  // One naming rule (Helios Cut 4, step B2): Aly reads each thing by the
  // page's name with its key, colour and side, and the set's named parts;
  // it picks the key from here, never a colour out of free words.
  it("lists each thing's name, key, colour and side, its alias on a named set, and the named parts", async () => {
    const s = spec();
    const car = setElements(s).find((e) => e.kind === "car")!;
    const carBlocks = new Set(car.members.map(([o]) => o));
    const wall = s.objects.findIndex((_, i) => !carBlocks.has(i));
    const named: SetSpec = { ...s, objects: s.objects.map((o, i) => (carBlocks.has(i) ? { ...o, name: "yellow coupe" } : i === wall ? { ...o, name: "grandstand" } : o)) };
    const plain = await readSetTool({ admin: fakeAdmin({ location_sets: [setRow(null)], location_set_shots: [] }), userId: "u1" }, { set_id: SET });
    expect(plain.text).toMatch(new RegExp(`- Car \\(key ${car.key}\\): car, (${["red", "orange", "yellow", "olive", "green", "teal", "cyan", "blue", "navy", "purple", "pink", "brown", "black", "white", "grey"].join("|")}), (in front of the figure|to the figure's left|to the figure's right|behind the figure), `));
    expect(plain.text).not.toContain("Parts (");
    const r = await readSetTool({ admin: fakeAdmin({ location_sets: [setRow(named)], location_set_shots: [] }), userId: "u1" }, { set_id: SET });
    expect(r.text).toContain(`- Yellow coupe (key ${car.key}; also "Car"): car, `);
    expect(r.text).toContain("Parts (the set itself, can't be moved): grandstand.");
    expect(r.text).toContain("pass its key");
    // Found by the name the page shows.
    const fixed = await fixSetTool({ admin: fakeAdmin({ location_sets: [setRow(named)], location_set_shots: [] }), userId: "u1" }, { set_id: SET, thing: "Yellow coupe", action: "floor", axis: null, degrees: null, move: null });
    expect(fixed.isError).toBeUndefined();
    expect(fixed.text).toMatch(/^(Done: )?Yellow coupe/);
  });

  it("stands it back on its wheels, saved through the editor's own save, keeping the copy it replaced", async () => {
    const before = upsideDown();
    const admin = fakeAdmin({ location_sets: [setRow(before)], location_set_shots: [] });
    const r = await fixSetTool({ admin, userId: "u1" }, { set_id: SET, thing: "Car", action: "upright", axis: null, degrees: null, move: null });
    expect(r.isError).toBeUndefined();
    expect(r.text).toMatch(/^Done: Car turned back onto its wheels/);
    expect(r.text).toContain("standing on its wheels");
    expect(saved).toHaveLength(1);
    const after = saved[0].spec as SetSpec;
    const car = setElements(after).find((e) => e.kind === "car")!;
    expect(uprightOf(after, car)).toBe("upright");
    expect(r.setChange?.setId).toBe(SET);
    expect(r.setChange?.before).toEqual(before);
  });

  it("says which things there are when the name doesn't match, and changes nothing", async () => {
    const admin = fakeAdmin({ location_sets: [setRow(null)], location_set_shots: [] });
    const r = await fixSetTool({ admin, userId: "u1" }, { set_id: SET, thing: "boat", action: "upright", axis: null, degrees: null, move: null });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/No thing called "boat"[\s\S]*Car/);
    expect(saved).toHaveLength(0);
  });

  it("undoes its last change from the conversation's record: back to Astra's original when there was no copy", async () => {
    const admin = fakeAdmin({
      location_sets: [setRow(spec())],
      producer_messages: [
        { user_id: "u1", created_at: "2026-09-25T12:00:00Z", display: { kind: "set_undo", changes: [{ setId: SET, before: null }] } },
      ],
    });
    const r = await undoSetTool({ admin, userId: "u1" }, { set_id: null });
    expect(r.isError).toBeUndefined();
    expect(cleared).toEqual([SET]);
    expect(r.text).toMatch(/Astra's original/);
    // Undoing again would redo: this undo records what it replaced.
    expect(r.setChange?.setId).toBe(SET);
  });
});
