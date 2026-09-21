import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { setElementPhotoPath, setElementSheetPath, setRefPhotoPath, setRefPrefix, setRefSheetPath, setRefSheetPrefix } from "./set-config";
import { sheetFromPhoto, LOOK_SHEET_PROMPT } from "./look-sheet";

// Reference photos (2026-09-21, "we need to add an option to upload
// reference images"): where they live, how the set lists them (since R1,
// on its things, with photos from before R1 on nothing), and the sheet
// drawn from one. Storage and the render are fakes.

vi.stubEnv("MEDIA_SIGNING_SECRET", "test-only");
vi.spyOn(console, "warn").mockImplementation(() => {});
const { listElementPhotos } = await import("./references");

const USER = "11111111-1111-4111-8111-111111111111";
const SET = "22222222-2222-4222-8222-222222222222";
const OTHER = "44444444-4444-4444-8444-444444444444";
const ref = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;

describe("where a set's reference photos live", () => {
  it("beside the set's other files, one path per photo and one per sheet, never overlapping", () => {
    expect(setRefPhotoPath(USER, SET, ref(5))).toBe(`${USER}/sets/${SET}.ref-${ref(5)}.jpg`);
    expect(setRefSheetPath(USER, SET, ref(5))).toBe(`${USER}/sets/${SET}.refsheet-${ref(5)}.jpg`);
    expect(`${SET}.refsheet-x`.startsWith(setRefPrefix(SET))).toBe(false);
    expect(setRefSheetPrefix(SET)).toBe(`${SET}.refsheet-`);
  });
});

describe("listing a set's reference photos", () => {
  const listing = (entries: { name: string; created_at?: string }[]) => {
    const searches: string[] = [];
    const admin = {
      storage: {
        from: () => ({
          list: async (_folder: string, opts: { search: string }) => (searches.push(opts.search), { data: entries, error: null }),
        }),
      },
    } as unknown as SupabaseClient;
    return { admin, searches };
  };

  it("reads the set's own photos only — on things and from before R1 — oldest first, each with its media link, and the sheets drawn", async () => {
    const CAR = "c_89e319be_0_-1";
    const { admin, searches } = listing([
      { name: `${SET}.ref-${ref(7)}.jpg`, created_at: "2026-09-21T10:02:00Z" },
      { name: `${SET}.ref-${ref(6)}.jpg`, created_at: "2026-09-21T10:01:00Z" },
      { name: setElementPhotoPath(USER, SET, CAR, 1, Date.parse("2026-09-21T10:05:00Z") / 1000, ref(9)).split("/").pop()!, created_at: "2026-09-21T10:05:00Z" },
      { name: `${SET}.refsheet-${ref(6)}.jpg`, created_at: "2026-09-21T10:03:00Z" },
      { name: setElementSheetPath(USER, SET, "abc123").split("/").pop()!, created_at: "2026-09-21T10:06:00Z" },
      { name: `${OTHER}.ref-${ref(8)}.jpg`, created_at: "2026-09-21T09:00:00Z" },
      { name: `${SET}.ref-not-a-uuid.jpg`, created_at: "2026-09-21T09:30:00Z" },
    ]);
    const { photos, sheets } = await listElementPhotos(admin, USER, SET);
    expect(searches).toContain(`${SET}.ref-`);
    expect(photos.map((p) => [p.refId, p.anchor])).toEqual([
      [ref(6), null],
      [ref(7), null],
      [ref(9), CAR],
    ]);
    expect(photos[0].url).toMatch(new RegExp(`^/api/media/generated-images/${USER}/sets/${SET}\\.ref-${ref(6)}\\.jpg`));
    expect(sheets).toEqual(["abc123"]);
  });

  it("an unreadable folder is an empty list, never a throw", async () => {
    const broken = { storage: { from: () => ({ list: async () => ({ data: null, error: { message: "down" } }) }) } } as unknown as SupabaseClient;
    expect(await listElementPhotos(broken, USER, SET)).toEqual({ photos: [], sheets: [] });
  });
});

describe("the sheet drawn from a reference photo", () => {
  it("is drawn from the photo itself to the reference's own sheet path, with the look's own words, once", async () => {
    const calls: { op: string; args: unknown[] }[] = [];
    let exists = false;
    const bucket = {
      exists: async (path: string) => (calls.push({ op: "exists", args: [path] }), { data: exists, error: null }),
      createSignedUrl: async (path: string) => (calls.push({ op: "sign", args: [path] }), { data: { signedUrl: "https://signed/photo.jpg" }, error: null }),
      upload: async (path: string) => (calls.push({ op: "upload", args: [path] }), { error: null }),
    };
    const admin = { storage: { from: () => bucket } } as unknown as SupabaseClient;
    let sharp: (typeof import("sharp"))["default"] | null = null;
    try {
      sharp = (await import("sharp")).default;
    } catch {
      sharp = null;
    }
    if (!sharp) return;
    const png = (await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 120, g: 120, b: 120 } } }).png().toBuffer()).toString("base64");
    const asked: { prompt: string; urls: unknown }[] = [];
    const render = (async (prompt: string, urls: unknown) => (asked.push({ prompt, urls }), png)) as never;
    const out = await sheetFromPhoto(
      { admin, sourcePath: setRefPhotoPath(USER, SET, ref(5)), sheetPath: setRefSheetPath(USER, SET, ref(5)) },
      { render },
    );
    expect(out).toEqual({ ok: true, path: setRefSheetPath(USER, SET, ref(5)), made: true });
    expect(calls.find((c) => c.op === "sign")?.args[0]).toBe(setRefPhotoPath(USER, SET, ref(5)));
    expect(asked).toEqual([{ prompt: LOOK_SHEET_PROMPT, urls: ["https://signed/photo.jpg"] }]);
    // Made once: the next shot finds it and draws nothing.
    exists = true;
    asked.length = 0;
    expect(await sheetFromPhoto({ admin, sourcePath: setRefPhotoPath(USER, SET, ref(5)), sheetPath: setRefSheetPath(USER, SET, ref(5)) }, { render })).toEqual({
      ok: true,
      path: setRefSheetPath(USER, SET, ref(5)),
      made: false,
    });
    expect(asked).toEqual([]);
  });

  it("asks for no people: a person in the photo never reaches a shot", () => {
    expect(LOOK_SHEET_PROMPT).toContain("No people");
  });
});
