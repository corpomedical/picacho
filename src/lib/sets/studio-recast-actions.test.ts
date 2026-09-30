import { beforeEach, describe, expect, it, vi } from "vitest";
import { SET_NOT_FOUND, SETS_NOT_OPEN, STUDIO_LOOK_GONE } from "./messages";

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

/** Every .eq() a query was narrowed by, per table: the look's row must be asked for as this person's. */
const filters: string[] = [];
let looks: Record<string, unknown>[] = [];
const db = {
  from: (table: string) => {
    const q = {
      select: () => q,
      eq: (k: string, v: unknown) => (filters.push(`${table}.${k}=${v}`), q),
      in: () => q,
      is: () => q,
      not: () => q,
      order: () => q,
      limit: async () => ({ data: looks }),
      maybeSingle: async () => ({ data: table === "location_sets" ? { id: SET } : row }),
    };
    return q;
  },
};
const stored: string[] = [];
const admin = {
  storage: {
    from: (bucket: string) => ({
      download: async (path: string) => (stored.push(`download ${bucket}/${path}`), { data: new Blob([new Uint8Array(8)]), error: null }),
      upload: async (path: string, _b: unknown, o: { contentType: string }) => (stored.push(`upload ${bucket}/${path} ${o.contentType}`), { error: null }),
    }),
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
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => admin }));
vi.mock("@/lib/recast/recast", async () => await import("../recast/recast"));
vi.mock("@/lib/recast/door-truth", async () => await import("../recast/door-truth"));
vi.mock("@/lib/sets/studio-recast", async () => await import("./studio-recast"));

const { reserveStudioRecast, inspectStudioRecast, startStudioRecast, readStudioRecast, discardStudioRecast, listStudioLooks } = await import("./studio-recast-actions");

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
    expect(await startStudioRecast(SET, { ...START, engine: "h3-768", castTag: "A", faceAt: { first: false, last: true } })).toEqual({ error: null, ids: [SEND] });
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
      faceAt: { first: false, last: true },
      rights: true,
    });
  });

  it("a look from the gallery: re-checked as this person's picture of THIS character, copied to Recast's image folder, sent as its added image", async () => {
    const LOOK = "55555555-5555-4555-8555-555555555555", C1 = "66666666-6666-4666-8666-666666666666";
    const media = `https://x.supabase.co/storage/v1/object/sign/generated-images/${USER}/still.png?token=t`;
    row = { id: LOOK, result_url: media, content_type: "image", status: "succeeded", character_profile_id: C1 };
    filters.length = 0; stored.length = 0;
    expect(await startStudioRecast(SET, { ...START, characterId: C1, lookId: LOOK })).toEqual({ error: null, ids: [SEND] });
    expect(filters).toEqual(expect.arrayContaining([`generations.id=${LOOK}`, `generations.user_id=${USER}`]));
    expect(stored).toEqual([`download generated-images/${USER}/still.png`, `upload chat-attachments/${USER}/studio-look-${LOOK}.png image/png`]);
    expect(JSON.parse(calls[0].slice(6)).imagePaths).toEqual([`${USER}/studio-look-${LOOK}.png`]);
    // Another character's picture, a video, an unfinished one, or none at all: nothing starts, nothing is charged.
    for (const other of [{ ...row, character_profile_id: "c2" }, { ...row, content_type: "video" }, { ...row, status: "failed" }, null]) {
      row = other; calls.length = 0;
      expect(await startStudioRecast(SET, { ...START, characterId: C1, lookId: LOOK })).toEqual({ error: STUDIO_LOOK_GONE });
      expect(calls).toEqual([]);
    }
  });

  it("the gallery strip: this person's finished pictures of the character, each with its prompt's outfit words", async () => {
    const C1 = "66666666-6666-4666-8666-666666666666";
    looks = [{ id: "g1", result_url: `https://x.supabase.co/storage/v1/object/sign/generated-images/${USER}/a.png?token=t`, prompt: "Eva wearing a red leather jacket, standing in the rain" }];
    filters.length = 0;
    const out = await listStudioLooks(SET, { characterId: C1 });
    expect(out.error).toBeNull();
    const list = (out as { looks: { id: string; url: string; outfit: string }[] }).looks;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "g1", outfit: "a red leather jacket" });
    expect(list[0].url).toMatch(/^\/api\/media\/generated-images\//);
    expect(filters).toEqual(expect.arrayContaining([`generations.user_id=${USER}`, `generations.character_profile_id=${C1}`, "generations.content_type=image", "generations.status=succeeded"]));
    expect(await listStudioLooks(SET, { characterId: "not-an-id" })).toEqual({ error: null, looks: [] });
    expect(await listStudioLooks("nope", { characterId: C1 })).toEqual({ error: SET_NOT_FOUND });
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
