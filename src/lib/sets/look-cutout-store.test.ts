import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import raceTrack from "./fixtures-race-track.json";
import type { segmentObject } from "../generations/providers/fal-segment";
import { lookCutout, removeLookCutoutsOf, removeSetLookCutouts } from "./look-cutout-store";
import { lookCuts, type ShotCamera } from "./look-cutout";
import { setLookCutoutPath, setLookCutoutPrefix, setPhotoPath, setThumbPath } from "./set-config";
import { normaliseSetSpec, type SetObject } from "./set-spec";

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
// Still 1's camera and figure (look-cutout.test.ts says where they come from).
const CAMERA: ShotCamera = {
  position: [-3.674, 1.894, 4.691],
  target: [-0.361, 1.128, 1.025],
  fovDeg: 44.7,
  canvasAspect: 16 / 9,
  figure: { x: 1.39, z: 2.37 },
};

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
// The vision reader, faked: it sees nobody unless a test says otherwise.
const people = async () => [] as { u0: number; v0: number; u1: number; v1: number }[];

async function stillPng(): Promise<Buffer> {
  return sharp!({ create: { width: 256, height: 256, channels: 3, background: { r: 70, g: 90, b: 110 } } }).png().toBuffer();
}

/** What SAM 2 answers: the 256² still with everything outside `kept` at alpha 0 (red, and green where `green` says). */
async function samAnswer(kept: (x: number, y: number) => boolean, green: (x: number, y: number) => boolean = () => false): Promise<Buffer> {
  const raw = Buffer.alloc(256 * 256 * 4);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const i = (y * 256 + x) * 4;
      raw.set([...(green(x, y) ? [20, 200, 30] : [200, 20, 30]), kept(x, y) ? 255 : 0], i);
    }
  }
  return sharp!(raw, { raw: { width: 256, height: 256, channels: 4 } }).png().toBuffer();
}

// Still 1's objects, and its person beside them where GPT Image drew them
// (about x 800–1010, y 280–965 of 1024), in a 256² still.
const carBlock = (x: number, y: number) => x >= 40 && x < 170 && y >= 90 && y < 220;
const personBlock = (x: number, y: number) => x >= 200 && x < 252 && y >= 70 && y < 241;

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
    expect(await lookCutout(input(f.admin), { segment, people })).toEqual({ ok: true, path: CUTOUT, made: false });
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
    expect(await lookCutout(input(f.admin, { camera: null }), { segment, people })).toEqual({ ok: false, reason: "no camera" });
    expect(f.ops()).toEqual(["exists"]);
    expect(segment).not.toHaveBeenCalled();
  });

  it("a still that cannot be read is no look", async () => {
    const segment = vi.fn();
    expect(await lookCutout(input(fakeAdmin({}).admin), { segment, people })).toEqual({ ok: false, reason: "storage" });
    const throws = fakeAdmin({ download: async () => { throw new Error("network"); } });
    expect(await lookCutout(input(throws.admin), { segment, people })).toEqual({ ok: false, reason: "storage" });
    const garbage = fakeAdmin({ download: async () => ({ data: blob(Buffer.from("not a picture")), error: null }) });
    expect(await lookCutout(input(garbage.admin), { segment, people })).toEqual({ ok: false, reason: "still unreadable" });
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
      const segment = vi.fn(async () => samAnswer(carBlock));
      expect(await lookCutout(input(f.admin), { segment, people })).toEqual({ ok: true, path: CUTOUT, made: true });
      // SAM 2 got the still's own bytes and the one object's box and point for a still that size.
      const { cuts } = lookCuts(spec, CAMERA, { width: 256, height: 256 });
      expect(cuts).toHaveLength(1);
      expect(segment).toHaveBeenCalledTimes(1);
      const [sent, box, point] = segment.mock.calls[0] as unknown as [Buffer, unknown, unknown];
      expect(sent.equals(still)).toBe(true);
      expect(box).toEqual(cuts[0].box);
      expect(point).toEqual(cuts[0].point);
      // What is kept is the cutout — a JPEG of the kept block and its margin — not the still.
      expect(uploads).toHaveLength(1);
      expect(uploads[0].path).toBe(CUTOUT);
      expect(uploads[0].opts).toEqual({ contentType: "image/jpeg", upsert: false });
      const meta = await sharp!(uploads[0].body).metadata();
      expect(meta.format).toBe("jpeg");
      // The 130 × 130 block and 8 px on each side (3% of 256).
      expect([meta.width, meta.height]).toEqual([146, 146]);
    });

    it("cuts a lab still's look from its negative, the frame before the lab — never the developed print", async () => {
      const print = await sharp!({ create: { width: 256, height: 256, channels: 3, background: { r: 128, g: 128, b: 128 } } }).png().toBuffer();
      const negative = await sharp!({ create: { width: 256, height: 256, channels: 3, background: { r: 70, g: 90, b: 110 } } }).jpeg().toBuffer();
      const NEGATIVE_PATH = `${USER}/negatives/${LOOK}.jpg`;
      const f = fakeAdmin({
        download: async (p) =>
          p === NEGATIVE_PATH ? { data: blob(negative), error: null } : p === STILL_PATH ? { data: blob(print), error: null } : { data: null, error: { message: "no" } },
      });
      const segment = vi.fn(async () => samAnswer(carBlock));
      expect(await lookCutout(input(f.admin), { segment, people })).toEqual({ ok: true, path: CUTOUT, made: true });
      const [sent] = segment.mock.calls[0] as unknown as [Buffer];
      expect(sent.equals(negative)).toBe(true);
      // The still itself was never fetched: the negative was there.
      expect(f.calls.filter((c) => c.op === "download").map((c) => c.args[0])).toEqual([NEGATIVE_PATH]);
    });

    it("two objects: one request each, laid together — and one of them failing is no look, with nothing kept", async () => {
      const still = await stillPng();
      // Two props apart, the figure far down the left of the frame, small and clear of both.
      const prop = (x: number): SetObject => ({
        shape: "box", position: [x, 0.5, 0], size: [1.5, 1, 1], rotation: [0, 0, 0], color: "#808080", roughness: 0.8, metalness: 0,
        emissive: null, emissiveIntensity: 0, castShadow: true, repeat: null,
      });
      const two = { objects: [prop(-2), prop(2)], bounds: { height: 12 } };
      const camera: ShotCamera = { position: [0, 1.6, 8], target: [0, 1, 0], fovDeg: 50, canvasAspect: 16 / 9, figure: { x: -9, z: -30 } };
      const { cuts } = lookCuts(two, camera, { width: 256, height: 256 });
      expect(cuts.map((c) => c.object).sort()).toEqual([0, 1]);
      // Each answer is its own block of the still; the cutout spans both.
      const leftBlock = (x: number, y: number) => x >= 40 && x < 100 && y >= 90 && y < 150;
      const rightBlock = (x: number, y: number) => x >= 150 && x < 210 && y >= 90 && y < 150;
      const uploads: Buffer[] = [];
      const f = fakeAdmin({
        download: async () => ({ data: blob(still), error: null }),
        upload: async (_path, body) => (uploads.push(body), { error: null }),
      });
      const segment = vi.fn<typeof segmentObject>(async (_still, box) => samAnswer(box.x_min === cuts[0].box.x_min ? leftBlock : rightBlock));
      expect(await lookCutout(input(f.admin, { spec: two, camera }), { segment, people })).toEqual({ ok: true, path: CUTOUT, made: true });
      expect(segment).toHaveBeenCalledTimes(2);
      expect(segment.mock.calls.map((c) => [c[1], c[2]])).toEqual(cuts.map((c) => [c.box, c.point]));
      const meta = await sharp!(uploads[0]).metadata();
      expect([meta.width, meta.height]).toEqual([210 - 40 + 16, 150 - 90 + 16]);
      // The second object's cut failing: no look, nothing kept, every object tried again next time.
      const broken = fakeAdmin({ download: async () => ({ data: blob(still), error: null }) });
      let calls = 0;
      const half = async () => (calls++ === 0 ? samAnswer(leftBlock) : null);
      expect(await lookCutout(input(broken.admin, { spec: two, camera }), { people, segment: half })).toEqual({ ok: false, reason: "cut failed" });
      expect(calls).toBe(2);
      expect(broken.ops()).not.toContain("upload");
    });

    it("keeps nothing of the person, whatever SAM 2 took in with the car", async () => {
      const still = await stillPng();
      const uploads: Buffer[] = [];
      const f = fakeAdmin({
        download: async () => ({ data: blob(still), error: null }),
        upload: async (_path, body) => (uploads.push(body), { error: null }),
      });
      // SAM 2 answers with the car and the person beside it in one mask.
      const segment = async () => samAnswer((x, y) => carBlock(x, y) || personBlock(x, y), personBlock);
      expect(await lookCutout(input(f.admin), { segment, people })).toEqual({ ok: true, path: CUTOUT, made: true });
      // The person's region, from the camera and figure recorded with the still, covers them.
      const { people: regions } = lookCuts(spec, CAMERA, { width: 256, height: 256 });
      expect(regions[0].u0 * 256).toBeLessThanOrEqual(200);
      expect(regions[0].v0 * 256).toBeLessThanOrEqual(70);
      expect(regions[0].v1 * 256).toBeGreaterThanOrEqual(241);
      // What is kept is the car alone, cropped as if the person had never been in the mask, and nowhere green.
      const { data, info } = await sharp!(uploads[0]).raw().toBuffer({ resolveWithObject: true });
      expect([info.width, info.height]).toEqual([146, 146]);
      for (let i = 0; i < data.length; i += info.channels) {
        expect(data[i + 1] - Math.max(data[i], data[i + 2]), `pixel ${i / info.channels}`).toBeLessThan(40);
      }
    });

    it("a person the vision reader found in the still is cleared too, wherever the figure stood — and not knowing where the people are is no look", async () => {
      const still = await stillPng();
      // The reader sees a person at the left edge of the frame, far from
      // still 1's figure at the right, and clear of the car block (from x 40).
      const foundBlock = (x: number, y: number) => x >= 0 && x < 30 && y >= 60 && y < 240;
      const found = [{ u0: 0, v0: 60 / 256, u1: 30 / 256, v1: 240 / 256 }];
      const uploads: Buffer[] = [];
      const f = fakeAdmin({
        download: async () => ({ data: blob(still), error: null }),
        upload: async (_path, body) => (uploads.push(body), { error: null }),
      });
      // SAM 2 answers with the car and that person in one mask.
      const segment = async () => samAnswer((x, y) => carBlock(x, y) || foundBlock(x, y), foundBlock);
      const seen = vi.fn(async () => found);
      expect(await lookCutout(input(f.admin), { segment, people: seen })).toEqual({ ok: true, path: CUTOUT, made: true });
      // Asked once, with the still's own bytes and kind.
      expect(seen).toHaveBeenCalledTimes(1);
      expect((seen.mock.calls[0] as unknown as [Buffer, string])[0].equals(still)).toBe(true);
      expect((seen.mock.calls[0] as unknown as [Buffer, string])[1]).toBe("image/png");
      // What is kept is the car alone, and nowhere green.
      const { data, info } = await sharp!(uploads[0]).raw().toBuffer({ resolveWithObject: true });
      expect([info.width, info.height]).toEqual([146, 146]);
      for (let i = 0; i < data.length; i += info.channels) {
        expect(data[i + 1] - Math.max(data[i], data[i + 2]), `pixel ${i / info.channels}`).toBeLessThan(40);
      }
      // The reader failing: no look, nothing cut, nothing kept.
      const blind = fakeAdmin({ download: async () => ({ data: blob(still), error: null }) });
      const cut = vi.fn();
      expect(await lookCutout(input(blind.admin), { segment: cut, people: async () => null })).toEqual({ ok: false, reason: "people unknown" });
      expect(cut).not.toHaveBeenCalled();
      expect(blind.ops()).not.toContain("upload");
    });

    it("no look when the mask held only the person", async () => {
      const still = await stillPng();
      const f = fakeAdmin({ download: async () => ({ data: blob(still), error: null }) });
      expect(await lookCutout(input(f.admin), { people, segment: () => samAnswer(personBlock) })).toEqual({ ok: false, reason: "empty mask" });
      expect(f.ops()).not.toContain("upload");
    });

    it("a camera that saw no objects, or not the figure, is no look, and SAM 2 is never asked", async () => {
      const still = await stillPng();
      const segment = vi.fn();
      // The figure at the foot of the grandstands, and nothing there but structure.
      const stands: ShotCamera = { position: [-10, 1.6, 0], target: [-35, 5, 0], fovDeg: 50, canvasAspect: 16 / 9, figure: { x: -18, z: -4 } };
      // The car in view, the figure out of frame.
      const noFigure: ShotCamera = { ...CAMERA, figure: { x: 6, z: 6 } };
      for (const camera of [stands, noFigure]) {
        const f = fakeAdmin({ download: async () => ({ data: blob(still), error: null }) });
        expect(await lookCutout(input(f.admin, { camera }), { segment, people })).toEqual({ ok: false, reason: "nothing to cut" });
        expect(f.ops()).not.toContain("upload");
      }
      expect(segment).not.toHaveBeenCalled();
    });

    it("SAM 2 failing, finding nothing, or taking the whole frame is no look — and nothing is kept", async () => {
      const still = await stillPng();
      // The figure far down the track, its region some 5% of the frame: the
      // share is measured once that region is cleared, so a mask of nearly
      // everything is still most of the still.
      const farFigure: ShotCamera = { ...CAMERA, figure: { x: 12, z: -6 } };
      const cases: [() => Promise<Buffer | null>, string][] = [
        [async () => null, "cut failed"],
        [async () => Buffer.from("not a png"), "cut failed"],
        [() => samAnswer(() => false), "empty mask"],
        [() => samAnswer((x) => x < 250), "mask took the whole frame"],
      ];
      for (const [segment, reason] of cases) {
        const f = fakeAdmin({ download: async () => ({ data: blob(still), error: null }) });
        expect(await lookCutout(input(f.admin, { camera: farFigure }), { segment, people })).toEqual({ ok: false, reason });
        expect(f.ops()).not.toContain("upload");
      }
    });

    it("a refused upload is fine when a shot beside it kept one first, and no look when nothing was kept", async () => {
      const still = await stillPng();
      const segment = async () => samAnswer(carBlock);
      let kept = false;
      const raced = fakeAdmin({
        exists: async () => ({ data: kept, error: null }),
        download: async () => ({ data: blob(still), error: null }),
        upload: async () => ((kept = true), { error: { message: "The resource already exists" } }),
      });
      expect(await lookCutout(input(raced.admin), { segment, people })).toEqual({ ok: true, path: CUTOUT, made: true });
      const broken = fakeAdmin({
        download: async () => ({ data: blob(still), error: null }),
        upload: async () => ({ error: { message: "storage down" } }),
      });
      expect(await lookCutout(input(broken.admin), { segment, people })).toEqual({ ok: false, reason: "storage" });
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
    // The cutouts, then the object sheets drawn from them (2026-09-14).
    expect(lists).toEqual([
      { folder: `${USER}/sets`, limit: 1000, offset: 0, search: `${SET}.look-` },
      { folder: `${USER}/sets`, limit: 1000, offset: 0, search: `${SET}.sheet-` },
    ]);
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
    // Each still's cutout and the object sheet drawn from it, in each set.
    expect(removed).toEqual([[
      setLookCutoutPath(USER, SET, LOOK),
      `${USER}/sets/${SET}.sheet-${LOOK}.jpg`,
      setLookCutoutPath(USER, other, LOOK),
      `${USER}/sets/${other}.sheet-${LOOK}.jpg`,
    ]]);
    // Nothing to look up for no stills; a failed read removes nothing and never throws.
    const none = fakeAdmin({});
    await removeLookCutoutsOf(none.admin, USER, []);
    expect(none.calls).toEqual([]);
    const failed = fakeAdmin({}, async () => { throw new Error("down"); });
    await expect(removeLookCutoutsOf(failed.admin, USER, [LOOK])).resolves.toBeUndefined();
    expect(failed.ops()).not.toContain("remove");
  });
});
