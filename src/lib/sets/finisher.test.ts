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
import type { NotifyOptions } from "../push/channels";
import type { PushMessage } from "../push/send";

// The set finisher (2026-09-11), driven with fakes: the same rules as the
// page without a session, the same tick, and a notification only for a
// build this run's own write settled — to browsers only.

const NOW = Date.parse("2026-09-11T12:00:00.000Z");
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ADMIN_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUSPENDED = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PAYING = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const NO_PROFILE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const set = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

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
type Setup = {
  rows?: Row[];
  rowsError?: boolean;
  profiles?: { id: string; plan: string | null; role: string | null; status: string | null }[];
  profilesError?: boolean;
  /** A set's title as read after its tick; null = deleted since; "error" = the read fails. */
  titles?: Record<string, string | null | "error">;
  flag?: boolean;
  photoFlag?: boolean;
  env?: Record<string, string | undefined>;
  advance?: (input: AdvanceSetBuildInput) => Promise<SetBuildTick>;
  notify?: FinisherDeps["notify"];
};

const PROFILES = [
  { id: ADMIN, plan: "none", role: "admin", status: "active" },
  { id: ADMIN_2, plan: "starter", role: "admin", status: null },
  { id: SUSPENDED, plan: "elite", role: "admin", status: "suspended" },
  { id: PAYING, plan: "studio", role: "user", status: "active" },
];

const building = (): SetBuildTick => ({ result: { error: null, state: "building" }, settledHere: null });

function setup(o: Setup = {}) {
  const clock = { t: NOW };
  const counts = { adminMade: 0, flagReads: 0, photoReads: 0 };
  const advanced: AdvanceSetBuildInput[] = [];
  const notified: { userId: string; notification: { message: PushMessage; path: string }; options: NotifyOptions }[] = [];
  const flagClients: SupabaseClient[] = [];
  const { admin, calls } = fakeAdmin((call) => {
    if (call.table === "location_sets" && argsOf(call, "select")?.[0] === "id, user_id") {
      return o.rowsError ? { data: null, error: { message: "boom" } } : { data: o.rows ?? [], error: null };
    }
    if (call.table === "profiles") {
      if (o.profilesError) return { data: null, error: { message: "boom" } };
      const ids = (argsOf(call, "in")?.[1] ?? []) as string[];
      return { data: (o.profiles ?? PROFILES).filter((p) => ids.includes(p.id)), error: null };
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
      return o.flag ?? true;
    },
    photoSetsEnabled: async () => {
      counts.photoReads++;
      return o.photoFlag ?? false;
    },
  };
  return { deps, admin, calls, counts, advanced, notified, clock, flagClients };
}

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
    // Each owner's profile is read once, in one query.
    const profileReads = f.calls.filter((c) => c.table === "profiles");
    expect(profileReads).toHaveLength(1);
    expect(argsOf(profileReads[0], "select")).toEqual(["id, plan, role, status"]);
    expect(argsOf(profileReads[0], "in")).toEqual(["id", [ADMIN, SUSPENDED, PAYING, NO_PROFILE, ADMIN_2]]);
    // The skip is logged by id and reason only.
    const skips = info.mock.calls.filter((c: unknown[]) => String(c[0]).includes("may not use Sets"));
    expect(skips.map((c: unknown[]) => c[1])).toEqual([
      { userId: SUSPENDED, reason: "suspended", sets: [set(2), set(6)] },
      { userId: PAYING, reason: "not eligible", sets: [set(3)] },
      { userId: NO_PROFILE, reason: "not eligible", sets: [set(4)] },
    ]);
  });

  it("a failed profile read is an error, and nothing is advanced on a guess", async () => {
    const f = setup({ rows: [{ id: set(1), user_id: ADMIN }], profilesError: true });
    expect(await runSetsFinisher(f.deps)).toEqual({ status: 500, body: { error: "profiles query failed" } });
    expect(f.advanced).toEqual([]);
  });

  it("asks the photo switch at most once a run, with the service client", async () => {
    const f = setup({
      rows: [1, 2, 3].map((n) => ({ id: set(n), user_id: ADMIN })),
      photoFlag: true,
      advance: async (input) => {
        expect(await input.photoSwitchOn()).toBe(true);
        expect(await input.photoSwitchOn()).toBe(true);
        return building();
      },
    });
    await runSetsFinisher(f.deps);
    expect(f.advanced).toHaveLength(3);
    expect(f.counts.photoReads).toBe(1);
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
    expect(f.notified).toContainEqual({
      userId: ADMIN,
      notification: { message: { key: "setReady", params: { title: "Night market" } }, path: `/app/sets/${set(1)}` },
      options: { webOnly: true },
    });
    expect(f.notified).toContainEqual({
      userId: ADMIN,
      notification: { message: { key: "setFailed" }, path: "/app/sets" },
      options: { webOnly: true },
    });
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
    expect(sent).toContainEqual({ message: { key: "setReady" }, path: `/app/sets/${set(1)}` });
    expect(sent).toContainEqual({ message: { key: "setReady" }, path: `/app/sets/${set(2)}` });
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
    f.deps.advance = async (input) => {
      f.advanced.push(input);
      // The first tick is slow enough to use the whole budget.
      f.clock.t = NOW + FINISHER_START_BUDGET_MS;
      return building();
    };
    const out = await runSetsFinisher(f.deps);
    expect(f.advanced.map((a) => a.setId)).toEqual([set(1)]);
    expect(out.body).toMatchObject({ checked: 10, advanced: 1, deferred: 9 });
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

  it("ends inside the route's 300 s even when the last tick it starts is a slow one (~100 s in the words gate, 15 s polling)", () => {
    expect(FINISHER_START_BUDGET_MS + 100_000 + 15_000).toBeLessThanOrEqual(300_000);
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
  const root = join(__dirname, "..", "..", "..");
  const read = (p: string) => readFileSync(join(root, p), "utf8");

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
