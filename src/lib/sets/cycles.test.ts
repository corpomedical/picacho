import { describe, expect, it } from "vitest";
import {
  CYCLES_BAD_JOB,
  CYCLES_MAX_FRAMES,
  CYCLES_TOO_LONG,
  CYCLES_USD_PER_S,
  CYCLES_JOB_MAX_CHARS,
  HELIOS_CYCLES_CREDITS,
  cyclesDollars,
  cyclesDuration,
  cyclesPath,
  cyclesSize,
  estimateCycles,
  validateCyclesJob,
} from "./cycles";
import { HELIOS_CYCLES_FOR_ALL } from "./set-config";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Blender (Cycles) renders (2026-09-29): the check every job passes on the
// server before a byte is sent or a GPU second spent, the estimate the
// window shows, and the numbers that must match the Modal app.

const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1.6, 8, 1];
const still = () => ({
  kind: "still",
  width: 1920,
  height: 1080,
  samples: 256,
  frameStart: 12,
  frameEnd: 12,
  fps: 24,
  lensMm: 35,
  sensorMm: 24,
  camera: [I],
  tracks: [] as { node: string; m: number[][] }[],
  world: { mode: "simple", background: [0.2, 0.3, 0.5], sky: [0.8, 0.85, 0.9], ground: [0.05, 0.05, 0.04], strength: 0.9 },
  sun: { on: true, dir: [0.4, 0.8, 0.3], color: [1, 0.95, 0.9], strength: 2.6 },
  hour: 15.8,
});
const anim = (frames = 48) => ({
  ...still(),
  kind: "animation",
  width: 1280,
  height: 720,
  samples: 64,
  frameStart: 1,
  frameEnd: frames,
  camera: Array.from({ length: frames }, () => I),
  tracks: [{ node: "helios_item_3", m: Array.from({ length: frames }, () => I) }],
});

describe("a Blender render's job", () => {
  it("takes a still and an animation as the Studio sends them, and drops fields it doesn't know", () => {
    const s = validateCyclesJob({ ...still(), extra: "x" });
    expect(s.ok).toBe(true);
    if (s.ok) expect(s.job).not.toHaveProperty("extra");
    expect(validateCyclesJob(anim()).ok).toBe(true);
  });

  it("refuses sizes, samples and frame counts past the caps", () => {
    const refuse = (patch: object, base: object = still()) => expect(validateCyclesJob({ ...base, ...patch }), JSON.stringify(patch).slice(0, 60)).toEqual({ ok: false, error: CYCLES_BAD_JOB });
    refuse({ width: 3842 });
    refuse({ width: 63 });
    refuse({ width: 1920.5 });
    refuse({ samples: 0 });
    refuse({ samples: 2049 });
    refuse({ samples: 513 }, anim());
    refuse({ width: 2560, height: 1440 }, anim());
    refuse({ frameEnd: 13 }); // a still is one frame
    refuse({ kind: "film" });
    const long = anim(CYCLES_MAX_FRAMES + 1);
    expect(validateCyclesJob(long)).toEqual({ ok: false, error: CYCLES_BAD_JOB });
    expect(validateCyclesJob({ ...anim(), frameEnd: 1 }).ok).toBe(false);
  });

  it("wants one camera matrix a frame, and a track per moving thing with one matrix a frame", () => {
    expect(validateCyclesJob({ ...anim(), camera: [I, I] }).ok).toBe(false);
    expect(validateCyclesJob({ ...anim(), tracks: [{ node: "helios_item_3", m: [I] }] }).ok).toBe(false);
    expect(validateCyclesJob({ ...anim(), tracks: [{ node: "Car; rm -rf", m: anim().camera }] }).ok).toBe(false);
    expect(validateCyclesJob({ ...still(), tracks: [{ node: "helios_item_1", m: [I] }] }).ok).toBe(false);
    expect(validateCyclesJob({ ...still(), camera: [[...I.slice(0, 15), Number.NaN]] }).ok).toBe(false);
    const twice = anim();
    twice.tracks = [twice.tracks[0], twice.tracks[0]];
    expect(validateCyclesJob(twice).ok).toBe(false);
  });

  it("checks the sky and the sun", () => {
    expect(validateCyclesJob({ ...still(), world: { ...still().world, mode: "hdri" } }).ok).toBe(false);
    expect(validateCyclesJob({ ...still(), world: { ...still().world, sky: [1, 1] } }).ok).toBe(false);
    expect(validateCyclesJob({ ...still(), sun: { ...still().sun, dir: [0, 0, 0] } }).ok).toBe(false);
    expect(validateCyclesJob(null).ok).toBe(false);
    expect(validateCyclesJob([]).ok).toBe(false);
  });

  it("refuses a render the estimate says would run past 90 minutes, in its own words", () => {
    expect(validateCyclesJob({ ...anim(240), width: 1920, height: 1080, samples: 512 })).toEqual({ ok: false, error: CYCLES_TOO_LONG });
    expect(validateCyclesJob({ ...still(), width: 3840, height: 2160, samples: 2048 })).toEqual({ ok: true, job: expect.any(Object) });
  });

  it("keeps the job's text under its cap for the longest animation the caps allow", () => {
    const big = { ...anim(240), tracks: Array.from({ length: 64 }, (_, n) => ({ node: `helios_item_${n}`, m: Array.from({ length: 240 }, () => I.map((v) => v + 0.12345)) })) };
    expect(JSON.stringify(big).length).toBeLessThan(CYCLES_JOB_MAX_CHARS);
  });
});

describe("the estimate and the money", () => {
  it("prices a second of the container from Modal's list (read 2026-09-29): L40S + 4 cores + 16 GiB", () => {
    expect(CYCLES_USD_PER_S).toBeCloseTo(0.000542 + 4 * 0.0000131 + 16 * 0.00000222, 12);
    expect(CYCLES_USD_PER_S).toBeCloseTo(0.00062992, 10);
  });

  it("matches the quote: a 1080p still at 256 samples ≈ $0.04, 240 frames of 1080p at 128 ≈ $2.27", () => {
    const s = estimateCycles({ width: 1920, height: 1080, samples: 256, frames: 1 });
    expect(s.seconds).toBeCloseTo(60, 0);
    expect(cyclesDollars(s.usd)).toBe("$0.04");
    const a = estimateCycles({ width: 1920, height: 1080, samples: 128, frames: 240 });
    expect(Math.round(a.seconds)).toBe(3630);
    expect(cyclesDollars(a.usd)).toBe("$2.29");
  });

  it("charges nothing yet, and opens to nobody but admins", () => {
    expect(HELIOS_CYCLES_CREDITS).toBeNull();
    expect(HELIOS_CYCLES_FOR_ALL).toBe(false);
  });

  it("says times and sizes the way the window shows them", () => {
    expect([cyclesDuration(42), cyclesDuration(61), cyclesDuration(3900)]).toEqual(["42 s", "1 min", "1 h 5 min"]);
    expect(cyclesSize(16 / 9, 1920)).toEqual([1920, 1080]);
    expect(cyclesSize(9 / 16, 1920)).toEqual([1080, 1920]);
    expect(cyclesSize(2.39, 1280)).toEqual([1280, 536]);
    expect(cyclesDollars(0.004)).toBe("$0.004");
  });

  it("keeps each render's files in the owner's own sets folder, named by set and press", () => {
    expect(cyclesPath("u", "s", "p", "mp4")).toBe("u/sets/s.cycles.p.mp4");
  });

  it("names the same machine as the Modal app", () => {
    const py = readFileSync(join(__dirname, "..", "..", "..", "modal", "helios_cycles.py"), "utf8");
    expect(py).toMatch(/^GPU = "L40S"$/m);
    expect(py).toMatch(/^CPU_CORES = 4\.0$/m);
    expect(py).toMatch(/^MEMORY_MIB = 16 \* 1024$/m);
    expect(py).toMatch(/^TIMEOUT_S = 6000$/m);
    expect(py).toMatch(/requires_proxy_auth=True/);
    expect(py).toMatch(/retries=0/);
  });
});
