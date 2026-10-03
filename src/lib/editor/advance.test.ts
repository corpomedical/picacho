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
  transcribeTwice: vi.fn(async () => ({ language: "en", words: [], speech: false, droppedSegments: 1 })),
}));
vi.mock("./agent", async (orig) => ({
  ...(await orig<typeof import("./agent")>()),
  startSession: vi.fn(async () => "sesn_1"),
  readSession: vi.fn(),
  collectDelivery: vi.fn(),
}));

import { advanceEdit, derivedUuid, OUT_OF_CREDIT_ERROR } from "./advance";
import { AgentError, collectDelivery, readSession, startSession } from "./agent";
import type { EditRow, SessionRecord } from "./job";

type Row = Record<string, unknown>;

/** A tiny ustar pack: name → text. */
function tar(entries: Record<string, string>): Uint8Array {
  const blocks: Buffer[] = [];
  for (const [name, text] of Object.entries(entries)) {
    const data = Buffer.from(text);
    const h = Buffer.alloc(512);
    h.write(`./${name}`, 0, "utf8");
    h.write(data.length.toString(8).padStart(11, "0") + "\0", 124, "ascii");
    h.write("0", 156, "ascii");
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return new Uint8Array(Buffer.concat(blocks));
}

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
  const rpcs: [string, unknown][] = [];
  const admin = {
    from: (table: string) => query(table),
    rpc: async (fn: string, args: unknown) => (rpcs.push([fn, args]), { data: null, error: null }),
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://store/${bucket}/${path}?sig` }, error: null }),
        upload: async (path: string, bytes: Uint8Array) => (files.set(`${bucket}/${path}`, bytes), { error: null }),
        remove: async () => ({ error: null }),
      }),
    },
  };
  return { admin: admin as never, tables, files, rpcs };
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
    // whisper, heard twice: 2 × (30 s + 60 s) at $0.006/min
    expect(row.cost_usd).toBeCloseTo(0.018, 6);
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
    vi.mocked(readSession).mockResolvedValue({ status: "running", stopReason: null, activity: null, errorType: null, idleAt: null, costUsd: 0.84, latest: "Rendering short 2 of 3." });
    expect(await advanceEdit(edit().id, { admin, now: () => 60_000 })).toBe("advanced");
    const row = tables.video_edits[0] as unknown as EditRow;
    expect(row).toMatchObject({ stage: "directing", progress: "Rendering short 2 of 3." });
    expect(row.render?.latest).toBe("Rendering short 2 of 3.");
    expect(row.cost_usd).toBeCloseTo(0.849, 6);
  });

  it("delivers every video into History once, even when a tick dies after the inserts", async () => {
    const { admin, tables, files } = fakeAdmin();
    tables.video_edits.push(edit({ stage: "directing", render: session() }) as never);
    vi.mocked(readSession).mockResolvedValue({ status: "idle", stopReason: "end_turn", activity: null, errorType: null, idleAt: 90_000, costUsd: 1.9, latest: "Done." });
    vi.mocked(collectDelivery).mockResolvedValue({
      resultId: "file_r1",
      notes: "Two clips had no usable sound.",
      outputs: [
        {
          file: "a.mp4",
          title: "Hook A",
          summary: "Opens on the explosion.",
          aspect: "9:16",
          seconds: 18.4,
          bytes: new Uint8Array([1]),
          // HyperFrames' own notes files ride in a pack; the bucket takes only a page's types, so they stay out.
          project: tar({ "index.html": "<html></html>", "assets/hit.wav": "RIFF", "footage/clip-0.mp4": "never kept", "CLAUDE.md": "notes", "AGENTS.md": "notes" }),
        },
        // A pack without its index.html costs the timeline, not the video.
        { file: "b.mp4", title: "Hook B", summary: "Opens on the face.", aspect: "9:16", seconds: 21, bytes: new Uint8Array([2]), project: tar({ "x.css": "a{}" }) },
      ],
    });
    expect(await advanceEdit(edit().id, { admin, now: () => 100_000 })).toBe("done");
    const ids = [0, 1].map((i) => derivedUuid(`video-edit:${edit().id}:1:${i}`));
    const dir = `u1/${edit().id}/projects/${ids[0]}`;
    expect(files.has(`edit-footage/${dir}/index.html`)).toBe(true);
    expect(files.has(`edit-footage/${dir}/assets/hit.wav`)).toBe(true);
    expect(files.has(`edit-footage/${dir}/footage/clip-0.mp4`)).toBe(false);
    expect(files.has(`edit-footage/${dir}/CLAUDE.md`)).toBe(false);
    const kept = (tables.video_edits[0] as unknown as EditRow).plan?.outputs;
    expect(kept?.[0].project).toEqual({ dir, entry: "index.html", files: [{ path: "index.html", bytes: 13 }, { path: "assets/hit.wav", bytes: 4 }] });
    expect(kept?.[1].project).toBeNull();
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

  // Credits (operator, 2026-10-03: "Pay what it uses"): the cut's hold is its first video's row.
  const HOLD = "22222222-2222-4222-8222-222222222222";
  const heard = (over: Partial<EditRow> = {}) =>
    edit({
      stage: "directing",
      render: session(),
      clips: [
        { ...clip(0), probe: { duration: 30, hasVideo: true, hasAudio: true, width: 1920, height: 1080, fps: 24 }, speech: "no-speech", analyzed: true },
        { ...clip(1, "audio/mpeg"), probe: { duration: 60, hasVideo: false, hasAudio: true, width: 0, height: 0, fps: 0 }, speech: "no-speech", analyzed: true },
      ],
      plan: { outputs: [], history: [{ role: "you", text: "Make shorts" }], holds: [{ turn: 1, rowId: HOLD, credits: 17, bytes: 20 }] },
      ...over,
    });
  const holdRow = () => ({
    id: HOLD,
    user_id: "u1",
    status: "generating",
    model_id: "video-editor",
    credits_used: 17,
    purchased_credits_used: 5,
    bonus_credits_used: 0,
    result_url: null,
    deleted_at: "2026-10-03T10:00:00Z",
  });

  it("a delivered cut keeps what Opus used and gives the rest of its hold back", async () => {
    const { admin, tables, rpcs } = fakeAdmin();
    tables.video_edits.push(heard() as never);
    tables.generations.push(holdRow());
    vi.mocked(readSession).mockResolvedValue({ status: "idle", stopReason: "end_turn", activity: null, errorType: null, idleAt: 90_000, costUsd: 2.26, latest: "Done." });
    vi.mocked(collectDelivery).mockResolvedValue({
      resultId: "file_r1",
      notes: "",
      outputs: [
        { file: "a.mp4", title: "Hook A", summary: "Opens on the explosion.", aspect: "9:16", seconds: 18.4, bytes: new Uint8Array([1]), project: null },
        { file: "b.mp4", title: "Hook B", summary: "Opens on the face.", aspect: "9:16", seconds: 21, bytes: new Uint8Array([2]), project: null },
      ],
    });
    expect(await advanceEdit(edit().id, { admin, now: () => 100_000 })).toBe("done");
    // $2.26 of Opus + listening 2 × (30 s + 60 s) at $0.006/min = $2.278 → 9 credits at $0.28.
    expect(tables.generations[0]).toMatchObject({ id: HOLD, status: "succeeded", deleted_at: null, credits_used: 9, purchased_credits_used: 0, video_aspect_ratio: "9:16" });
    expect(String(tables.generations[0].result_url)).toContain(`u1/${HOLD}.mp4`);
    // The 8 back: the 5 bought first, the other 3 off the month (credits_used fell to 9).
    expect(rpcs).toEqual([["add_purchased_credits", { p_user_id: "u1", p_amount: 5 }]]);
    // The second video is its own, free row.
    expect(tables.generations[1]).toMatchObject({ id: derivedUuid(`video-edit:${edit().id}:1:1`), credits_used: 0, status: "succeeded" });
    const row = tables.video_edits[0] as unknown as EditRow;
    expect(row.generation_id).toBe(HOLD);
    expect(row.plan?.holds).toEqual([{ turn: 1, rowId: HOLD, credits: 17, bytes: 20, charged: 9, refunded: 8 }]);

    // A tick that dies after settling and runs again settles nothing twice.
    Object.assign(tables.video_edits[0], { stage: "directing", plan: heard().plan, render: session() });
    expect(await advanceEdit(edit().id, { admin, now: () => 100_000 })).toBe("done");
    expect(rpcs).toHaveLength(1);
    expect(tables.generations[0]).toMatchObject({ credits_used: 9 });
  });

  it("a cut that delivers no video gives its whole hold back", async () => {
    const { admin, tables, rpcs } = fakeAdmin();
    tables.video_edits.push(heard() as never);
    tables.generations.push(holdRow());
    vi.mocked(readSession).mockResolvedValue({ status: "idle", stopReason: "budget_reached", activity: null, errorType: null, idleAt: 90_000, costUsd: 4.1, latest: null });
    expect(await advanceEdit(edit().id, { admin, now: () => 100_000 })).toBe("failed");
    expect(tables.generations[0]).toMatchObject({ status: "failed", credits_used: 0, purchased_credits_used: 0 });
    expect(rpcs).toEqual([["add_purchased_credits", { p_user_id: "u1", p_amount: 5 }]]);
    const row = tables.video_edits[0] as unknown as EditRow;
    expect(row.stage).toBe("failed");
    expect(row.plan?.holds?.[0]).toMatchObject({ charged: 0, refunded: 17 });
  });

  it("a change is charged only what Opus used since it was asked for", async () => {
    const { admin, tables, rpcs } = fakeAdmin();
    const HOLD2 = "33333333-3333-4333-8333-333333333333";
    tables.video_edits.push(
      heard({
        render: session({ turn: 2, turnStartedAt: 50_000, turnStartUsd: 2.3, lastResultId: "file_r1" }),
        plan: {
          outputs: [],
          history: [],
          holds: [
            { turn: 1, rowId: HOLD, credits: 17, bytes: 20, charged: 9, refunded: 8 },
            { turn: 2, rowId: HOLD2, credits: 10, bytes: 20 },
          ],
        },
      }) as never,
    );
    tables.generations.push({ ...holdRow(), id: HOLD2, credits_used: 10, purchased_credits_used: 0 });
    vi.mocked(readSession).mockResolvedValue({ status: "idle", stopReason: "end_turn", activity: null, errorType: null, idleAt: 90_000, costUsd: 3.2, latest: "Done." });
    vi.mocked(collectDelivery).mockResolvedValue({
      resultId: "file_r2",
      notes: "",
      outputs: [{ file: "a2.mp4", title: "Hook A", summary: "Shorter.", aspect: "9:16", seconds: 15, bytes: new Uint8Array([1]), project: null }],
    });
    expect(await advanceEdit(edit().id, { admin, now: () => 100_000 })).toBe("done");
    // $3.20 − $2.30 = $0.90 of Opus, no listening on a change → 4 credits; 6 back off the month.
    expect(tables.generations[0]).toMatchObject({ id: HOLD2, status: "succeeded", credits_used: 4 });
    expect(rpcs).toEqual([]);
    expect((tables.video_edits[0] as unknown as EditRow).plan?.holds?.[1]).toMatchObject({ charged: 4, refunded: 6 });
  });

  it("waits while an idle from BEFORE the change request is all the session shows", async () => {
    const { admin, tables } = fakeAdmin();
    tables.video_edits.push(edit({ stage: "directing", render: session({ turn: 2, turnStartedAt: 500_000, lastResultId: "file_r1" }) }) as never);
    vi.mocked(readSession).mockResolvedValue({ status: "idle", stopReason: "end_turn", activity: null, errorType: null, idleAt: 400_000, costUsd: 2, latest: "Done." });
    await advanceEdit(edit().id, { admin, now: () => 510_000 });
    expect((tables.video_edits[0] as Row).stage).toBe("directing");
    expect(collectDelivery).not.toHaveBeenCalled();
  });

  it("fails honestly: budget reached, nothing new delivered, the editor refusing the job", async () => {
    const one = fakeAdmin();
    one.tables.video_edits.push(edit({ stage: "directing", render: session() }) as never);
    vi.mocked(readSession).mockResolvedValue({ status: "idle", stopReason: "budget_reached", activity: null, errorType: null, idleAt: 90_000, costUsd: 6.02, latest: null });
    expect(await advanceEdit(edit().id, { admin: one.admin, now: () => 100_000 })).toBe("failed");
    expect(one.tables.video_edits[0]).toMatchObject({ stage: "failed", error: expect.stringContaining("budget") });

    const two = fakeAdmin();
    two.tables.video_edits.push(edit({ stage: "directing", render: session() }) as never);
    vi.mocked(readSession).mockResolvedValue({ status: "idle", stopReason: "end_turn", activity: null, errorType: null, idleAt: 90_000, costUsd: 1, latest: "I could not render." });
    vi.mocked(collectDelivery).mockResolvedValue(null);
    expect(await advanceEdit(edit().id, { admin: two.admin, now: () => 100_000 })).toBe("failed");
    expect(two.tables.video_edits[0]).toMatchObject({ error: 'The editor stopped without delivering a video: "I could not render."' });

    const three = fakeAdmin();
    three.tables.video_edits.push(edit({ clips: [{ ...clip(0), probe: { duration: 30, hasVideo: true, hasAudio: false, width: 1, height: 1, fps: 24 }, speech: "silent", analyzed: true }] }) as never);
    vi.mocked(startSession).mockRejectedValueOnce(new AgentError("not configured"));
    expect(await advanceEdit(edit().id, { admin: three.admin, heavyStartBudgetMs: 1e9 })).toBe("failed");
    expect(three.tables.video_edits[0]).toMatchObject({ stage: "failed", error: "The editor couldn't take this edit on. Try again." });
  });

  it("says the editor is paused on OUR side, and tells the operator, when our Anthropic workspace is out of credit (edit c7215eef, 2026-09-27)", async () => {
    const onOutOfCredit = vi.fn(async () => {});
    const one = fakeAdmin();
    one.tables.video_edits.push(edit({ stage: "directing", render: session() }) as never);
    vi.mocked(readSession).mockResolvedValue({ status: "idle", stopReason: "retries_exhausted", activity: null, errorType: "billing_error", idleAt: 90_000, costUsd: 0.25, latest: null });
    expect(await advanceEdit(edit().id, { admin: one.admin, now: () => 100_000, onOutOfCredit })).toBe("failed");
    expect(one.tables.video_edits[0]).toMatchObject({ stage: "failed", error: OUT_OF_CREDIT_ERROR });
    expect(onOutOfCredit).toHaveBeenCalledTimes(1);
    expect(collectDelivery).not.toHaveBeenCalled();

    // Any other error it gave up on keeps the old words, and nobody is paged.
    const two = fakeAdmin();
    two.tables.video_edits.push(edit({ stage: "directing", render: session() }) as never);
    vi.mocked(readSession).mockResolvedValue({ status: "idle", stopReason: "retries_exhausted", activity: null, errorType: "overloaded_error", idleAt: 90_000, costUsd: 0.25, latest: null });
    expect(await advanceEdit(edit().id, { admin: two.admin, now: () => 100_000, onOutOfCredit })).toBe("failed");
    expect(two.tables.video_edits[0]).toMatchObject({ error: "The editor ran into repeated errors. Try again in a few minutes." });
    expect(onOutOfCredit).toHaveBeenCalledTimes(1);

    // Refused before a session even starts: failed at once — no two more minutes of retries.
    const three = fakeAdmin();
    three.tables.video_edits.push(edit({ clips: [{ ...clip(0), probe: { duration: 30, hasVideo: true, hasAudio: false, width: 1, height: 1, fps: 24 }, speech: "silent", analyzed: true }] }) as never);
    vi.mocked(startSession).mockRejectedValueOnce(
      Object.assign(new Error("400 billing_error"), { error: { type: "error", error: { type: "billing_error", message: "Your credit balance is too low" } } }),
    );
    expect(await advanceEdit(edit().id, { admin: three.admin, heavyStartBudgetMs: 1e9, onOutOfCredit })).toBe("failed");
    expect(three.tables.video_edits[0]).toMatchObject({ stage: "failed", error: OUT_OF_CREDIT_ERROR, attempts: 1 });
    expect(onOutOfCredit).toHaveBeenCalledTimes(2);
  });

  it("still fails the edit when the alert itself throws", async () => {
    const { admin, tables } = fakeAdmin();
    tables.video_edits.push(edit({ stage: "directing", render: session() }) as never);
    vi.mocked(readSession).mockResolvedValue({ status: "idle", stopReason: "retries_exhausted", activity: null, errorType: "billing_error", idleAt: 90_000, costUsd: 0.25, latest: null });
    const onOutOfCredit = vi.fn(async () => {
      throw new Error("push down");
    });
    expect(await advanceEdit(edit().id, { admin, now: () => 100_000, onOutOfCredit })).toBe("failed");
    expect(tables.video_edits[0]).toMatchObject({ error: OUT_OF_CREDIT_ERROR });
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
