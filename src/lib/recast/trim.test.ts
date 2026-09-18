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
    // The operator's clip: 28.4 s into "Into the clip", which takes 10.
    expect(defaultRecastWindow(28.4, "scene")).toEqual({ start: 0, end: 10 });
    expect(defaultRecastWindow(28.4, "motion")).toEqual({ start: 0, end: 28.4 });
    expect(defaultRecastWindow(28.4, "world")).toEqual({ start: 0, end: 10 });
  });
});

describe("clamping", () => {
  it("keeps the start where it was put and moves the end", () => {
    expect(clampRecastWindow({ start: 12, end: 28.4 }, 28.4, "scene")).toEqual({ start: 12, end: 22 });
  });

  it("never lets a window leave the clip or fall under the shortest take", () => {
    expect(clampRecastWindow({ start: -4, end: 2 }, 28.4, "scene")).toEqual({ start: 0, end: 3 });
    expect(clampRecastWindow({ start: 27, end: 40 }, 28.4, "scene")).toEqual({ start: 25.4, end: 28.4 });
    expect(clampRecastWindow({ start: NaN, end: NaN }, 28.4, "scene")).toEqual({ start: 0, end: 10 });
  });

  it("gives way to a job that takes less when the job is changed", () => {
    // Chosen on Photo to life (30 s), then switched to Into the clip (10 s).
    expect(clampRecastWindow({ start: 4, end: 28.4 }, 28.4, "scene")).toEqual({ start: 4, end: 14 });
  });
});

describe("a window from the wire", () => {
  it("is checked against the file, never trusted", () => {
    expect(recastWindowProblem({ start: 0, end: 10 }, 28.4, "scene")).toBeNull();
    expect(recastWindowProblem({ start: 0, end: 10.04 }, 28.4, "scene")).toBeNull();
    expect(recastWindowProblem({ start: 0, end: 12 }, 28.4, "scene")).toBe("too-long");
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
});
