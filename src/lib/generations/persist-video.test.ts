import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Storing a finished video without its sound (2026-09-25): a Helios take on
// an engine with no switch for its own invented voice (Gemini Omni) is kept
// silent until it is dubbed ("silent now, dubbed later", operator
// 2026-09-23). The runner asks persistVideo to take the sound out where the
// clip is stored, and records the take as silent only when that was done.
// A paid clip is never lost over its sound: a file the remux cannot read is
// stored as it came.
//
// core.ts imports through "@/", which this suite does not resolve, so each
// such import is given a stand-in; the MP4 code is the real one.

vi.mock("@/lib/supabase/server", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/media/url", () => ({ mediaUrl: (bucket: string, path: string) => `/api/media/${bucket}/${path}` }));
vi.mock("@/lib/media/faststart", async () => await import("../media/faststart"));
vi.mock("@/lib/media/mp4-join", async () => await import("../media/mp4-join"));
vi.mock("@/lib/plans", async () => await import("../plans"));
vi.mock("@/lib/generations/providers/video-models", async () => await import("./providers/video-models"));

import type { SupabaseClient } from "@supabase/supabase-js";
import { persistGeneratedVideo, persistVideo } from "./core";
import { withoutSoundMp4 } from "../media/mp4-join";

// Picture and AAC sound, as an Omni take comes back.
const SPEAKING = new Uint8Array(readFileSync(join(__dirname, "../../../public/showcase-video.mp4")));
const USER = "8f14e45f-ea2c-4f5d-9c1b-000000000001";
const PATH_RE = new RegExp(`^${USER}/[0-9a-f-]{36}\\.mp4$`);

type Upload = { bucket: string; path: string; body: Uint8Array };
let uploads: Upload[] = [];

const supabase = {
  storage: {
    from: (bucket: string) => ({
      upload: async (path: string, body: Uint8Array) => {
        uploads.push({ bucket, path, body: new Uint8Array(body) });
        return { error: null };
      },
    }),
  },
} as unknown as SupabaseClient;

/** The provider's CDN, answering with these bytes (or this status). */
function provider(body: Uint8Array | string, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(status === 200 ? (body as BodyInit) : "error", { status, headers: { "content-type": "video/mp4" } })),
  );
}

beforeEach(() => {
  uploads = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("persistVideo", () => {
  it("stores the clip without its sound when asked, and says so", async () => {
    provider(SPEAKING);
    const out = await persistVideo(supabase, USER, "https://fal.test/take.mp4", { dropSound: true });
    expect(uploads).toHaveLength(1);
    expect(uploads[0].bucket).toBe("generated-videos");
    expect(uploads[0].path).toMatch(PATH_RE);
    expect(out).toEqual({ url: `/api/media/generated-videos/${uploads[0].path}`, silent: true });
    // The stored file itself has no sound track left to take out.
    // The stored file reads (a corrupted one would not) and has no sound
    // track left to take out.
    const stored = withoutSoundMp4(uploads[0].body);
    expect(stored).toMatchObject({ ok: true, hadSound: false });
    expect(uploads[0].body.length).toBeLessThan(SPEAKING.length);
    // And it is exactly what the remux makes of a plain copy of the clip:
    // the server's Buffer changed nothing on the way (review, 2026-09-25).
    const expected = withoutSoundMp4(SPEAKING.slice());
    expect(expected.ok).toBe(true);
    if (expected.ok) expect(Buffer.compare(Buffer.from(uploads[0].body), Buffer.from(expected.bytes))).toBe(0);
  });

  it("keeps the sound when nobody asked, as persistGeneratedVideo always has", async () => {
    provider(SPEAKING);
    const out = await persistVideo(supabase, USER, "https://fal.test/clip.mp4");
    expect(out?.silent).toBe(false);
    const stored = withoutSoundMp4(uploads[0].body);
    expect(stored.ok && stored.hadSound).toBe(true);

    provider(SPEAKING);
    const url = await persistGeneratedVideo(supabase, USER, "https://fal.test/clip.mp4");
    expect(url).toBe(`/api/media/generated-videos/${uploads[1].path}`);
    const again = withoutSoundMp4(uploads[1].body);
    expect(again.ok && again.hadSound).toBe(true);
  });

  it("stores a file it cannot silence as it came, and never calls it silent", async () => {
    const words = new TextEncoder().encode("not a video at all, just words");
    provider(words);
    const out = await persistVideo(supabase, USER, "https://fal.test/odd.mp4", { dropSound: true });
    expect(out?.silent).toBe(false);
    expect(out?.url).toBe(`/api/media/generated-videos/${uploads[0].path}`);
    expect(Array.from(uploads[0].body)).toEqual(Array.from(words));
    expect(console.warn).toHaveBeenCalledWith("persistVideo: couldn't take the sound out; storing the clip as it came.");
  });

  it("stores nothing, and hands back nothing, when the provider fails", async () => {
    provider("", 500);
    expect(await persistVideo(supabase, USER, "https://fal.test/gone.mp4", { dropSound: true })).toBeNull();
    expect(await persistGeneratedVideo(supabase, USER, "https://fal.test/gone.mp4")).toBeNull();
    expect(uploads).toEqual([]);
  });
});
