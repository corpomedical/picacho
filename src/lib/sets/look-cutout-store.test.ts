import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import raceTrack from "./fixtures-race-track.json";
import { lookCutout, removeLookCutoutsOf, removeSetLookCutouts } from "./look-cutout-store";
import { lookCutoutBoxes, type ShotCamera } from "./look-cutout";
import { setLookCutoutPath, setLookCutoutPrefix, setPhotoPath, setThumbPath } from "./set-config";
import { normaliseSetSpec } from "./set-spec";

// A look's cutout is made once and kept (2026-09-12): every way it can fail
// is a reason for the shot to go without its look, never a throw, and never
// the whole still in its place. Storage and SAM 2 are fakes: nothing is
// uploaded and nothing is called.

vi.spyOn(console, "warn").mockImplementation(() => {});

type SharpFn = (typeof import("sharp"))["default"];
let sharp: SharpFn | null = null;
try {
  sharp = (await import("sharp")).default;
} catch {
  sharp = null;
}

const USER = "11111111-1111-4111-8111-111111111111";
const SET = "22222222-2222-4222-8222-222222222222";
const LOOK = "33333333-3333-4333-8333-333333333333";
const STILL_PATH = `${USER}/${LOOK}.png`;
const CUTOUT = setLookCutoutPath(USER, SET, LOOK);
const spec = (() => {
  const n = normaliseSetSpec(raceTrack);
  if (!n.ok) throw new Error("the race-track fixture no longer normalises");
  return n.spec;
})();
// Still 1's camera (look-cutout.test.ts says where it comes from).
const CAMERA: ShotCamera = { position: [-3.674, 1.894, 4.691], target: [-0.361, 1.128, 1.025], fovDeg: 44.7, canvasAspect: 16 / 9 };

type Storage = {
  exists?: (path: string) => Promise<{ data: boolean; error: unknown }>;
  download?: (path: string) => Promise<{ data: Blob | null; error: unknown }>;
  upload?: (path: string, body: Buffer, opts: unknown) => Promise<{ error: unknown }>;
  list?: (folder: string, opts: { limit: number; offset: number; search: string }) => Promise<{ data: { name: string }[] | null; error: unknown }>;
  remove?: (paths: string[]) => Promise<{ error: unknown }>;
};

function fakeAdmin(storage: Storage, rows?: () => Promise<{ data: unknown; error: unknown }>) {
  const calls: { op: string; args: unknown[] }[] = [];
  const record =
    <A extends unknown[], R>(op: string, fn: ((...a: A) => Promise<R>) | undefined, fallback: R) =>
    async (...args: A) => {
      calls.push({ op, args });
      return fn ? fn(...args) : fallback;
    };
  const bucket = {
    exists: record("exists", storage.exists, { data: false, error: { status: 404 } }),
    download: record("download", storage.download, { data: null, error: { message: "not found" } }),
    upload: record("upload", storage.upload, { error: null }),
    list: record("list", storage.list, { data: [], error: null }),
    remove: record("remove", storage.remove, { error: null }),
  };
  const query: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in"]) query[m] = () => query;
  query.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    (rows ?? (async () => ({ data: [], error: null })))().then(resolve, reject);
  const admin = {
    storage: { from: (b: string) => (calls.push({ op: "bucket", args: [b] }), bucket) },
    from: (t: string) => (calls.push({ op: "table", args: [t] }), query),
  } as unknown as SupabaseClient;
  return { admin, calls, ops: () => calls.map((c) => c.op).filter((op) => op !== "bucket" && op !== "table") };
}

const blob = (b: Buffer) => new Blob([new Uint8Array(b)]);

async function stillPng(): Promise<Buffer> {
  return sharp!({ create: { width: 256, height: 256, channels: 3, background: { r: 70, g: 90, b: 110 } } }).png().toBuffer();
}

/** What SAM 2 answers: the 256² still with everything outside `kept` at alpha 0. */
async function samAnswer(kept: (x: number, y: number) => boolean): Promise<Buffer> {
  const raw = Buffer.alloc(256 * 256 * 4);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const i = (y * 256 + x) * 4;
      raw.set([200, 20, 30, kept(x, y) ? 255 : 0], i);
    }
  }
  return sharp!(raw, { raw: { width: 256, height: 256, channels: 4 } }).png().toBuffer();
}

const input = (admin: SupabaseClient, over: Partial<Parameters<typeof lookCutout>[0]> = {}) => ({
  admin,
  userId: USER,
  setId: SET,
  lookGenerationId: LOOK,
  stillPath: STILL_PATH,
  spec,
  camera: CAMERA,
  ...over,
});

describe("lookCutout", () => {
  it("reuses a kept cutout: nothing downloaded, nothing cut", async () => {
    const f = fakeAdmin({ exists: async (p) => ({ data: p === CUTOUT, error: null }) });
    const segment = vi.fn();
    expect(await lookCutout(input(f.admin), { segment })).toEqual({ ok: true, path: CUTOUT, made: false });
    expect(f.ops()).toEqual(["exists"]);
    expect(segment).not.toHaveBeenCalled();
  });

  it("keeps each cutout at the set's own name for that still, in the owner's folder", () => {
    expect(CUTOUT).toBe(`${USER}/sets/${SET}.look-${LOOK}.jpg`);
    expect(CUTOUT.startsWith(`${USER}/sets/${setLookCutoutPrefix(SET)}`)).toBe(true);
  });

  it("without the still's camera there is nothing to cut from: no look", async () => {
    const f = fakeAdmin({});
    const segment = vi.fn();
    expect(await lookCutout(input(f.admin, { camera: null }), { segment })).toEqual({ ok: false, reason: "no camera" });
    expect(f.ops()).toEqual(["exists"]);
    expect(segment).not.toHaveBeenCalled();
  });

  it("a still that cannot be read is no look", async () => {
    const segment = vi.fn();
    expect(await lookCutout(input(fakeAdmin({}).admin), { segment })).toEqual({ ok: false, reason: "storage" });
    const throws = fakeAdmin({ download: async () => { throw new Error("network"); } });
    expect(await lookCutout(input(throws.admin), { segment })).toEqual({ ok: false, reason: "storage" });
    const garbage = fakeAdmin({ download: async () => ({ data: blob(Buffer.from("not a picture")), error: null }) });
    expect(await lookCutout(input(garbage.admin), { segment })).toEqual({ ok: false, reason: "still unreadable" });
    expect(segment).not.toHaveBeenCalled();
  });

  describe.skipIf(!sharp)("with a still to cut", () => {
    it("cuts the objects the still's camera saw, lays them on grey and keeps them — never overwriting", async () => {
      const still = await stillPng();
      const uploads: { path: string; body: Buffer; opts: unknown }[] = [];
      const f = fakeAdmin({
        download: async (p) => ({ data: p === STILL_PATH ? blob(still) : null, error: p === STILL_PATH ? null : { message: "no" } }),
        upload: async (path, body, opts) => (uploads.push({ path, body, opts }), { error: null }),
      });
      const segment = vi.fn(async () => samAnswer((x, y) => x >= 40 && x < 200 && y >= 90 && y < 220));
      expect(await lookCutout(input(f.admin), { segment })).toEqual({ ok: true, path: CUTOUT, made: true });
      // SAM 2 got the still's own bytes and the boxes for a still that size.
      expect(segment).toHaveBeenCalledTimes(1);
      const [sent, boxes] = segment.mock.calls[0] as unknown as [Buffer, unknown];
      expect(sent.equals(still)).toBe(true);
      expect(boxes).toEqual(lookCutoutBoxes(spec, CAMERA, { width: 256, height: 256 }).boxes);
      // What is kept is the cutout — a JPEG of the kept block and its margin — not the still.
      expect(uploads).toHaveLength(1);
      expect(uploads[0].path).toBe(CUTOUT);
      expect(uploads[0].opts).toEqual({ contentType: "image/jpeg", upsert: false });
      const meta = await sharp!(uploads[0].body).metadata();
      expect(meta.format).toBe("jpeg");
      // The 160 × 130 block and 8 px on each side (3% of 256).
      expect([meta.width, meta.height]).toEqual([176, 146]);
    });

    it("a camera that saw no objects is no look, and SAM 2 is never asked", async () => {
      const still = await stillPng();
      const f = fakeAdmin({ download: async () => ({ data: blob(still), error: null }) });
      const segment = vi.fn();
      const sky: ShotCamera = { position: [0, 1.6, 20], target: [0, 30, 60], fovDeg: 40, canvasAspect: 16 / 9 };
      expect(await lookCutout(input(f.admin, { camera: sky }), { segment })).toEqual({ ok: false, reason: "no objects in view" });
      expect(segment).not.toHaveBeenCalled();
      expect(f.ops()).not.toContain("upload");
    });

    it("SAM 2 failing, finding nothing, or taking the whole frame is no look — and nothing is kept", async () => {
      const still = await stillPng();
      const cases: [() => Promise<Buffer | null>, string][] = [
        [async () => null, "cut failed"],
        [async () => Buffer.from("not a png"), "cut failed"],
        [() => samAnswer(() => false), "empty mask"],
        [() => samAnswer((x) => x < 250), "mask took the whole frame"],
      ];
      for (const [segment, reason] of cases) {
        const f = fakeAdmin({ download: async () => ({ data: blob(still), error: null }) });
        expect(await lookCutout(input(f.admin), { segment })).toEqual({ ok: false, reason });
        expect(f.ops()).not.toContain("upload");
      }
    });

    it("a refused upload is fine when a shot beside it kept one first, and no look when nothing was kept", async () => {
      const still = await stillPng();
      const segment = async () => samAnswer((x, y) => x >= 40 && x < 200 && y >= 90 && y < 220);
      let kept = false;
      const raced = fakeAdmin({
        exists: async () => ({ data: kept, error: null }),
        download: async () => ({ data: blob(still), error: null }),
        upload: async () => ((kept = true), { error: { message: "The resource already exists" } }),
      });
      expect(await lookCutout(input(raced.admin), { segment })).toEqual({ ok: true, path: CUTOUT, made: true });
      const broken = fakeAdmin({
        download: async () => ({ data: blob(still), error: null }),
        upload: async () => ({ error: { message: "storage down" } }),
      });
      expect(await lookCutout(input(broken.admin), { segment })).toEqual({ ok: false, reason: "storage" });
    });
  });
});

describe("removing cutouts", () => {
  it("deleting a set removes every cutout of that set, and nothing else in the folder", async () => {
    const other = "44444444-4444-4444-8444-444444444444";
    const removed: string[][] = [];
    const lists: unknown[] = [];
    const f = fakeAdmin({
      list: async (folder, opts) => (
        lists.push({ folder, ...opts }),
        {
          data: [
            { name: `${SET}.look-${LOOK}.jpg` },
            { name: `${SET}.look-55555555-5555-4555-8555-555555555555.jpg` },
            { name: setThumbPath(USER, SET).split("/").pop()! },
            { name: setPhotoPath(USER, SET).split("/").pop()! },
            { name: `${other}.look-${LOOK}.jpg` },
          ],
          error: null,
        }
      ),
      remove: async (paths) => (removed.push(paths), { error: null }),
    });
    await removeSetLookCutouts(f.admin, USER, SET);
    expect(lists).toEqual([{ folder: `${USER}/sets`, limit: 1000, offset: 0, search: `${SET}.look-` }]);
    expect(removed).toEqual([[`${USER}/sets/${SET}.look-${LOOK}.jpg`, `${USER}/sets/${SET}.look-55555555-5555-4555-8555-555555555555.jpg`]]);
  });

  it("never throws, and removes nothing when the folder cannot be listed", async () => {
    const f = fakeAdmin({ list: async () => ({ data: null, error: { message: "down" } }) });
    await expect(removeSetLookCutouts(f.admin, USER, SET)).resolves.toBeUndefined();
    expect(f.ops()).not.toContain("remove");
    const throws = fakeAdmin({ list: async () => { throw new Error("network"); } });
    await expect(removeSetLookCutouts(throws.admin, USER, SET)).resolves.toBeUndefined();
  });

  it("deleting a still removes the cutouts cut from it, in each set it was shot in", async () => {
    const other = "44444444-4444-4444-8444-444444444444";
    const removed: string[][] = [];
    const f = fakeAdmin(
      { remove: async (paths) => (removed.push(paths), { error: null }) },
      async () => ({ data: [{ set_id: SET, generation_id: LOOK }, { set_id: other, generation_id: LOOK }, { set_id: null, generation_id: LOOK }], error: null }),
    );
    await removeLookCutoutsOf(f.admin, USER, [LOOK]);
    expect(removed).toEqual([[setLookCutoutPath(USER, SET, LOOK), setLookCutoutPath(USER, other, LOOK)]]);
    // Nothing to look up for no stills; a failed read removes nothing and never throws.
    const none = fakeAdmin({});
    await removeLookCutoutsOf(none.admin, USER, []);
    expect(none.calls).toEqual([]);
    const failed = fakeAdmin({}, async () => { throw new Error("down"); });
    await expect(removeLookCutoutsOf(failed.admin, USER, [LOOK])).resolves.toBeUndefined();
    expect(failed.ops()).not.toContain("remove");
  });
});
