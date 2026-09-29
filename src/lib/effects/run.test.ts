import { beforeEach, describe, expect, it, vi } from "vitest";

const fal = vi.hoisted(() => ({
  submitEffectJob: vi.fn(),
  checkQueuedJob: vi.fn(),
  fetchQueuedVideoUrl: vi.fn(),
}));
const work = vi.hoisted(() => ({ framesAt: vi.fn(), probeClip: vi.fn() }));
const opus = vi.hoisted(() => ({ planEffect: vi.fn(), judgeEffect: vi.fn(), effectsClient: vi.fn() }));
vi.mock("../generations/providers/fal", () => fal);
vi.mock("../editor/work", () => work);
vi.mock("./opus", () => opus);

import { runFx } from "./run";
import { fxMarker, fxOf, type FxState } from "./job";
import type { EditRow } from "../editor/job";

const JOB = { requestId: "r1", statusUrl: "s", responseUrl: "o", cancelUrl: "c", label: "effects" };
const admin = {
  storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://signed/clip" }, error: null }) }) },
} as never;

function row(fx: FxState, over: Partial<EditRow> = {}): EditRow {
  return {
    id: "e1",
    user_id: "u1",
    brief: "Effect — Lightning hands",
    aspect: "auto",
    target_seconds: null,
    clips: [{ path: "u1/e1/clip-0.mp4", name: "a.mp4", bytes: 2_000_000, contentType: "video/mp4", probe: null, speech: "no-speech", words: [], analyzed: true }],
    stage: "analyzing",
    progress: null,
    director: fxMarker(fx),
    plan: { outputs: [], history: [] },
    render: null,
    generation_id: null,
    error: null,
    cost_usd: 0,
    attempts: 0,
    locked_at: null,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

const shot: FxState = { kind: "shot", effectId: "lightning-hands", effectName: "Lightning hands", words: "", media: "video", width: null, height: null, plan: null, tries: [], source: { kind: "upload" } };
const deliver = vi.fn();
const deps = { admin, now: () => 1000, deliver, derivedUuid: (s: string) => `id:${s}` };

beforeEach(() => {
  vi.clearAllMocks();
  opus.effectsClient.mockReturnValue({});
  work.framesAt.mockResolvedValue([new Uint8Array([1])]);
  fal.submitEffectJob.mockResolvedValue(JOB);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([9, 9]))));
});

describe("an effect on a video", () => {
  it("reads the shot, lets Opus write the instruction, and sends it to FLUX 3 edit", async () => {
    work.probeClip.mockResolvedValue({ duration: 5, hasVideo: true, hasAudio: true, width: 1280, height: 720, fps: 24 });
    opus.planEffect.mockResolvedValue({ ok: true, usd: 0.02, value: { instruction: "Add lightning. Keep everything else.", title: "Lightning", summary: "Lightning on her hands.", doable: true, whyNot: "" } });
    const next = await runFx(row(shot), deps);
    expect(fal.submitEffectJob).toHaveBeenCalledWith("blackforestlabs/flux-3/edit-video", { prompt: "Add lightning. Keep everything else.", video_url: "https://signed/clip" });
    expect(next.stage).toBe("directing");
    expect(fxOf(next.director)?.tries).toHaveLength(1);
    expect(next.cost_usd).toBeCloseTo(0.02 + 0.15);
  });

  it("stops before spending when the clip is too long or Opus says it can't be done", async () => {
    work.probeClip.mockResolvedValue({ duration: 30, hasVideo: true, hasAudio: true, width: 1280, height: 720, fps: 24 });
    expect((await runFx(row(shot), deps)).error).toContain("15 seconds");
    work.probeClip.mockResolvedValue({ duration: 5, hasVideo: true, hasAudio: true, width: 1280, height: 720, fps: 24 });
    opus.planEffect.mockResolvedValue({ ok: true, usd: 0.02, value: { instruction: "", title: "", summary: "", doable: false, whyNot: "That needs a real person's face." } });
    const next = await runFx(row(shot), deps);
    expect(next).toMatchObject({ stage: "failed", error: "That needs a real person's face." });
    expect(fal.submitEffectJob).not.toHaveBeenCalled();
  });

  it("tries once more with Opus's rewrite when the effect didn't land, then delivers", async () => {
    const working = { ...shot, plan: { title: "Lightning", summary: "s" }, tries: [{ instruction: "first", job: JOB, at: 1, verdict: null }] };
    const clip = { path: "u1/e1/clip-0.mp4", name: "a.mp4", bytes: 1, contentType: "video/mp4", probe: { duration: 5, hasVideo: true, hasAudio: true, width: 1280, height: 720, fps: 24 }, speech: "no-speech" as const, words: [], analyzed: true };
    fal.checkQueuedJob.mockResolvedValue({ state: "completed" });
    fal.fetchQueuedVideoUrl.mockResolvedValue("https://fal/out.mp4");
    work.probeClip.mockResolvedValue({ duration: 5, hasVideo: true, hasAudio: true, width: 1248, height: 704, fps: 24 });
    opus.judgeEffect.mockResolvedValueOnce({ ok: true, usd: 0.03, value: { ok: false, note: "Too faint.", betterInstruction: "second" } });
    const retry = await runFx(row(working, { stage: "directing", clips: [clip] }), deps);
    expect(fal.submitEffectJob).toHaveBeenLastCalledWith("blackforestlabs/flux-3/edit-video", { prompt: "second", video_url: "https://signed/clip" });
    const tried = fxOf(retry.director)!;
    expect(tried.tries).toHaveLength(2);
    expect(tried.tries[0].verdict).toEqual({ ok: false, note: "Too faint." });
    expect(deliver).not.toHaveBeenCalled();

    // The second try: judged a miss again, but out of tries → it is delivered with Opus's note.
    opus.judgeEffect.mockResolvedValueOnce({ ok: true, usd: 0.03, value: { ok: false, note: "Still faint.", betterInstruction: "third" } });
    const done = await runFx(row(tried, { stage: "directing", clips: [clip] }), deps);
    expect(done.stage).toBe("done");
    expect(deliver).toHaveBeenCalledWith(admin, expect.anything(), "id:video-effect:e1:2", expect.objectContaining({ aspect: "16:9", modelId: "effects", summary: "Still faint." }));
    expect(done.plan?.outputs[0]).toMatchObject({ generationId: "id:video-effect:e1:2", turn: 1 });
  });

  it("waits while the engine works, and ends a refusal in plain words without another try", async () => {
    const working = { ...shot, tries: [{ instruction: "x", job: JOB, at: 1, verdict: null }] };
    fal.checkQueuedJob.mockResolvedValue({ state: "pending", started: true });
    expect(await runFx(row(working, { stage: "directing" }), deps)).toEqual({ progress: "Rendering the effect" });
    fal.checkQueuedJob.mockResolvedValue({ state: "failed", error: "fal.ai (effects): content_policy_violation" });
    expect(await runFx(row(working, { stage: "directing" }), deps)).toMatchObject({ stage: "failed", error: expect.stringContaining("refused") });
    expect(fal.submitEffectJob).not.toHaveBeenCalled();
  });
});

describe("a one-tap effect on a photo", () => {
  it("sends the provider's own effect name, and delivers without an Opus reading", async () => {
    const photo: FxState = { kind: "photo", effectId: "wan:inflate", effectName: "Inflate", words: "", media: "image", width: 1024, height: 1536, plan: null, tries: [], source: { kind: "upload" } };
    const started = await runFx(row(photo), deps);
    expect(fal.submitEffectJob).toHaveBeenCalledWith("fal-ai/wan-effects", expect.objectContaining({ image_url: "https://signed/clip", effect_type: "inflate", aspect_ratio: "9:16" }));
    expect(started.cost_usd).toBeCloseTo(0.35);
    fal.checkQueuedJob.mockResolvedValue({ state: "completed" });
    fal.fetchQueuedVideoUrl.mockResolvedValue("https://fal/out.mp4");
    work.probeClip.mockResolvedValue({ duration: 5, hasVideo: true, hasAudio: false, width: 720, height: 1280, fps: 16 });
    const done = await runFx(row(fxOf(started.director)!, { stage: "directing" }), deps);
    expect(opus.judgeEffect).not.toHaveBeenCalled();
    expect(done.stage).toBe("done");
    expect(deliver).toHaveBeenCalledWith(admin, expect.anything(), "id:video-effect:e1:1", expect.objectContaining({ aspect: "9:16", title: "Inflate" }));
  });
});
