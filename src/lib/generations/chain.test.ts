import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeMp4 } from "../media/mp4-probe";
import { recastCreditCost } from "../recast/recast";
import { forceRefundEligible } from "./refund-rules";
import { ChainRetry, encoderFailure } from "./chain-failure";
import {
  AGREE_H,
  AGREE_W,
  CHAIN_CLIP_PLACEHOLDER,
  CHAIN_LOOK_PLACEHOLDER,
  CHAIN_STILL_MAX_PX,
  chainPieceBody,
  chainStillArgs,
  CHAIN_DISSOLVE_FRAMES,
  CHAIN_FPS,
  CHAIN_MIN_NEW_FRAMES,
  CHAIN_PIECE_MAX_FRAMES,
  CHAIN_PREFIX_FRAMES,
  CHAIN_TAIL_FRAMES,
  chainAgreementArgs,
  chainBilledSeconds,
  chainFirstPieceArgs,
  chainFrameDistance,
  chainJoinArgs,
  chainJoinOffset,
  chainJoinSpans,
  chainMinutes,
  chainMotion,
  chainNextPieceArgs,
  chainPieceCount,
  chainRequestOf,
  chainSwitchAt,
  chainWindowArgs,
  chainWindowSize,
  planChain,
} from "./chain";

// THE LONG TAKE. The operator asked whether a 30 s clip could be made as
// 15 + 15 and come out as one; the seam tests on his own clip (2026-09-19)
// said: only if every later piece opens on the last second of the one before,
// each join sits where the renders agree, and every hand-over to the footage
// falls at a still moment. The first shipped chain then showed two more
// things — a render may come back a few frames SHORT, and a piece opened on a
// busy second re-draws it loosely — and these pin the answers to both. The
// real encoder runs over a clip with renders cut short on purpose, because an
// argument off by one frame is a visible jump, or picture drifting from sound,
// that nobody would see until a paid take showed it.

describe("how many pieces, and what they can cost", () => {
  it("is one piece up to the engine's own 15 s, and up to three past it", () => {
    expect(chainPieceCount(10)).toBe(1);
    expect(chainPieceCount(15.04)).toBe(1);
    expect(chainPieceCount(16)).toBe(2);
    // 348 new frames, then 336: two pieces reach 28.5 s.
    expect(chainPieceCount(28.5)).toBe(2);
    expect(chainPieceCount(29)).toBe(3);
    expect(chainPieceCount(30)).toBe(3);
  });

  it("counts pieces in frames — what a piece actually holds", () => {
    expect(chainPieceCount(361 / CHAIN_FPS)).toBe(1);
    expect(chainPieceCount(684 / CHAIN_FPS)).toBe(2);
    expect(chainPieceCount(685 / CHAIN_FPS)).toBe(3);
  });

  it("is quoted at the most the pieces can bill, overlap, tails and rounding in", () => {
    expect(chainBilledSeconds(10)).toBe(10);
    expect(chainBilledSeconds(15)).toBe(15);
    // Two pieces: 20 s + 1.5 re-rendered = 21.5 → 22, plus one rounding.
    expect(chainBilledSeconds(20)).toBe(23);
    // The operator's 30 s: 30 + 3 = 33, plus two roundings.
    expect(chainBilledSeconds(30)).toBe(35);
    // 35 s at $0.168 = $5.88, over the $0.28 basis = 21 credits.
    expect(recastCreditCost("kling-edit", { seconds: 30, frames: null })).toBe(21);
    // Up to 15 s the price is exactly what it was.
    expect(recastCreditCost("kling-edit", { seconds: 10, frames: null })).toBe(6);
  });

  it("never quotes less than any real placement bills", () => {
    // Kling bills each piece on its length rounded up (ledger: 6.0 s → 7.2
    // units at 1.2 a second, 14.99 s → 18). Every placement the limits allow,
    // at every length from 15 s to 30 s in quarter seconds.
    const billed = (lengths: number[]) => lengths.reduce((s, l) => s + Math.ceil(l / CHAIN_FPS), 0);
    for (let quarter = 61; quarter <= 120; quarter++) {
      const total = quarter * 6;
      const seconds = total / CHAIN_FPS;
      const bound = chainBilledSeconds(seconds);
      const n = chainPieceCount(seconds);
      for (let s1 = CHAIN_MIN_NEW_FRAMES; s1 <= CHAIN_PIECE_MAX_FRAMES - CHAIN_TAIL_FRAMES; s1 += 5) {
        if (n === 2) {
          const last = total - s1;
          if (last < CHAIN_MIN_NEW_FRAMES || last > CHAIN_PIECE_MAX_FRAMES - CHAIN_PREFIX_FRAMES) continue;
          expect(billed([s1 + CHAIN_TAIL_FRAMES, CHAIN_PREFIX_FRAMES + last])).toBeLessThanOrEqual(bound);
          continue;
        }
        for (let s2 = s1 + CHAIN_MIN_NEW_FRAMES; s2 <= s1 + CHAIN_PIECE_MAX_FRAMES - CHAIN_PREFIX_FRAMES - CHAIN_TAIL_FRAMES; s2 += 7) {
          const last = total - s2;
          if (last < CHAIN_MIN_NEW_FRAMES || last > CHAIN_PIECE_MAX_FRAMES - CHAIN_PREFIX_FRAMES) continue;
          expect(
            billed([s1 + CHAIN_TAIL_FRAMES, CHAIN_PREFIX_FRAMES + s2 - s1 + CHAIN_TAIL_FRAMES, CHAIN_PREFIX_FRAMES + last]),
          ).toBeLessThanOrEqual(bound);
        }
      }
    }
  });

  it("says roughly how long it waits — about a minute a rendered second", () => {
    // Measured: 14.4 s in 718 s, 5.5 s in 389 s, 12 s in 601 s — 28 minutes for 30 s.
    expect(chainMinutes(10)).toBe(10);
    expect(chainMinutes(30)).toBe(35);
  });
});

describe("where the pieces hand over to the footage", () => {
  // Busy throughout, but for the stretches given — whole seconds, since the
  // second a piece opens on is what it must re-draw.
  const motion = (frames: number, calm: [number, number][]) =>
    Array.from({ length: frames }, (_, f) => (f === 0 ? 0 : calm.some(([a, b]) => f >= a && f < b) ? 0.5 : 8 + (f % 5)));

  it("leaves a take the engine renders whole alone", () => {
    expect(planChain(360, motion(360, []))).toEqual({ switches: [], lengths: [360], stillness: [] });
  });

  it("switches where the whole second before is still, not where one frame is", () => {
    // 30 s with two still seconds, 322–350 and 576–604. A switch at s opens
    // the next piece on s−24…s: only 346–347 and 600–601 keep all of it still.
    const plan = planChain(720, motion(720, [[322, 350], [576, 604]]))!;
    expect(plan.switches).toHaveLength(2);
    expect(plan.switches[0]).toBeGreaterThanOrEqual(346);
    expect(plan.switches[0]).toBeLessThanOrEqual(347);
    expect(plan.switches[1]).toBeGreaterThanOrEqual(600);
    expect(plan.switches[1]).toBeLessThanOrEqual(601);
    expect(Math.max(...plan.stillness)).toBeLessThan(0.2);
    // A still FRAME inside a busy second is not a still second.
    const blip = planChain(720, motion(720, [[344, 349], [576, 604]]))!;
    expect(blip.stillness[0]).toBeGreaterThan(0.5);
  });

  it("always keeps every piece inside the engine's limits, tails included", () => {
    for (const total of [361, 480, 600, 684, 685, 697, 720]) {
      const plan = planChain(total, motion(total, [[200, 230], [500, 530]]))!;
      expect(plan).not.toBeNull();
      for (const [i, l] of plan.lengths.entries()) {
        expect(l, `${total} piece ${i}`).toBeLessThanOrEqual(plan.lengths.length === 1 ? CHAIN_PIECE_MAX_FRAMES + 1 : CHAIN_PIECE_MAX_FRAMES);
      }
      // The pieces' new footage covers the take exactly once.
      const n = plan.lengths.length;
      const covered = plan.lengths.reduce(
        (s, l, i) => s + l - (i === 0 ? 0 : CHAIN_PREFIX_FRAMES) - (i === n - 1 ? 0 : CHAIN_TAIL_FRAMES),
        0,
      );
      expect(covered).toBe(total);
      if (n > 1) {
        expect(plan.lengths[0]).toBe(plan.switches[0] + CHAIN_TAIL_FRAMES);
        expect(plan.lengths[n - 1]).toBe(CHAIN_PREFIX_FRAMES + total - plan.switches[n - 2]);
      }
    }
  });

  it("balances the pieces when every moment is as still as the next", () => {
    // Twenty minutes for one 15 s piece against nine for a 10 s one.
    const flat = Array.from({ length: 720 }, (_, f) => (f === 0 ? 0 : 1));
    expect(Math.max(...planChain(720, flat)!.lengths)).toBeLessThanOrEqual(264);
  });

  it("refuses what three pieces cannot hold", () => {
    // 348 + 324 + 336 = 1,008 frames (42 s). The product stops at 30 s
    // (CHAIN_MAX_SECONDS, enforced by the door and the action).
    expect(planChain(1008, motion(1008, []))).not.toBeNull();
    expect(planChain(1009, motion(1009, []))).toBeNull();
  });

  it("measures change in the middle of the picture, where the person is", () => {
    const w = 10;
    const h = 10;
    const frame = (fill: (x: number, y: number) => number) => Array.from({ length: w * h }, (_, i) => fill(i % w, Math.floor(i / w)));
    const still = frame(() => 100);
    const edgeMoves = frame((x) => (x === 0 ? 255 : 100));
    const middleMoves = frame((x, y) => (x === 5 && y === 5 ? 200 : 100));
    const m = chainMotion(Uint8Array.from([...still, ...edgeMoves, ...middleMoves]), w, h);
    expect(m[0]).toBe(0);
    expect(m[1]).toBe(0);
    expect(m[2]).toBeGreaterThan(0);
  });
});

describe("a render that comes back short", () => {
  it("hands over where the render ends when it no longer reaches the planned switch", () => {
    // The proof: part 2 was sent 133 frames and came back with 129.
    expect(chainSwitchAt(456, 322, 146)).toBe(456);
    expect(chainSwitchAt(456, 322, 129)).toBe(451);
  });

  it("holds the last frame so the picture ends with the sound", () => {
    // The first shipped chain's own numbers, with the tails it now renders:
    // part 1 came back 1 short, part 2 four short, part 3 two short.
    const { spans, hold } = chainJoinSpans(
      [
        { start: 0, frames: 357 },
        { start: 322, frames: 142 },
        { start: 432, frames: 286 },
      ],
      [346, 456],
      [15, 17],
      720,
    );
    const half = CHAIN_DISSOLVE_FRAMES / 2;
    expect(spans).toEqual([
      { piece: 0, from: 0, to: 337 + half },
      { piece: 1, from: 337 - half - 322, to: 449 + half - 322 },
      { piece: 2, from: 449 - half - 432, to: 286 },
    ]);
    expect(hold).toBe(2);
    // Every source frame once, the dissolves' overlaps aside.
    const frames = spans.reduce((s, x) => s + x.to - x.from, 0) + hold - 2 * CHAIN_DISSOLVE_FRAMES;
    expect(frames).toBe(720);
  });
});

describe("where each join sits", () => {
  it("centres on the frame where the renders agree best, with the dissolve inside the second", () => {
    const measured = [9, 9, 1.7, 1.7, 1.6, 1.6, 1.7, 1.8, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    expect(chainJoinOffset(measured)).toBe(4);
    expect(chainJoinOffset(Array(24).fill(0))).toBe(CHAIN_DISSOLVE_FRAMES / 2 + 1);
    const lateBest = Array.from({ length: 24 }, (_, j) => 24 - j);
    expect(chainJoinOffset(lateBest)).toBe(CHAIN_PREFIX_FRAMES - CHAIN_DISSOLVE_FRAMES / 2 - 1);
  });

  it("compares small grey frames", () => {
    expect(chainFrameDistance(Uint8Array.from([0, 10]), Uint8Array.from([4, 6]))).toBe(4);
  });
});

describe("the request each piece is sent with", () => {
  it("is composed whole by the lane, with the clip's field found by its placeholder", () => {
    const body = { video_url: CHAIN_CLIP_PLACEHOLDER, prompt: "Replace Person A", keep_audio: true };
    expect(chainRequestOf("fal-ai/kling-video/o3/pro/video-to-video/edit", "Kling O3 Edit Pro", body)).toEqual({
      endpoint: "fal-ai/kling-video/o3/pro/video-to-video/edit",
      label: "Kling O3 Edit Pro",
      body,
      clipField: "video_url",
    });
    expect(chainRequestOf("x/y", "x", { video_url: "https://example.test/a.mp4" })).toBeNull();
  });

  it("prepares the window at the engine's floor of 720, keeping its shape", () => {
    expect(chainWindowSize({ width: 574, height: 324 })).toEqual({ width: 1276, height: 720 });
    expect(chainWindowSize({ width: 1920, height: 1080 })).toEqual({ width: 1280, height: 720 });
    expect(chainWindowSize({ width: 1080, height: 1920 })).toEqual({ width: 720, height: 1280 });
  });
});

describe("the runner's side of a long take", () => {
  const runner = readFileSync(join(__dirname, "job-runner.ts"), "utf8");

  it("leaves a piece for a route that carries the encoder rather than claiming and failing it", () => {
    const check = runner.indexOf("if (chainStep && !chainEncoderAvailable())");
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(runner.indexOf("chainStep ? CHAIN_LEASE_SECONDS : ADVANCE_LEASE_SECONDS"));
  });

  it("holds the claim long enough to encode, inside the 300 s every route may run", () => {
    const lease = Number(runner.match(/const CHAIN_LEASE_SECONDS = (\d+);/)?.[1]);
    expect(lease).toBeGreaterThan(90);
    expect(lease).toBeLessThan(300);
  });

  it("keeps the take for another pass when our side fails between paid pieces", () => {
    const branch = runner.slice(runner.indexOf("if (err instanceof ChainRetry)"));
    expect(branch.slice(0, 800)).toContain("await releaseAdvanceClaim(admin, generationId, row.provider_request_id, {");
    expect(branch.slice(0, 800)).toContain("throw new CriticalWriteError(");
  });

  it("writes why the step failed onto the row, counting, and clears it when the next piece starts", () => {
    // The counting itself is nextChainError's (chain-failure.test.ts); since
    // 2026-09-22 it also keeps when the first failure was, and is read.
    const branch = runner.slice(runner.indexOf("if (err instanceof ChainRetry)"));
    expect(branch.slice(0, 800)).toContain("const chainError = nextChainError(row.payload.chainError, err.message, now);");
    expect(branch.slice(0, 800)).toContain("...row.payload,\n            chainError,\n");
    expect(runner).toContain("payload: { ...row.payload, chain: nextChain, chainError: undefined,");
    // The release writes the payload only when it is given one.
    expect(runner).toContain(".update({ advance_lock: null, advance_locked_at: null, ...(payload ? { payload } : {}) })");
  });
  it("records the next piece only where it collected this one — the dialogue stages' fence", () => {
    const write = runner.slice(runner.indexOf("let pieceWrite = admin"));
    expect(write).toContain('.eq("stage", "video" satisfies JobStage)');
    expect(write).toContain('pieceWrite.eq("provider_request_id", row.provider_request_id)');
    expect(write).toContain('await cancelVideoJob({ ...next, provider: "fal" });');
  });

  it("records what each piece really came back with, and measures on from that", () => {
    expect(runner).toContain("frames: [...chain.frames, prepared.renderFrames]");
    expect(runner).toContain("switches: chain.switches.map((s, i) => (i === k ? prepared.switchAt : s))");
    expect(runner).toContain("starts: [...chain.starts, prepared.switchAt - CHAIN_PREFIX_FRAMES]");
  });

  it("fills in only the clip of a request the lane composed", () => {
    expect(runner).toContain("chainPieceBody(request, prepared.inputUrl, prepared.lookUrl)");
  });

  it("marks a finished piece as billed, so a refused later piece is not refunded as free", () => {
    expect(runner).toContain("`Rendered the video's part ${k + 1} of ${pieces} — part ${k + 2} opens on its last second.`");
    const run = (...details: string[]) => [{ steps: details.map((detail) => ({ step: "generate" as const, detail })) }];
    expect(
      forceRefundEligible(
        run(
          "Submitted part 1 of 3 of a 30s clip to Kling O3 Edit Pro.",
          "Rendered the video's part 1 of 3 — part 2 opens on its last second.",
          "fal.ai (Kling O3 Edit Pro) error (422): invalid parameters",
        ),
      ),
    ).toBe(false);
  });

  it("refunds a stop only when no earlier piece was paid for", () => {
    expect(runner).toContain("const earlierPiecesBilled = (row.payload.chain?.index ?? 0) > 0;");
    expect(runner).toContain("((stoppedBeforeStart && !earlierPiecesBilled) || REFUND_ON_FAILURE[row.stage])");
  });

  it("clears a take's working files once it has ended, either way", () => {
    expect(runner).toContain("if (!deleteError && jobRow?.payload?.chain) {");
    expect(runner).toContain("await cleanupChain(admin, jobRow.payload.chain);");
  });
});

// THE STILL AT THE SWITCH (2026-09-20): a later part is sent one second of
// the part before it and then the footage again, so a take that changed the
// whole picture fell back to the footage — the operator's Anubis take built
// an Egyptian field for two parts and came back as the school for the third.
describe("the look a later part carries", () => {
  const request = {
    endpoint: "fal-ai/x",
    label: "X",
    clipField: "video_url",
    body: { video_url: CHAIN_CLIP_PLACEHOLDER, prompt: "…", image_urls: ["https://x/eva.jpg", CHAIN_LOOK_PLACEHOLDER] },
  };

  it("puts the clip in the field the lane named and the still where it left a place", () => {
    const body = chainPieceBody(request, "https://x/piece-2.mp4", "https://x/look-2.jpg");
    expect(body.video_url).toBe("https://x/piece-2.mp4");
    expect(body.image_urls).toEqual(["https://x/eva.jpg", "https://x/look-2.jpg"]);
  });

  it("drops the place rather than sending the placeholder as an image", () => {
    // The first part has no finished frame behind it, and neither has a take
    // started before stills existed.
    const body = chainPieceBody(request, "https://x/piece-1.mp4", null);
    expect(body.image_urls).toEqual(["https://x/eva.jpg"]);
    const alone = chainPieceBody(
      { ...request, body: { video_url: CHAIN_CLIP_PLACEHOLDER, image_urls: [CHAIN_LOOK_PLACEHOLDER] } },
      "https://x/piece-1.mp4",
      null,
    );
    expect(alone).not.toHaveProperty("image_urls");
    expect(JSON.stringify(alone)).not.toContain(CHAIN_LOOK_PLACEHOLDER);
  });

  it("takes the frame the next part opens on, at a size every engine accepts", () => {
    const args = chainStillArgs("/tmp/render.mp4", 317, "/tmp/look.jpg");
    expect(args.join(" ")).toContain("select='eq(n\\,317)'");
    expect(args.join(" ")).toContain(`scale='min(${CHAIN_STILL_MAX_PX},iw)':-2`);
    expect(args.join(" ")).toContain("-frames:v 1");
    // Never a negative frame, whatever the arithmetic upstream.
    expect(chainStillArgs("/tmp/render.mp4", -4, "/tmp/look.jpg").join(" ")).toContain("select='eq(n\\,0)'");
  });
});

describe("why the encoder failed", () => {
  const command = `Command failed: /var/task/node_modules/ffmpeg-static/ffmpeg -y -v error ${"-i /tmp/chain-x/piece.mp4 ".repeat(40)}`;

  it("keeps ffmpeg's own words, not the command line that used to fill the log", () => {
    const err = Object.assign(new Error(command), { code: 1, signal: null, killed: false, stderr: "[AVFilterGraph @ 0x1] No such filter: 'xfade'\n" });
    const failure = encoderFailure("joining the pieces", err);
    expect(failure).toBeInstanceOf(ChainRetry);
    expect(failure.message).toBe("joining the pieces: ffmpeg exit 1: [AVFilterGraph @ 0x1] No such filter: 'xfade'");
    expect(failure.message).not.toContain("Command failed");
  });

  it("reads a buffer's stderr and keeps its END, where ffmpeg says why", () => {
    const stderr = Buffer.from(`${"frame noise ".repeat(200)}Cannot allocate memory`);
    const failure = encoderFailure("reading join 1", Object.assign(new Error(command), { code: 1, stderr }));
    expect(failure.message.endsWith("Cannot allocate memory")).toBe(true);
    expect(failure.message.length).toBeLessThan(1300);
  });

  it("keeps the line that says why, even with ffmpeg 7's thread-stopping lines after it", () => {
    // What Vercel's build printed for the first two real 30 s takes.
    const stderr = [
      "[Parsed_xfade_19 @ 0x2a8a0e80] The inputs needs to be a constant frame rate; current rate of 1/0 is invalid",
      "[Parsed_xfade_19 @ 0x2a8a0e80] Failed to configure output pad on Parsed_xfade_19",
      "[fc#0 @ 0x2a8011c0] Error reinitializing filters!",
      "[fc#0 @ 0x2a8011c0] Task finished with error code: -22 (Invalid argument)",
      "[fc#0 @ 0x2a8011c0] Terminating thread with return code -22 (Invalid argument)",
      "[vost#0:0/libx264 @ 0x2ae338c0] Could not open encoder before EOF",
      "[vost#0:0/libx264 @ 0x2ae338c0] Task finished with error code: -22 (Invalid argument)",
      "[vost#0:0/libx264 @ 0x2ae338c0] Terminating thread with return code -22 (Invalid argument)",
      "[out#0/mp4 @ 0x2a914840] Nothing was written into output file, because at least one of its streams received no packets.",
    ].join("\n");
    const failure = encoderFailure("joining the pieces", Object.assign(new Error(command), { code: 234, stderr }));
    expect(failure.message).toContain("The inputs needs to be a constant frame rate");
  });

  it("says the rate again after every timestamp reset before a dissolve — ffmpeg 7's xfade needs it", () => {
    // ffmpeg 7's setpts marks its output rate unknown; the 6.0 encoder in
    // these tests does not, so only the arguments can show this.
    const args = chainJoinArgs({
      pieces: ["a.mp4", "b.mp4", "c.mp4"],
      spans: [{ piece: 0, from: 0, to: 316 }, { piece: 1, from: 16, to: 108 }, { piece: 2, from: 6, to: 329 }],
      hold: 1,
      window: "w.mp4",
      totalFrames: 720,
      size: { width: 1916, height: 1080 },
      output: "out.mp4",
    });
    const graph = args[args.indexOf("-filter_complex") + 1];
    const chains = graph.split(";").filter((c) => c.includes("setpts"));
    expect(chains).toHaveLength(3);
    for (const c of chains) expect(c).toContain(`setpts=PTS-STARTPTS,fps=${CHAIN_FPS},`);
  });

  it("names a timeout, a kill and a failed start apart", () => {
    expect(encoderFailure("joining", Object.assign(new Error(command), { killed: true, signal: "SIGTERM", stderr: "" })).message).toBe(
      "joining: ffmpeg stopped after 180 s",
    );
    expect(encoderFailure("joining", Object.assign(new Error(command), { killed: false, signal: "SIGKILL", stderr: "" })).message).toBe(
      "joining: ffmpeg killed (SIGKILL)",
    );
    expect(encoderFailure("joining", Object.assign(new Error("spawn EACCES"), { code: "EACCES" })).message).toBe(
      "joining: the encoder couldn't start (EACCES)",
    );
  });

  it("caps the encoder's threads, which is what sizes its memory", () => {
    const args = chainJoinArgs({
      pieces: ["a.mp4", "b.mp4"],
      spans: [{ piece: 0, from: 0, to: 100 }, { piece: 1, from: 10, to: 100 }],
      hold: 0,
      window: "w.mp4",
      totalFrames: 184,
      size: { width: 1920, height: 1080 },
      output: "out.mp4",
    });
    expect(args.join(" ")).toContain("-threads 2");
  });
});

describe("a long take on the real encoder", () => {
  const ffmpeg = (() => {
    try {
      const path = createRequire(__filename)("ffmpeg-static") as string | null;
      return path && existsSync(path) ? path : null;
    } catch {
      return null;
    }
  })();

  it.skipIf(!ffmpeg)("cuts, chains and joins to exactly the source's frames and sound, with renders that come back short", () => {
    const dir = mkdtempSync(join(tmpdir(), "chain-test-"));
    const run = (args: string[]) => execFileSync(ffmpeg!, args, { maxBuffer: 256 * 1024 * 1024 });
    const framesOf = (file: string) => probeMp4(readFileSync(file))!.frames!;
    // Kling's habits, faked: the render comes back larger and SHORT by `drop`.
    const fakeRender = (input: string, output: string, drop: number) => {
      run(["-y", "-v", "error", "-i", input, "-vf", `scale=1920:1080,trim=end_frame=${framesOf(input) - drop}`, "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "copy", output]);
      return framesOf(output);
    };
    try {
      // 20 s of moving test pattern at 30 fps with a tone: two pieces.
      const source = join(dir, "source.mp4");
      run(["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-f", "lavfi", "-i", "sine=frequency=440",
        "-t", "20", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", source]);

      const windowFile = join(dir, "window.mp4");
      run(chainWindowArgs(source, windowFile, { start: 0, end: 20 }, chainWindowSize({ width: 640, height: 360 })));
      const win = probeMp4(readFileSync(windowFile))!;
      expect(win.frames).toBe(480);
      expect(win.height).toBe(720);

      const gray = run(["-v", "error", "-i", windowFile, "-vf", "scale=160:90,format=gray", "-f", "rawvideo", "-"]);
      const plan = planChain(480, chainMotion(new Uint8Array(gray), 160, 90))!;
      expect(plan.lengths).toHaveLength(2);
      expect(plan.lengths[0]).toBe(plan.switches[0] + CHAIN_TAIL_FRAMES);

      // The first piece is the window's opening frames and its tail, exactly.
      const first = join(dir, "first.mp4");
      run(chainFirstPieceArgs(windowFile, first, plan.lengths[0]));
      expect(framesOf(first)).toBe(plan.lengths[0]);
      const render1 = join(dir, "render1.mp4");
      const got1 = fakeRender(first, render1, 4);

      // The second piece opens on the render's second before the switch.
      const switchAt = chainSwitchAt(plan.switches[0], 0, got1);
      expect(switchAt).toBe(plan.switches[0]);
      const second = join(dir, "second.mp4");
      run(chainNextPieceArgs({
        previousRender: render1,
        prefixFrom: switchAt - CHAIN_PREFIX_FRAMES,
        window: windowFile,
        from: switchAt,
        to: 480,
        size: { width: 1920, height: 1080 },
        output: second,
      }));
      expect(framesOf(second)).toBe(plan.lengths[1]);
      const render2 = join(dir, "render2.mp4");
      const got2 = fakeRender(second, render2, 3);

      // Its opening second IS the first render's second before the switch.
      const size = AGREE_W * AGREE_H;
      const before = run(chainAgreementArgs(render1, switchAt - CHAIN_PREFIX_FRAMES, CHAIN_PREFIX_FRAMES));
      const after = run(chainAgreementArgs(render2, 0, CHAIN_PREFIX_FRAMES));
      expect(before.length).toBe(CHAIN_PREFIX_FRAMES * size);
      const agreement = Array.from({ length: CHAIN_PREFIX_FRAMES }, (_, j) =>
        chainFrameDistance(before.subarray(j * size, (j + 1) * size), after.subarray(j * size, (j + 1) * size)),
      );
      expect(Math.max(...agreement)).toBeLessThan(3);

      // And the take is every source frame, once, the short end held, with the window's sound.
      const { spans, hold } = chainJoinSpans(
        [{ start: 0, frames: got1 }, { start: switchAt - CHAIN_PREFIX_FRAMES, frames: got2 }],
        [switchAt],
        [chainJoinOffset(agreement)],
        480,
      );
      expect(hold).toBe(3);
      const take = join(dir, "take.mp4");
      run(chainJoinArgs({ pieces: [render1, render2], spans, hold, window: windowFile, totalFrames: 480, size: { width: 1920, height: 1080 }, output: take }));
      const joined = probeMp4(readFileSync(take))!;
      expect(joined.frames).toBe(480);
      expect(joined.seconds).toBeGreaterThan(19.9);
      expect(joined.seconds).toBeLessThan(20.1);
      const streams = (() => {
        try {
          execFileSync(ffmpeg!, ["-hide_banner", "-i", take], { stdio: "pipe" });
          return "";
        } catch (err) {
          return String((err as { stderr?: Buffer }).stderr ?? "");
        }
      })();
      expect(streams).toMatch(/Audio: aac/);

      // In step with the source to the last frame: testsrc2 draws a moving
      // pattern, so the take's frame f must look like the window's frame f —
      // at the start, across the join and at the very end (the held frame
      // aside).
      const look = (file: string, f: number) => run(["-v", "error", "-i", file, "-vf", `fps=24,trim=start_frame=${f}:end_frame=${f + 1},setpts=PTS-STARTPTS,scale=96:54,format=gray`, "-fps_mode", "passthrough", "-f", "rawvideo", "-"]);
      for (const f of [10, switchAt - 12, switchAt + 12, 470]) {
        const same = chainFrameDistance(look(take, f), look(windowFile, f));
        const off = chainFrameDistance(look(take, f), look(windowFile, f + 3));
        expect(same, `frame ${f}`).toBeLessThan(off);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
