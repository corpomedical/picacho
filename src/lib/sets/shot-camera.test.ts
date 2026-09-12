import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import showroomOpen from "./fixtures-showroom-open.json";
import { readShotCameras, recordShotCamera, shotCameraOf } from "./shot-camera";
import { normaliseSetLayout, normaliseSetSpec } from "./set-spec";

// The camera each Set shot was framed from (2026-09-12). Until
// set-shot-camera.sql runs, the column does not exist and PostgREST fails
// any statement that names it — so shots must work exactly as before, and
// every read of it must come back as "no camera", never as a failure.

vi.spyOn(console, "warn").mockImplementation(() => {});

const USER = "11111111-1111-4111-8111-111111111111";
const SET = "22222222-2222-4222-8222-222222222222";
const G1 = "33333333-3333-4333-8333-333333333333";
const G2 = "44444444-4444-4444-8444-444444444444";
const POSE = { position: [-3.67, 1.89, 4.69] as [number, number, number], target: [-0.36, 1.13, 1.03] as [number, number, number], fovDeg: 44.7 };
const MARK = { x: 1.39, z: 2.37, facingDeg: 230 };
// What the page sends with a shot: the layout it saves, with the stage's pose as its camera.
const LAYOUT = { markId: "m2", mark: MARK, camera: POSE };
const CAMERA = { ...POSE, canvasAspect: 1.6, figure: { x: MARK.x, z: MARK.z } };

/** A PostgREST stand-in: every filter returns the builder and is recorded; awaiting it returns the answer. */
function fakeDb(answer: () => Promise<{ data: unknown; error: { code?: string; message: string } | null }>) {
  const calls: { m: string; args: unknown[] }[] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "update"]) {
    builder[m] = (...args: unknown[]) => (calls.push({ m, args }), builder);
  }
  builder.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => answer().then(resolve, reject);
  const db = { from: (t: string) => (calls.push({ m: "from", args: [t] }), builder) } as unknown as SupabaseClient;
  return { db, calls };
}

describe("shotCameraOf", () => {
  it("is the stage's pose, the figure's mark and the canvas's shape as the page sent them, as a read gives them back", () => {
    expect(shotCameraOf(LAYOUT, 1.6)).toEqual(CAMERA);
  });

  it("keeps a pose the saved layout would move: the frame was drawn from it, not from the layout's copy", () => {
    // The showroom's layout holds a camera to its bounds plus 10 m (z ≤ 20)
    // and never below 0.2 m; the stage's orbit reaches 38.8 m from its
    // target and floors only at 0.1 m. Scrolled out to z 30 with the 135 mm
    // lens, the frame sees the car at two thirds of the size a camera at z
    // 20 would.
    const n = normaliseSetSpec(showroomOpen);
    if (!n.ok) throw new Error("the showroom fixture no longer normalises");
    for (const position of [[0, 1.6, 30], [0, 0.12, 6]] as [number, number, number][]) {
      const sent = { markId: n.spec.marks[0].id, mark: { x: 1.8, z: 1.3, facingDeg: 0 }, camera: { position, target: [0, 0.8, 0], fovDeg: 10.16 } };
      expect(normaliseSetLayout(sent, n.spec)?.camera?.position, "the layout moves it").not.toEqual(position);
      expect(shotCameraOf(sent, 16 / 9)).toEqual({ position, target: [0, 0.8, 0], fovDeg: 10.16, canvasAspect: 16 / 9, figure: { x: 1.8, z: 1.3 } });
    }
  });

  it("is nothing without the pose, the mark or the canvas's shape: such a still is never a look's source", () => {
    for (const bad of [null, undefined, "layout", [], { mark: MARK }, { camera: POSE }, { ...LAYOUT, mark: { x: 1 } }, { ...LAYOUT, camera: [POSE] }]) {
      expect(shotCameraOf(bad, 1.6), JSON.stringify(bad)).toBeNull();
    }
    for (const bad of [undefined, null, "1.6", Number.NaN, 0, -1]) expect(shotCameraOf(LAYOUT, bad)).toBeNull();
  });

  it("records nothing, rather than a camera moved to fit, for a pose no stage can have", () => {
    expect(shotCameraOf({ ...LAYOUT, camera: { ...POSE, fovDeg: 5 } }, 1.6)).toBeNull();
    expect(shotCameraOf({ ...LAYOUT, camera: { ...POSE, position: [0, 1.6, 900] } }, 1.6)).toBeNull();
    expect(shotCameraOf(LAYOUT, 40)).toBeNull();
  });
});

describe("recordShotCamera", () => {
  it("writes the camera onto the shot's own row, in an update of its own", async () => {
    const f = fakeDb(async () => ({ data: [{ generation_id: G1 }], error: null }));
    expect(await recordShotCamera(f.db, { setId: SET, generationId: G1, userId: USER }, CAMERA)).toBe(true);
    expect(f.calls).toEqual([
      { m: "from", args: ["location_set_shots"] },
      { m: "update", args: [{ camera: CAMERA }] },
      { m: "eq", args: ["set_id", SET] },
      { m: "eq", args: ["generation_id", G1] },
      { m: "eq", args: ["user_id", USER] },
      { m: "select", args: ["generation_id"] },
    ]);
  });

  it("before set-shot-camera.sql, or on any failure, says false and never throws", async () => {
    const missing = fakeDb(async () => ({ data: null, error: { code: "PGRST204", message: "Could not find the 'camera' column" } }));
    expect(await recordShotCamera(missing.db, { setId: SET, generationId: G1, userId: USER }, CAMERA)).toBe(false);
    const none = fakeDb(async () => ({ data: [], error: null }));
    expect(await recordShotCamera(none.db, { setId: SET, generationId: G1, userId: USER }, CAMERA)).toBe(false);
    const throws = fakeDb(async () => {
      throw new Error("network");
    });
    expect(await recordShotCamera(throws.db, { setId: SET, generationId: G1, userId: USER }, CAMERA)).toBe(false);
  });
});

describe("readShotCameras", () => {
  it("reads the set's own shots' cameras, keeping only those that normalise", async () => {
    const f = fakeDb(async () => ({
      data: [
        { generation_id: G1, camera: CAMERA },
        { generation_id: G2, camera: null },
        { generation_id: "55555555-5555-4555-8555-555555555555", camera: { ...POSE, canvasAspect: 1.6 } },
        { generation_id: 42, camera: CAMERA },
      ],
      error: null,
    }));
    const got = await readShotCameras(f.db, SET, USER, [G1, G2]);
    expect([...got.keys()]).toEqual([G1]);
    expect(got.get(G1)).toEqual(CAMERA);
    expect(f.calls).toContainEqual({ m: "select", args: ["generation_id, camera"] });
    expect(f.calls).toContainEqual({ m: "eq", args: ["set_id", SET] });
    expect(f.calls).toContainEqual({ m: "eq", args: ["user_id", USER] });
    expect(f.calls).toContainEqual({ m: "in", args: ["generation_id", [G1, G2]] });
  });

  it("fails open: the column missing, any other failure, or a throw is no camera at all", async () => {
    for (const error of [
      { code: "42703", message: "column location_set_shots.camera does not exist" },
      { code: "PGRST000", message: "Could not connect with the database" },
    ]) {
      expect((await readShotCameras(fakeDb(async () => ({ data: null, error })).db, SET, USER)).size).toBe(0);
    }
    const throws = fakeDb(async () => {
      throw new Error("network");
    });
    expect((await readShotCameras(throws.db, SET, USER, [G1])).size).toBe(0);
  });

  it("asks nothing for no shots", async () => {
    const f = fakeDb(async () => {
      throw new Error("not called");
    });
    expect((await readShotCameras(f.db, SET, USER, [])).size).toBe(0);
    expect(f.calls).toEqual([]);
  });
});

describe("no other query names the column", () => {
  const SRC = join(__dirname, "..", "..");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return walk(p);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
    });

  it("every other statement on location_set_shots — reads, the insert, the lookups — names only the columns every version has", () => {
    // Each statement from .from("location_set_shots") to the end of its
    // expression; shot-camera.ts is the one place allowed to name `camera`.
    const offenders: string[] = [];
    let statements = 0;
    for (const file of walk(SRC)) {
      if (file.endsWith(join("sets", "shot-camera.ts"))) continue;
      const source = readFileSync(file, "utf8");
      for (const m of source.matchAll(/\.from\(\s*["']location_set_shots["']\s*\)/g)) {
        const rest = source.slice(m.index ?? 0);
        const end = rest.search(/;|\n\s*\n/);
        const statement = rest.slice(0, end < 0 ? undefined : end);
        statements += 1;
        if (/\bcamera\b/.test(statement)) offenders.push(`${relative(SRC, file)}: ${statement.slice(0, 120)}`);
      }
    }
    // The scan saw the shot action's, the page's and the cleanup's statements.
    expect(statements).toBeGreaterThanOrEqual(4);
    expect(offenders).toEqual([]);
  });
});
