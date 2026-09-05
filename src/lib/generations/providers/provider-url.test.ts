import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { providerDownloadUrl, providerMediaOrigin } from "./provider-url";
import { canExtractFrameFrom } from "./frame-url";

// The 2026-09-04 regression, pinned from both ends.
//
// persistGeneratedVideo started storing videos in our own bucket, which means
// result_url and payload.videoUrl became RELATIVE /api/media paths. Two
// job-runner call sites handed that relative path to fal, which downloads it
// from its own network: every spoken line shipped silent (422
// file_download_error) and identity scoring silently returned null.
//
// Both halves of the contract matter and each can break without the other, so
// both are asserted: what crosses the wire is absolute, what gets persisted
// stays relative.

const STORED = "/api/media/generated-videos/u-123/8f0c1b2e.mp4?v=abc123";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("providerMediaOrigin", () => {
  it("uses NEXT_PUBLIC_SITE_URL — the same basis fal's webhook callback is built on", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://picacho.io");
    expect(providerMediaOrigin()).toBe("https://picacho.io");
  });

  it("trims a trailing slash so the joined URL never doubles it", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://picacho.io/");
    expect(providerDownloadUrl(STORED)).toBe(`https://picacho.io${STORED}`);
  });

  it("ignores a *.vercel.app value and falls back to the canonical origin", () => {
    // A deployment URL is not a stable public identity — origin.ts rejects it
    // for redirects for the same reason.
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://picacho-abc123.vercel.app");
    expect(providerMediaOrigin()).toBe("https://picacho.io");
  });

  it("falls back to the canonical origin when nothing is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    expect(providerMediaOrigin()).toBe("https://picacho.io");
  });

  it("reads no request headers — it must work from the reaper, with no request in scope", () => {
    // The whole reason this is not getOrigin(). If this ever starts touching
    // headers(), a background driver of advanceGeneration throws at the
    // lip-sync submit and the failure disguises itself as a provider fault.
    // Comments stripped first — the module's own header explains at length
    // why it is NOT getOrigin(), and that prose must not trip the check.
    const code = readFileSync(new URL("./provider-url.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    expect(code).not.toMatch(/next\/headers/);
    expect(code).not.toMatch(/getOrigin/);
    expect(code).toMatch(/process\.env\.NEXT_PUBLIC_SITE_URL/);
  });
});

describe("dialogue transitions hand the job to fal", () => {
  // Source pin, same style as the wiring test above: the dialogue stages
  // always run on fal, but the stage-transition payload writes spread
  // ...row.payload — so a BytePlus-routed video that keeps provider
  // "byteplus" through them sends every TTS/lip-sync poll to ModelArk with a
  // fal request id, whose missing-means-gone rule fails the stage on the
  // first poll and ships every spoken line silent. Both transitions must
  // relabel provider alongside label.
  it("both dialogue-stage payload writes set provider fal", () => {
    const code = readFileSync(new URL("../job-runner.ts", import.meta.url), "utf8");
    expect(code).toContain('label: "ElevenLabs TTS", provider: "fal"');
    expect(code).toContain('label: "Sync Lipsync", provider: "fal"');
  });
});

describe("providerDownloadUrl", () => {
  it("REGRESSION: what fal is handed is absolute", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://picacho.io");
    const wire = providerDownloadUrl(STORED);
    expect(wire.startsWith("http")).toBe(true);
    expect(wire).toBe(`https://picacho.io${STORED}`);
  });

  it("REGRESSION: the absolute form passes canExtractFrameFrom, the stored form does not", () => {
    // The exact gate that made video identity scoring a silent no-op: it was
    // handed the stored value, returned false, and skipped the whole block
    // without logging or charging anything.
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://picacho.io");
    expect(canExtractFrameFrom(STORED)).toBe(false);
    expect(canExtractFrameFrom(providerDownloadUrl(STORED))).toBe(true);
  });

  it("REGRESSION: the persisted value is left untouched — media stays relative in the DB", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://picacho.io");
    const persisted = STORED;
    providerDownloadUrl(persisted);
    expect(persisted).toBe(STORED);
    expect(persisted.startsWith("/api/media/")).toBe(true);
  });

  it("passes an already-absolute provider CDN URL through untouched", () => {
    // The persistGeneratedVideo-failed fallback path stores fal's own URL.
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://picacho.io");
    const cdn = "https://v3.fal.media/files/panda/abc.mp4";
    expect(providerDownloadUrl(cdn)).toBe(cdn);
  });
});

// job-runner.ts cannot be imported here: it pulls the whole provider chain in
// through "@/" aliases and vitest runs with no config in this repo (same
// constraint frame-url.ts was split out for). So the WIRING — that these two
// call sites actually pass through providerDownloadUrl, and that the values
// written back to the row do not — is pinned against the source text. Same
// static-check approach as scripts/check-hook-order.mjs.
describe("job-runner wiring", () => {
  const src = readFileSync(
    new URL("../job-runner.ts", import.meta.url),
    "utf8",
  );

  it("REGRESSION: submitLipSyncJob's video_url is absolutized", () => {
    expect(src).toMatch(/submitLipSyncJob\(\s*providerDownloadUrl\(row\.payload\.videoUrl!\)/);
  });

  it("REGRESSION: extractVideoFrame's argument is absolutized", () => {
    expect(src).toMatch(/extractVideoFrame\(\s*providerDownloadUrl\(outcome\.resultUrl\)\s*\)/);
  });

  it("REGRESSION: the value persisted to payload.videoUrl is NOT absolutized", () => {
    // Absolutizing the stored side too would bake a hostname into every row
    // and break the re-signing toMediaUrl() does on render.
    expect(src).toMatch(/payload: \{ \.\.\.row\.payload, videoUrl,/);
    expect(src).not.toMatch(/videoUrl: providerDownloadUrl/);
  });

  it("REGRESSION: the dialogue transitions relabel the job for their own provider", () => {
    // Otherwise jobHandle() reports a Sync Labs / ElevenLabs failure under the
    // video model's name — the misattribution that sent this investigation at
    // MiniMax and Gemini first.
    expect(src).toMatch(/videoUrl, label: "ElevenLabs TTS"/);
    expect(src).toMatch(/audioUrl, label: "Sync Lipsync"/);
  });
});
