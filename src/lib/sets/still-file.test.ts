import { describe, expect, it } from "vitest";
import { originalMediaUrl, shotFileName, shotFileUrl } from "./still-file";
import { thumbUrl } from "../media/url";

// The finished still or take as a file (2026-09-25, Cut 1). The set page's
// only download saved the stage's grey sketch, even with a finished still
// on screen. The still in the viewer now downloads as itself: the untouched
// original, never the 640 or 1600 copy the strip and the viewer show.

const RAW = "/api/media/generated-images/u/a.png?v=sig";

describe("originalMediaUrl", () => {
  it("takes the resize off a stored media url, and keeps its signature", () => {
    expect(originalMediaUrl("/api/media/generated-images/u/a.png?v=sig&w=640")).toBe(RAW);
    expect(originalMediaUrl("/api/media/x/a.png?w=1600&v=sig")).toBe("/api/media/x/a.png?v=sig");
    expect(originalMediaUrl("/api/media/x/a.png?w=640")).toBe("/api/media/x/a.png");
    expect(originalMediaUrl("/api/media/x/a.png?v=sig&w=640&k=1")).toBe("/api/media/x/a.png?v=sig&k=1");
  });

  it("leaves anything else as it is", () => {
    expect(originalMediaUrl(RAW)).toBe(RAW);
    expect(originalMediaUrl("/api/media/x/a.png")).toBe("/api/media/x/a.png");
    expect(originalMediaUrl("https://cdn.example/x.png?w=640")).toBe("https://cdn.example/x.png?w=640");
  });

  it("undoes exactly what the page's resized copies add (media/url.ts thumbUrl)", () => {
    for (const width of [640, 1600] as const) {
      expect(originalMediaUrl(thumbUrl(RAW, width)!)).toBe(RAW);
      expect(originalMediaUrl(thumbUrl("/api/media/generated-images/u/b.png", width)!)).toBe("/api/media/generated-images/u/b.png");
    }
  });
});

describe("shotFileUrl", () => {
  const still = { kind: "still" as const, status: "succeeded", resultUrl: thumbUrl(RAW, 640), viewUrl: thumbUrl(RAW, 1600) };

  it("is nothing for a shot that isn't finished", () => {
    expect(shotFileUrl({ ...still, status: "failed" })).toBeNull();
    expect(shotFileUrl({ kind: "take", status: "generating", resultUrl: null, viewUrl: null })).toBeNull();
  });

  it("is a still's original, from the viewer's copy or the strip's", () => {
    expect(shotFileUrl(still)).toBe(RAW);
    // A still that just landed carries the raw url as both (set-view.tsx shoot).
    expect(shotFileUrl({ ...still, resultUrl: RAW, viewUrl: null })).toBe(RAW);
    expect(shotFileUrl({ ...still, resultUrl: null, viewUrl: null })).toBeNull();
  });

  it("is a take's raw clip", () => {
    const clip = "/api/media/generated-videos/u/c.mp4?v=sig";
    expect(shotFileUrl({ kind: "take", status: "succeeded", resultUrl: clip, viewUrl: null })).toBe(clip);
  });
});

describe("shotFileName", () => {
  it("names the set, the kind, its number and the stored file's extension", () => {
    expect(shotFileName("Pit Lane", "still", 3, "/api/media/generated-images/u/a.png?v=s")).toBe("pit-lane-still-3.png");
    expect(shotFileName("Pit Lane", "take", 2, "/api/media/generated-videos/u/c.mp4?v=s")).toBe("pit-lane-take-2.mp4");
    expect(shotFileName("Pit Lane", "still", 1, "/api/media/generated-images/u/a.JPG?v=s")).toBe("pit-lane-still-1.jpg");
  });

  it("falls back to the kind's own extension, and to 'set' for an untitled set", () => {
    expect(shotFileName("Pit Lane", "still", 4, "/api/media/generated-images/u/a")).toBe("pit-lane-still-4.png");
    expect(shotFileName("Pit Lane", "take", 4, "/api/media/generated-videos/u/c?v=s")).toBe("pit-lane-take-4.mp4");
    expect(shotFileName("", "still", 1, RAW)).toBe("set-still-1.png");
  });
});
