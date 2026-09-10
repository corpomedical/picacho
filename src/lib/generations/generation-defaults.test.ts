import { describe, expect, it } from "vitest";
import { defaultsFromRow, resolveComposerDefaults, validateGenerationDefaults, NO_DEFAULTS } from "./generation-defaults";

const models = [
  { id: "kling", durations: [{ seconds: 5, creditWeight: 1, default: true }, { seconds: 10, creditWeight: 2 }] },
  { id: "veo", durations: [{ seconds: 4, creditWeight: 2 }, { seconds: 8, creditWeight: 4, default: true }] },
];

describe("validating defaults", () => {
  it("accepts a real model, its own length, an aspect and a sound choice", () => {
    const r = validateGenerationDefaults({ videoModel: "veo", aspectRatio: "9:16", durationSeconds: "8", sound: false }, models, "kling");
    expect(r).toEqual({ ok: true, value: { videoModel: "veo", aspectRatio: "9:16", durationSeconds: 8, sound: false } });
  });
  it("accepts 'Picacho's default' for everything", () => {
    const r = validateGenerationDefaults({ videoModel: "", aspectRatio: "", durationSeconds: "", sound: true }, models, "kling");
    expect(r).toEqual({ ok: true, value: NO_DEFAULTS });
  });
  it("refuses a model that is not offered, a length the model lacks, or an unknown aspect", () => {
    expect(validateGenerationDefaults({ videoModel: "sora", aspectRatio: "", durationSeconds: "", sound: true }, models, "kling")).toEqual({ ok: false, error: "model" });
    expect(validateGenerationDefaults({ videoModel: "kling", aspectRatio: "", durationSeconds: "8", sound: true }, models, "kling")).toEqual({ ok: false, error: "duration" });
    expect(validateGenerationDefaults({ videoModel: "", aspectRatio: "4:3", durationSeconds: "", sound: true }, models, "kling")).toEqual({ ok: false, error: "aspect" });
  });
  it("checks a length against the fallback model when none is chosen", () => {
    expect(validateGenerationDefaults({ videoModel: "", aspectRatio: "", durationSeconds: "10", sound: true }, models, "kling").ok).toBe(true);
    expect(validateGenerationDefaults({ videoModel: "", aspectRatio: "", durationSeconds: "8", sound: true }, models, "kling").ok).toBe(false);
  });
});

describe("what the composer opens on", () => {
  it("uses the stored model and length when both are still valid", () => {
    expect(resolveComposerDefaults({ videoModel: "veo", aspectRatio: "16:9", durationSeconds: 4, sound: true }, models, "kling")).toEqual({
      videoModelId: "veo",
      durationSeconds: 4,
      aspectRatio: "16:9",
    });
  });
  it("falls back to the global default when the stored model is no longer offered, and drops its length", () => {
    expect(resolveComposerDefaults({ videoModel: "retired", aspectRatio: null, durationSeconds: 8, sound: true }, models, "kling")).toEqual({
      videoModelId: "kling",
      durationSeconds: null,
      aspectRatio: null,
    });
  });
});

describe("reading a profiles row", () => {
  it("treats missing columns as no preference and sound as on", () => {
    expect(defaultsFromRow(null)).toEqual(NO_DEFAULTS);
    expect(defaultsFromRow({})).toEqual(NO_DEFAULTS);
    expect(defaultsFromRow({ video_sound: false, default_aspect_ratio: "weird" })).toEqual({ ...NO_DEFAULTS, sound: false });
  });
});
