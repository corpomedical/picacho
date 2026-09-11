import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CLEAR_PHOTO_SOURCE,
  isMissingColumn,
  normaliseSetPhoto,
  parseSetPhotoDataUri,
  photoDataUrl,
  photoSourceColumns,
  readPhotoSources,
  readStoredPhoto,
  removeSetPhoto,
} from "./photo";
import { MAX_SET_PHOTO_BYTES, setPhotoPath } from "./set-config";
import {
  SET_PHOTO_BAD_SHAPE,
  SET_PHOTO_TOO_LARGE,
  SET_PHOTO_TOO_SMALL,
  SET_PHOTO_UNREADABLE,
} from "./messages";

// A Set's source photo on the server (2026-09-11): what is accepted, what
// the re-encode strips, and — the promise text sets rest on — that a
// database without the photo columns reads every set as a text build.

const USER = "11111111-1111-4111-8111-111111111111";
const SET = "22222222-2222-4222-8222-222222222222";
const SHA = "a".repeat(64);
const jpegUri = (bytes: Buffer) => `data:image/jpeg;base64,${bytes.toString("base64")}`;
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

describe("parseSetPhotoDataUri", () => {
  it("accepts a JPEG data URI and hands back its bytes", () => {
    const r = parseSetPhotoDataUri(jpegUri(JPEG_HEAD));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bytes.equals(JPEG_HEAD)).toBe(true);
  });

  it("refuses anything that is not a JPEG data URI", () => {
    expect(parseSetPhotoDataUri(`data:image/png;base64,${Buffer.from([0x89, 0x50]).toString("base64")}`)).toEqual({
      ok: false,
      error: SET_PHOTO_UNREADABLE,
    });
    expect(parseSetPhotoDataUri("https://example.com/photo.jpg")).toEqual({ ok: false, error: SET_PHOTO_UNREADABLE });
    for (const bad of [undefined, null, 42, { photo: "x" }]) {
      expect(parseSetPhotoDataUri(bad)).toEqual({ ok: false, error: SET_PHOTO_UNREADABLE });
    }
  });

  it("refuses bytes that do not open like a JPEG", () => {
    expect(parseSetPhotoDataUri(jpegUri(Buffer.from([0xff, 0xd8, 0x00, 0x01])))).toEqual({ ok: false, error: SET_PHOTO_UNREADABLE });
    expect(parseSetPhotoDataUri(jpegUri(Buffer.from("GIF89a")))).toEqual({ ok: false, error: SET_PHOTO_UNREADABLE });
  });

  it("refuses more than 3 MB — decoded, and before decoding when the string alone says so", () => {
    const over = Buffer.alloc(MAX_SET_PHOTO_BYTES + 1, 0x41);
    JPEG_HEAD.copy(over);
    expect(parseSetPhotoDataUri(jpegUri(over))).toEqual({ ok: false, error: SET_PHOTO_TOO_LARGE });
    expect(parseSetPhotoDataUri(`data:image/jpeg;base64,${"A".repeat(5 * 1024 * 1024)}`)).toEqual({
      ok: false,
      error: SET_PHOTO_TOO_LARGE,
    });
    const exact = Buffer.alloc(MAX_SET_PHOTO_BYTES, 0x41);
    JPEG_HEAD.copy(exact);
    expect(parseSetPhotoDataUri(jpegUri(exact)).ok).toBe(true);
  });
});

type SharpFn = (typeof import("sharp"))["default"];
let sharp: SharpFn | null = null;
try {
  sharp = (await import("sharp")).default;
} catch {
  sharp = null;
}

describe.skipIf(!sharp)("normaliseSetPhoto (sharp)", () => {
  const make = (width: number, height: number) =>
    sharp!({ create: { width, height, channels: 3, background: { r: 90, g: 120, b: 150 } } });

  it("re-encodes a large photo to 2048 on its long side, with no EXIF and no GPS left", async () => {
    const src = await make(3000, 2000)
      .jpeg()
      .withExif({
        IFD0: { Make: "TestCam", Copyright: "Someone" },
        IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 3230/100", GPSLongitudeRef: "W", GPSLongitude: "0/1 7/1 4366/100" },
      })
      .toBuffer();
    // The fixture really carries location data.
    expect((await sharp!(src).metadata()).exif).toBeDefined();

    const r = await normaliseSetPhoto(src);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(2048);
    expect(r.width).toBe(2048);
    const meta = await sharp!(r.jpeg).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(r.sha256).toBe(createHash("sha256").update(r.jpeg).digest("hex"));
    // Stable: the same photo hashes the same, so a stored copy can be checked.
    const again = await normaliseSetPhoto(src);
    expect(again.ok && again.sha256).toBe(r.sha256);
  });

  it("turns a photo upright from its orientation tag", async () => {
    const sideways = await make(3000, 2000).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const r = await normaliseSetPhoto(sideways);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.height).toBeGreaterThan(r.width);
  });

  it("refuses a photo too small or too wide, and bytes that do not decode", async () => {
    expect(await normaliseSetPhoto(await make(600, 900).jpeg().toBuffer())).toEqual({ ok: false, error: SET_PHOTO_TOO_SMALL });
    expect(await normaliseSetPhoto(await make(3000, 1000).jpeg().toBuffer())).toEqual({ ok: false, error: SET_PHOTO_BAD_SHAPE });
    const broken = Buffer.concat([JPEG_HEAD, Buffer.alloc(64, 0x11)]);
    expect(await normaliseSetPhoto(broken)).toEqual({ ok: false, error: SET_PHOTO_UNREADABLE });
  });
});

// A minimal PostgREST stand-in: every filter returns the builder, awaiting it
// returns the canned answer.
function fakeDb(answer: { data: unknown; error: { code?: string; message: string } | null }): SupabaseClient {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "in", "eq", "is"]) builder[m] = () => builder;
  builder.then = (resolve: (v: unknown) => void) => resolve(answer);
  return { from: () => builder } as unknown as SupabaseClient;
}

describe("before astra-photo-sets.sql runs, every set is a text build", () => {
  it("knows a missing column when PostgREST reports one", () => {
    expect(isMissingColumn({ code: "PGRST204" })).toBe(true);
    expect(isMissingColumn({ code: "42703" })).toBe(true);
    expect(isMissingColumn({ code: "23505" })).toBe(false);
    expect(isMissingColumn(null)).toBe(false);
    expect(isMissingColumn(undefined)).toBe(false);
  });

  it("reads no photo sources when the columns are not there", async () => {
    const db = fakeDb({ data: null, error: { code: "42703", message: "column location_sets.source_photo_path does not exist" } });
    expect((await readPhotoSources(db, [SET], USER)).size).toBe(0);
  });

  it("reads no photo sources when the read itself throws", async () => {
    const db = { from: () => { throw new Error("network"); } } as unknown as SupabaseClient;
    expect((await readPhotoSources(db, [SET], USER)).size).toBe(0);
  });

  it("names the photo columns nowhere in src/ but photo.ts (and tests)", () => {
    // No other query can then name a column that may not exist: the list,
    // the set page, the poll and the delete all stay as they were.
    const SRC = join(__dirname, "..", "..");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) return walk(p);
        return /\.(ts|tsx)$/.test(name) ? [p] : [];
      });
    const offenders = walk(SRC)
      .filter((f) => !f.endsWith(join("sets", "photo.ts")) && !/\.test\.tsx?$/.test(f))
      .filter((f) => readFileSync(f, "utf8").includes("source_photo_"))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});

describe("the photo action's order (actions.ts, read as source: a \"use server\" module cannot load here)", () => {
  const source = readFileSync(join(__dirname, "actions.ts"), "utf8");
  const start = source.indexOf("export async function submitSetPhotoBuild(");
  const body = source.slice(start, source.indexOf("\nexport async function", start + 10));

  it("reserves a text build's row with nothing extra, exactly as before photos", () => {
    expect(source).toContain('reserveBuildRow(access, admin, {}, "submitSetBuild")');
  });

  it("checks admin and the photo switch, reads and re-encodes the photo, reserves, gates, and only then stores and sends", () => {
    expect(start).toBeGreaterThan(0);
    const steps = [
      "if (!access.isAdmin) return { error: SETS_NOT_OPEN }",
      "isPhotoSetsEnabled(access.supabase)",
      "parseSetPhotoDataUri(",
      'rateLimited(userId, "set-build"',
      "normaliseSetPhoto(",
      "reserveBuildRow(",
      "gatePrompt(",
      "assertOutputAllowed(",
      ".upload(setPhotoPath(userId, setId)",
      "submitAstraJob(",
    ];
    const at = steps.map((s) => body.indexOf(s));
    for (const [i, s] of steps.entries()) expect(at[i], s).toBeGreaterThan(-1);
    for (let i = 1; i < at.length; i++) expect(at[i], `${steps[i - 1]} before ${steps[i]}`).toBeGreaterThan(at[i - 1]);
  });

  it("sends Astra the photo inline, never a link to where it is stored", () => {
    expect(body).toContain("photoBuildInput(dataUrl, notes)");
    expect(body).not.toMatch(/mediaUrl\(|createSignedUrl|getPublicUrl/);
  });
});

describe("readPhotoSources, once the columns exist", () => {
  it("counts a row only when its photo is exactly the owner's own path for that set", async () => {
    const other = "33333333-3333-4333-8333-333333333333";
    const db = fakeDb({
      data: [
        { id: SET, source_photo_path: setPhotoPath(USER, SET), source_photo_sha256: SHA },
        // Another set's path, another person's folder, a bad hash, no photo.
        { id: other, source_photo_path: setPhotoPath(USER, SET), source_photo_sha256: SHA },
        { id: "44444444-4444-4444-8444-444444444444", source_photo_path: setPhotoPath("someone-else", "x"), source_photo_sha256: SHA },
        { id: "55555555-5555-4555-8555-555555555555", source_photo_path: setPhotoPath(USER, "55555555-5555-4555-8555-555555555555"), source_photo_sha256: "not-a-hash" },
        { id: "66666666-6666-4666-8666-666666666666", source_photo_path: null, source_photo_sha256: null },
      ],
      error: null,
    });
    const got = await readPhotoSources(db, [SET, other], USER);
    expect([...got.keys()]).toEqual([SET]);
    expect(got.get(SET)).toEqual({ path: setPhotoPath(USER, SET), sha256: SHA });
  });

  it("writes and clears the two columns as a pair, pinned to the owner's path", () => {
    expect(photoSourceColumns(USER, SET, SHA)).toEqual({ source_photo_path: setPhotoPath(USER, SET), source_photo_sha256: SHA });
    expect(CLEAR_PHOTO_SOURCE).toEqual({ source_photo_path: null, source_photo_sha256: null });
  });
});

function fakeStorage(download: () => Promise<{ data: Blob | null; error: unknown }>, remove?: () => Promise<unknown>) {
  return {
    storage: { from: () => ({ download, remove: remove ?? (async () => ({ error: null })) }) },
  } as unknown as SupabaseClient;
}

describe("readStoredPhoto resends only the bytes that passed the check", () => {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3]);
  const sha = createHash("sha256").update(bytes).digest("hex");

  it("returns the photo as a data URL when its hash still matches", async () => {
    const admin = fakeStorage(async () => ({ data: new Blob([bytes]), error: null }));
    expect(await readStoredPhoto(admin, { path: setPhotoPath(USER, SET), sha256: sha })).toBe(photoDataUrl(bytes));
  });

  it("returns nothing when the file was replaced, is gone, or cannot be read", async () => {
    const swapped = fakeStorage(async () => ({ data: new Blob([Buffer.from([0xff, 0xd8, 0xff, 9])]), error: null }));
    expect(await readStoredPhoto(swapped, { path: setPhotoPath(USER, SET), sha256: sha })).toBeNull();
    const gone = fakeStorage(async () => ({ data: null, error: { message: "Object not found" } }));
    expect(await readStoredPhoto(gone, { path: setPhotoPath(USER, SET), sha256: sha })).toBeNull();
    const broken = fakeStorage(async () => {
      throw new Error("network");
    });
    expect(await readStoredPhoto(broken, { path: setPhotoPath(USER, SET), sha256: sha })).toBeNull();
  });

  it("removes a photo without ever throwing", async () => {
    const broken = fakeStorage(
      async () => ({ data: null, error: null }),
      async () => {
        throw new Error("network");
      },
    );
    await expect(removeSetPhoto(broken, USER, SET)).resolves.toBeUndefined();
  });
});
