import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { exportUrl } from "./export-url";
import { contentTypeFor, freeMarkApplies, markedCopy, markedPath, type ExportProfile } from "./free-mark-export";

const ME = "11111111-1111-4111-8111-111111111111";
const free: ExportProfile = { plan: "none", role: "user", purchased_credits: 0 };

describe("freeMarkApplies", () => {
  it("marks a free account's own picture and video", () => {
    expect(freeMarkApplies(ME, free, "generated-images", `${ME}/a.png`)).toBe(true);
    expect(freeMarkApplies(ME, free, "generated-videos", `${ME}/a.mp4`)).toBe(true);
    expect(freeMarkApplies(ME, { ...free, plan: null }, "generated-videos", `${ME}/a.mov`)).toBe(true);
  });

  it("leaves paid, comped, admin and bought-credit accounts clean", () => {
    for (const plan of ["basic", "starter", "growth", "studio", "elite"]) {
      expect(freeMarkApplies(ME, { ...free, plan }, "generated-images", `${ME}/a.png`)).toBe(false);
    }
    expect(freeMarkApplies(ME, { ...free, role: "admin" }, "generated-images", `${ME}/a.png`)).toBe(false);
    expect(freeMarkApplies(ME, { ...free, purchased_credits: 40 }, "generated-images", `${ME}/a.png`)).toBe(false);
  });

  it("never marks someone else's file, a signed-out download, another bucket or a marked copy", () => {
    const other = "22222222-2222-4222-8222-222222222222";
    expect(freeMarkApplies(ME, free, "generated-images", `${other}/a.png`)).toBe(false);
    expect(freeMarkApplies(null, null, "generated-images", `${ME}/a.png`)).toBe(false);
    expect(freeMarkApplies(ME, free, "character-references", `${ME}/a.png`)).toBe(false);
    expect(freeMarkApplies(ME, free, "generated-images", `${ME}/marked/a.png`)).toBe(false);
    expect(freeMarkApplies(ME, free, "generated-images", `${ME}/a.glb`)).toBe(false);
  });
});

describe("markedPath", () => {
  it("sits beside the original, and a video is written as .mp4", () => {
    expect(markedPath(`${ME}/a.png`)).toBe(`${ME}/marked/a.png`);
    expect(markedPath(`${ME}/layers/g/z1.png`)).toBe(`${ME}/marked/layers/g/z1.png`);
    expect(markedPath(`${ME}/a.mov`)).toBe(`${ME}/marked/a.mp4`);
    expect(contentTypeFor(markedPath(`${ME}/a.mov`))).toBe("video/mp4");
    expect(contentTypeFor(`${ME}/a.jpg`)).toBe("image/jpeg");
  });
});

describe("exportUrl", () => {
  it("sends a render's download through the door, without a thumbnail width", () => {
    expect(exportUrl(`/api/media/generated-videos/${ME}/a.mp4?v=abc`)).toBe(`/api/export/generated-videos/${ME}/a.mp4?v=abc`);
    expect(exportUrl(`/api/media/generated-images/${ME}/a.png?v=abc&w=640`)).toBe(`/api/export/generated-images/${ME}/a.png?v=abc`);
  });

  it("leaves everything else alone", () => {
    expect(exportUrl("https://v3.fal.media/files/x.mp4")).toBe("https://v3.fal.media/files/x.mp4");
    expect(exportUrl(`/api/media/character-references/${ME}/a.png?v=abc`)).toBe(`/api/media/character-references/${ME}/a.png?v=abc`);
  });
});

describe("markedCopy", () => {
  // A stand-in for the storage bucket: what's there, and what gets uploaded.
  function fakeAdmin(files: Map<string, Buffer>) {
    const uploads: string[] = [];
    const storage = {
      from: () => ({
        download: async (p: string) => {
          const b = files.get(p);
          return b ? { data: new Blob([new Uint8Array(b)]), error: null } : { data: null, error: { message: "not found" } };
        },
        upload: async (p: string, bytes: Buffer) => {
          uploads.push(p);
          files.set(p, Buffer.from(bytes));
          return { error: null };
        },
      }),
    };
    return { admin: { storage } as unknown as Parameters<typeof markedCopy>[0], uploads };
  }

  it("burns a picture once, keeps the copy beside the original, and reads it back the second time", async () => {
    const png = await sharp({ create: { width: 640, height: 360, channels: 3, background: "#000" } }).png().toBuffer();
    const files = new Map([[`${ME}/a.png`, png]]);
    const { admin, uploads } = fakeAdmin(files);
    const first = await markedCopy(admin, "generated-images", `${ME}/a.png`);
    expect(first?.path).toBe(`${ME}/marked/a.png`);
    expect(first?.contentType).toBe("image/png");
    expect(first?.bytes.equals(png)).toBe(false);
    expect(files.get(`${ME}/a.png`)?.equals(png)).toBe(true); // the original is untouched
    const second = await markedCopy(admin, "generated-images", `${ME}/a.png`);
    expect(second?.bytes.equals(first!.bytes)).toBe(true);
    expect(uploads).toEqual([`${ME}/marked/a.png`]);
  });

  it("burns a real video with the encoder and stores it as MP4", async () => {
    const mp4 = readFileSync(join(process.cwd(), "public/showcase-video.mp4"));
    const files = new Map([[`${ME}/v.mp4`, mp4]]);
    const { admin } = fakeAdmin(files);
    const out = await markedCopy(admin, "generated-videos", `${ME}/v.mp4`);
    expect(out?.path).toBe(`${ME}/marked/v.mp4`);
    expect(out?.bytes.subarray(4, 8).toString()).toBe("ftyp");
    expect(out?.bytes.equals(mp4)).toBe(false);
  }, 120_000);

  it("gives up (so the original is served) when the original isn't there", async () => {
    const { admin } = fakeAdmin(new Map());
    expect(await markedCopy(admin, "generated-images", `${ME}/gone.png`)).toBeNull();
  });
});
