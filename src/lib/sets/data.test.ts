import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import raceTrack from "./fixtures-race-track.json";
import { SET_EDITS_MONTH_SCOPE, setEditsMonthlyLimit, setTakesEligible } from "./set-config";
import { mediaUrl, thumbUrl } from "../media/url";

// The set page's loader, for what a take was rendered from (2026-09-16). A
// take whose clip failed on an earlier visit offers "Try the clip again"
// only when the loader hands the page its two stills — and it must hand
// them over only while the clip could really be rendered again between
// them: a take of its own, both stills still finished, its person still one
// who can be shot. Before helios-take-frames.sql runs, the page must load as
// it did.
//
// data.ts imports through "@/", which this suite does not resolve: the
// server-only modules are stood in for, and every Sets module is the real
// one, forwarded.

vi.spyOn(console, "warn").mockImplementation(() => {});
// Media urls are signed; any key will do for a url nobody fetches.
vi.stubEnv("MEDIA_SIGNING_SECRET", "test-only");

const USER = "11111111-1111-4111-8111-111111111111";
const SET = "22222222-2222-4222-8222-222222222222";
const PERSON = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NO_PHOTO = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const gid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Row = Record<string, unknown>;
type Tables = Record<string, { columns: string[]; rows: Row[] }>;

let db: SupabaseClient;
let who: { plan: string; isAdmin: boolean; periodStart?: string | null } = { plan: "studio", isAdmin: false };
let reads: { table: string; select: string; filters: [string, string, unknown][] }[] = [];

// The service role reads one thing here: the limiter's record of the
// month's Astra changes (data.ts countAstraEditsThisMonth).
let rateHits: { scope: string; created_at: string }[] = [];
let rateReadFails = false;
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== "api_rate_hits") throw new Error(`the page's read runs as the person, not ${table}`);
      const f: [string, string, unknown][] = [];
      const builder = {
        select: () => builder,
        eq: (c: string, v: unknown) => (f.push([c, "eq", v]), builder),
        gte: (c: string, v: unknown) => (f.push([c, "gte", v]), builder),
        then: (resolve: (v: unknown) => void) => {
          if (rateReadFails) return resolve({ count: null, error: { message: "boom" } });
          const scope = f.find(([c]) => c === "scope")?.[2];
          const since = f.find(([, op]) => op === "gte")?.[2] as string;
          const userOk = f.some(([c, op, v]) => c === "user_id" && op === "eq" && v === USER);
          resolve({ count: userOk ? rateHits.filter((h) => h.scope === scope && h.created_at >= since).length : 0, error: null });
        },
      };
      return builder;
    },
  }),
}));
vi.mock("@/lib/generations/core", () => ({ monthlyWindowStart: (p: string | null) => new Date(p ?? 0) }));
vi.mock("@/lib/sets/access", () => ({
  setsAccess: async () => ({ error: null, supabase: db, userId: USER, periodStart: null, ...who, monthlyLimit: 5 }),
  UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
}));
vi.mock("@/lib/sets/enabled", () => ({ isPhotoSetsEnabled: async () => false }));
vi.mock("@/lib/media/url", async () => await import("../media/url"));
vi.mock("@/lib/plans", async () => await import("../plans"));
vi.mock("@/lib/generations/identity-gate", async () => await import("../generations/identity-gate"));
vi.mock("@/lib/sets/photo", async () => await import("./photo"));
vi.mock("@/lib/sets/set-config", async () => await import("./set-config"));
vi.mock("@/lib/sets/shot-camera", async () => await import("./shot-camera"));
vi.mock("@/lib/sets/shot-words-store", async () => await import("./shot-words-store"));
vi.mock("@/lib/sets/look-cutout", async () => await import("./look-cutout"));
vi.mock("@/lib/sets/set-spec", async () => await import("./set-spec"));
vi.mock("@/lib/sets/film", async () => await import("./film"));
vi.mock("@/lib/sets/rig", async () => await import("./rig"));
vi.mock("@/lib/sets/shot-rig", async () => await import("./shot-rig"));
vi.mock("@/lib/sets/shot-take", async () => await import("./shot-take"));
vi.mock("@/lib/sets/set-shots", async () => await import("./set-shots"));
vi.mock("@/lib/sets/messages", async () => await import("./messages"));

import { getSetPage } from "./data";

/**
 * PostgREST over the tables given, as far as the loader asks it: a select
 * naming a column the table does not have fails the whole statement, as the
 * real one does before a column's SQL has run.
 */
function fakeDb(tables: Tables): SupabaseClient {
  return {
    from: (table: string) => {
      const t = tables[table];
      if (!t) throw new Error(`no table ${table}`);
      const read = { table, select: "*", filters: [] as [string, string, unknown][] };
      reads.push(read);
      let order: { col: string; asc: boolean } | null = null;
      let limit: number | null = null;
      const run = () => {
        const cols = read.select === "*" ? t.columns : read.select.split(",").map((c) => c.trim());
        const missing = cols.find((c) => !t.columns.includes(c));
        if (missing) return { data: null, error: { message: `column ${table}.${missing} does not exist`, code: "42703" } };
        let out = t.rows.filter((r) =>
          read.filters.every(([col, op, v]) => {
            const x = r[col] ?? null;
            if (op === "eq") return x === v;
            if (op === "in") return (v as unknown[]).includes(x);
            if (op === "is") return x === v;
            throw new Error(`no filter ${op}`);
          }),
        );
        if (order) {
          const { col, asc } = order;
          out = [...out].sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (asc ? 1 : -1));
        }
        if (limit !== null) out = out.slice(0, limit);
        return { data: out.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null]))), error: null };
      };
      const builder = {
        select: (cols: string) => ((read.select = cols), builder),
        eq: (col: string, v: unknown) => (read.filters.push([col, "eq", v]), builder),
        in: (col: string, v: unknown) => (read.filters.push([col, "in", v]), builder),
        is: (col: string, v: unknown) => (read.filters.push([col, "is", v]), builder),
        order: (col: string, o: { ascending: boolean }) => ((order = { col, asc: o.ascending }), builder),
        limit: (n: number) => ((limit = n), builder),
        maybeSingle: async () => {
          const r = run();
          return r.error ? r : { data: r.data?.[0] ?? null, error: null };
        },
        then: (resolve: (v: unknown) => void) => resolve(run()),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

const at = (n: number) => new Date(Date.UTC(2026, 8, 16, 10, n)).toISOString();

/** A still of the set: its generation row and its shot row. */
function still(n: number, over: Row = {}) {
  return {
    gen: { id: gid(n), user_id: USER, status: "succeeded", result_url: `u/${n}.png`, poster_url: null, content_type: "image", video_duration_seconds: null, match_score: 80, created_at: at(n), character_profile_id: PERSON, deleted_at: null, ...over },
    shot: { set_id: SET, generation_id: gid(n), user_id: USER, created_at: at(n), take: null },
  };
}

/** A take of the set from still `start` to still `end`, kept as rendered. */
function take(n: number, status: string, kept: Row | null, over: Row = {}) {
  return {
    gen: { id: gid(n), user_id: USER, status, result_url: status === "succeeded" ? `u/${n}.mp4` : null, poster_url: null, content_type: "video", video_duration_seconds: 8, match_score: null, created_at: at(n), character_profile_id: PERSON, deleted_at: null, ...over },
    shot: { set_id: SET, generation_id: gid(n), user_id: USER, created_at: at(n), take: kept },
  };
}

const keptFrom = (start: number, end: number, over: Row = {}) => ({
  start: gid(start),
  end: gid(end),
  engine: "veo",
  direction: "She turns to the door.",
  film: false,
  ...over,
});

function world(items: { gen: Row; shot: Row }[], opts: { takeColumn?: boolean } = {}): Tables {
  const shotColumns = ["set_id", "generation_id", "user_id", "created_at", "camera", "words", "rig", "rig_check"];
  return {
    location_sets: {
      columns: ["id", "user_id", "title", "description", "brief", "status", "failure", "spec", "layout", "thumb_path", "deleted_at", "source_photo_path", "source_photo_sha256"],
      // Still building: no spec, so no working copy, film or rig is read.
      rows: [{ id: SET, user_id: USER, title: "Cream Corner", description: "", brief: "a cafe", status: "building", failure: null, spec: null, layout: null, thumb_path: null, deleted_at: null }],
    },
    location_set_shots: {
      columns: opts.takeColumn === false ? shotColumns : [...shotColumns, "take"],
      rows: items.map((i) => i.shot),
    },
    generations: {
      columns: ["id", "user_id", "status", "result_url", "poster_url", "content_type", "video_duration_seconds", "match_score", "created_at", "character_profile_id", "deleted_at"],
      rows: items.map((i) => i.gen),
    },
    character_profiles: {
      columns: ["id", "user_id", "name", "reference_image_urls", "created_at"],
      rows: [
        { id: PERSON, user_id: USER, name: "Eva", reference_image_urls: ["eva.jpg"], created_at: at(0) },
        { id: NO_PHOTO, user_id: USER, name: "Sam", reference_image_urls: [], created_at: at(0) },
      ],
    },
    app_settings: { columns: ["key", "value"], rows: [] },
  };
}

async function page(tables: Tables) {
  db = fakeDb(tables);
  const out = await getSetPage(SET);
  if (out.error !== null) throw new Error(out.error);
  return out;
}

async function load(tables: Tables) {
  return new Map((await page(tables)).shots.map((sh) => [sh.generationId, sh]));
}

beforeEach(() => {
  reads = [];
  who = { plan: "studio", isAdmin: false };
  rateHits = [];
  rateReadFails = false;
});

describe("the month's Astra changes, for the editor", () => {
  const ready = (tables: Tables): Tables => {
    tables.location_sets.rows[0] = { ...tables.location_sets.rows[0], status: "ready", spec: raceTrack };
    return tables;
  };

  it("says how many are left since the billing month began", async () => {
    who = { plan: "growth", isAdmin: false, periodStart: "2026-09-05T00:00:00.000Z" };
    rateHits = [
      { scope: SET_EDITS_MONTH_SCOPE, created_at: "2026-09-06T10:00:00.000Z" },
      { scope: SET_EDITS_MONTH_SCOPE, created_at: "2026-09-15T10:00:00.000Z" },
      { scope: SET_EDITS_MONTH_SCOPE, created_at: "2026-09-16T10:00:00.000Z" },
      // Last month's, and another limiter's: not this month's changes.
      { scope: SET_EDITS_MONTH_SCOPE, created_at: "2026-09-04T23:59:59.000Z" },
      { scope: "set-astra-edit", created_at: "2026-09-16T10:00:00.000Z" },
    ];
    expect((await page(ready(world([still(1)])))).astraEditsLeft).toBe(setEditsMonthlyLimit("growth", false) - 3);
    rateHits = Array.from({ length: 40 }, () => ({ scope: SET_EDITS_MONTH_SCOPE, created_at: "2026-09-16T10:00:00.000Z" }));
    expect((await page(ready(world([still(1)])))).astraEditsLeft).toBe(0);
  });

  it("says nothing for an admin, a count it cannot read, or a set still building", async () => {
    who = { plan: "growth", isAdmin: true };
    expect((await page(ready(world([still(1)])))).astraEditsLeft).toBeNull();
    who = { plan: "growth", isAdmin: false };
    rateReadFails = true;
    expect((await page(ready(world([still(1)])))).astraEditsLeft).toBeNull();
    rateReadFails = false;
    expect((await page(world([still(1)]))).astraEditsLeft).toBeNull();
  });
});

describe("whether the page offers takes", () => {
  it("offers them by the takes rule — every plan that can enter Helios (set-config.ts setTakesEligible, 2026-09-19)", async () => {
    // While SETS_OPEN_TO_PLANS is false that is admins only; at the flip it
    // becomes every paid plan. The expectation follows the rule, not a list,
    // so this test holds on both sides of the launch commit.
    for (const [plan, isAdmin] of [
      ["studio", false],
      ["elite", false],
      ["growth", true],
      ["growth", false],
      ["starter", false],
      ["basic", false],
    ] as const) {
      who = { plan, isAdmin };
      expect((await page(world([still(1)]))).takesOn, `${plan}${isAdmin ? " (admin)" : ""}`).toBe(setTakesEligible(plan, isAdmin));
    }
  });
});

// A stored media link carries the signature it was written under; every
// page but this one signed it again under today's key (toMediaUrl), so the
// set page's stills, takes and posters would all stop loading the day the
// key is changed — and a film could not be downloaded (2026-09-16).
describe("the set page's pictures and clips", () => {
  it("are signed again under today's key, whatever key they were stored under", async () => {
    const old = (bucket: string, path: string) => `/api/media/${bucket}/${path}?v=signed-under-an-old-key`;
    const expired = "https://abc.supabase.co/storage/v1/object/sign/generated-images/user/s2.png?token=expired";
    const shots = await load(
      world([
        still(1, { result_url: old("generated-images", "user/s1.png") }),
        still(2, { result_url: expired }),
        take(3, "succeeded", null, { result_url: old("generated-videos", "user/t3.mp4"), poster_url: old("generated-images", "user/p3.jpg") }),
      ]),
    );
    expect(shots.get(gid(1))?.resultUrl).toBe(thumbUrl(mediaUrl("generated-images", "user/s1.png"), 640));
    expect(shots.get(gid(1))?.viewUrl).toBe(thumbUrl(mediaUrl("generated-images", "user/s1.png"), 1600));
    expect(shots.get(gid(2))?.resultUrl).toBe(thumbUrl(mediaUrl("generated-images", "user/s2.png"), 640));
    expect(shots.get(gid(3))?.resultUrl).toBe(mediaUrl("generated-videos", "user/t3.mp4"));
    expect(shots.get(gid(3))?.posterUrl).toBe(thumbUrl(mediaUrl("generated-images", "user/p3.jpg"), 640));
    expect(mediaUrl("generated-videos", "user/t3.mp4")).not.toContain("signed-under-an-old-key");
  });
});

describe("a take on the set page", () => {
  it("carries its two stills, person, engine and direction while the clip can be rendered again", async () => {
    const shots = await load(world([still(1), still(2), take(3, "failed", keptFrom(1, 2)), take(4, "generating", keptFrom(1, 2, { engine: "omni" }))]));
    expect(shots.get(gid(3))?.takeFrom).toEqual({
      start: gid(1),
      end: gid(2),
      characterId: PERSON,
      direction: "She turns to the door.",
      engine: "veo",
    });
    // One still rendering now may fail while the page is open.
    expect(shots.get(gid(4))?.takeFrom?.engine).toBe("omni");
    // The stills themselves carry none.
    expect(shots.get(gid(1))?.takeFrom).toBeNull();
  });

  it("carries nothing for a film's beat, a still that is gone or failed, or a person who cannot be shot", async () => {
    const shots = await load(
      world([
        still(1),
        still(2),
        still(5, { deleted_at: at(30) }),
        still(6, { status: "failed" }),
        take(10, "failed", keptFrom(1, 2, { film: true })),
        take(11, "failed", keptFrom(1, 5)),
        take(12, "failed", keptFrom(6, 2)),
        take(13, "failed", keptFrom(1, 2), { character_profile_id: NO_PHOTO }),
        take(14, "failed", keptFrom(1, 2), { character_profile_id: null }),
        take(15, "failed", null),
        // A still id that is no still of the person's at all.
        take(16, "failed", keptFrom(1, 99)),
      ]),
    );
    for (const n of [10, 11, 12, 13, 14, 15, 16]) expect(shots.get(gid(n))?.takeFrom, `take ${n}`).toBeNull();
    // The stills are looked up once, as the person, and only the ones a take of its own names.
    const stillReads = reads.filter((r) => r.table === "generations" && r.select === "id");
    expect(stillReads).toHaveLength(1);
    const asked = stillReads[0].filters.find(([col]) => col === "id")?.[2] as string[];
    expect([...asked].sort()).toEqual([gid(1), gid(2), gid(5), gid(6), gid(99)].sort());
    expect(stillReads[0].filters).toEqual(
      expect.arrayContaining([
        ["user_id", "eq", USER],
        ["status", "eq", "succeeded"],
        ["content_type", "eq", "image"],
        ["deleted_at", "is", null],
      ]),
    );
  });

  it("does not look for what a finished take was rendered from", async () => {
    const shots = await load(world([still(1), still(2), take(3, "succeeded", keptFrom(1, 2))]));
    expect(shots.get(gid(3))?.takeFrom).toBeNull();
    expect(reads.some((r) => r.table === "location_set_shots" && r.select.includes("take"))).toBe(false);
    expect(reads.some((r) => r.table === "generations" && r.select === "id")).toBe(false);
  });

  it("loads the page as before when the column is not there yet", async () => {
    const tables = world([still(1), still(2), take(3, "failed", keptFrom(1, 2))], { takeColumn: false });
    const shots = await load(tables);
    expect([...shots.keys()]).toEqual([gid(3), gid(2), gid(1)]);
    expect(shots.get(gid(3))?.status).toBe("failed");
    expect(shots.get(gid(3))?.takeFrom).toBeNull();
  });
});
