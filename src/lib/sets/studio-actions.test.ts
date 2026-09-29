import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SET_NOT_FOUND } from "./messages";
import {
  normaliseStudioScene,
  readStudioScene,
  STUDIO_SCENE_MAX_BYTES,
  STUDIO_SCENE_NOT_SAVED,
  STUDIO_SCENE_TOO_BIG,
  STUDIO_SCENE_UNREADABLE,
} from "./studio-scene";

// Helios Studio stage 3 (2026-09-29): the scene is kept on the account.
// The doors are the owner's and the admins' (HELIOS_STUDIO_FOR_ALL false),
// a scene is an object with v 1 under 512 KB, and a missing column (the SQL
// not run yet) never breaks the Studio: a read answers null and a save says
// it couldn't reach the account, so the browser copy carries on.
//
// studio-actions.ts imports through "@/", which this suite does not resolve:
// the session and the database are stood in for; the Sets modules are real.

const SET = "22222222-2222-4222-8222-222222222222";
type Access = { error: string } | { error: null; supabase: unknown; userId: string; plan: string; isAdmin: boolean };
let access: Access;
let updateAnswer: { data: { id: string }[] | null; error: { message: string } | null };
const updates: { values: unknown; filters: [string, string, unknown][] }[] = [];

function updater() {
  const filters: [string, string, unknown][] = [];
  const rec = { values: null as unknown, filters };
  const chain = {
    update(values: unknown) {
      rec.values = values;
      updates.push(rec);
      return chain;
    },
    eq(col: string, v: unknown) {
      filters.push(["eq", col, v]);
      return chain;
    },
    is(col: string, v: unknown) {
      filters.push(["is", col, v]);
      return chain;
    },
    select: async () => updateAnswer,
  };
  return chain;
}

/** A read client whose select answers `answer` (or throws). */
function reader(answer: { data: unknown; error: { message: string } | null } | "throw") {
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    maybeSingle: async () => {
      if (answer === "throw") throw new Error("network");
      return answer;
    },
  };
  return { from: () => chain };
}

vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => ({ from: () => updater() }) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimited: async () => false }));
vi.mock("@/lib/sets/access", () => ({
  setsAccess: async () => access,
  UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
}));
vi.mock("@/lib/sets/set-config", async () => await import("./set-config"));
vi.mock("@/lib/sets/messages", async () => await import("./messages"));
vi.mock("@/lib/sets/studio-scene", async () => await import("./studio-scene"));

import { loadStudioScene, saveStudioScene } from "./studio-actions";

const scene = { v: 1, hour: 14, format: "16:9 · HD", lens: 35, items: [{ key: "person", t: [0, 0, 0] }] };
const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});

beforeEach(() => {
  access = { error: null, supabase: reader({ data: { studio_scene: scene }, error: null }), userId: "u1", plan: "studio", isAdmin: true };
  updateAnswer = { data: [{ id: SET }], error: null };
  updates.length = 0;
  quiet.mockClear();
});

describe("normaliseStudioScene", () => {
  it("keeps an object with v 1, as JSON keeps it", () => {
    const n = normaliseStudioScene({ ...scene, gone: undefined });
    expect(n).toEqual({ ok: true, scene });
  });
  it("refuses anything else", () => {
    for (const v of [null, undefined, "x", 3, [scene], { ...scene, v: 2 }, { items: [] }]) {
      expect(normaliseStudioScene(v)).toEqual({ ok: false, error: STUDIO_SCENE_UNREADABLE });
    }
  });
  it("refuses a scene over the cap, and says so", () => {
    const big = { v: 1, items: [{ keys: "x".repeat(STUDIO_SCENE_MAX_BYTES) }] };
    expect(normaliseStudioScene(big)).toEqual({ ok: false, error: STUDIO_SCENE_TOO_BIG });
  });
});

describe("readStudioScene — fails soft", () => {
  it("answers the saved scene", async () => {
    expect(await readStudioScene(reader({ data: { studio_scene: scene }, error: null }) as never, SET, "u1")).toEqual(scene);
  });
  it("answers null when the column isn't there yet (the SQL not run)", async () => {
    const db = reader({ data: null, error: { message: 'column location_sets.studio_scene does not exist' } });
    expect(await readStudioScene(db as never, SET, "u1")).toBeNull();
    expect(quiet).toHaveBeenCalled();
  });
  it("answers null when the read throws, when none is kept, or when what is kept is not a scene", async () => {
    expect(await readStudioScene(reader("throw") as never, SET, "u1")).toBeNull();
    expect(await readStudioScene(reader({ data: { studio_scene: null }, error: null }) as never, SET, "u1")).toBeNull();
    expect(await readStudioScene(reader({ data: null, error: null }) as never, SET, "u1")).toBeNull();
    expect(await readStudioScene(reader({ data: { studio_scene: { v: 7 } }, error: null }) as never, SET, "u1")).toBeNull();
  });
});

describe("loadStudioScene", () => {
  it("answers the owner's scene", async () => {
    expect(await loadStudioScene(SET)).toEqual({ error: null, scene });
  });
  it("answers null, not an error, when the column is missing", async () => {
    access = { ...(access as Extract<Access, { error: null }>), supabase: reader({ data: null, error: { message: "column does not exist" } }) };
    expect(await loadStudioScene(SET)).toEqual({ error: null, scene: null });
  });
  it("is the admins' while the Studio is", async () => {
    access = { ...(access as Extract<Access, { error: null }>), isAdmin: false };
    expect(await loadStudioScene(SET)).toEqual({ error: SET_NOT_FOUND });
  });
  it("says the access check's own refusal, and refuses a bad id", async () => {
    access = { error: "Sign in again." };
    expect(await loadStudioScene(SET)).toEqual({ error: "Sign in again." });
    access = { error: null, supabase: reader("throw"), userId: "u1", plan: "studio", isAdmin: true };
    expect(await loadStudioScene("nope")).toEqual({ error: SET_NOT_FOUND });
  });
});

describe("saveStudioScene", () => {
  it("writes the scene on the owner's own, live set", async () => {
    expect(await saveStudioScene(SET, scene)).toEqual({ error: null });
    expect(updates).toHaveLength(1);
    expect(updates[0].values).toEqual({ studio_scene: scene });
    expect(updates[0].filters).toEqual([
      ["eq", "id", SET],
      ["eq", "user_id", "u1"],
      ["is", "deleted_at", null],
    ]);
  });
  it("writes nothing for a bad id, a bad scene, a scene over the cap, or a non-admin", async () => {
    expect(await saveStudioScene("nope", scene)).toEqual({ error: SET_NOT_FOUND });
    expect(await saveStudioScene(SET, { v: 2 })).toEqual({ error: STUDIO_SCENE_UNREADABLE });
    expect(await saveStudioScene(SET, { v: 1, blob: "x".repeat(STUDIO_SCENE_MAX_BYTES) })).toEqual({ error: STUDIO_SCENE_TOO_BIG });
    access = { ...(access as Extract<Access, { error: null }>), isAdmin: false };
    expect(await saveStudioScene(SET, scene)).toEqual({ error: SET_NOT_FOUND });
    expect(updates).toHaveLength(0);
  });
  it("says it couldn't reach the account when the column is missing", async () => {
    updateAnswer = { data: null, error: { message: 'column "studio_scene" of relation "location_sets" does not exist' } };
    expect(await saveStudioScene(SET, scene)).toEqual({ error: STUDIO_SCENE_NOT_SAVED });
  });
  it("is not found when no row of theirs was touched", async () => {
    updateAnswer = { data: [], error: null };
    expect(await saveStudioScene(SET, scene)).toEqual({ error: SET_NOT_FOUND });
  });
});

describe("the wiring", () => {
  const read = (p: string) => readFileSync(join(__dirname, "../../..", p), "utf8");
  it("the page hands the Studio the account's copy", () => {
    const page = read("src/app/app/sets/[id]/page.tsx");
    expect(page).toContain("const savedScene = await readStudioScene(supabase, data.set.id, userData.user.id);");
    expect(page).toContain("savedScene={savedScene}");
  });
  it("the engine opens from the account unless this browser's copy is newer, saves up ~5 s after a change, and keeps the browser copy", () => {
    const engine = read("src/components/studio/studio-engine.ts");
    expect(engine).toContain("const SERVER_DELAY_MS = 5000");
    expect(engine).toContain("localStorage.setItem(SAVE_KEY, JSON.stringify(stamped(s)))");
    expect(engine).toContain('local.at > (acct.at || 0))) return { data: acct, from: "account" }');
    expect(engine).toContain('"Saved to your account"');
    expect(engine).toContain("couldn't reach your account");
    const wrapper = read("src/components/studio/helios-studio.tsx");
    expect(wrapper).toContain("return await saveStudioScene(setId, scene);");
  });
  it("the SQL adds the one column, idempotently", () => {
    expect(read("supabase/applied/2026-09-29/helios-studio-scene.sql")).toContain(
      "alter table public.location_sets add column if not exists studio_scene jsonb;",
    );
  });
});
