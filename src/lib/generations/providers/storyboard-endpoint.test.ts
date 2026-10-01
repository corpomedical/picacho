import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// fal.ts imports through the @/ alias, which vitest here doesn't resolve:
// the two modules this path uses are the real ones, the rest are unused.
vi.mock("@/lib/generations/providers/video-models", async () => await import("./video-models"));
vi.mock("@/lib/generations/providers/fetch-with-timeout", async () => await import("./fetch-with-timeout"));
vi.mock("@/lib/generations/providers/frame-url", async () => await import("./frame-url"));
vi.mock("@/lib/generations/layers", () => ({ LAYERIZE_ENDPOINT: "", LAYERIZE_LABEL: "" }));
vi.mock("@/lib/recast/recast", () => ({ RECAST_ENGINES: {}, recastRequestBody: () => ({}) }));
vi.mock("@/lib/generations/voice-lock", () => ({ SPEECH_ENDPOINTS: { v3: "", v4: "" }, speechRequestBody: () => ({}) }));

const { KLING_STORYBOARD_ENDPOINT, submitVideoJob } = await import("./fal");

// The start & end frames lane on Kling (the picker's Kling 1.6, the Angle
// Stage's move, set film beats) left fal's deprecated v2.1 pro endpoint on
// 2026-09-30. This drives the real request builder with fetch faked and
// reads what would leave for fal: the endpoint and the body.
describe("Kling start & end frames go to 2.5 Turbo Pro", () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];

  beforeEach(() => {
    calls.length = 0;
    vi.stubEnv("FAL_KEY", "test-key");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
        return new Response(
          JSON.stringify({
            request_id: "r1",
            status_url: "https://queue.fal.run/x/requests/r1/status",
            response_url: "https://queue.fal.run/x/requests/r1",
            cancel_url: "https://queue.fal.run/x/requests/r1/cancel",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is the active endpoint, not the deprecated one", () => {
    expect(KLING_STORYBOARD_ENDPOINT).toBe("fal-ai/kling-video/v2.5-turbo/pro/image-to-video");
    expect(KLING_STORYBOARD_ENDPOINT).not.toContain("v2.1");
  });

  it("sends both frames, the start as image_url and the end as tail_image_url", async () => {
    const job = await submitVideoJob("The camera arcs to her left.", "kling", {
      startImageUrl: "https://picacho.ai/api/media/a.jpg",
      endImageUrl: "https://picacho.ai/api/media/b.jpg",
      durationSeconds: 10,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://queue.fal.run/${KLING_STORYBOARD_ENDPOINT}`);
    expect(calls[0].body).toEqual({
      prompt: "The camera arcs to her left.",
      image_url: "https://picacho.ai/api/media/a.jpg",
      tail_image_url: "https://picacho.ai/api/media/b.jpg",
      duration: "10",
    });
    expect(job.label).toBe("Kling (storyboard)");
  });

  it("an end frame alone still opens the clip, as before", async () => {
    await submitVideoJob("Slow push in.", "kling", { endImageUrl: "https://picacho.ai/api/media/b.jpg" });
    expect(calls[0].url).toBe(`https://queue.fal.run/${KLING_STORYBOARD_ENDPOINT}`);
    expect(calls[0].body).toMatchObject({
      image_url: "https://picacho.ai/api/media/b.jpg",
      tail_image_url: "https://picacho.ai/api/media/b.jpg",
      duration: "5",
    });
  });
});
