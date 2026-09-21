import { beforeEach, describe, expect, it, vi } from "vitest";
import { setRefPhotoPath, setRefSheetPath } from "./set-config";
import { SET_NOT_FOUND, SET_PHOTO_UNREADABLE, SET_REF_REFUSED, SET_REF_TOO_FAST, SET_REF_TOO_MANY, SET_REF_UNCHECKED } from "./messages";

// Uploading and removing a set's reference photos (reference-actions.ts,
// 2026-09-21): the photo is the person's own set's, checked like a photo
// set's photo, stored re-encoded at its fixed path, and listed back. The
// session, the database, storage and the picture gate are stood in for;
// the photo's parsing and re-encoding are the real ones.

const USER = "11111111-1111-4111-8111-111111111111";
const SET = "22222222-2222-4222-8222-222222222222";
const REF = "55555555-5555-4555-8555-555555555555";

type Access = { error: string } | { error: null; supabase: unknown; userId: string; plan: string; isAdmin: boolean };
let access: Access = { error: null, supabase: {}, userId: USER, plan: "growth", isAdmin: false };
let owned = true;
let limited = false;
let gate: "pass" | "refuse" | "unavailable" = "pass";
const files = new Map<string, { bytes: Buffer; createdAt: string }>();
const uploads: { path: string; bytes: Buffer; type: unknown }[] = [];
const removed: string[][] = [];
const refusals: unknown[] = [];

vi.stubEnv("MEDIA_SIGNING_SECRET", "test-only");
vi.spyOn(console, "warn").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});

class FakeRefusal extends Error {
  constructor(
    readonly reason: string,
    readonly readings: unknown = null,
  ) {
    super(reason);
  }
}

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({
    from: () => {
      const q = { select: () => q, eq: () => q, is: () => q, maybeSingle: async () => ({ data: owned ? { id: SET } : null, error: null }) };
      return q;
    },
    storage: {
      from: () => ({
        list: async (folder: string, opts: { search: string }) => ({
          data: [...files.entries()]
            .filter(([p]) => p.startsWith(`${folder}/${opts.search}`))
            .map(([p, f]) => ({ name: p.slice(folder.length + 1), created_at: f.createdAt })),
          error: null,
        }),
        upload: async (path: string, bytes: Buffer, opts: { contentType: unknown }) => {
          uploads.push({ path, bytes, type: opts.contentType });
          files.set(path, { bytes, createdAt: new Date(Date.now() + files.size).toISOString() });
          return { error: null };
        },
        remove: async (paths: string[]) => {
          removed.push(paths);
          for (const p of paths) files.delete(p);
          return { error: null };
        },
      }),
    },
  }),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimited: async () => limited }));
vi.mock("@/lib/generations/output-policy", () => ({
  OutputPolicyRefusal: FakeRefusal,
  assertOutputAllowed: async (input: { imageUrl: string; strictLane: boolean }) => {
    expect(input.strictLane).toBe(true);
    expect(input.imageUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
    if (gate === "refuse") throw new FakeRefusal("sexual");
    if (gate === "unavailable") throw new FakeRefusal("unavailable");
  },
}));
vi.mock("@/lib/generations/policy-log", () => ({
  recentRefusalCount: async () => 0,
  recordPolicyRefusal: async (r: unknown) => void refusals.push(r),
}));
vi.mock("@/lib/sets/access", () => ({
  setsAccess: async () => access,
  UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
}));
vi.mock("@/lib/sets/photo", async () => await import("./photo"));
vi.mock("@/lib/sets/set-config", async () => await import("./set-config"));
vi.mock("@/lib/sets/references", async () => await import("./references"));
vi.mock("@/lib/sets/messages", async () => await import("./messages"));
vi.mock("@/lib/sets/reference-upload", async () => await import("./reference-upload"));

const { addSetReference, removeSetReference } = await import("./reference-actions");

let sharp: (typeof import("sharp"))["default"] | null = null;
try {
  sharp = (await import("sharp")).default;
} catch {
  sharp = null;
}
const jpeg = async (w = 900, h = 700) =>
  `data:image/jpeg;base64,${(await sharp!({ create: { width: w, height: h, channels: 3, background: { r: 180, g: 30, b: 30 } } }).jpeg().toBuffer()).toString("base64")}`;

beforeEach(() => {
  access = { error: null, supabase: {}, userId: USER, plan: "growth", isAdmin: false };
  owned = true;
  limited = false;
  gate = "pass";
  files.clear();
  uploads.length = 0;
  removed.length = 0;
  refusals.length = 0;
});

describe("uploading a reference photo", () => {
  it.skipIf(!sharp)("checks it, stores it re-encoded at the set's own path, and lists it back", async () => {
    const res = await addSetReference(SET, { photoDataUri: await jpeg() });
    expect(res.error).toBeNull();
    if (res.error !== null) return;
    expect(uploads).toHaveLength(1);
    expect(uploads[0].path).toBe(setRefPhotoPath(USER, SET, res.reference.id));
    expect(uploads[0].type).toBe("image/jpeg");
    expect(res.reference.url).toContain(`/sets/${SET}.ref-${res.reference.id}.jpg`);
  });

  it.skipIf(!sharp)("says no, storing nothing, to someone else's set, a picture it can't read, a full set, a burst, and the gate", async () => {
    owned = false;
    expect(await addSetReference(SET, { photoDataUri: await jpeg() })).toEqual({ error: SET_NOT_FOUND });
    owned = true;
    expect(await addSetReference(SET, { photoDataUri: "data:image/png;base64,AAAA" })).toEqual({ error: SET_PHOTO_UNREADABLE });
    for (let i = 0; i < 6; i++) files.set(`${USER}/sets/${SET}.ref-${`${i}`.repeat(8)}-0000-4000-8000-000000000000.jpg`, { bytes: Buffer.alloc(1), createdAt: `2026-09-21T10:0${i}:00Z` });
    expect(await addSetReference(SET, { photoDataUri: await jpeg() })).toEqual({ error: SET_REF_TOO_MANY });
    files.clear();
    limited = true;
    expect(await addSetReference(SET, { photoDataUri: await jpeg() })).toEqual({ error: SET_REF_TOO_FAST });
    limited = false;
    gate = "refuse";
    expect(await addSetReference(SET, { photoDataUri: await jpeg() })).toEqual({ error: SET_REF_REFUSED });
    expect(refusals).toEqual([expect.objectContaining({ userId: USER, gate: "output", provider: "set-reference", strictLane: true })]);
    gate = "unavailable";
    expect(await addSetReference(SET, { photoDataUri: await jpeg() })).toEqual({ error: SET_REF_UNCHECKED });
    expect(uploads).toEqual([]);
  });

  it("needs Helios 3D itself", async () => {
    access = { error: "Helios 3D is part of the paid plans. Upgrade in Settings → Plan & billing." };
    expect(await addSetReference(SET, { photoDataUri: "x" })).toEqual({ error: "Helios 3D is part of the paid plans. Upgrade in Settings → Plan & billing." });
  });
});

describe("removing a reference photo", () => {
  it("removes the photo and the sheet drawn from it, from the person's own set only", async () => {
    expect(await removeSetReference(SET, REF)).toEqual({ error: null });
    expect(removed).toEqual([[setRefPhotoPath(USER, SET, REF), setRefSheetPath(USER, SET, REF)]]);
    owned = false;
    expect(await removeSetReference(SET, REF)).toEqual({ error: SET_NOT_FOUND });
    expect(await removeSetReference(SET, "../../etc")).toEqual({ error: SET_NOT_FOUND });
  });
});
