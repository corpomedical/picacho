import { beforeEach, describe, expect, it, vi } from "vitest";
import raceTrack from "./fixtures-race-track.json";
import showroomOpen from "./fixtures-showroom-open.json";
import { setElementPhotoPath, setElementSheetPath, setRefPhotoPath, setRefSheetPath } from "./set-config";
import { SET_ELEMENTS_TOO_MANY, SET_ELEMENT_FULL, SET_ELEMENT_GONE, SET_ELEMENT_NOT_A_THING } from "./messages";
import { listSetReferences } from "./references";
import { sheetHashOf } from "./elements";

// Photos on the set's things (element-actions.ts, R1, 2026-09-21): each is
// stored under the key of the thing it was put on, four at most per thing,
// 24 per set, in the lowest free slot; a key a moment out of date finds its
// thing; removing a photo removes the thing's stale sheet; a photo from
// before R1 can be put on a thing, bringing its sheet; photos that followed
// their thing after an edit are renamed to its key. Storage, the session
// and the picture gate are stood in for; the listing, the resolver and the
// photo's re-encode are the real ones.

const USER = "11111111-1111-4111-8111-111111111111";
const SET = "22222222-2222-4222-8222-222222222222";
const CAR = "c_89e319be_0_-1";
const refId = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;

let limited = false;
let spec: unknown = raceTrack;
let allowanceError: string | null = null;
const renders: string[][] = [];
const files = new Map<string, { createdAt: string }>();
const refuseOnce = new Set<string>();
const removed: string[][] = [];
const moves: [string, string][] = [];

vi.stubEnv("MEDIA_SIGNING_SECRET", "test-only");
vi.spyOn(console, "warn").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({
    from: () => {
      let cols = "";
      const q = {
        select: (c: string) => ((cols = c), q),
        eq: () => q,
        is: () => q,
        maybeSingle: async () => ({ data: cols.includes("edited_spec") ? { edited_spec: null } : { status: "ready", spec }, error: null }),
      };
      return q;
    },
    storage: {
      from: () => ({
        list: async (folder: string, opts: { search: string }) => ({
          data: [...files.entries()].filter(([p]) => p.startsWith(`${folder}/${opts.search}`)).map(([p, f]) => ({ name: p.slice(folder.length + 1), created_at: f.createdAt })),
          error: null,
        }),
        upload: async (path: string) => {
          if (refuseOnce.delete(path) || files.has(path)) return { error: { message: "The resource already exists" } };
          files.set(path, { createdAt: new Date(Date.now() + files.size).toISOString() });
          return { error: null };
        },
        remove: async (paths: string[]) => {
          removed.push(paths);
          for (const p of paths) files.delete(p);
          return { error: null };
        },
        exists: async (path: string) => ({ data: files.has(path), error: null }),
        createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://signed/${path}` }, error: null }),
        move: async (from: string, to: string) => {
          if (!files.has(from)) return { error: { message: "Object not found" } };
          moves.push([from, to]);
          files.set(to, files.get(from)!);
          files.delete(from);
          return { error: null };
        },
      }),
    },
  }),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimited: async () => limited }));
vi.mock("@/lib/generations/core", () => ({ checkGenerationAllowance: async () => ({ error: allowanceError }) }));
vi.mock("@/lib/generations/quote", async () => await import("../generations/quote"));
vi.mock("@/lib/sets/take", async () => await import("./take"));
vi.mock("@/lib/sets/look-sheet", async () => await import("./look-sheet"));
vi.mock("../generations/providers/openai-images", () => ({
  ImageSafetyRejection: class extends Error {},
  generateImageWithOpenAI: async (_prompt: string, urls: string[]) => {
    renders.push(urls);
    const sharpMod = (await import("sharp")).default;
    return (await sharpMod({ create: { width: 32, height: 32, channels: 3, background: { r: 128, g: 128, b: 128 } } }).png().toBuffer()).toString("base64");
  },
}));
vi.mock("@/lib/generations/output-policy", () => ({ OutputPolicyRefusal: class extends Error {}, assertOutputAllowed: async () => {} }));
vi.mock("@/lib/generations/policy-log", () => ({ recentRefusalCount: async () => 0, recordPolicyRefusal: async () => {} }));
vi.mock("@/lib/sets/access", () => ({
  setsAccess: async () => ({ error: null, supabase: {}, userId: USER, plan: "growth", isAdmin: false }),
  UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
}));
vi.mock("@/lib/sets/photo", async () => await import("./photo"));
vi.mock("@/lib/sets/set-config", async () => await import("./set-config"));
vi.mock("@/lib/sets/set-spec", async () => await import("./set-spec"));
vi.mock("@/lib/sets/elements", async () => await import("./elements"));
vi.mock("@/lib/sets/references", async () => await import("./references"));
vi.mock("@/lib/sets/messages", async () => await import("./messages"));
vi.mock("@/lib/sets/reference-upload", async () => await import("./reference-upload"));

const { addElementPhoto, removeElementPhoto, assignElementPhoto, settleElementPhotos, prepareElementSheets } = await import("./element-actions");

let sharp: (typeof import("sharp"))["default"] | null = null;
try {
  sharp = (await import("sharp")).default;
} catch {
  sharp = null;
}
const jpeg = async () =>
  `data:image/jpeg;base64,${(await sharp!({ create: { width: 900, height: 700, channels: 3, background: { r: 180, g: 30, b: 30 } } }).jpeg().toBuffer()).toString("base64")}`;
const seed = (path: string) => files.set(path, { createdAt: new Date(Date.now() - 60_000 + files.size).toISOString() });

beforeEach(() => {
  limited = false;
  spec = raceTrack;
  allowanceError = null;
  renders.length = 0;
  files.clear();
  refuseOnce.clear();
  removed.length = 0;
  moves.length = 0;
});

describe("addElementPhoto", () => {
  it("stores a photo under its thing's key, in the lowest free slot, and lists it back", async () => {
    const first = await addElementPhoto(SET, { photoDataUri: await jpeg(), element: CAR });
    expect(first.error).toBeNull();
    if (first.error !== null) return;
    expect(first.photo).toMatchObject({ anchor: CAR, slot: 1 });
    const second = await addElementPhoto(SET, { photoDataUri: await jpeg(), element: CAR });
    if (second.error !== null) throw new Error(second.error);
    expect(second.photo.slot).toBe(2);
    expect(second.listing.photos.map((p) => p.slot)).toEqual([1, 2]);
    const [path] = [...files.keys()].filter((p) => p.includes(first.photo.refId));
    expect(path).toBe(setElementPhotoPath(USER, SET, CAR, 1, Math.floor(first.photo.at / 1000), first.photo.refId));
    expect(second.listing.photos.every((p) => !("path" in p))).toBe(true);
  });

  it("finds its thing when the page's key is a moment out of date", async () => {
    const r = await addElementPhoto(SET, { photoDataUri: await jpeg(), element: "c_89e319be_30_-1" });
    if (r.error !== null) throw new Error(r.error);
    expect(r.photo.anchor).toBe(CAR);
  });

  it("moves to the next slot when another upload just took this one", async () => {
    const r1 = await addElementPhoto(SET, { photoDataUri: await jpeg(), element: CAR });
    if (r1.error !== null) throw new Error(r1.error);
    const upload = vi.spyOn(crypto, "randomUUID").mockReturnValueOnce(refId(7) as `${string}-${string}-${string}-${string}-${string}`);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    refuseOnce.add(setElementPhotoPath(USER, SET, CAR, 2, Math.floor(now / 1000), refId(7)));
    const r2 = await addElementPhoto(SET, { photoDataUri: await jpeg(), element: CAR });
    vi.restoreAllMocks();
    upload.mockRestore();
    if (r2.error !== null) throw new Error(r2.error);
    expect(r2.photo.slot).toBe(3);
  });

  it("refuses a fifth photo on a thing, a 25th on a set, the person, and a thing that is gone", async () => {
    for (const slot of [1, 2, 3, 4]) seed(setElementPhotoPath(USER, SET, CAR, slot, 100 + slot, refId(slot)));
    expect(await addElementPhoto(SET, { photoDataUri: await jpeg(), element: CAR })).toEqual({ error: SET_ELEMENT_FULL });
    files.clear();
    for (let i = 0; i < 24; i++) seed(setRefPhotoPath(USER, SET, refId(100 + i)));
    expect(await addElementPhoto(SET, { photoDataUri: await jpeg(), element: CAR })).toEqual({ error: SET_ELEMENTS_TOO_MANY });
    expect(await addElementPhoto(SET, { photoDataUri: await jpeg(), element: "figure" })).toEqual({ error: SET_ELEMENT_NOT_A_THING });
    expect(await addElementPhoto(SET, { photoDataUri: await jpeg(), element: "c_00000000_900_900" })).toEqual({ error: SET_ELEMENT_GONE });
    expect(await addElementPhoto(SET, { photoDataUri: await jpeg(), element: "not a key" })).toEqual({ error: SET_ELEMENT_GONE });
  });

  it("removes the thing's old sheet: it no longer matches its photos", async () => {
    const p1 = setElementPhotoPath(USER, SET, CAR, 1, 100, refId(1));
    seed(p1);
    const oldSheet = setElementSheetPath(USER, SET, sheetHashOf([{ refId: refId(1), anchor: CAR, slot: 1, at: 100_000, url: "" }]));
    seed(oldSheet);
    const r = await addElementPhoto(SET, { photoDataUri: await jpeg(), element: CAR });
    expect(r.error).toBeNull();
    expect(files.has(oldSheet)).toBe(false);
  });
});

describe("removeElementPhoto", () => {
  it("removes the photo and its thing's sheet; a photo from before R1 takes its own sheet with it", async () => {
    const p1 = setElementPhotoPath(USER, SET, CAR, 1, 100, refId(1));
    seed(p1);
    const sheet = setElementSheetPath(USER, SET, sheetHashOf([{ refId: refId(1), anchor: CAR, slot: 1, at: 100_000, url: "" }]));
    seed(sheet);
    const r = await removeElementPhoto(SET, refId(1));
    expect(r.error).toBeNull();
    expect(removed.at(-1)).toEqual([p1, sheet]);
    seed(setRefPhotoPath(USER, SET, refId(2)));
    await removeElementPhoto(SET, refId(2));
    expect(removed.at(-1)).toEqual([setRefPhotoPath(USER, SET, refId(2)), setRefSheetPath(USER, SET, refId(2))]);
  });
});

describe("assignElementPhoto", () => {
  it("puts a photo from before R1 on a thing, bringing the sheet already drawn from it", async () => {
    seed(setRefPhotoPath(USER, SET, refId(3)));
    seed(setRefSheetPath(USER, SET, refId(3)));
    const r = await assignElementPhoto(SET, refId(3), CAR);
    if (r.error !== null) throw new Error(r.error);
    expect(r.listing.photos).toEqual([expect.objectContaining({ refId: refId(3), anchor: CAR, slot: 1 })]);
    const sheet = setElementSheetPath(USER, SET, sheetHashOf([{ refId: refId(3), anchor: CAR, slot: 1, at: 0, url: "" }]));
    expect(moves.map((m) => m[1])).toContain(sheet);
    expect(files.has(sheet)).toBe(true);
  });
});

describe("settleElementPhotos", () => {
  it("renames the photos that followed their thing to its key now, and leaves exact ones", async () => {
    const old = setElementPhotoPath(USER, SET, "c_89e319be_30_-1", 1, 100, refId(4));
    seed(old);
    const r = await settleElementPhotos(SET);
    if (r.error !== null) throw new Error(r.error);
    expect(r.moved).toBe(1);
    expect(moves).toEqual([[old, setElementPhotoPath(USER, SET, CAR, 1, 100, refId(4))]]);
    const again = await settleElementPhotos(SET);
    if (again.error !== null) throw new Error(again.error);
    expect(again.moved).toBe(0);
  });
});

describe("deploying in either order", () => {
  it("leaves the new names out of the old listing", async () => {
    seed(setElementPhotoPath(USER, SET, CAR, 1, 100, refId(5)));
    seed(setRefPhotoPath(USER, SET, refId(6)));
    const { createAdminClient } = await import("@/lib/supabase/server");
    const listed = await listSetReferences(createAdminClient() as never, USER, SET);
    expect(listed.map((r) => r.id)).toEqual([refId(6)]);
  });
});

describe("the storage audit", () => {
  it("counts a live set's reference photos and sheets, and not a deleted set's", async () => {
    const { isReferenced } = await import("../../../scripts/lib/storage-references.mjs");
    const live = new Set([`live-set:${SET}`]);
    expect(isReferenced(live, setElementPhotoPath(USER, SET, CAR, 1, 100, refId(1)))).toBe(true);
    expect(isReferenced(live, setRefSheetPath(USER, SET, refId(1)))).toBe(true);
    expect(isReferenced(live, setElementSheetPath(USER, SET, "169cd97f035286"))).toBe(true);
    expect(isReferenced(live, setRefPhotoPath(USER, "33333333-3333-4333-8333-333333333333", refId(1)))).toBe(false);
  });
});

describe("prepareElementSheets", () => {
  it("draws a thing's sheet once from its photos, front first, and then finds it ready", async () => {
    const photos = [1, 2].map((slot) => setElementPhotoPath(USER, SET, CAR, slot, 100 + slot, refId(slot)));
    for (const p of photos) seed(p);
    const first = await prepareElementSheets(SET, [CAR]);
    expect(first).toEqual({ error: null, sheets: [{ key: CAR, status: "drawn" }] });
    expect(renders).toEqual([photos.map((p) => `https://signed/${p}`)]);
    const again = await prepareElementSheets(SET, [CAR]);
    expect(again).toEqual({ error: null, sheets: [{ key: CAR, status: "ready" }] });
    expect(renders).toHaveLength(1);
  });

  it("asks the allowance before any render, and says what it could not draw", async () => {
    seed(setElementPhotoPath(USER, SET, CAR, 1, 100, refId(1)));
    allowanceError = "Not enough credits.";
    expect(await prepareElementSheets(SET, [CAR])).toEqual({ error: "Not enough credits." });
    expect(renders).toHaveLength(0);
    allowanceError = null;
    limited = true;
    expect(await prepareElementSheets(SET, [CAR])).toEqual({ error: null, sheets: [{ key: CAR, status: "too-fast" }] });
    expect(await prepareElementSheets(SET, ["c_00000000_900_900", "not a key"])).toEqual({ error: null, sheets: [{ key: "c_00000000_900_900", status: "gone" }] });
  });

  it("draws four at once and leaves the rest queued for the page to ask again", async () => {
    spec = showroomOpen;
    const { setElements } = await import("./elements");
    const { normaliseSetSpec } = await import("./set-spec");
    const n = normaliseSetSpec(showroomOpen);
    if (!n.ok) throw new Error("fixture");
    const keys = setElements(n.spec).map((e) => e.key);
    keys.forEach((k, i) => seed(setElementPhotoPath(USER, SET, k, 1, 100 + i, refId(10 + i))));
    const r = await prepareElementSheets(SET, keys);
    if (r.error !== null) throw new Error(r.error);
    expect(r.sheets.map((x) => x.key)).toEqual(keys);
    expect(r.sheets.filter((x) => x.status === "drawn")).toHaveLength(4);
    expect(r.sheets.filter((x) => x.status === "queued")).toHaveLength(keys.length - 4);
  });
});
