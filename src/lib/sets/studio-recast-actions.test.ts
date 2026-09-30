import { beforeEach, describe, expect, it, vi } from "vitest";
import { SET_NOT_FOUND, SETS_NOT_OPEN } from "./messages";

// The Studio's doors to Recast (studio-recast-actions.ts, 2026-09-30): an
// account on no plan never reaches Recast; an account Recast refuses is
// refused in Recast's words; only the Studio's lanes start, with the press's
// own sendId and the whole recording as the window. Recast's actions, the
// session and the poll are stood in for — nothing here can spend.

const USER = "11111111-1111-4111-8111-111111111111";
const SET = "22222222-2222-4222-8222-222222222222";
const SEND = "44444444-4444-4444-8444-444444444444";
const RECAST_NOT_OPEN = "Recasting is in private testing.";

let access: Record<string, unknown> = {};
let recastOpen = true;
let row: Record<string, unknown> | null = null;
const calls: string[] = [];

const db = {
  from: (table: string) => {
    const q = {
      select: () => q,
      eq: () => q,
      in: () => q,
      is: () => q,
      maybeSingle: async () => ({ data: table === "location_sets" ? { id: SET } : row }),
    };
    return q;
  },
};
vi.stubEnv("MEDIA_SIGNING_SECRET", "test-only");
const recastGate = <T,>(answer: T) => (recastOpen ? answer : { error: RECAST_NOT_OPEN });

vi.mock("@/lib/sets/access", () => ({
  setsAccess: async () => access,
  UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
}));
vi.mock("@/lib/sets/messages", async () => await import("./messages"));
vi.mock("@/lib/recast/actions", () => ({
  canUseRecast: async () => (calls.push("canUseRecast"), { error: recastOpen ? null : RECAST_NOT_OPEN }),
  reserveRecastUpload: async (i: unknown) => (calls.push("reserve " + JSON.stringify(i)), recastGate({ error: null, path: `${USER}/x.mp4`, contentType: "video/mp4" })),
  inspectRecastClip: async (i: unknown) =>
    (calls.push("inspect " + JSON.stringify(i)), recastGate({ error: null, path: `${USER}/x.mp4`, seconds: 5, frames: 120, width: 1280, height: 720, quotes: [], read: null, warnings: [] })),
  startRecastTakes: async (i: unknown) => (calls.push("start " + JSON.stringify(i)), recastGate({ error: null, ids: [SEND] })),
  discardRecastUpload: async (p: unknown) => void calls.push("discard " + p),
}));
vi.mock("@/lib/generations/actions", () => ({ pollGeneration: async () => (calls.push("poll"), { error: null, state: "pending", stage: "video", progress: "Rendering" }) }));
vi.mock("@/lib/media/url", async () => await import("../media/url"));
vi.mock("@/lib/recast/recast", async () => await import("../recast/recast"));
vi.mock("@/lib/recast/door-truth", async () => await import("../recast/door-truth"));
vi.mock("@/lib/sets/studio-recast", async () => await import("./studio-recast"));

const { reserveStudioRecast, inspectStudioRecast, startStudioRecast, readStudioRecast, discardStudioRecast } = await import("./studio-recast-actions");

const START = { sendId: SEND, path: `${USER}/x.mp4`, characterId: "c1", engine: "kling-edit", seconds: 5, direction: "d", read: null, castTag: null };

beforeEach(() => {
  access = { error: null, supabase: db, userId: USER, plan: "growth", isAdmin: false };
  recastOpen = true;
  row = null;
  calls.length = 0;
});

describe("an account on no plan", () => {
  it("is refused at every door before Recast is asked anything", async () => {
    access = { error: SETS_NOT_OPEN };
    expect(await reserveStudioRecast(SET, { size: 1000, type: "video/mp4" })).toEqual({ error: SETS_NOT_OPEN });
    expect(await inspectStudioRecast(SET, { path: `${USER}/x.mp4` })).toEqual({ error: SETS_NOT_OPEN });
    expect(await startStudioRecast(SET, START)).toEqual({ error: SETS_NOT_OPEN });
    expect(await readStudioRecast(SET, { id: SEND })).toEqual({ error: SETS_NOT_OPEN });
    await discardStudioRecast(SET, { path: `${USER}/x.mp4` });
    expect(calls).toEqual([]);
  });
});

describe("an account Recast won't take", () => {
  it("is refused in Recast's own words, and no take starts", async () => {
    recastOpen = false;
    expect(await reserveStudioRecast(SET, { size: 1000, type: "video/mp4" })).toEqual({ error: RECAST_NOT_OPEN });
    expect(await startStudioRecast(SET, START)).toEqual({ error: RECAST_NOT_OPEN });
    expect(await readStudioRecast(SET, { id: SEND })).toEqual({ error: RECAST_NOT_OPEN });
    expect(calls).not.toContain("poll");
  });
});

describe("the doors hand Recast the Studio's press", () => {
  it("reserve: the recording's type and a name Recast knows it by", async () => {
    await reserveStudioRecast(SET, { size: 97251, type: "video/mp4;codecs=avc1.640028" });
    await reserveStudioRecast(SET, { size: 5, type: "video/webm" });
    expect(calls).toEqual(['reserve {"size":97251,"type":"video/mp4","name":"helios-studio.mp4"}', 'reserve {"size":5,"type":"video/webm","name":"helios-studio.webm"}']);
  });

  it("inspect: Recast samples the file itself", async () => {
    expect(await inspectStudioRecast(SET, { path: `${USER}/x.mp4` })).toMatchObject({ error: null, seconds: 5, width: 1280, height: 720 });
    expect(calls).toEqual([`inspect {"path":"${USER}/x.mp4","frames":""}`]);
  });

  it("start: one character, the lane, the whole recording as the window, the sendId, the rights", async () => {
    expect(await startStudioRecast(SET, { ...START, engine: "h3-768", castTag: "A" })).toEqual({ error: null, ids: [SEND] });
    expect(JSON.parse(calls[0].slice(6))).toEqual({
      sendId: SEND,
      path: `${USER}/x.mp4`,
      characterIds: ["c1"],
      engine: "h3-768",
      keeps: [],
      direction: "d",
      castTag: "A",
      read: null,
      window: { start: 0, end: 5 },
      rights: true,
    });
  });

  it("start: a lane the Studio doesn't offer, a set that isn't there, or no length never reaches Recast", async () => {
    expect(await startStudioRecast(SET, { ...START, engine: "kling-pro" })).toEqual({ error: SET_NOT_FOUND });
    expect(await startStudioRecast("nope", START)).toEqual({ error: SET_NOT_FOUND });
    expect(await startStudioRecast(SET, { ...START, seconds: 0 })).toEqual({ error: SET_NOT_FOUND });
    expect(calls).toEqual([]);
  });

  it("read: nothing yet, rendering (advanced by the poll), done, failed", async () => {
    expect(await readStudioRecast(SET, { id: SEND })).toEqual({ error: null, state: "none" });
    row = { id: SEND, status: "generating", result_url: null, credits_used: 3 };
    expect(await readStudioRecast(SET, { id: SEND })).toEqual({ error: null, state: "working", progress: "Rendering" });
    row = { id: SEND, status: "succeeded", result_url: "https://x.supabase.co/storage/v1/object/public/generated-videos/u/t.mp4", credits_used: 3 };
    const done = await readStudioRecast(SET, { id: SEND });
    expect(done).toMatchObject({ error: null, state: "done" });
    row = { id: SEND, status: "failed", result_url: null, credits_used: 0, pipeline_log: null };
    expect(await readStudioRecast(SET, { id: SEND })).toEqual({ error: null, state: "failed", reason: null, refused: false, charged: false });
  });
});
