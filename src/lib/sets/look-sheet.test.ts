import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ImageSafetyRejection } from "../generations/providers/openai-images";
import { LOOK_SHEET_MEASURED_USD, LOOK_SHEET_PROMPT, LOOK_SHEET_SIGNED_URL_SECONDS, lookSheet } from "./look-sheet";
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
