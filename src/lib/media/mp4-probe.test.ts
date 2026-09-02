import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { probeMp4 } from "./mp4-probe";

// Ground truth: the committed homepage reel clips. hero-band-3 was committed
// as "1280x720/10s" (0bee2f7); hero-band-4 is the 15s space trailer
// (e98fc89, "native 1280x720"). If these files are ever replaced, update
// the expectations WITH the replacement.

describe("probeMp4", () => {
  it("reads dimensions and duration from a real render (hero-band-3)", () => {
    const probe = probeMp4(readFileSync("public/hero-band-3.mp4"));
    expect(probe).not.toBeNull();
    expect(probe!.width).toBe(1280);
    expect(probe!.height).toBe(720);
    expect(probe!.seconds).toBeGreaterThan(9);
    expect(probe!.seconds).toBeLessThan(11);
  });

  it("reads the 15s trailer (hero-band-4)", () => {
    const probe = probeMp4(readFileSync("public/hero-band-4.mp4"));
    expect(probe).not.toBeNull();
    expect(probe!.width).toBe(1280);
    expect(probe!.height).toBe(720);
    expect(probe!.seconds).toBeGreaterThan(14);
    expect(probe!.seconds).toBeLessThan(16);
  });

  it("rejects a buffer that is not an MP4", () => {
    expect(probeMp4(Buffer.from("RIFF....WEBPVP8 not a video at all"))).toBeNull();
    expect(probeMp4(Buffer.alloc(4))).toBeNull();
  });
});
