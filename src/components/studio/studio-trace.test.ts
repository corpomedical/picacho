import { describe, expect, it } from "vitest";
import {
  ENV_H,
  ENV_W,
  SUN_DIAMETER_DEG,
  SUN_ZENITH_IRRADIANCE,
  TRACE_PRESETS,
  envAddSplit,
  envAddSun,
  envDir,
  envTexelSolidAngle,
  envUpIrradiance,
  meterExposure,
  physicalSunIrradiance,
  traceDuration,
  traceEstimate,
  traceSamples,
  traceSize,
} from "./studio-trace";

describe("Helios Studio path-traced renders (made to look like Cycles)", () => {
  it("Draft, Final and Custom give the samples; Custom is kept inside the limits", () => {
    expect(traceSamples("still", "draft", 999)).toBe(TRACE_PRESETS.still.draft);
    expect(traceSamples("still", "final", 999)).toBe(TRACE_PRESETS.still.final);
    expect(traceSamples("animation", "final", 999)).toBe(TRACE_PRESETS.animation.final);
    expect(traceSamples("still", "custom", 77.4)).toBe(77);
    expect(traceSamples("still", "custom", 0)).toBe(1);
    expect(traceSamples("animation", "custom", 99999)).toBe(512);
  });

  it("the size is the shot format at ½, 1× or 2×, always with even sides", () => {
    expect(traceSize([1280, 720], 0.5)).toEqual([640, 360]);
    expect(traceSize([1280, 720], 2)).toEqual([2560, 1440]);
    expect(traceSize([864, 1080], 0.5)).toEqual([432, 540]);
    expect(traceSize([1280, 853], 0.5).every((n) => n % 2 === 0)).toBe(true);
  });

  it("the estimate is only given once the device has been timed, and grows with samples, pixels and frames", () => {
    expect(traceEstimate(null, 32, 1280, 720)).toBeNull();
    const one = traceEstimate(900, 32, 1280, 720)!;
    expect(one).toBeCloseTo((900 * 32 * 0.9216) / 1000, 5);
    expect(traceEstimate(900, 64, 1280, 720)).toBeCloseTo(one * 2, 5);
    expect(traceEstimate(900, 32, 1280, 720, 10, 1)).toBeCloseTo((one + 1) * 10, 5);
    expect(traceDuration(26.4)).toBe("26 s");
    expect(traceDuration(200)).toBe("3 min");
    expect(traceDuration(3900)).toBe("1 h 5 min");
  });

  it("the dome uses three's equirect layout: bottom row is straight down, top row straight up, the middle column faces +x", () => {
    expect(envDir(0, 0, ENV_W, ENV_H)[1]).toBeLessThan(-0.999);
    expect(envDir(0, ENV_H - 1, ENV_W, ENV_H)[1]).toBeGreaterThan(0.999);
    const mid = envDir(ENV_W / 2, ENV_H / 2, ENV_W, ENV_H);
    expect(mid[0]).toBeGreaterThan(0.999);
    let total = 0;
    for (let j = 0; j < ENV_H; j++) total += envTexelSolidAngle(j, ENV_W, ENV_H) * ENV_W;
    expect(total).toBeCloseTo(4 * Math.PI, 3);
  });

  it("an even sky of radiance L lights a roof with π·L, as the viewport's hemisphere light does", () => {
    const w = 256, h = 128, data = new Float32Array(w * h * 4);
    envAddSplit(data, w, h, [0.3, 0.2, 0.1], [0.05, 0.05, 0.05]);
    const e = envUpIrradiance(data, w, h);
    expect(e[0]).toBeCloseTo(Math.PI * 0.3, 2);
    expect(e[2]).toBeCloseTo(Math.PI * 0.1, 2);
  });

  it("the sun disc carries exactly the viewport sun's light, starts at Blender's 0.526° and widens only as the dome needs", () => {
    const dir = [0.36, 0.78, 0.51], n = Math.hypot(...dir), d = dir.map((v) => v / n);
    const lit = (data: Float32Array) => {
      let sum = 0;
      for (let j = 0; j < ENV_H; j++) for (let i = 0; i < ENV_W; i++) {
        const k = (j * ENV_W + i) * 4;
        if (!data[k]) continue;
        const v = envDir(i, j, ENV_W, ENV_H);
        sum += data[k] * envTexelSolidAngle(j, ENV_W, ENV_H) * (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]);
      }
      return sum;
    };
    const weak = new Float32Array(ENV_W * ENV_H * 4), a = envAddSun(weak, ENV_W, ENV_H, dir, [0.5, 0.5, 0.5]);
    expect(a.diameterDeg).toBeCloseTo(SUN_DIAMETER_DEG, 5);
    expect(lit(weak)).toBeCloseTo(0.5, 3);
    const strong = new Float32Array(ENV_W * ENV_H * 4), b = envAddSun(strong, ENV_W, ENV_H, dir, [3, 2.9, 2.6]);
    expect(b.diameterDeg).toBeGreaterThan(SUN_DIAMETER_DEG);
    expect(b.diameterDeg).toBeLessThan(1.5);
    expect(strong.reduce((m, v) => Math.max(m, v), 0)).toBeLessThanOrEqual(20000);
    expect(lit(strong)).toBeCloseTo(3, 2);
  });
});

describe("Helios Studio traced light: sun and sky from one model, and a camera's metering", () => {
  const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

  it("the sun is white overhead and warmer and weaker low down, from the viewport sky's own air", () => {
    const top = physicalSunIrradiance(Math.PI / 2);
    top.forEach((v) => expect(v).toBeCloseTo(SUN_ZENITH_IRRADIANCE, 5));
    const low = physicalSunIrradiance((27 * Math.PI) / 180);
    expect(low[0]).toBeGreaterThan(low[1]);
    expect(low[1]).toBeGreaterThan(low[2]);
    expect(lum(low)).toBeLessThan(lum(top));
    expect(lum(low)).toBeGreaterThan(0.5 * lum(top));
    const set = physicalSunIrradiance((3 * Math.PI) / 180);
    expect(set[2] / set[0]).toBeLessThan(low[2] / low[0]);
  });

  it("metering brings the log-average to mid-grey and stays within −3…+4 EV", () => {
    const fill = (v: number) => new Float32Array(64 * 4).fill(v);
    expect(meterExposure(fill(0.18))).toBeCloseTo(1, 3);
    expect(meterExposure(fill(0.045))).toBeCloseTo(4, 2);
    expect(meterExposure(fill(0))).toBe(16);
    expect(meterExposure(fill(100))).toBe(1 / 8);
    const split = fill(0.02);
    split.fill(2, 0, split.length / 2);
    const e = meterExposure(split);
    expect(e).toBeGreaterThan(0.25);
    expect(e).toBeLessThan(0.35); // the bright half caps it well under the average's 0.9
    const nan = fill(0.18);
    nan[0] = NaN;
    expect(meterExposure(nan)).toBeCloseTo(1, 3);
  });
});
