import { describe, expect, it } from "vitest";
import { footageProblem, nextStep, planUploads, type ClipRecord } from "./job";

describe("job rules", () => {
  it("names upload paths the server chose, and refuses what it can't read", () => {
    const ok = planUploads("u1", "e1", [
      { name: "take 1.MOV", size: 1000, type: "video/quicktime" },
      { name: "song.mp3", size: 50, type: "audio/mpeg" },
    ]);
    expect(ok.error).toBeNull();
    if (ok.error === null) expect(ok.clips.map((c) => c.path)).toEqual(["u1/e1/clip-0.mov", "u1/e1/clip-1.mp3"]);
    expect(planUploads("u1", "e1", [{ name: "x.gif", size: 5, type: "image/gif" }]).error).toContain("isn't a video or audio file");
    expect(planUploads("u1", "e1", [{ name: "big.mp4", size: 2 * 1024 ** 3, type: "video/mp4" }]).error).toContain("over 1 GB");
    expect(planUploads("u1", "e1", []).error).toBe("Add at least one clip.");
  });

  const rec = (probe: ClipRecord["probe"], analyzed = false): ClipRecord => ({
    path: "p",
    name: "n",
    bytes: 1,
    contentType: "video/mp4",
    probe,
    interval: 1,
    sheets: [],
    sceneChanges: [],
    silences: [],
    words: [],
    analyzed,
  });
  const video = { duration: 600, hasVideo: true, hasAudio: true, width: 1920, height: 1080, fps: 30 };

  it("needs picture, and no more than 20 minutes of it", () => {
    expect(footageProblem([rec(video)])).toBeNull();
    expect(footageProblem([rec({ ...video, hasVideo: false })])).toContain("at least one clip with picture");
    expect(footageProblem([rec(video), rec(video), rec({ ...video, duration: 30 })])).toContain("20 minutes");
    expect(footageProblem([rec(null)])).toContain("couldn't be read");
  });

  it("picks the one next step from the row", () => {
    expect(nextStep({ stage: "analyzing", clips: [rec(null)], director: null, plan: null, render: null })).toEqual({ kind: "probe" });
    expect(nextStep({ stage: "analyzing", clips: [rec(video, true), rec(video)], director: null, plan: null, render: null })).toEqual({
      kind: "analyze",
      clip: 1,
    });
    expect(nextStep({ stage: "directing", clips: [], director: null, plan: null, render: null })).toEqual({ kind: "direct" });
    expect(
      nextStep({ stage: "rendering", clips: [], director: null, plan: null, render: { assetId: "a", renderId: "r", startedAt: 0 } }),
    ).toEqual({ kind: "poll" });
    expect(nextStep({ stage: "done", clips: [], director: null, plan: null, render: null })).toEqual({ kind: "none" });
  });
});
