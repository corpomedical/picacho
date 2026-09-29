import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CYCLES_BAD_JOB,
  CYCLES_NOT_A_SCENE,
  CYCLES_NOT_SWITCHED_ON,
  CYCLES_TEAM_ONLY,
  CYCLES_TOO_BIG,
  CYCLES_UNREACHABLE,
  CYCLES_GLB_MAX_BYTES,
  cyclesPath,
} from "./cycles";
import { SET_NOT_FOUND, SETS_SESSION_EXPIRED } from "./messages";

// The Blender render doors (cycles-actions.ts, 2026-09-29): who may press
// (signed in, admins only while HELIOS_CYCLES_FOR_ALL is false, the set
// their own), the plain answer while the Modal keys aren't set, the job's
// check before anything is read or sent, ONE render per press, and what the
// read answers. Storage, the session and Modal are stood in for.

const USER = "11111111-1111-4111-8111-111111111111";
const SET = "22222222-2222-4222-8222-222222222222";
const PRESS = "33333333-3333-4333-8333-333333333333";
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1.6, 8, 1];
const JOB = {
  kind: "still",
  width: 1280,
  height: 720,
  samples: 128,
  frameStart: 1,
  frameEnd: 1,
  fps: 24,
  lensMm: 35,
  sensorMm: 24,
  camera: [I],
  tracks: [],
  world: { mode: "simple", background: [0.2, 0.3, 0.5], sky: [0.8, 0.85, 0.9], ground: [0.05, 0.05, 0.04], strength: 0.9 },
  sun: { on: true, dir: [0.4, 0.8, 0.3], color: [1, 0.95, 0.9], strength: 2.6 },
  hour: 15.8,
};
function glb(size = 64): Uint8Array {
  const b = new Uint8Array(size);
  b.set([0x67, 0x6c, 0x54, 0x46]);
  new DataView(b.buffer).setUint32(4, 2, true);
  new DataView(b.buffer).setUint32(8, size, true);
  return b;
}

let access: Record<string, unknown> = {};
let owned = true;
let limited = false;
const files = new Map<string, Uint8Array | string>();
const calls: { url: string; init: RequestInit }[] = [];
let modalAnswer: (url: string) => Response | Promise<Response> = () => new Response(JSON.stringify({ call_id: "fc-01ABC" }));

vi.stubEnv("MEDIA_SIGNING_SECRET", "test-only");
vi.spyOn(console, "warn").mockImplementation(() => {});

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({
    from: () => {
      const q = { select: () => q, eq: () => q, is: () => q, maybeSingle: async () => ({ data: owned ? { id: SET } : null, error: null }) };
      return q;
    },
    storage: {
      from: () => ({
        upload: async (path: string, body: string | Uint8Array, opts: { upsert?: boolean }) => {
          if (!opts?.upsert && files.has(path)) return { error: { message: "The resource already exists" } };
          files.set(path, body);
          return { error: null };
        },
        download: async (path: string) => {
          const f = files.get(path);
          return f === undefined ? { data: null, error: { message: "Object not found" } } : { data: new Blob([f as BlobPart]), error: null };
        },
        remove: async (paths: string[]) => {
          for (const p of paths) files.delete(p);
          return { error: null };
        },
        createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://store/read/${path}?token=r` }, error: null }),
        createSignedUploadUrl: async (path: string) => ({ data: { signedUrl: `https://store/upload/${path}?token=u`, token: "u", path }, error: null }),
      }),
    },
  }),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimited: async () => limited }));
vi.mock("@/lib/generations/providers/fetch-with-timeout", () => ({
  fetchWithTimeout: async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return modalAnswer(url);
  },
}));
vi.mock("@/lib/media/url", async () => await import("../media/url"));
vi.mock("@/lib/sets/access", () => ({
  setsAccess: async () => access,
  UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
}));
vi.mock("@/lib/sets/set-config", async () => await import("./set-config"));
vi.mock("@/lib/sets/messages", async () => await import("./messages"));
vi.mock("@/lib/sets/thing-model", async () => await import("./thing-model"));
vi.mock("@/lib/sets/cycles", async () => await import("./cycles"));

const { reserveCyclesScene, renderCyclesInSet, readCyclesRender } = await import("./cycles-actions");

const admin = { error: null, supabase: {}, userId: USER, plan: "none", isAdmin: true };
const keys = () => {
  vi.stubEnv("MODAL_CYCLES_URL", "https://picacho--helios-cycles-api.modal.run/");
  vi.stubEnv("MODAL_KEY", "wk-test");
  vi.stubEnv("MODAL_SECRET", "ws-test");
};

beforeEach(() => {
  access = admin;
  owned = true;
  limited = false;
  files.clear();
  calls.length = 0;
  modalAnswer = () => new Response(JSON.stringify({ call_id: "fc-01ABC" }));
  keys();
});

describe("who may press", () => {
  it("answers a signed-out session with setsAccess's own refusal, before anything else", async () => {
    access = { error: SETS_SESSION_EXPIRED };
    expect(await reserveCyclesScene(SET, { pressId: PRESS, size: 64 })).toEqual({ error: SETS_SESSION_EXPIRED });
    expect(await renderCyclesInSet(SET, { pressId: PRESS, job: JOB })).toEqual({ error: SETS_SESSION_EXPIRED });
    expect(await readCyclesRender(SET, { pressId: PRESS })).toEqual({ error: SETS_SESSION_EXPIRED });
    expect(calls).toEqual([]);
  });

  it("keeps everyone but admins out while it is the team's, on every paid plan", async () => {
    access = { ...admin, plan: "elite", isAdmin: false };
    expect(await reserveCyclesScene(SET, { pressId: PRESS, size: 64 })).toEqual({ error: CYCLES_TEAM_ONLY });
    expect(await renderCyclesInSet(SET, { pressId: PRESS, job: JOB })).toEqual({ error: CYCLES_TEAM_ONLY });
    expect(await readCyclesRender(SET, { pressId: PRESS })).toEqual({ error: CYCLES_TEAM_ONLY });
    expect(files.size + calls.length).toBe(0);
  });

  it("finds no set that isn't the person's own, and takes no id that isn't one", async () => {
    owned = false;
    expect(await reserveCyclesScene(SET, { pressId: PRESS, size: 64 })).toEqual({ error: SET_NOT_FOUND });
    expect(await renderCyclesInSet(SET, { pressId: PRESS, job: JOB })).toEqual({ error: SET_NOT_FOUND });
    owned = true;
    expect(await reserveCyclesScene("../x", { pressId: PRESS, size: 64 })).toEqual({ error: SET_NOT_FOUND });
    expect(await renderCyclesInSet(SET, { pressId: "again", job: JOB })).toEqual({ error: SET_NOT_FOUND });
    expect(calls).toEqual([]);
  });
});

describe("switched off", () => {
  it("says Blender renders aren't switched on while any of the three values is missing, and sends nothing", async () => {
    for (const name of ["MODAL_CYCLES_URL", "MODAL_KEY", "MODAL_SECRET"]) {
      keys();
      vi.stubEnv(name, "");
      expect(await reserveCyclesScene(SET, { pressId: PRESS, size: 64 }), name).toEqual({ error: CYCLES_NOT_SWITCHED_ON });
      expect(await renderCyclesInSet(SET, { pressId: PRESS, job: JOB }), name).toEqual({ error: CYCLES_NOT_SWITCHED_ON });
      expect(await readCyclesRender(SET, { pressId: PRESS }), name).toEqual({ error: CYCLES_NOT_SWITCHED_ON });
    }
    vi.stubEnv("MODAL_CYCLES_URL", "http://not-https.example");
    expect(await renderCyclesInSet(SET, { pressId: PRESS, job: JOB })).toEqual({ error: CYCLES_NOT_SWITCHED_ON });
    expect(files.size + calls.length).toBe(0);
  });
});

describe("one press", () => {
  const scene = cyclesPath(USER, SET, PRESS, "glb");
  const ticket = cyclesPath(USER, SET, PRESS, "json");

  it("hands out a one-time place for the scene, within the size cap", async () => {
    expect(await reserveCyclesScene(SET, { pressId: PRESS, size: CYCLES_GLB_MAX_BYTES + 1 })).toEqual({ error: CYCLES_TOO_BIG });
    expect(await reserveCyclesScene(SET, { pressId: PRESS, size: 64 })).toEqual({ error: null, path: scene, token: "u" });
  });

  it("checks the job before reading the scene or calling Modal", async () => {
    files.set(scene, glb());
    expect(await renderCyclesInSet(SET, { pressId: PRESS, job: { ...JOB, samples: 99999 } })).toEqual({ error: CYCLES_BAD_JOB });
    expect(files.has(ticket)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("refuses a scene that didn't arrive or isn't a GLB, and says so to a later read", async () => {
    expect(await renderCyclesInSet(SET, { pressId: PRESS, job: JOB })).toEqual({ error: CYCLES_NOT_A_SCENE });
    expect(await readCyclesRender(SET, { pressId: PRESS })).toEqual({ error: CYCLES_NOT_A_SCENE });
    const other = "44444444-4444-4444-8444-444444444444";
    files.set(cyclesPath(USER, SET, other, "glb"), new Uint8Array(64));
    expect(await renderCyclesInSet(SET, { pressId: other, job: JOB })).toEqual({ error: CYCLES_NOT_A_SCENE });
    expect(calls).toEqual([]);
  });

  it("starts ONE render per press: the job and two signed addresses go to Modal with the proxy-auth headers; a second delivery starts nothing", async () => {
    files.set(scene, glb());
    expect(await renderCyclesInSet(SET, { pressId: PRESS, job: JOB })).toEqual({ error: null, state: "started" });
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe("https://picacho--helios-cycles-api.modal.run/render");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Modal-Key": "wk-test", "Modal-Secret": "ws-test" });
    const body = JSON.parse(String(init.body));
    expect(body.glb_url).toBe(`https://store/read/${scene}?token=r`);
    expect(body.upload_url).toBe(`https://store/upload/${cyclesPath(USER, SET, PRESS, "png")}?token=u`);
    expect(body.content_type).toBe("image/png");
    expect(body.job).toEqual(JOB);
    expect(JSON.parse(String(files.get(ticket)))).toMatchObject({ v: 1, kind: "still", callId: "fc-01ABC" });

    expect(await renderCyclesInSet(SET, { pressId: PRESS, job: JOB })).toEqual({ error: null, state: "started" });
    expect(calls).toHaveLength(1);
  });

  it("says plainly when Modal doesn't answer, and a read of that press says the same", async () => {
    files.set(scene, glb());
    modalAnswer = () => new Response("no", { status: 502 });
    expect(await renderCyclesInSet(SET, { pressId: PRESS, job: JOB })).toEqual({ error: CYCLES_UNREACHABLE });
    expect(await readCyclesRender(SET, { pressId: PRESS })).toEqual({ error: CYCLES_UNREACHABLE });
  });
});

describe("following a render", () => {
  const start = async () => {
    files.set(cyclesPath(USER, SET, PRESS, "glb"), glb());
    await renderCyclesInSet(SET, { pressId: PRESS, job: JOB });
  };

  it("answers frame n of m while it runs, reading the call the ticket names", async () => {
    await start();
    modalAnswer = () => new Response(JSON.stringify({ state: "running", done: 3, total: 10 }));
    expect(await readCyclesRender(SET, { pressId: PRESS })).toEqual({ error: null, state: "working", done: 3, total: 10 });
    expect(calls.at(-1)!.url).toBe("https://picacho--helios-cycles-api.modal.run/result/fc-01ABC");
    expect(calls.at(-1)!.init.headers).toMatchObject({ "Modal-Key": "wk-test", "Modal-Secret": "ws-test" });
  });

  it("hands back the file's address, the seconds and their cost when done, charges no credits, and lets the scene go", async () => {
    await start();
    modalAnswer = () => new Response(JSON.stringify({ state: "done", seconds: 58.2, render_seconds: 31.5, device: "OPTIX", frames: 1, bytes: 1234 }));
    const r = await readCyclesRender(SET, { pressId: PRESS });
    expect(r).toMatchObject({ error: null, state: "done", kind: "still", seconds: 58.2, renderSeconds: 31.5, device: "OPTIX", credits: 0 });
    if (r.error === null && r.state === "done") {
      expect(r.url).toMatch(new RegExp(`^/api/media/generated-videos/${USER}/sets/${SET}\\.cycles\\.${PRESS}\\.png\\?v=`));
      expect(r.usd).toBeCloseTo(58.2 * 0.00062992, 8);
    }
    expect(files.has(cyclesPath(USER, SET, PRESS, "glb"))).toBe(false);
  });

  it("says why a render failed, and a missed read is only 'still working'", async () => {
    await start();
    modalAnswer = () => new Response(JSON.stringify({ state: "failed", error: "no GPU was found for Cycles" }));
    expect(await readCyclesRender(SET, { pressId: PRESS })).toEqual({ error: "Blender couldn't render this scene. no GPU was found for Cycles" });
    modalAnswer = () => {
      throw new Error("socket hang up");
    };
    expect(await readCyclesRender(SET, { pressId: PRESS })).toEqual({ error: null, state: "working", done: 0, total: 0 });
  });
});
