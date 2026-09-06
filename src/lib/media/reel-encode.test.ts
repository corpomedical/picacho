import { describe, expect, it } from "vitest";
import {
  REEL_CRF,
  REEL_FPS,
  REEL_HEIGHT,
  REEL_WIDTH,
  buildConcatArgs,
  buildConcatList,
  buildSegmentArgs,
  reelDurationSeconds,
  reelStorageKey,
} from "./reel-encode";

// The highlight reel's encoder (2026-09-07, operator: "with the lowest data
// consumption possible and cacheable").
//
// Both halves of that sentence are pinned here. "Cacheable" is the storage
// key: a pure function of the inputs, because /api/media serves `immutable`
// for a year and a key that wobbled would either serve a stale reel forever or
// re-download an identical one. "Lowest data" is the argv: a lost -crf or a
// lost -an quietly multiplies the file.

const seg = (over: Partial<{ generationId: string; startSeconds: number; durationSeconds: number }> = {}) => ({
  generationId: "g1",
  startSeconds: 1,
  durationSeconds: 3,
  ...over,
});

describe("the storage key", () => {
  it("is stable for the same clips cut the same way", () => {
    expect(reelStorageKey("user-1", [seg(), seg({ generationId: "g2" })])).toBe(
      reelStorageKey("user-1", [seg(), seg({ generationId: "g2" })]),
    );
  });

  it("sits under the owner's folder, which storage RLS enforces", () => {
    // storage.foldername(name)[1] = auth.uid() is the policy on the
    // generated-videos bucket, so a key not starting with the user id would be
    // rejected at upload time.
    expect(reelStorageKey("user-1", [seg()])).toMatch(/^user-1\/reel\/[0-9a-f]{32}\.mp4$/);
  });

  it("changes when the winning takes change", () => {
    expect(reelStorageKey("u", [seg({ generationId: "g9" })])).not.toBe(
      reelStorageKey("u", [seg({ generationId: "g1" })]),
    );
  });

  it("changes when the same take is cut at a different point", () => {
    const a = reelStorageKey("u", [seg({ startSeconds: 1 })]);
    const b = reelStorageKey("u", [seg({ startSeconds: 4 })]);
    const c = reelStorageKey("u", [seg({ durationSeconds: 5 })]);
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("distinguishes order, so a re-ranked reel gets its own URL", () => {
    expect(reelStorageKey("u", [seg({ generationId: "g1" }), seg({ generationId: "g2" })])).not.toBe(
      reelStorageKey("u", [seg({ generationId: "g2" }), seg({ generationId: "g1" })]),
    );
  });

  it("does not collide across users", () => {
    expect(reelStorageKey("user-1", [seg()])).not.toBe(reelStorageKey("user-2", [seg()]));
  });
});

describe("cutting one segment", () => {
  const one = { inputPath: "/tmp/a.mp4", startSeconds: 1, durationSeconds: 3 };

  it("seeks before the input, which is the fast seek", () => {
    // -ss must PRECEDE -i; after it, ffmpeg decodes the whole file up to the
    // in-point instead of jumping to the nearest keyframe.
    const args = buildSegmentArgs(one, "/tmp/seg0.mp4");
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"));
    expect(args[args.indexOf("-i") + 1]).toBe("/tmp/a.mp4");
  });

  // Aspect is user-selectable — 16:9 and 9:16 are both offered in the composer
  // — so a bare scale would horizontally squash every vertical take.
  it("letterboxes rather than squashing a take of a different shape", () => {
    const args = buildSegmentArgs(one, "/tmp/seg0.mp4");
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("force_original_aspect_ratio=decrease");
    expect(filter).toContain(`pad=${REEL_WIDTH}:${REEL_HEIGHT}`);
  });

  it("keeps every setting that decides the file size", () => {
    // Dropping any one of these silently multiplies the reel. -an alone was
    // measured at 125 KB per five seconds of dead audio.
    const args = buildSegmentArgs(one, "/tmp/seg0.mp4");
    expect(args).toContain("-an");
    expect(args[args.indexOf("-crf") + 1]).toBe(String(REEL_CRF));
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).toContain(`fps=${REEL_FPS}`);
    expect(filter).toContain(`scale=${REEL_WIDTH}:${REEL_HEIGHT}`);
  });

  // Without a keyframe on the boundary the lossless join can start a segment
  // mid-GOP, which decodes as a smear until the next keyframe.
  it("forces a keyframe on the segment boundary", () => {
    const params = buildSegmentArgs(one, "/tmp/seg0.mp4");
    const x264 = params[params.indexOf("-x264-params") + 1];
    expect(x264).toContain(`keyint=${REEL_FPS}`);
    expect(x264).toContain("scenecut=0");
  });

  it("writes to the path it was handed, last", () => {
    expect(buildSegmentArgs(one, "/tmp/seg0.mp4").at(-1)).toBe("/tmp/seg0.mp4");
  });
});

describe("joining the segments", () => {
  it("copies rather than re-encodes", () => {
    // The segments already share codec parameters, so a second encode here
    // would cost quality and time for nothing.
    const args = buildConcatArgs("/tmp/list.txt", "/tmp/reel.mp4");
    expect(args[args.indexOf("-c") + 1]).toBe("copy");
    expect(args).not.toContain("libx264");
  });

  it("puts the index at the front so playback starts on the first bytes", () => {
    const args = buildConcatArgs("/tmp/list.txt", "/tmp/reel.mp4");
    expect(args[args.indexOf("-movflags") + 1]).toBe("+faststart");
    expect(args.at(-1)).toBe("/tmp/reel.mp4");
  });

  it("writes one demuxer line per segment", () => {
    expect(buildConcatList(["/tmp/a.mp4", "/tmp/b.mp4"])).toBe(
      "file '/tmp/a.mp4'\nfile '/tmp/b.mp4'\n",
    );
  });

  it("refuses a path that would break the list format", () => {
    // A single quote is the demuxer's escape character; a malformed list
    // surfaces as a confusing ffmpeg error much later.
    expect(() => buildConcatList(["/tmp/it's.mp4"])).toThrow();
    expect(() => buildConcatList(["/tmp/a\nb.mp4"])).toThrow();
  });

  it("refuses to build a reel out of nothing", () => {
    expect(() => buildConcatList([])).toThrow();
  });
});

describe("declared duration", () => {
  it("is the sum of the segments, which is what the row records", () => {
    expect(reelDurationSeconds([{ durationSeconds: 3 }, { durationSeconds: 3 }])).toBe(6);
    expect(reelDurationSeconds([])).toBe(0);
  });
});

describe("the frame the reel is encoded to", () => {
  // 640x360 is an exact 2:1 downscale from 1280x720 and an exact 3:1 from
  // 1920x1080 — both of Picacho's source resolutions — so neither resamples.
  it("divides cleanly from both source resolutions", () => {
    expect(1280 / REEL_WIDTH).toBe(2);
    expect(720 / REEL_HEIGHT).toBe(2);
    expect(1920 / REEL_WIDTH).toBe(3);
    expect(1080 / REEL_HEIGHT).toBe(3);
  });
});
