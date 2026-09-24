import { beforeEach, describe, expect, it, vi } from "vitest";

// The steps' providers are faked at the module edge; what is under test is
// the tick itself — the lock, the stage walk, the retry rule, and delivering
// exactly one History row.
vi.mock("./work", () => ({
  probeClip: vi.fn(async () => ({ duration: 30, hasVideo: true, hasAudio: true, width: 1920, height: 1080, fps: 24 })),
  analyzeClip: vi.fn(async (_url: string, probe: object, interval: number) => ({
    ...probe,
    interval,
    sheets: [new Uint8Array([1]), new Uint8Array([2])],
    sceneChanges: [4.5],
    silences: [{ start: 10, end: 11 }],
    speech: new Uint8Array([9, 9]),
  })),
  buildBundle: vi.fn(async () => ({ zip: new Uint8Array([80, 75]), html: "<html>", files: ["index.html"] })),
}));
vi.mock("./transcribe", () => ({
  transcribeSpeech: vi.fn(async () => ({ language: "en", words: [{ text: "Hi", start: 1, end: 1.3 }] })),
}));
vi.mock("./heygen", async (orig) => ({
  ...(await orig<typeof import("./heygen")>()),
  uploadBundle: vi.fn(async () => "asst_1"),
  startRender: vi.fn(async () => "r_1"),
  readRender: vi.fn(async () => ({ status: "rendering", videoUrl: null, duration: null, failure: null })),
}));
vi.mock("./director", async (orig) => {
  const real = await orig<typeof import("./director")>();
  return { ...real, directStep: vi.fn() };
});

import { advanceEdit, derivedUuid } from "./advance";
import { directStep, DirectorError, newDirectorState } from "./director";
import { readRender } from "./heygen";
import { analyzeClip } from "./work";
import type { EditRow } from "./job";

// ---- a small in-memory Supabase: just the calls advance.ts makes --------
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
      run(): { data: Row[] | null; error: { message: string; code?: string } | null } {
        if (inserted) {
          if (tables[table].some((r) => r.id === inserted!.id)) return { data: null, error: { message: "duplicate", code: "23505" } };
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
      single: async () => {
        const { data, error } = api.run();
        return { data: data?.[0] ?? null, error: error ?? (data?.length ? null : { message: "none" }) };
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
        download: async (path: string) => {
          const b = files.get(`${bucket}/${path}`);
          return b ? { data: new Blob([b as BlobPart]), error: null } : { data: null, error: { message: "missing" } };
        },
        remove: async (paths: string[]) => (paths.forEach((p) => files.delete(`${bucket}/${p}`)), { error: null }),
      }),
    },
  };
  return { admin: admin as never, tables, files };
}

function edit(over: Partial<EditRow> = {}): EditRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    user_id: "u1",
    brief: "cut the ums",
    aspect: "9:16",
    target_seconds: 30,
    clips: [
      {
        path: "u1/e/clip-0.mp4",
        name: "take.mp4",
        bytes: 10,
        contentType: "video/mp4",
        probe: null,
        interval: null,
        sheets: [],
        sceneChanges: [],
        silences: [],
        words: [],
        analyzed: false,
      },
    ],
    stage: "analyzing",
    progress: null,
    director: null,
    plan: null,
    render: null,
    generation_id: null,
    error: null,
    cost_usd: 0,
    attempts: 0,
    locked_at: null,
    created_at: "2026-09-24T00:00:00Z",
    updated_at: "2026-09-24T00:00:00Z",
    ...over,
  };
}

const plan = {
  summary: "A tight cut",
  aspect: "9:16" as const,
  look: "clean" as const,
  captions: "lines" as const,
  shots: [{ clip: 0, from: 1, to: 5, zoom: 1, focusX: 0.5, focusY: 0.5, transitionIn: "cut" as const, volume: 1 }],
  texts: [],
  music: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MEDIA_SIGNING_SECRET", "test-secret");
  vi.mocked(readRender).mockResolvedValue({ status: "rendering", videoUrl: null, duration: null, failure: null });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([0, 0, 0, 1]), { status: 200 })));
});

describe("advanceEdit", () => {
  it("walks probe → analyze → direct → bundle in one tick when the budgets allow, and records what it cost", async () => {
    const { admin, tables, files } = fakeAdmin();
    tables.video_edits.push(edit() as never);
    vi.mocked(directStep).mockImplementation(async (_input, state) => ({ ...state, phase: "done", plan, usage: { input_tokens: 100_000, output_tokens: 10_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }));
    const out = await advanceEdit(edit().id, { admin, heavyStartBudgetMs: 1e9, tickBudgetMs: 1e9 });
    const row = tables.video_edits[0] as unknown as EditRow;
    expect(out).toBe("advanced");
    expect(row.stage).toBe("rendering");
    expect(row.render).toMatchObject({ assetId: "asst_1", renderId: "r_1" });
    expect(row.clips[0]).toMatchObject({ analyzed: true, interval: 1, sceneChanges: [4.5], words: [{ text: "Hi", start: 1, end: 1.3 }] });
    expect(row.clips[0].sheets).toHaveLength(2);
    expect(files.has(`edit-footage/${row.clips[0].sheets[0]}`)).toBe(true);
    expect(vi.mocked(analyzeClip).mock.calls[0][0]).toContain("https://store/edit-footage/u1/e/clip-0.mp4");
    // whisper 30 s ($0.003) + opus 100k in / 10k out ($0.40 + $0.20)
    expect(row.cost_usd).toBeCloseTo(0.603, 4);
    expect(row.locked_at).toBeNull();
  });

  it("does not start a heavy step late in a tick", async () => {
    const { admin, tables } = fakeAdmin();
    tables.video_edits.push(edit() as never);
    let t = 0;
    const out = await advanceEdit(edit().id, { admin, now: () => (t += 10_000), heavyStartBudgetMs: 15_000 });
    const row = tables.video_edits[0] as unknown as EditRow;
    expect(row.clips[0].probe).not.toBeNull(); // the light probe ran
    expect(row.clips[0].analyzed).toBe(false); // the heavy analyze waited for the next tick
    expect(out).toBe("advanced");
  });

  it("leaves a freshly locked edit alone and takes over a stale lock", async () => {
    const { admin, tables } = fakeAdmin();
    const now = Date.parse("2026-09-24T12:00:00Z");
    tables.video_edits.push(edit({ locked_at: new Date(now - 60_000).toISOString() }) as never);
    expect(await advanceEdit(edit().id, { admin, now: () => now })).toBe("locked");
    (tables.video_edits[0] as Row).locked_at = new Date(now - 10 * 60_000).toISOString();
    expect(await advanceEdit(edit().id, { admin, now: () => now, heavyStartBudgetMs: 0 })).toBe("advanced");
  });

  it("fails the edit on a refusal at once, and on the third failure of anything else", async () => {
    const { admin, tables } = fakeAdmin();
    const analyzed = { ...edit().clips[0], probe: { duration: 30, hasVideo: true, hasAudio: true, width: 1, height: 1, fps: 24 }, interval: 1, analyzed: true };
    tables.video_edits.push(edit({ stage: "directing", clips: [analyzed], director: newDirectorState() }) as never);
    vi.mocked(directStep).mockRejectedValueOnce(new DirectorError("no", "refused", 0.12));
    expect(await advanceEdit(edit().id, { admin, heavyStartBudgetMs: 1e9 })).toBe("failed");
    const row = tables.video_edits[0] as unknown as EditRow;
    expect(row.stage).toBe("failed");
    expect(row.error).toBe("The editor can't work with this footage or brief.");
    expect(row.cost_usd).toBeCloseTo(0.12, 4);

    const second = fakeAdmin();
    second.tables.video_edits.push(edit({ stage: "directing", clips: [analyzed], director: newDirectorState() }) as never);
    vi.mocked(directStep).mockRejectedValue(new DirectorError("timeout", "api"));
    for (let i = 0; i < 2; i++) expect(await advanceEdit(edit().id, { admin: second.admin, heavyStartBudgetMs: 1e9 })).toBe("idle");
    expect((second.tables.video_edits[0] as Row).attempts).toBe(2);
    expect(await advanceEdit(edit().id, { admin: second.admin, heavyStartBudgetMs: 1e9 })).toBe("failed");
  });

  it("delivers a finished render into History exactly once, even when a tick dies after the insert", async () => {
    const { admin, tables, files } = fakeAdmin();
    const director = { ...newDirectorState(), phase: "done" as const, plan, turns: [{ role: "assistant" as const, content: "{}" }] };
    tables.video_edits.push(edit({ stage: "rendering", plan, director, render: { assetId: "a", renderId: "r_1", startedAt: Date.now() } }) as never);
    vi.mocked(readRender).mockResolvedValue({ status: "completed", videoUrl: "https://heygen/v.mp4", duration: 4.2, failure: null });

    expect(await advanceEdit(edit().id, { admin })).toBe("done");
    const id = derivedUuid(`video-edit:${edit().id}:1`);
    expect(tables.generations).toHaveLength(1);
    expect(tables.generations[0]).toMatchObject({ id, user_id: "u1", status: "succeeded", model_id: "video-editor", credits_used: 0, video_duration_seconds: 4, video_aspect_ratio: "9:16" });
    expect(String(tables.generations[0].result_url)).toContain(`/api/media/generated-videos/u1/${id}.mp4`);
    expect(files.has(`generated-videos/u1/${id}.mp4`)).toBe(true);

    // The tick that inserted died before saving "done": the next one lands on the same row.
    Object.assign(tables.video_edits[0], { stage: "rendering", generation_id: null });
    expect(await advanceEdit(edit().id, { admin })).toBe("done");
    expect(tables.generations).toHaveLength(1);
    expect((tables.video_edits[0] as Row).generation_id).toBe(id);
  });

  it("waits on a render in progress and gives up after the deadline", async () => {
    const { admin, tables } = fakeAdmin();
    const now = Date.parse("2026-09-24T12:00:00Z");
    tables.video_edits.push(edit({ stage: "rendering", plan, render: { assetId: "a", renderId: "r_1", startedAt: now - 60_000 } }) as never);
    expect(await advanceEdit(edit().id, { admin, now: () => now })).toBe("idle");
    expect((tables.video_edits[0] as Row).stage).toBe("rendering");
    (tables.video_edits[0] as Row).render = { assetId: "a", renderId: "r_1", startedAt: now - 31 * 60_000 };
    expect(await advanceEdit(edit().id, { admin, now: () => now })).toBe("failed");
    expect((tables.video_edits[0] as Row)).toMatchObject({ stage: "failed", error: "The render took too long. Nothing was charged; try again." });
  });

  it("derives the same id from the same seed and different ids from different turns", () => {
    expect(derivedUuid("a")).toBe(derivedUuid("a"));
    expect(derivedUuid("a")).not.toBe(derivedUuid("b"));
    expect(derivedUuid("a")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
