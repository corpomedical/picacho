import { beforeEach, describe, expect, it, vi } from "vitest";

// The providers are faked at the module edge; what is under test is the tick
// itself — the lock, the stage walk, the retry rule, delivering each video
// exactly once, and the change-request race.
vi.mock("./work", () => ({
  probeClip: vi.fn(async (url: string) =>
    url.includes("clip-1") ? { duration: 60, hasVideo: false, hasAudio: true, width: 0, height: 0, fps: 0 } : { duration: 30, hasVideo: true, hasAudio: true, width: 1920, height: 1080, fps: 24 },
  ),
  extractSpeech: vi.fn(async () => new Uint8Array([1, 2])),
}));
vi.mock("./transcribe", () => ({
  transcribeSpeech: vi.fn(async () => ({ language: "en", words: [], speech: false, droppedSegments: 1 })),
}));
vi.mock("./agent", async (orig) => ({
  ...(await orig<typeof import("./agent")>()),
  startSession: vi.fn(async () => "sesn_1"),
  readSession: vi.fn(),
  collectDelivery: vi.fn(),
}));

import { advanceEdit, derivedUuid } from "./advance";
import { AgentError, collectDelivery, readSession, startSession } from "./agent";
import type { EditRow, SessionRecord } from "./job";

type Row = Record<string, unknown>;
function fakeAdmin() {
  const tables: Record<string, Row[]> = { video_edits: [], generations: [] };
  const files = new Map<string, Uint8Array>();
  function query(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let patch: Row | null = null;
    let inserted: Row | null = null;
    const api = {
      select: () => api,
      update: (p: Row) => ((patch = p), api),
      insert: (r: Row) => ((inserted = r), api),
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), api),
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), api),
      or: (expr: string) => {
        const stale = /locked_at\.lt\.(.+)$/.exec(expr)![1];
        filters.push((r) => r.locked_at === null || String(r.locked_at) < stale);
        return api;
      },
      run(): { data: Row[] | null; error: { message: string } | null } {
        if (inserted) {
          if (tables[table].some((r) => r.id === inserted!.id)) return { data: null, error: { message: "duplicate" } };
          tables[table].push({ ...inserted });
          return { data: [{ ...inserted }], error: null };
        }
        const hits = tables[table].filter((r) => filters.every((f) => f(r)));
        if (patch) for (const r of hits) Object.assign(r, patch);
        return { data: hits.map((r) => ({ ...r })), error: null };
      },
      maybeSingle: async () => {
        const { data, error } = api.run();
        return { data: data?.[0] ?? null, error };
      },
      then: (resolve: (v: unknown) => void) => resolve(api.run()),
    };
    return api;
  }
  const admin = {
    from: (table: string) => query(table),
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://store/${bucket}/${path}?sig` }, error: null }),
        upload: async (path: string, bytes: Uint8Array) => (files.set(`${bucket}/${path}`, bytes), { error: null }),
        remove: async () => ({ error: null }),
      }),
    },
  };
  return { admin: admin as never, tables, files };
}

const clip = (i: number, type = "video/mp4") => ({
  path: `u1/e/clip-${i}.mp4`,
  name: `clip ${i}`,
  bytes: 10,
  contentType: type,
  probe: null,
  speech: null,
  words: [],
  analyzed: false,
});

function edit(over: Partial<EditRow> = {}): EditRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    user_id: "u1",
    brief: "Make shorts from this pile",
    aspect: "auto",
    target_seconds: null,
    clips: [clip(0), clip(1, "audio/mpeg")],
    stage: "analyzing",
    progress: null,
    director: null,
    plan: { outputs: [], history: [{ role: "you", text: "Make shorts from this pile" }] },
    render: null,
    generation_id: null,
    error: null,
    cost_usd: 0,
    attempts: 0,
    locked_at: null,
    created_at: "2026-09-25T00:00:00Z",
    updated_at: "2026-09-25T00:00:00Z",
    ...over,
  };
}

const session = (over: Partial<SessionRecord> = {}): SessionRecord => ({
  sessionId: "sesn_1",
  startedAt: 1_000,
  turn: 1,
  turnStartedAt: 1_000,
  preUsd: 0.009,
  lastResultId: null,
  latest: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MEDIA_SIGNING_SECRET", "test-secret");
});

describe("advanceEdit v2", () => {
  it("reads, listens to every clip, and hands the footage to ONE editing session", async () => {
    const { admin, tables } = fakeAdmin();
    tables.video_edits.push(edit() as never);
    const out = await advanceEdit(edit().id, { admin, heavyStartBudgetMs: 1e9, tickBudgetMs: 1e9 });
    const row = tables.video_edits[0] as unknown as EditRow;
    expect(out).toBe("advanced");
    expect(row.stage).toBe("directing");
    expect(row.render).toMatchObject({ sessionId: "sesn_1", turn: 1, lastResultId: null });
    expect(row.clips.map((c) => [c.speech, c.analyzed])).toEqual([
      ["no-speech", true],
      ["no-speech", true],
    ]);
    // whisper: 30 s + 60 s at $0.006/min
    expect(row.cost_usd).toBeCloseTo(0.009, 6);
    const job = vi.mocked(startSession).mock.calls[0][0];
    expect(job).toMatchObject({ aspectHint: "auto", lengthHint: null });
    expect(job.clips.map((c) => [c.hasVideo, c.speech])).toEqual([
      [true, "no-speech"],
      [false, "no-speech"],
    ]);
    expect(job.clips[0].url).toContain("https://store/edit-footage/u1/e/clip-0.mp4");
    expect(row.locked_at).toBeNull();
  });

  it("shows the editor's own latest words while it works", async () => {
    const { admin, tables } = fakeAdmin();
    tables.video_edits.push(edit({ stage: "directing", render: session() }) as never);
    vi.mocked(readSession).mockResolvedValue({ status: "running", stopReason: null, idleAt: null, costUsd: 0.84, latest: "Rendering short 2 of 3." });
    expect(await advanceEdit(edit().id, { admin, now: () => 60_000 })).toBe("advanced");
    const row = tables.video_edits[0] as unknown as EditRow;
    expect(row).toMatchObject({ stage: "directing", progress: "Rendering short 2 of 3." });
    expect(row.render?.latest).toBe("Rendering short 2 of 3.");
    expect(row.cost_usd).toBeCloseTo(0.849, 6);
  });

  it("delivers every video into History once, even when a tick dies after the inserts", async () => {
    const { admin, tables, files } = fakeAdmin();
    tables.video_edits.push(edit({ stage: "directing", render: session() }) as never);
    vi.mocked(readSession).mockResolvedValue({ status: "idle", stopReason: "end_turn", idleAt: 90_000, costUsd: 1.9, latest: "Done." });
    vi.mocked(collectDelivery).mockResolvedValue({
      resultId: "file_r1",
      notes: "Two clips had no usable sound.",
      outputs: [
        { file: "a.mp4", title: "Hook A", summary: "Opens on the explosion.", aspect: "9:16", seconds: 18.4, bytes: new Uint8Array([1]) },
        { file: "b.mp4", title: "Hook B", summary: "Opens on the face.", aspect: "9:16", seconds: 21, bytes: new Uint8Array([2]) },
      ],
    });
    expect(await advanceEdit(edit().id, { admin, now: () => 100_000 })).toBe("done");
    const ids = [0, 1].map((i) => derivedUuid(`video-edit:${edit().id}:1:${i}`));
    expect(tables.generations.map((g) => g.id)).toEqual(ids);
    expect(tables.generations[0]).toMatchObject({ user_id: "u1", status: "succeeded", model_id: "video-editor", credits_used: 0, video_duration_seconds: 18, video_aspect_ratio: "9:16" });
    expect(files.has(`generated-videos/u1/${ids[1]}.mp4`)).toBe(true);
    const row = tables.video_edits[0] as unknown as EditRow;
    expect(row).toMatchObject({ stage: "done", generation_id: ids[0], progress: null });
    expect(row.render?.lastResultId).toBe("file_r1");
    expect(row.plan?.outputs.map((o) => o.title)).toEqual(["Hook A", "Hook B"]);
    expect(row.plan?.history.map((n) => n.role)).toEqual(["you", "editor", "editor", "editor"]);
    expect(row.cost_usd).toBeCloseTo(1.909, 6);

    // The tick that inserted died before saving "done": the next one lands on the same rows.
    Object.assign(tables.video_edits[0], { stage: "directing", plan: edit().plan, render: session() });
    expect(await advanceEdit(edit().id, { admin, now: () => 100_000 })).toBe("done");
    expect(tables.generations).toHaveLength(2);
  });

  it("waits while an idle from BEFORE the change request is all the session shows", async () => {
    const { admin, tables } = fakeAdmin();
    tables.video_edits.push(edit({ stage: "directing", render: session({ turn: 2, turnStartedAt: 500_000, lastResultId: "file_r1" }) }) as never);
    vi.mocked(readSession).mockResolvedValue({ status: "idle", stopReason: "end_turn", idleAt: 400_000, costUsd: 2, latest: "Done." });
    await advanceEdit(edit().id, { admin, now: () => 510_000 });
    expect((tables.video_edits[0] as Row).stage).toBe("directing");
    expect(collectDelivery).not.toHaveBeenCalled();
  });

  it("fails honestly: budget reached, nothing new delivered, the editor refusing the job", async () => {
    const one = fakeAdmin();
    one.tables.video_edits.push(edit({ stage: "directing", render: session() }) as never);
    vi.mocked(readSession).mockResolvedValue({ status: "idle", stopReason: "budget_reached", idleAt: 90_000, costUsd: 6.02, latest: null });
    expect(await advanceEdit(edit().id, { admin: one.admin, now: () => 100_000 })).toBe("failed");
    expect(one.tables.video_edits[0]).toMatchObject({ stage: "failed", error: expect.stringContaining("budget") });

    const two = fakeAdmin();
    two.tables.video_edits.push(edit({ stage: "directing", render: session() }) as never);
    vi.mocked(readSession).mockResolvedValue({ status: "idle", stopReason: "end_turn", idleAt: 90_000, costUsd: 1, latest: "I could not render." });
    vi.mocked(collectDelivery).mockResolvedValue(null);
    expect(await advanceEdit(edit().id, { admin: two.admin, now: () => 100_000 })).toBe("failed");
    expect(two.tables.video_edits[0]).toMatchObject({ error: 'The editor stopped without delivering a video: "I could not render."' });

    const three = fakeAdmin();
    three.tables.video_edits.push(edit({ clips: [{ ...clip(0), probe: { duration: 30, hasVideo: true, hasAudio: false, width: 1, height: 1, fps: 24 }, speech: "silent", analyzed: true }] }) as never);
    vi.mocked(startSession).mockRejectedValueOnce(new AgentError("not configured"));
    expect(await advanceEdit(edit().id, { admin: three.admin, heavyStartBudgetMs: 1e9 })).toBe("failed");
    expect(three.tables.video_edits[0]).toMatchObject({ stage: "failed", error: "The editor couldn't take this edit on. Try again." });
  });

  it("leaves a freshly locked edit alone", async () => {
    const { admin, tables } = fakeAdmin();
    const now = Date.parse("2026-09-25T12:00:00Z");
    tables.video_edits.push(edit({ locked_at: new Date(now - 60_000).toISOString() }) as never);
    expect(await advanceEdit(edit().id, { admin, now: () => now })).toBe("locked");
  });

  it("derives the same id from the same seed", () => {
    expect(derivedUuid("a")).toBe(derivedUuid("a"));
    expect(derivedUuid("a")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
