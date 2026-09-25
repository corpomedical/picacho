import { describe, expect, it } from "vitest";
import { RECAST_CONVERT_LONG_PX, RECAST_CONVERT_MAX_SECONDS, recastConvertArgs, recastFrameArgs } from "./convert";
import { RECAST_MAX_BYTES, RECAST_MAX_SECONDS } from "./recast";

// Any clip into the MP4 a take stands on (2026-09-25). The run itself is
// convert-run.ts; these pin the promises its arguments make.

describe("the conversion's arguments", () => {
  const args = recastConvertArgs("/tmp/in.webm", "/tmp/out.mp4");
  const after = (flag: string) => args[args.indexOf(flag) + 1];

  it("reads the upload and writes an MP4 last", () => {
    expect(after("-i")).toBe("/tmp/in.webm");
    expect(args.at(-1)).toBe("/tmp/out.mp4");
  });

  it("makes H.264 in 4:2:0 and AAC — what every engine decodes", () => {
    expect(after("-c:v")).toBe("libx264");
    expect(after("-pix_fmt")).toBe("yuv420p");
    expect(after("-c:a")).toBe("aac");
    expect(after("-movflags")).toBe("+faststart");
  });

  it("stops a second past the lane's limit, so a long clip is still refused as long", () => {
    expect(RECAST_CONVERT_MAX_SECONDS).toBe(RECAST_MAX_SECONDS + 1);
    expect(after("-t")).toBe(String(RECAST_CONVERT_MAX_SECONDS));
    // Output options: -t sits after the input, so it bounds what is written.
    expect(args.indexOf("-t")).toBeGreaterThan(args.indexOf("-i"));
  });

  it("stays inside the bucket's 50 MB at the longest length", () => {
    const videoBits = Number(after("-maxrate").replace("M", "")) * 1_000_000;
    const audioBits = Number(after("-b:a").replace("k", "")) * 1000;
    expect(((videoBits + audioBits) / 8) * RECAST_CONVERT_MAX_SECONDS).toBeLessThan(RECAST_MAX_BYTES);
  });

  it("keeps each frame's own time — a browser recording's 1000 fps header is not filled in", () => {
    expect(after("-fps_mode")).toBe("vfr");
  });

  it("squares the pixels, then fits 1920 px without enlarging, in even numbers", () => {
    const vf = after("-vf");
    expect(vf).toContain("iw*sar");
    expect(vf).toContain("setsar=1");
    expect(vf).toContain(`min(${RECAST_CONVERT_LONG_PX},iw)`);
    expect(vf).toContain("force_original_aspect_ratio=decrease");
    expect(vf).toContain("force_divisible_by=2");
  });

  it("keeps the first sound track when there is one, and never needs one", () => {
    expect(args.join(" ")).toContain("-map 0:v:0 -map 0:a:0?");
  });
});

describe("a still for the read", () => {
  it("seeks, takes one frame inside the long side, and writes one JPEG", () => {
    const args = recastFrameArgs("/tmp/in.avi", "/tmp/f.jpg", 2.5, 1024, 4);
    expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 4)).toEqual(["-ss", "2.50", "-i", "/tmp/in.avi"]);
    expect(args[args.indexOf("-frames:v") + 1]).toBe("1");
    expect(args[args.indexOf("-vf") + 1]).toContain("min(1024,iw)");
    expect(args.at(-1)).toBe("/tmp/f.jpg");
  });
});
