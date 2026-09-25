import { describe, expect, it } from "vitest";
import { backdrops, buildTimeline, moveClip, snap, splitClip, trimEnd, trimStart, type ProjectElement, type TimelineClip } from "./timeline";

const el = (id: string, tag: string, attributes: Record<string, string>, extra: Partial<ProjectElement> = {}): ProjectElement => ({
  id,
  tag,
  attributes,
  classNames: [],
  text: null,
  children: [],
  ...extra,
});

// Shaped like a real delivered project: a root, story shots with a blurred
// backdrop, a caption made of word spans, the customer's clip sound, a song and a hit.
const root = el(
  "hf-root",
  "div",
  { "data-composition-id": "main", "data-start": "0", "data-duration": "30" },
  {
    children: [
      el("hf-b0", "video", { src: "assets/fill-0.mp4", muted: "", "data-start": "0" }, { classNames: ["clip", "shot", "fill"] }),
      el("hf-v0", "video", { src: "footage/clip-0.mp4", "data-start": "0", "data-media-start": "1.5", "data-volume": "0" }),
      el("hf-v1", "video", { src: "footage/clip-2.mov", "data-start": "6.5" }),
      el(
        "hf-c0",
        "div",
        { "data-start": "0.8" },
        { classNames: ["cap"], children: [el("hf-w0", "span", {}, { text: "ONE" }), el("hf-w1", "span", {}, { text: "FACE" })] },
      ),
      el("hf-a0", "audio", { src: "footage/clip-0.mp4", "data-start": "0", "data-volume": "0.4" }),
      el("hf-a1", "audio", { src: "assets/music/score.mp3", "data-start": "0" }),
      el("hf-a2", "audio", { src: "assets/sfx/hit-low.wav", "data-start": "17" }),
      el("hf-img", "img", { src: "assets/logo.png", "data-start": "26" }),
    ],
  },
);
const timings = {
  "hf-root": { enterAt: 0, exitAt: 30 },
  "hf-b0": { enterAt: 0, exitAt: 6.5 },
  "hf-v0": { enterAt: 0, exitAt: 6.5 },
  "hf-v1": { enterAt: 6.5, exitAt: 17 },
  "hf-c0": { enterAt: 0.8, exitAt: 4.5 },
  "hf-w0": { enterAt: 0.8, exitAt: 4.5 },
  "hf-a0": { enterAt: 0, exitAt: 30 },
  "hf-a1": { enterAt: 0, exitAt: 30 },
  "hf-a2": { enterAt: 17, exitAt: 17.8 },
  "hf-img": { enterAt: 26, exitAt: 30 },
};

describe("reading a project onto tracks", () => {
  const tl = buildTimeline([root], timings, ["school-crowd.mp4", "snow.mp4", "surf.mov"]);
  const lane = (key: string) => tl.lanes.find((l) => l.key === key);

  it("puts each element on its track, top to bottom like an editor", () => {
    expect(tl.duration).toBe(30);
    expect(tl.lanes.map((l) => l.code)).toEqual(["V3", "V2", "V1", "A1", "A2", "A3"]);
    expect(lane("story")?.clips.map((c) => c.label)).toEqual(["school-crowd.mp4", "surf.mov"]);
    expect(lane("titles")?.clips.map((c) => c.label)).toEqual(["ONE FACE"]);
    expect(lane("clip-sound")?.clips[0]).toMatchObject({ footage: 0, volume: 0.4 });
    expect(lane("music")?.clips[0]).toMatchObject({ label: "score", start: 0, end: 30 });
    expect(lane("effects")?.clips[0]).toMatchObject({ label: "hit low", start: 17 });
    expect(lane("graphics")?.clips[0].kind).toBe("image");
  });

  it("keeps the blurred backdrops behind their shots, and a caption's words inside the caption", () => {
    expect(tl.lanes.some((l) => l.key === "backdrop")).toBe(false);
    expect(backdrops([root], timings).map((b) => b.id)).toEqual(["hf-b0"]);
    expect(tl.lanes.flatMap((l) => l.clips).some((c) => c.id === "hf-w0")).toBe(false);
  });

  it("always shows the tracks you add to (titles, story, music, effects), even empty", () => {
    const bare = buildTimeline([el("r", "div", { "data-composition-id": "m", "data-start": "0" })], { r: { enterAt: 0, exitAt: 10 } });
    expect(bare.lanes.map((l) => l.code)).toEqual(["V2", "V1", "A2", "A3"]);
  });
});

describe("editing on the timeline", () => {
  const shot: TimelineClip = { id: "v", lane: "story", kind: "video", label: "", start: 6.5, end: 17, mediaStart: 2, src: "footage/clip-2.mov", footage: 2, volume: 1, muted: false };

  it("moves and trims without going below zero or a tenth of a second", () => {
    expect(moveClip(shot, -3)).toEqual({ id: "v", start: 0 });
    expect(trimEnd(shot, 12)).toEqual({ id: "v", duration: 5.5 });
    expect(trimEnd(shot, 6)).toEqual({ id: "v", duration: 0.1 });
  });

  it("trims the front so the frames that stay keep their place, and never before the source's start", () => {
    expect(trimStart(shot, 8)).toEqual({ id: "v", start: 8, duration: 9, mediaStart: 3.5 });
    // Only 2 s of source exist before this clip's first frame.
    expect(trimStart(shot, 1)).toEqual({ id: "v", start: 4.5, duration: 12.5, mediaStart: 0 });
    const title: TimelineClip = { ...shot, kind: "text", mediaStart: 0 };
    expect(trimStart(title, 1)).toEqual({ id: "v", start: 1, duration: 16 });
  });

  it("splits a shot into two that play on, the second reading its source from the cut", () => {
    const out = splitClip(shot, 10, { tag: "video", attributes: { src: "footage/clip-2.mov", "data-hf-id": "hf-v1", playsinline: "", "data-volume": "1" }, classNames: ["clip", "shot"] }, "v1b");
    expect(out?.first).toEqual({ id: "v", duration: 3.5 });
    expect(out?.secondHtml).toBe('<video src="footage/clip-2.mov" playsinline data-volume="1" id="v1b" data-start="10" data-duration="7" data-media-start="5.5" class="clip shot"></video>');
    expect(splitClip(shot, 6.55, { tag: "video", attributes: {}, classNames: [] }, "x")).toBeNull();
    expect(splitClip({ ...shot, kind: "text" }, 10, { tag: "div", attributes: {}, classNames: [] }, "x")).toBeNull();
  });

  it("snaps to the nearest point in reach", () => {
    expect(snap(6.62, [0, 6.5, 17], 0.2)).toBe(6.5);
    expect(snap(7.2, [0, 6.5, 17], 0.2)).toBe(7.2);
  });
});
