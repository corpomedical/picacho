import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ImageSafetyRejection } from "../generations/providers/openai-images";
import { ELEMENT_SHEET_PROMPT, LOOK_SHEET_MEASURED_USD, LOOK_SHEET_PROMPT, LOOK_SHEET_SIGNED_URL_SECONDS, lookSheet, sheetFromPhotos } from "./look-sheet";
import { setLookCutoutPath, setLookSheetPath } from "./set-config";

// A look's object sheet (2026-09-14): drawn once from the cutout by the image
// model, kept beside it, and every way it can fail is a reason for the shot
// to go without its look. Storage and the render are fakes.

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
const CUTOUT = setLookCutoutPath(USER, SET, LOOK);
const SHEET = setLookSheetPath(USER, SET, LOOK);
const SIGNED = "https://example.supabase.co/storage/v1/object/sign/generated-images/cutout.jpg?token=abc";

type Storage = {
  exists?: (path: string) => Promise<{ data: boolean; error: unknown }>;
  createSignedUrl?: (path: string, seconds: number) => Promise<{ data: { signedUrl: string } | null; error: unknown }>;
  upload?: (path: string, body: Buffer, opts: unknown) => Promise<{ error: unknown }>;
};

function fakeAdmin(storage: Storage) {
  const calls: { op: string; args: unknown[] }[] = [];
  const record =
    <A extends unknown[], R>(op: string, fn: ((...a: A) => Promise<R>) | undefined, fallback: R) =>
    async (...args: A) => {
      calls.push({ op, args });
      return fn ? fn(...args) : fallback;
    };
  const bucket = {
    exists: record("exists", storage.exists, { data: false, error: { status: 404 } }),
    createSignedUrl: record("createSignedUrl", storage.createSignedUrl, { data: { signedUrl: SIGNED }, error: null }),
    upload: record("upload", storage.upload, { error: null }),
  };
  const admin = { storage: { from: (b: string) => (calls.push({ op: "bucket", args: [b] }), bucket) } } as unknown as SupabaseClient;
  return { admin, calls, ops: () => calls.map((c) => c.op).filter((op) => op !== "bucket") };
}

async function sheetPng(): Promise<string> {
  return (await sharp!({ create: { width: 64, height: 64, channels: 3, background: { r: 128, g: 128, b: 128 } } }).png().toBuffer()).toString("base64");
}

const input = (admin: SupabaseClient) => ({ admin, userId: USER, setId: SET, lookGenerationId: LOOK, cutoutPath: CUTOUT });

describe("lookSheet", () => {
  it("names the sheet beside the cutout, and the measured sheet's price", () => {
    expect(SHEET).toBe(`${USER}/sets/${SET}.sheet-${LOOK}.jpg`);
    // 160 × $5 + 640 × $8 + 1,756 × $30 per million = $0.0586.
    expect(LOOK_SHEET_MEASURED_USD).toBeCloseTo(0.0586, 6);
    expect(LOOK_SHEET_PROMPT).toContain("two-by-two grid");
    expect(LOOK_SHEET_PROMPT).toContain("No people");
  });

  it("reuses a kept sheet: nothing signed, nothing drawn", async () => {
    const f = fakeAdmin({ exists: async (p) => ({ data: p === SHEET, error: null }) });
    const render = vi.fn();
    expect(await lookSheet(input(f.admin), { render })).toEqual({ ok: true, path: SHEET, made: false });
    expect(f.ops()).toEqual(["exists"]);
    expect(render).not.toHaveBeenCalled();
  });

  it.skipIf(!sharp)("draws the sheet from the cutout's signed link with the measured words, keeps it as a JPEG, and never overwrites", async () => {
    const uploads: { path: string; body: Buffer; opts: unknown }[] = [];
    const f = fakeAdmin({ upload: async (path, body, opts) => (uploads.push({ path, body, opts }), { error: null }) });
    const render = vi.fn(async () => sheetPng());
    expect(await lookSheet(input(f.admin), { render })).toEqual({ ok: true, path: SHEET, made: true });
    expect(f.calls.find((c) => c.op === "createSignedUrl")?.args).toEqual([CUTOUT, LOOK_SHEET_SIGNED_URL_SECONDS]);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0]).toEqual([LOOK_SHEET_PROMPT, [SIGNED]]);
    expect(uploads).toHaveLength(1);
    expect(uploads[0].path).toBe(SHEET);
    expect(uploads[0].opts).toEqual({ contentType: "image/jpeg", upsert: false });
    expect((await sharp!(uploads[0].body).metadata()).format).toBe("jpeg");
    // Refused because a shot beside this one kept one first: fine.
    let kept = false;
    const raced = fakeAdmin({
      exists: async () => ({ data: kept, error: null }),
      upload: async () => ((kept = true), { error: { message: "The resource already exists" } }),
    });
    expect(await lookSheet(input(raced.admin), { render })).toEqual({ ok: true, path: SHEET, made: true });
  });

  it.skipIf(!sharp)("a link that cannot be signed, a refused or failed render, an answer that is no picture, or storage failing is no look — and nothing is kept", async () => {
    const good = async () => sheetPng();
    const cases: [Storage, () => Promise<string>, string][] = [
      [{ createSignedUrl: async () => ({ data: null, error: { message: "no" } }) }, good, "storage"],
      [{ createSignedUrl: async () => { throw new Error("network"); } }, good, "storage"],
      [{}, async () => { throw new ImageSafetyRejection("refused", true); }, "sheet refused"],
      [{}, async () => { throw new Error("OpenAI image API error (500)"); }, "sheet failed"],
      [{}, async () => Buffer.from("not a picture").toString("base64"), "sheet failed"],
      [{}, async () => "", "sheet failed"],
      [{ upload: async () => ({ error: { message: "storage down" } }) }, good, "storage"],
    ];
    for (const [storage, render, reason] of cases) {
      const f = fakeAdmin(storage);
      expect(await lookSheet(input(f.admin), { render }), reason).toEqual({ ok: false, reason });
      if (reason !== "storage" || !storage.upload) expect(f.ops(), reason).not.toContain("upload");
    }
  });
});

// A thing's sheet from its photos (R1, 2026-09-21): one photo is the tested
// path word for word; two to four go in together, front first, under their
// own words.
describe("sheetFromPhotos", () => {
  const SHEET_OF_THING = `${USER}/sets/${SET}.elsheet-169cd97f035286.jpg`;
  const photos = [1, 2, 3].map((n) => `${USER}/sets/${SET}.ref-c_89e319be_0_-1.${n}.t0k2mo.${n}${n}${n}${n}${n}${n}${n}${n}-0000-4000-8000-000000000000.jpg`);

  it("draws one photo with the look's own words, and several with the thing's, in slot order", async () => {
    const seen: [string, string[]][] = [];
    const render = async (prompt: string, urls?: string | string[] | null) => (seen.push([prompt, [urls ?? []].flat()]), sheetPng());
    const signed = (p: string) => ({ data: { signedUrl: `https://signed/${p.split("/").pop()}` }, error: null });
    const one = fakeAdmin({ createSignedUrl: async (p) => signed(p) });
    expect(await sheetFromPhotos({ admin: one.admin, sourcePaths: photos.slice(0, 1), sheetPath: SHEET_OF_THING }, { render })).toEqual({ ok: true, path: SHEET_OF_THING, made: true });
    const three = fakeAdmin({ createSignedUrl: async (p) => signed(p) });
    await sheetFromPhotos({ admin: three.admin, sourcePaths: photos, sheetPath: SHEET_OF_THING }, { render });
    expect(seen[0]).toEqual([LOOK_SHEET_PROMPT, [`https://signed/${photos[0].split("/").pop()}`]]);
    expect(seen[1][0]).toBe(ELEMENT_SHEET_PROMPT);
    expect(seen[1][1]).toEqual(photos.map((p) => `https://signed/${p.split("/").pop()}`));
  });

  it("reuses a kept sheet, and has nothing to draw from no photos", async () => {
    const render = vi.fn();
    const kept = fakeAdmin({ exists: async () => ({ data: true, error: null }) });
    expect(await sheetFromPhotos({ admin: kept.admin, sourcePaths: photos, sheetPath: SHEET_OF_THING }, { render })).toEqual({ ok: true, path: SHEET_OF_THING, made: false });
    expect(await sheetFromPhotos({ admin: kept.admin, sourcePaths: [], sheetPath: SHEET_OF_THING }, { render })).toEqual({ ok: false, reason: "sheet failed" });
    expect(render).not.toHaveBeenCalled();
  });

  it("says the photos could not be signed, and a refusal as a refusal", async () => {
    const unsigned = fakeAdmin({ createSignedUrl: async () => ({ data: null, error: { message: "no" } }) });
    expect(await sheetFromPhotos({ admin: unsigned.admin, sourcePaths: photos, sheetPath: SHEET_OF_THING }, { render: vi.fn() })).toEqual({ ok: false, reason: "storage" });
    const refused = fakeAdmin({});
    const render = async () => {
      throw new ImageSafetyRejection("moderation_blocked", true);
    };
    expect(await sheetFromPhotos({ admin: refused.admin, sourcePaths: photos, sheetPath: SHEET_OF_THING }, { render })).toEqual({ ok: false, reason: "sheet refused" });
  });
});
