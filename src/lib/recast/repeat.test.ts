import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { followRepeatSend } from "../generations/repeat-send";
import { parseRecastSendId, RECAST_MAX_TAKES, recastRepeatAnswer, recastTakeIds } from "./repeat";

// ONE PRESS, DELIVERED TWICE (audited 2026-09-22, after 5058a4a). A Take
// press is open for the whole start (read, judge, cut, reserve, submit), and
// the take rows' ids were minted on the server, so a resent POST would have
// reserved, charged and rendered a second take. The door now names each
// press, the rows take their ids from that name, and the second delivery
// follows the first's takes.

const USER = "u-operator";
const SEND = "5f0c2a8e-7b1d-4c3e-9a6f-2d8b1e4c7a90";

type Row = {
  id: string;
  user_id: string;
  angle_group_id: string | null;
  angle: string | null;
  status: string;
  result_url: string | null;
  pipeline_log: unknown[] | null;
  match_score: number | null;
};

/**
 * The service-role client, as far as the follower reads it: generations and
 * generation_jobs, filtered with eq/in. Every call is recorded, and any write
 * or reservation throws, so a test can prove a repeat moves nothing.
 */
function fakeDb() {
  const db = {
    generations: [] as Row[],
    jobs: [] as { generation_id: string; user_id: string }[],
    failNextReads: 0,
    calls: [] as string[],
  };
  const client = {
    from(table: string) {
      const filters: [string, "eq" | "in", unknown][] = [];
      const builder = {
        select(cols: string) {
          db.calls.push(`${table}.select(${cols})`);
          return builder;
        },
        eq(col: string, v: unknown) {
          filters.push([col, "eq", v]);
          return builder;
        },
        in(col: string, v: unknown[]) {
          filters.push([col, "in", v]);
          return builder;
        },
        then(resolve: (r: { data: unknown[] | null; error: { message: string } | null }) => unknown) {
          if (db.failNextReads > 0) {
            db.failNextReads -= 1;
            return Promise.resolve(resolve({ data: null, error: { message: "fetch failed" } }));
          }
          const source: Record<string, unknown>[] = table === "generations" ? db.generations : db.jobs;
          const data = source.filter((r) =>
            filters.every(([col, op, v]) => (op === "eq" ? r[col] === v : (v as unknown[]).includes(r[col]))),
          );
          return Promise.resolve(resolve({ data: data.map((r) => ({ ...r })), error: null }));
        },
      };
      for (const write of ["insert", "update", "upsert", "delete"]) {
        (builder as Record<string, unknown>)[write] = () => {
          throw new Error(`a repeat must never ${write} (${table})`);
        };
      }
      return builder;
    },
    rpc() {
      throw new Error("a repeat must never reserve");
    },
  } as unknown as SupabaseClient;
  return { db, client };
}

const row = (over: Partial<Row>): Row => ({
  id: SEND,
  user_id: USER,
  angle_group_id: null,
  angle: null,
  status: "generating",
  result_url: null,
  pipeline_log: [],
  match_score: null,
  ...over,
});

/** A clock the follower's sleeps advance, with a hook to change the world between polls. */
function clock(onSleep: (sleeps: number) => void = () => {}) {
  let t = 0;
  let sleeps = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
      sleeps += 1;
      onSleep(sleeps);
    },
    get sleeps() {
      return sleeps;
    },
  };
}

/** What startRecastTakes does with a press: follow the takes under its ids, answer in its own shape. */
async function followPress(client: SupabaseClient, deadlineAt: number, c = clock()) {
  const pressIds = recastTakeIds(SEND, RECAST_MAX_TAKES);
  return recastRepeatAnswer(await followRepeatSend(client, USER, { ids: pressIds }, { deadlineAt, ...c }), pressIds);
}

describe("a second delivery of the same Take press", () => {
  it("follows the variants the first delivery started and answers with them in take order, reserving and charging nothing", async () => {
    const { db, client } = fakeDb();
    const [first, second] = recastTakeIds(SEND, 2);
    // Two characters cast apart: two takes. The first delivery has reserved
    // both and queued one. Rows come back from the database in any order.
    db.generations.push(row({ id: second }), row({ id: first }));
    db.jobs.push({ generation_id: first, user_id: USER });
    const c = clock((n) => {
      if (n === 2) db.jobs.push({ generation_id: second, user_id: USER });
    });

    const answer = await followPress(client, 280_000, c);

    expect(c.sleeps).toBe(2);
    expect(answer).toEqual({ error: null, ids: [first, second] });
    // Nothing was reserved, charged or written: the fake throws on any of it.
    expect(db.calls.every((call) => call.includes(".select("))).toBe(true);
  });

  it("follows a single take under the press's own id", async () => {
    const { db, client } = fakeDb();
    db.generations.push(row({ id: SEND }));
    db.jobs.push({ generation_id: SEND, user_id: USER });
    expect(await followPress(client, 280_000)).toEqual({ error: null, ids: [SEND] });
  });

  it("answers a take that failed to start too, so its own card says so, beside the ones that started", async () => {
    const { db, client } = fakeDb();
    const [first, second] = recastTakeIds(SEND, 2);
    db.generations.push(row({ id: first, status: "failed" }), row({ id: second }));
    db.jobs.push({ generation_id: second, user_id: USER });
    const c = clock();
    expect(await followPress(client, 280_000, c)).toEqual({ error: null, ids: [first, second] });
    expect(c.sleeps).toBe(0);
  });

  it("still being started when the clock runs out: answers with the takes that exist, never an error that invites a second press", async () => {
    const { db, client } = fakeDb();
    // Reserved and charged, the submit still under way (the operator's 04:20
    // take sat four minutes between the two).
    db.generations.push(row({ id: SEND }));
    const answer = await followPress(client, 10_000);
    expect(answer).toEqual({ error: null, ids: [SEND] });
  });

  it("is not a repeat when this user has no take under the press's ids, and asks only once", async () => {
    const { db, client } = fakeDb();
    // Someone else's row under the same id is never followed or shown.
    db.generations.push(row({ user_id: "someone-else", status: "succeeded" }));
    const c = clock();
    expect(await followPress(client, 280_000, c)).toBeNull();
    expect(c.sleeps).toBe(0);
    expect(db.calls).toEqual(["generations.select(id, status, result_url, pipeline_log, match_score, angle)"]);
  });

  it("a failed read before any take is seen leaves an ordinary press alone", async () => {
    const { db, client } = fakeDb();
    db.failNextReads = 1;
    expect(await followPress(client, 280_000)).toBeNull();
  });

  it("answers only takes of this press, whatever else the read hands back", () => {
    const pressIds = recastTakeIds(SEND, RECAST_MAX_TAKES);
    expect(recastRepeatAnswer({ kind: "none" }, pressIds)).toBeNull();
    expect(recastRepeatAnswer({ kind: "running", ids: ["not-this-press"] }, pressIds)).toBeNull();
    expect(recastRepeatAnswer({ kind: "running", ids: [pressIds[2], pressIds[0]] }, pressIds)).toEqual({
      error: null,
      ids: [pressIds[0], pressIds[2]],
    });
  });
});

describe("a press's take ids", () => {
  const UUID_V8 = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it("are the same for both deliveries of one press, so the second meets the first's primary keys", () => {
    const firstDelivery = recastTakeIds(SEND, 3);
    const secondDelivery = recastTakeIds(SEND, 3);
    expect(secondDelivery).toEqual(firstDelivery);
    // A stand-in for reserve_generations: one transaction, primary key on id.
    const table = new Set<string>();
    const reserve = (ids: string[]) => {
      if (ids.some((id) => table.has(id))) return { code: "23505" };
      ids.forEach((id) => table.add(id));
      return null;
    };
    expect(reserve(firstDelivery)).toBeNull();
    expect(reserve(secondDelivery)).toEqual({ code: "23505" });
    expect(table.size).toBe(3);
  });

  it("are the press's own id first, then distinct version-8 UUIDs, and fewer takes are the start of more", () => {
    const ids = recastTakeIds(SEND, RECAST_MAX_TAKES);
    expect(ids).toHaveLength(4);
    expect(ids[0]).toBe(SEND);
    for (const id of ids.slice(1)) expect(id).toMatch(UUID_V8);
    expect(new Set(ids).size).toBe(4);
    expect(recastTakeIds(SEND, 2)).toEqual(ids.slice(0, 2));
    expect(recastTakeIds(SEND, 0)).toEqual([]);
  });

  it("never overlap between two presses", () => {
    const a = recastTakeIds(crypto.randomUUID(), RECAST_MAX_TAKES);
    const b = recastTakeIds(crypto.randomUUID(), RECAST_MAX_TAKES);
    expect(a.filter((id) => b.includes(id))).toEqual([]);
  });

  it("take only a real UUID from the door as a row id", () => {
    const made = crypto.randomUUID();
    expect(parseRecastSendId(made)).toBe(made);
    expect(parseRecastSendId(SEND.toUpperCase())).toBe(SEND);
    for (const bad of [undefined, null, 42, {}, "", "not-a-uuid", `${SEND} `, `${SEND}'; drop table generations; --`]) {
      expect(parseRecastSendId(bad)).toBeNull();
    }
  });
});

describe("the Take press is wired to follow a repeat", () => {
  // recast/actions.ts cannot load under vitest (its "@/" imports are
  // unresolved here), so its wiring is pinned from the source, as the rest of
  // the suite does.
  const source = readFileSync(join(__dirname, "actions.ts"), "utf8");
  const start = source.slice(
    source.indexOf("export async function startRecastTakes"),
    source.indexOf("export async function getRecastTakeMedia"),
  );
  const at = (needle: string, body = start) => {
    const i = body.indexOf(needle);
    expect(i, `no longer contains: ${needle}`).toBeGreaterThan(-1);
    return i;
  };

  it("follows first, before the rate limit, the credit checks and any byte of the clip", () => {
    const first = at("const repeatOfRunning = await followRepeat();\n  if (repeatOfRunning) return repeatOfRunning;");
    expect(at("const sendStartedAt = Date.now();")).toBeLessThan(at("await recastAccess()"));
    expect(at("await recastAccess()")).toBeLessThan(first);
    for (const later of ["rateLimited(", "checkGenerationAllowance(", "readUpload(admin, uploadPath)", "await gatePrompt({", 'admin.rpc("reserve_generations"']) {
      expect(first, later).toBeLessThan(at(later));
    }
    expect(start).toContain("const sendId = parseRecastSendId(input?.sendId);");
    expect(start).toContain("followRepeatSend(createAdminClient(), userId, { ids: pressIds }, {");
    expect(start).toContain("deadlineAt: sendStartedAt + REPEAT_FOLLOW_DEADLINE_MS,");
  });

  it("reserves every take under the press's ids, never a fresh random one when the door named the press", () => {
    expect(start).toContain("const pressIds = sendId ? recastTakeIds(sendId, RECAST_MAX_TAKES) : [];");
    expect(start).toContain("const rowIds = sendId ? pressIds.slice(0, takes.length) : takes.map(() => crypto.randomUUID());");
    expect(start).toContain("id: rowIds[i],");
    expect(start).not.toContain("id: crypto.randomUUID(),");
    expect(start).toContain("const groupId = takes.length > 1 ? (sendId ?? crypto.randomUUID()) : null;");
    // A press never has more takes than the ids made for it.
    expect(start).toContain(".slice(0, RECAST_MAX_TAKES) : [];");
  });

  it("follows again wherever the first delivery's own rows could refuse this one", () => {
    expect(start).toContain("if (early.error) return (await followRepeat()) ?? { error: early.error };");
    const fresh = start.slice(at("const allowance = await checkGenerationAllowance(supabase, userId, total)"));
    expect(fresh.slice(0, 200)).toContain("await dropPrepared();\n    return (await followRepeat()) ?? { error: allowance.error };");
    expect(start).toMatch(
      /await dropPrepared\(\);\n    return \(await followRepeat\(\)\) \?\? \{ error: "You've used all the credits included in your plan this month\." \};/,
    );
  });

  it("at the reservation, a duplicate key drops this delivery's own files and follows, before any start error", () => {
    const reserve = start.slice(at('admin.rpc("reserve_generations"'));
    const duplicate = reserve.indexOf(
      "if (isRepeatReservation(reserveError) || /duplicate key/i.test(reserveError.message)) {\n      await dropPrepared();\n      return (await followRepeat()) ?? { error: RECAST_ALREADY_STARTED };",
    );
    expect(duplicate).toBeGreaterThan(-1);
    expect(duplicate).toBeLessThan(reserve.indexOf("return { error: RECAST_COULDNT_START };"));
    // And before anything is spent.
    expect(duplicate).toBeLessThan(reserve.indexOf("consumePurchasedCredits("));
    expect(duplicate).toBeLessThan(reserve.indexOf("submitRecastJob("));
  });

  it("the door names each press afresh and sends it", () => {
    const door = readFileSync(join(__dirname, "..", "..", "components", "mystique", "mystique-door.tsx"), "utf8");
    const take = door.slice(door.indexOf("  async function take() {"), door.indexOf("  async function stop(id: string) {"));
    // Inside the press, not at the component's top: every press is new, and a
    // re-render never reuses one.
    expect(take).toContain("const sendId = crypto.randomUUID();");
    expect(take.indexOf("const sendId = crypto.randomUUID();")).toBeLessThan(take.indexOf("await startRecastTakes({"));
    expect(take).toMatch(/await startRecastTakes\(\{\n\s+sendId,/);
    expect(door.indexOf("const sendId")).toBe(door.indexOf("const sendId = crypto.randomUUID();"));
  });
});
