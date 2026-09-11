import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FINISHER_BATCH,
  FINISHER_CONCURRENCY,
  FINISHER_START_BUDGET_MS,
  FINISHER_WINDOW_MS,
  finisherCanRun,
  runSetsFinisher,
  type FinisherDeps,
} from "./finisher";
import type { AdvanceSetBuildInput, SetBuildTick } from "./build-tick";
import { setNoticePath, setNoticeTag } from "./leaving";
import type { NotifyOptions } from "../push/channels";
import type { PushMessage } from "../push/send";

// The set finisher (2026-09-11), driven with fakes: the same rules as the
// page without a session, asked before every tick as the page asks them
// before every poll, the same tick, and a notification only for a build
// this run's own write settled — to browsers only.

const NOW = Date.parse("2026-09-11T12:00:00.000Z");
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ADMIN_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUSPENDED = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PAYING = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const NO_PROFILE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const set = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ROOT = join(__dirname, "..", "..", "..");
const readSource = (p: string) => readFileSync(join(ROOT, p), "utf8");

type Op = [string, unknown[]];
type Call = { table: string; ops: Op[] };
type Answer = { data: unknown; error: { message: string } | null };

const argsOf = (call: Call, name: string) => call.ops.find(([m]) => m === name)?.[1];
const eqOf = (call: Call, column: string) => call.ops.find(([m, a]) => m === "eq" && a[0] === column)?.[1][1];

// A PostgREST stand-in that records every chain and answers by table.
function fakeAdmin(answer: (call: Call) => Answer) {
  const calls: Call[] = [];
  const admin = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "gte", "order", "limit", "in", "maybeSingle"]) {
        builder[m] = (...args: unknown[]) => {
          call.ops.push([m, args]);
          return builder;
        };
      }
      builder.then = (resolve: (v: Answer) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve()
          .then(() => answer(call))
          .then(resolve, reject);
      return builder;
    },
  };
  return { admin: admin as unknown as SupabaseClient, calls };
}

type Row = { id: string; user_id: string };
type Profile = { id: string; plan: string | null; role: string | null; status: string | null };
type Setup = {
  rows?: Row[];
  rowsError?: boolean;
  /** Read at the moment each profile query runs, so a test may change it mid-run. */
  profiles?: Profile[];
  /** Owners whose profile read fails. */
  profileErrors?: string[];
  /** A set's title as read after its tick; null = deleted since; "error" = the read fails. */
  titles?: Record<string, string | null | "error">;
  /** The astra_sets switch, asked afresh at every read. */
  flag?: boolean | (() => boolean);
  /** The astra_photo_sets switch, asked afresh at every read. */
  photoFlag?: boolean | (() => boolean);
  env?: Record<string, string | undefined>;
  advance?: (input: AdvanceSetBuildInput) => Promise<SetBuildTick>;
  notify?: FinisherDeps["notify"];
};

const PROFILES: Profile[] = [
  { id: ADMIN, plan: "none", role: "admin", status: "active" },
  { id: ADMIN_2, plan: "starter", role: "admin", status: null },
  { id: SUSPENDED, plan: "elite", role: "admin", status: "suspended" },
  { id: PAYING, plan: "studio", role: "user", status: "active" },
];

const building = (): SetBuildTick => ({ result: { error: null, state: "building" }, settledHere: null });
const switchValue = (v: boolean | (() => boolean) | undefined, fallback: boolean) =>
  typeof v === "function" ? v() : (v ?? fallback);

function setup(o: Setup = {}) {
  const clock = { t: NOW };
  const counts = { adminMade: 0, flagReads: 0, photoReads: 0 };
  const advanced: AdvanceSetBuildInput[] = [];
  const notified: {
    userId: string;
    notification: { message: PushMessage; path: string; tag?: string };
    options: NotifyOptions;
  }[] = [];
  const flagClients: SupabaseClient[] = [];
  const photoClients: SupabaseClient[] = [];
  const { admin, calls } = fakeAdmin((call) => {
    if (call.table === "location_sets" && argsOf(call, "select")?.[0] === "id, user_id") {
      return o.rowsError ? { data: null, error: { message: "boom" } } : { data: o.rows ?? [], error: null };
    }
    if (call.table === "profiles") {
      const id = eqOf(call, "id") as string;
      if (o.profileErrors?.includes(id)) return { data: null, error: { message: "boom" } };
      return { data: (o.profiles ?? PROFILES).find((p) => p.id === id) ?? null, error: null };
    }
    if (call.table === "location_sets" && argsOf(call, "select")?.[0] === "title") {
      const title = o.titles?.[eqOf(call, "id") as string];
      if (title === "error") return { data: null, error: { message: "boom" } };
      if (title === null) return { data: null, error: null };
      return { data: { title: title ?? "A set" }, error: null };
    }
    throw new Error(`unexpected query on ${call.table}`);
  });
  const deps: FinisherDeps = {
    env: o.env ?? { OPENAI_API_KEY: "sk-test" },
    admin: () => {
      counts.adminMade++;
      return admin;
    },
    advance: async (input) => {
      advanced.push(input);
      return o.advance ? o.advance(input) : building();
    },
    notify:
      o.notify ??
      (async (userId, notification, options) => {
        notified.push({ userId, notification, options });
      }),
    now: () => clock.t,
    setsEnabled: async (client) => {
      counts.flagReads++;
      flagClients.push(client);
      return switchValue(o.flag, true);
    },
    photoSetsEnabled: async (client) => {
      counts.photoReads++;
      photoClients.push(client);
      return switchValue(o.photoFlag, false);
    },
  };
  return { deps, admin, calls, counts, advanced, notified, clock, flagClients, photoClients };
}

const profileReads = (calls: Call[]) => calls.filter((c) => c.table === "profiles");

let info: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  info = vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("the kill switch stops the finisher before any database read", () => {
  it("ASTRA_DISABLED=1: nothing made, nothing read, nothing ticked", async () => {
    const f = setup({ env: { ASTRA_DISABLED: "1", OPENAI_API_KEY: "sk-test" }, rows: [{ id: set(1), user_id: ADMIN }] });
    expect(await runSetsFinisher(f.deps)).toEqual({ status: 200, body: { skipped: "disabled" } });
    expect(f.counts).toEqual({ adminMade: 0, flagReads: 0, photoReads: 0 });
    expect(f.calls).toEqual([]);
    expect(f.advanced).toEqual([]);
  });

  it("no OpenAI key: the same", async () => {
    for (const env of [{}, { OPENAI_API_KEY: "" }]) {
      const f = setup({ env, rows: [{ id: set(1), user_id: ADMIN }] });
      expect(await runSetsFinisher(f.deps)).toEqual({ status: 200, body: { skipped: "disabled" } });
      expect(f.counts.adminMade).toBe(0);
      expect(f.calls).toEqual([]);
    }
  });
});

describe("which builds it looks at", () => {
  it("asks for building, undeleted sets touched in the last two hours, oldest first, 25 at most — ids and owners only", async () => {
    const f = setup({ rows: [] });
    expect(await runSetsFinisher(f.deps)).toEqual({ status: 200, body: { checked: 0 } });
    expect(f.calls).toHaveLength(1);
    const q = f.calls[0];
    expect(q.table).toBe("location_sets");
    expect(q.ops).toEqual([
      ["select", ["id, user_id"]],
      ["eq", ["status", "building"]],
      ["is", ["deleted_at", null]],
      ["gte", ["updated_at", new Date(NOW - 2 * 60 * 60 * 1000).toISOString()]],
      ["order", ["updated_at", { ascending: true }]],
      ["limit", [25]],
    ]);
    expect(FINISHER_WINDOW_MS).toBe(2 * 60 * 60 * 1000);
    expect(FINISHER_BATCH).toBe(25);
  });

  it("with nothing building, reads no flag and no profile", async () => {
    const f = setup({ rows: [] });
    await runSetsFinisher(f.deps);
    expect(f.counts.flagReads).toBe(0);
    expect(f.calls.map((c) => c.table)).toEqual(["location_sets"]);
  });

  it("never reads anything a person wrote", async () => {
    const f = setup({
      rows: [{ id: set(1), user_id: ADMIN }],
      advance: async () => ({ result: { error: null, state: "ready" }, settledHere: "ready" }),
    });
    await runSetsFinisher(f.deps);
    for (const c of f.calls) expect(String(argsOf(c, "select")?.[0])).not.toMatch(/brief|description|spec|notes/);
  });

  it("a failed read of the building sets is an error, and nothing runs", async () => {
    const f = setup({ rowsError: true });
    expect(await runSetsFinisher(f.deps)).toEqual({ status: 500, body: { error: "query failed" } });
    expect(f.counts.flagReads).toBe(0);
    expect(f.advanced).toEqual([]);
  });
});

describe("the same rules as the page, without a session", () => {
  it("the astra_sets switch off stops collection, before any profile is read", async () => {
    const f = setup({ rows: [{ id: set(1), user_id: ADMIN }], flag: false });
    expect(await runSetsFinisher(f.deps)).toEqual({ status: 200, body: { skipped: "off" } });
    expect(f.advanced).toEqual([]);
    expect(f.calls.map((c) => c.table)).toEqual(["location_sets"]);
    expect(f.flagClients).toEqual([f.admin]);
  });

  it("skips every build of an owner who is suspended or not eligible, and ticks the rest with their own owner", async () => {
    const f = setup({
      rows: [
        { id: set(1), user_id: ADMIN },
        { id: set(2), user_id: SUSPENDED },
        { id: set(3), user_id: PAYING },
        { id: set(4), user_id: NO_PROFILE },
        { id: set(5), user_id: ADMIN_2 },
        { id: set(6), user_id: SUSPENDED },
      ],
    });
    const out = await runSetsFinisher(f.deps);
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ checked: 6, advanced: 2, skipped: 4, deferred: 0, errors: 0 });
    expect(f.advanced.map((a) => [a.setId, a.userId])).toEqual([
      [set(1), ADMIN],
      [set(5), ADMIN_2],
    ]);
    for (const a of f.advanced) expect(a.admin).toBe(f.admin);
    // Each build's owner is read on its own, just before its tick, as the
    // page reads the person's profile before each poll.
    const reads = profileReads(f.calls);
    expect(reads.map((c) => eqOf(c, "id"))).toEqual([ADMIN, SUSPENDED, PAYING, NO_PROFILE, ADMIN_2, SUSPENDED]);
    for (const c of reads) {
      expect(c.ops).toEqual([["select", ["plan, role, status"]], ["eq", ["id", eqOf(c, "id")]], ["maybeSingle", []]]);
    }
    // The skip is logged by id and reason only.
    const skips = info.mock.calls.filter((c: unknown[]) => String(c[0]).includes("may not use Sets"));
    expect(skips.map((c: unknown[]) => c[1])).toEqual([
      { setId: set(2), userId: SUSPENDED, reason: "suspended" },
      { setId: set(3), userId: PAYING, reason: "not eligible" },
      { setId: set(4), userId: NO_PROFILE, reason: "not eligible" },
      { setId: set(6), userId: SUSPENDED, reason: "suspended" },
    ]);
  });

  it("a failed profile read is an error for that build alone, and it is not advanced on a guess", async () => {
    const f = setup({
      rows: [
        { id: set(1), user_id: ADMIN },
        { id: set(2), user_id: ADMIN_2 },
        { id: set(3), user_id: ADMIN },
      ],
      profileErrors: [ADMIN_2],
    });
    const out = await runSetsFinisher(f.deps);
    expect(out).toEqual({
      status: 200,
      body: { checked: 3, advanced: 2, ready: 0, failed: 0, skipped: 0, deferred: 0, errors: 1 },
    });
    expect(f.advanced.map((a) => a.setId)).toEqual([set(1), set(3)]);
  });

  it("the switch turned off during a run stops the next tick, not the next run", async () => {
    let on = true;
    const f = setup({
      rows: Array.from({ length: 6 }, (_, i) => ({ id: set(i + 1), user_id: ADMIN })),
      flag: () => on,
      advance: async (input) => {
        // Turned off while the first ticks are running.
        if (input.setId === set(1)) on = false;
        return building();
      },
    });
    const out = await runSetsFinisher(f.deps);
    // The three already past their check finish, as a page's tick in flight
    // does; nothing starts after.
    expect(f.advanced.map((a) => a.setId)).toEqual([set(1), set(2), set(3)]);
    expect(out.body).toMatchObject({ checked: 6, advanced: 3, skipped: 0, deferred: 3, errors: 0 });
    expect(info.mock.calls.some((c: unknown[]) => String(c[0]).includes("switch went off during the run"))).toBe(true);
    // Once a run, then before every tick a worker went to start, always
    // with the service client.
    expect(f.counts.flagReads).toBeGreaterThan(1 + 3);
    expect(f.flagClients.every((c) => c === f.admin)).toBe(true);
  });

  it("an owner suspended during a run has no further build ticked", async () => {
    const profiles = PROFILES.map((p) => ({ ...p }));
    const f = setup({
      rows: Array.from({ length: 6 }, (_, i) => ({ id: set(i + 1), user_id: ADMIN })),
      profiles,
      advance: async (input) => {
        if (input.setId === set(1)) profiles.find((p) => p.id === ADMIN)!.status = "suspended";
        return building();
      },
    });
    const out = await runSetsFinisher(f.deps);
    expect(f.advanced.map((a) => a.setId)).toEqual([set(1), set(2), set(3)]);
    expect(out.body).toMatchObject({ checked: 6, advanced: 3, skipped: 3, deferred: 0, errors: 0 });
  });

  it("asks the photo switch when a tick wants it, fresh every time, with the service client", async () => {
    // Turned off after the first photo retry asked: the next may not resend
    // the photo, as enabled.ts promises for a build already running (a
    // switch remembered for the run would have said yes three times).
    const answers = [true, false, true];
    let asked = 0;
    const seen: boolean[] = [];
    const f = setup({
      rows: [1, 2, 3].map((n) => ({ id: set(n), user_id: ADMIN })),
      photoFlag: () => answers[asked++],
      advance: async (input) => {
        seen.push(await input.photoSwitchOn());
        return building();
      },
    });
    await runSetsFinisher(f.deps);
    expect([...seen].sort()).toEqual([false, true, true]);
    expect(f.counts.photoReads).toBe(3);
    expect(f.photoClients.every((c) => c === f.admin)).toBe(true);
  });

  it("never asks the photo switch when no tick wants a retry", async () => {
    const f = setup({ rows: [{ id: set(1), user_id: ADMIN }] });
    await runSetsFinisher(f.deps);
    expect(f.counts.photoReads).toBe(0);
  });
});

describe("who is told, and how", () => {
  const ticks: Record<string, SetBuildTick> = {
    [set(1)]: { result: { error: null, state: "ready" }, settledHere: "ready" },
    [set(2)]: { result: { error: null, state: "failed", message: "x" }, settledHere: "failed" },
    // Settled by some other tick (the page, another run): not this run's news.
    [set(3)]: { result: { error: null, state: "ready" }, settledHere: null },
    [set(4)]: { result: { error: null, state: "failed", message: "x" }, settledHere: null },
    [set(5)]: building(),
    [set(6)]: { result: { error: "That set isn't available." }, settledHere: null },
  };

  it("only a build this run's own write settled — to browsers only, the set's title and a link to it", async () => {
    const f = setup({
      rows: [1, 2, 3, 4, 5, 6].map((n) => ({ id: set(n), user_id: ADMIN })),
      titles: { [set(1)]: "Night market" },
      advance: async (input) => ticks[input.setId],
    });
    const out = await runSetsFinisher(f.deps);
    expect(out.body).toMatchObject({ checked: 6, advanced: 6, ready: 1, failed: 1, errors: 0 });
    expect(f.notified).toHaveLength(2);
    // The same page and the same tag as the notification a Sets tab shows
    // for a build it settled itself (leaving.ts): one per set, never two.
    expect(f.notified).toContainEqual({
      userId: ADMIN,
      notification: {
        message: { key: "setReady", params: { title: "Night market" } },
        path: `/app/sets/${set(1)}`,
        tag: `set-${set(1)}`,
      },
      options: { webOnly: true },
    });
    expect(f.notified).toContainEqual({
      userId: ADMIN,
      notification: { message: { key: "setFailed" }, path: "/app/sets", tag: `set-${set(2)}` },
      options: { webOnly: true },
    });
    expect(setNoticePath(set(1), "ready")).toBe(`/app/sets/${set(1)}`);
    expect(setNoticePath(set(2), "failed")).toBe("/app/sets");
    expect(setNoticeTag(set(2))).toBe(`set-${set(2)}`);
    // The title is read after the tick, as the owner's, and only if not deleted.
    const titleRead = f.calls.find((c) => c.table === "location_sets" && argsOf(c, "select")?.[0] === "title")!;
    expect(titleRead.ops).toEqual([
      ["select", ["title"]],
      ["eq", ["id", set(1)]],
      ["eq", ["user_id", ADMIN]],
      ["is", ["deleted_at", null]],
      ["maybeSingle", []],
    ]);
  });

  it("a ready set without a title, or whose title cannot be read, is still announced — without a name", async () => {
    const f = setup({
      rows: [1, 2].map((n) => ({ id: set(n), user_id: ADMIN })),
      titles: { [set(1)]: "  ", [set(2)]: "error" },
      advance: async () => ({ result: { error: null, state: "ready" }, settledHere: "ready" }),
    });
    await runSetsFinisher(f.deps);
    const sent = f.notified.map((n) => n.notification);
    expect(sent).toHaveLength(2);
    expect(sent).toContainEqual({ message: { key: "setReady" }, path: `/app/sets/${set(1)}`, tag: `set-${set(1)}` });
    expect(sent).toContainEqual({ message: { key: "setReady" }, path: `/app/sets/${set(2)}`, tag: `set-${set(2)}` });
  });

  it("a set deleted since its tick settled it is not announced", async () => {
    const f = setup({
      rows: [1, 2].map((n) => ({ id: set(n), user_id: ADMIN })),
      titles: { [set(1)]: null, [set(2)]: null },
      advance: async (input) => ticks[input.setId],
    });
    const out = await runSetsFinisher(f.deps);
    expect(out.body).toMatchObject({ ready: 1, failed: 1 });
    expect(f.notified).toEqual([]);
  });

  it("a notification that throws never stops the run", async () => {
    const f = setup({
      rows: [1, 2, 3].map((n) => ({ id: set(n), user_id: ADMIN })),
      advance: async () => ({ result: { error: null, state: "ready" }, settledHere: "ready" }),
      notify: async () => {
        throw new Error("push service down");
      },
    });
    const out = await runSetsFinisher(f.deps);
    expect(out.body).toMatchObject({ checked: 3, advanced: 3, ready: 3, errors: 0 });
  });
});

describe("one set's trouble is its own", () => {
  it("a tick that throws is logged and the others carry on", async () => {
    const f = setup({
      rows: [1, 2, 3].map((n) => ({ id: set(n), user_id: ADMIN })),
      advance: async (input) => {
        if (input.setId === set(2)) throw new Error("database blip");
        return { result: { error: null, state: "ready" }, settledHere: "ready" };
      },
    });
    const out = await runSetsFinisher(f.deps);
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ checked: 3, advanced: 2, ready: 2, errors: 1 });
    expect(f.advanced.map((a) => a.setId)).toEqual([set(1), set(2), set(3)]);
    expect(f.notified.map((n) => n.notification.path).sort()).toEqual([`/app/sets/${set(1)}`, `/app/sets/${set(3)}`]);
  });
});

describe("the time budget", () => {
  it("starts nothing new once the budget is spent, and leaves the rest to the next run", async () => {
    const f = setup({ rows: Array.from({ length: 10 }, (_, i) => ({ id: set(i + 1), user_id: ADMIN })) });
    const startedAt: number[] = [];
    f.deps.advance = async (input) => {
      f.advanced.push(input);
      startedAt.push(f.clock.t);
      // The first tick is slow enough to use the whole budget.
      f.clock.t = NOW + FINISHER_START_BUDGET_MS;
      return building();
    };
    const out = await runSetsFinisher(f.deps);
    // The three workers had each taken a build before the clock moved;
    // none takes another after.
    expect(f.advanced.map((a) => a.setId)).toEqual([set(1), set(2), set(3)]);
    expect(startedAt[0]).toBe(NOW);
    expect(out.body).toMatchObject({ checked: 10, advanced: 3, deferred: 7 });
  });

  it("keeps starting while inside it, oldest first", async () => {
    const f = setup({ rows: Array.from({ length: 5 }, (_, i) => ({ id: set(i + 1), user_id: ADMIN })) });
    f.deps.advance = async (input) => {
      f.advanced.push(input);
      f.clock.t += FINISHER_START_BUDGET_MS / 10;
      return building();
    };
    const out = await runSetsFinisher(f.deps);
    expect(f.advanced.map((a) => a.setId)).toEqual([1, 2, 3, 4, 5].map(set));
    expect(out.body).toMatchObject({ advanced: 5, deferred: 0 });
  });

  it("ends inside the route's limit even when the last tick it starts takes the slowest path — every wait read from the code it runs", () => {
    // A tick cut off after its claim loses the answer, and a retry it
    // submitted bills with its id stored nowhere; so the budget is checked
    // against each wait at its timeout, as the code has them today.
    const fnBody = (file: string, name: string) => {
      const source = readSource(file);
      const start = source.indexOf(`export async function ${name}(`);
      expect(start, `${file}: ${name}`).toBeGreaterThan(-1);
      const end = source.indexOf("\nexport ", start + 1);
      return source.slice(start, end < 0 ? undefined : end);
    };
    // The timeout a call hands fetchWithTimeout: its last argument.
    const timeoutOf = (file: string, name: string) => {
      const m = /fetchWithTimeout\([\s\S]*?\b(\d{1,3}_000),?\s*\)/.exec(fnBody(file, name));
      expect(m, `${file}: ${name}`).not.toBeNull();
      return Number(m![1].replace("_", ""));
    };
    const ASTRA = "src/lib/generations/providers/astra.ts";
    const poll = timeoutOf(ASTRA, "pollAstraJob");
    const submit = timeoutOf(ASTRA, "submitAstraJob");
    const cancel = timeoutOf(ASTRA, "cancelAstraJob");

    // The words gate: two rounds (content-policy.ts score), each as slow as
    // its slowest reader. The OpenAI reader sends at most three times, with
    // a wait of at most 5 s after each 429; Claude at most three times (a
    // 429 retry, then one without the thinking setting), with one such wait.
    const openai = readSource("src/lib/generations/providers/openai.ts");
    expect(openai).toContain("for (let retry = 0; retry < 2 && res.status === 429; retry++)");
    const cap = openai.slice(openai.indexOf("function retryAfterMs("), openai.indexOf("export async function reviewWithOpenAI("));
    expect([...cap.matchAll(/Math\.min\([^)]*?,\s*(\d+)\)/g)].map((m) => Number(m[1]))).toEqual([5000, 5000]);
    const claude = fnBody("src/lib/generations/providers/anthropic.ts", "draftWithClaude");
    expect(claude.match(/await call\(/g)).toHaveLength(3);
    expect(claude).toContain("Math.min(sec * 1000, 5000)");
    const primary = 3 * timeoutOf("src/lib/generations/providers/openai.ts", "reviewWithOpenAI") + 2 * 5_000;
    const backup = 3 * timeoutOf("src/lib/generations/providers/anthropic.ts", "draftWithClaude") + 5_000;
    expect(fnBody("src/lib/generations/content-policy.ts", "score").match(/await Promise\.all\(/g)).toHaveLength(2);
    const gate = 2 * Math.max(primary, backup);

    // What the budget's comment adds up (finisher.ts), and the route's limit.
    expect({ poll, gate, submit, cancel }).toEqual({ poll: 15_000, gate: 170_000, submit: 30_000, cancel: 10_000 });
    const limit = Number(/export const maxDuration = (\d+);/.exec(readSource("src/app/api/cron/sets/route.ts"))![1]) * 1000;
    // Left for the database, the stored photo, the notification and a cold start.
    const MARGIN_MS = 15_000;
    expect(FINISHER_START_BUDGET_MS + poll + gate + submit + cancel + MARGIN_MS).toBeLessThanOrEqual(limit);
  });

  it("never has more than three ticks in flight", async () => {
    let inFlight = 0;
    let most = 0;
    const f = setup({
      rows: Array.from({ length: 10 }, (_, i) => ({ id: set(i + 1), user_id: ADMIN })),
      advance: async () => {
        inFlight++;
        most = Math.max(most, inFlight);
        await new Promise((r) => setTimeout(r, 2));
        inFlight--;
        return building();
      },
    });
    const out = await runSetsFinisher(f.deps);
    expect(FINISHER_CONCURRENCY).toBe(3);
    expect(most).toBe(3);
    expect(out.body).toMatchObject({ advanced: 10, deferred: 0 });
  });
});

describe("what a run says", () => {
  it("returns its counts and logs one summary line", async () => {
    const f = setup({
      rows: [
        { id: set(1), user_id: ADMIN },
        { id: set(2), user_id: PAYING },
      ],
      advance: async () => ({ result: { error: null, state: "ready" }, settledHere: "ready" }),
    });
    const out = await runSetsFinisher(f.deps);
    expect(out).toEqual({
      status: 200,
      body: { checked: 2, advanced: 1, ready: 1, failed: 0, skipped: 1, deferred: 0, errors: 0 },
    });
    const lines = info.mock.calls.filter((c: unknown[]) => String(c[0]).startsWith("[sets] finisher: checked"));
    expect(lines).toEqual([
      ["[sets] finisher: checked 2, advanced 1, ready 1, failed 0, skipped 1, deferred 0, errors 0"],
    ]);
  });
});

describe("finisherCanRun", () => {
  it("is exactly whether the cron's secret is set", () => {
    expect(finisherCanRun({ CRON_SECRET: "a-long-random-string" })).toBe(true);
    expect(finisherCanRun({ CRON_SECRET: "" })).toBe(false);
    expect(finisherCanRun({})).toBe(false);
  });
});

describe("the route, the schedule and the pages (read as source)", () => {
  const read = readSource;

  it("the route authenticates like every cron, failing closed, before anything runs", () => {
    const route = read("src/app/api/cron/sets/route.ts");
    expect(route).toContain('export const runtime = "nodejs";');
    expect(route).toContain("export const maxDuration = 300;");
    const check = route.indexOf("if (!secret || auth !== `Bearer ${secret}`) {");
    expect(check).toBeGreaterThan(route.indexOf("const secret = process.env.CRON_SECRET;"));
    expect(route.indexOf('{ status: 401 }')).toBeGreaterThan(check);
    expect(route.indexOf("runSetsFinisher(")).toBeGreaterThan(route.indexOf('{ status: 401 }'));
  });

  it("the route wires in the real tick, notifier and switches", () => {
    const route = read("src/app/api/cron/sets/route.ts");
    for (const part of [
      "env: process.env",
      "admin: createAdminClient",
      "advance: advanceSetBuild",
      "notify: notifyUser",
      "now: Date.now",
      "setsEnabled: isSetsEnabled",
      "photoSetsEnabled: isPhotoSetsEnabled",
    ]) {
      expect(route, part).toContain(part);
    }
  });

  it("Vercel calls it every minute, beside the three crons already there", () => {
    const crons = (JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] }).crons;
    expect(crons).toContainEqual({ path: "/api/cron/sets", schedule: "* * * * *" });
    for (const path of ["/api/cron/drip", "/api/cron/reconcile", "/api/cron/reels"]) {
      expect(crons.map((c) => c.path)).toContain(path);
    }
  });

  it("the pages read it on the server and hand down only a yes or no", () => {
    expect(read("src/app/app/sets/page.tsx")).toContain("finisherOn={finisherCanRun()}");
    expect(read("src/app/app/sets/[id]/page.tsx")).toContain("const finisherOn = finisherCanRun();");
    const client = read("src/components/sets/sets-home.tsx");
    expect(client).not.toMatch(/process\.env|from\s+["'][^"']*sets\/finisher["']/);
    expect(client).toContain("finisherOn: boolean;");
  });
});
