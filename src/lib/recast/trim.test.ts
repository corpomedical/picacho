import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeMp4 } from "../media/mp4-probe";
import { recastCreditCost } from "./recast";
import {
  clampRecastWindow,
  cutsInWindow,
  defaultRecastWindow,
  isWholeClip,
  recastFitFor,
  recastSendWindow,
  recastTrimArgs,
  recastWindowCredits,
  recastWindowProblem,
  windowedClip,
} from "./trim";

// The window. It exists because the operator's first real take — a 28 s
// clip — was quietly moved into the one job that took 28 s, the one that
// builds the picture from the character's photo, and came back as a room of
// invented children. These pin that a long clip now keeps any job, and that
// the price and the cut agree with what the door showed.

describe("the window a job opens with", () => {
  it("is the whole clip when it fits, and the job's own ceiling when it does not", () => {
    expect(defaultRecastWindow(8, "scene")).toEqual({ start: 0, end: 8 });
    // The operator's clip: 28.4 s. Into the clip took 15 until the long take
    // (lib/generations/chain.ts, 2026-09-19); now it takes the whole of it.
    expect(defaultRecastWindow(28.4, "scene")).toEqual({ start: 0, end: 28.4 });
    expect(defaultRecastWindow(40, "scene")).toEqual({ start: 0, end: 30 });
    expect(defaultRecastWindow(28.4, "motion")).toEqual({ start: 0, end: 28.4 });
    expect(defaultRecastWindow(28.4, "world")).toEqual({ start: 0, end: 10 });
  });
});

describe("what is sent to an engine with a ceiling", () => {
  // H3 refused the operator's 0–15 s restage as "over 15.0 seconds" (2026-09-20).
  it("ends a tenth under the ceiling, and leaves every other engine's window alone", () => {
    expect(recastSendWindow({ start: 0, end: 15 }, 15)).toEqual({ start: 0, end: 14.9 });
    expect(recastSendWindow({ start: 7.3, end: 22.3 }, 15)).toEqual({ start: 7.3, end: 22.2 });
    expect(recastSendWindow({ start: 0, end: 8 }, 15)).toEqual({ start: 0, end: 8 });
    expect(recastSendWindow({ start: 0, end: 30 }, undefined)).toEqual({ start: 0, end: 30 });
  });
  it("makes the whole of a 15 s clip a cut, so it is never sent as it is", () => {
    expect(isWholeClip(recastSendWindow({ start: 0, end: 15.02 }, 15), 15.02)).toBe(false);
  });
});

describe("clamping", () => {
  it("keeps the start where it was put and moves the end", () => {
    expect(clampRecastWindow({ start: 12, end: 28.4 }, 28.4, "world")).toEqual({ start: 12, end: 22 });
    expect(clampRecastWindow({ start: 5, end: 40 }, 40, "scene")).toEqual({ start: 5, end: 35 });
  });

  it("never lets a window leave the clip or fall under the shortest take", () => {
    expect(clampRecastWindow({ start: -4, end: 2 }, 28.4, "scene")).toEqual({ start: 0, end: 3 });
    expect(clampRecastWindow({ start: 27, end: 40 }, 28.4, "scene")).toEqual({ start: 25.4, end: 28.4 });
    expect(clampRecastWindow({ start: NaN, end: NaN }, 28.4, "scene")).toEqual({ start: 0, end: 28.4 });
  });

  it("gives way to a job that takes less when the job is changed", () => {
    // Chosen on Photo to life (30 s) and switched to Into the clip (30 s, in parts): kept.
    expect(clampRecastWindow({ start: 4, end: 28.4 }, 28.4, "scene")).toEqual({ start: 4, end: 28.4 });
    // And on to Restyle (10 s).
    expect(clampRecastWindow({ start: 4, end: 28.4 }, 28.4, "world")).toEqual({ start: 4, end: 14 });
  });
});

describe("a window from the wire", () => {
  it("is checked against the file, never trusted", () => {
    expect(recastWindowProblem({ start: 0, end: 15 }, 28.4, "scene")).toBeNull();
    expect(recastWindowProblem({ start: 0, end: 28.4 }, 28.4, "scene")).toBeNull();
    expect(recastWindowProblem({ start: 0, end: 30.04 }, 40, "scene")).toBeNull();
    expect(recastWindowProblem({ start: 0, end: 31 }, 40, "scene")).toBe("too-long");
    expect(recastWindowProblem({ start: 0, end: 12 }, 28.4, "world")).toBe("too-long");
    expect(recastWindowProblem({ start: 5, end: 6 }, 28.4, "scene")).toBe("too-short");
    expect(recastWindowProblem({ start: 20, end: 31 }, 28.4, "motion")).toBe("outside");
    expect(recastWindowProblem({ start: 9, end: 4 }, 28.4, "motion")).toBe("outside");
    expect(recastWindowProblem({ start: "0", end: 10 }, 28.4, "motion")).toBe("shape");
    expect(recastWindowProblem(null, 28.4, "motion")).toBe("shape");
  });

  it("knows the whole clip needs no cut", () => {
    expect(isWholeClip({ start: 0, end: 28.4 }, 28.4)).toBe(true);
    expect(isWholeClip({ start: 0.02, end: 28.38 }, 28.4)).toBe(true);
    expect(isWholeClip({ start: 0, end: 10 }, 28.4)).toBe(false);
  });
});

describe("what a window costs", () => {
  it("is the engine's own price on the window's share of the clip", () => {
    // 28.4 s at 30 fps = 852 frames; a 10 s window is 300 of them.
    const clip = { seconds: 28.4, frames: 852 };
    expect(windowedClip(clip, { start: 4, end: 14 })).toEqual({ seconds: 10, frames: 300 });
    expect(recastWindowCredits("wan-scene-720", clip, { start: 4, end: 14 })).toBe(recastCreditCost("wan-scene-720", { seconds: 10, frames: 300 }));
    expect(recastWindowCredits("wan-scene-720", clip, { start: 4, end: 14 })).toBe(6);
    expect(recastWindowCredits("kling-pro", clip, { start: 4, end: 14 })).toBe(6);
    // The whole clip prices exactly as the clip.
    expect(recastWindowCredits("kling-pro", clip, { start: 0, end: 28.4 })).toBe(recastCreditCost("kling-pro", clip));
  });
});

describe("the read's cuts, on the window's clock", () => {
  it("keeps only the cuts inside, moved to start at zero", () => {
    expect(cutsInWindow([2, 6.5, 13.9, 20], { start: 4, end: 14 })).toEqual([2.5]);
    expect(cutsInWindow([], { start: 0, end: 10 })).toEqual([]);
  });
});

describe("fitting a clip to the engine", () => {
  const kling = { minSide: 720, maxSide: 3840, minFps: 24, maxFps: 60 };

  it("brings the operator's own source inside Kling O3 Edit's limits", () => {
    // 574×324 at 61.2 fps — two refusals waiting to happen at submit.
    expect(recastFitFor({ width: 574, height: 324, seconds: 29.9905, frames: 1836 }, kling)).toEqual({ width: 1276, height: 720, fps: 60 });
  });

  it("leaves a clip alone when it already fits", () => {
    expect(recastFitFor({ width: 1920, height: 1080, seconds: 10, frames: 300 }, kling)).toBeNull();
    expect(recastFitFor({ width: 720, height: 1280, seconds: 10, frames: 240 }, kling)).toBeNull();
    // An engine with no limits takes anything.
    expect(recastFitFor({ width: 300, height: 200, seconds: 10, frames: 900 }, undefined)).toBeNull();
  });

  it("scales down what is too big, and fixes only the frame rate when only that is wrong", () => {
    expect(recastFitFor({ width: 7680, height: 4320, seconds: 10, frames: 300 }, kling)).toEqual({ width: 3840, height: 2160, fps: null });
    expect(recastFitFor({ width: 1280, height: 720, seconds: 10, frames: 150 }, kling)).toEqual({ width: 1280, height: 720, fps: 24 });
  });

  it("always lands on even sides the encoder can take, never under the floor", () => {
    const f = recastFitFor({ width: 577, height: 341, seconds: 5, frames: 150 }, kling)!;
    expect(f.width % 2).toBe(0);
    expect(f.height % 2).toBe(0);
    expect(Math.min(f.width, f.height)).toBeGreaterThanOrEqual(720);
  });
});

describe("the cut itself, on the real binary", () => {
  const ffmpeg = (() => {
    try {
      const path = createRequire(__filename)("ffmpeg-static") as string | null;
      return path && existsSync(path) ? path : null;
    } catch {
      return null;
    }
  })();
  const source = join(__dirname, "..", "..", "..", "public", "hero-band-3.mp4");

  it.skipIf(!ffmpeg)("cuts exactly the stretch asked for, and keeps it readable", () => {
    const before = probeMp4(readFileSync(source))!;
    const dir = mkdtempSync(join(tmpdir(), "recast-trim-test-"));
    try {
      const out = join(dir, "out.mp4");
      execFileSync(ffmpeg!, recastTrimArgs(source, out, { start: 2.5, end: 6 }));
      const after = probeMp4(readFileSync(out))!;
      expect(after).not.toBeNull();
      // Frame-accurate, not keyframe-rounded: 3.5 s, within a frame.
      expect(after.seconds).toBeGreaterThan(3.45);
      expect(after.seconds).toBeLessThan(3.6);
      // The picture's size is untouched.
      expect(after.width).toBe(before.width);
      expect(after.height).toBe(before.height);
      // And the frames land where the price said they would, within one.
      const priced = windowedClip({ seconds: before.seconds, frames: before.frames }, { start: 2.5, end: 6 }).frames!;
      expect(Math.abs((after.frames ?? 0) - priced)).toBeLessThanOrEqual(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!ffmpeg)("a restage cut of a clip with sound is under the 15.0 s the engine measures", () => {
    const dir = mkdtempSync(join(tmpdir(), "recast-trim-test-"));
    try {
      const src = join(dir, "src.mp4");
      execFileSync(ffmpeg!, [
        "-v", "error", "-y",
        "-f", "lavfi", "-i", "testsrc=size=320x180:rate=30",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
        "-t", "20", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", src,
      ]);
      const out = join(dir, "out.mp4");
      execFileSync(ffmpeg!, recastTrimArgs(src, out, recastSendWindow({ start: 0, end: 15 }, 15), null, false));
      const after = probeMp4(readFileSync(out))!;
      expect(after.seconds).toBeLessThanOrEqual(15);
      expect(after.seconds).toBeGreaterThan(14.8);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
