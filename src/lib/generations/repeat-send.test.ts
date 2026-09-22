import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import it_ from "../i18n/messages/it";
import pt from "../i18n/messages/pt";
import { localizeServerText } from "../i18n/server-text";
import {
  followRepeatSend,
  isRepeatReservation,
  repeatMultiResult,
  repeatRunResult,
  REPEAT_STILL_RUNNING,
  type FollowOutcome,
} from "./repeat-send";

// ONE SEND, DELIVERED TWICE (2026-09-22, Play reviewer account, Android
// emulator): "John laughing at a sunny garden party…" and "John hosting a
// cooking show…" each showed "Couldn't start this generation — try again."
// while both rendered (scores 88 and 85) and each took a credit. The WebView
// resent the POST after its connection dropped. The first delivery reserved,
// charged and rendered the take, and the second hit the primary key.

// The follower hands back the stable media URL, which is signed.
vi.stubEnv("MEDIA_SIGNING_SECRET", "test-only");

const USER = "u-reviewer";
const SEND = "0b8f6a52-6a0e-4d51-9c1e-4c1b8f0e2a11";

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
 * generation_jobs, filtered with eq/in. Every call is recorded, so a test can
 * prove the follower only ever READS.
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
          throw new Error(`the follower must never ${write} (${table})`);
        };
      }
      return builder;
    },
    rpc() {
      throw new Error("the follower must never reserve");
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

const FINISHED_LOG = [
  { attempt: 1, compiledPrompt: "John laughing at a sunny garden party, string lights…", steps: [] },
];

describe("a second delivery of the same send", () => {
  it("replays the incident: follows the take the first delivery is rendering and answers with it, never 'Couldn't start'", async () => {
    const { db, client } = fakeDb();
    // The first delivery has reserved and charged the row and is rendering
    // (the image lane renders inside its own request, so there is no job
    // row). The resend hit the primary key: 23505.
    db.generations.push(row({ status: "generating" }));
    expect(isRepeatReservation({ code: "23505" })).toBe(true);

    // Three polls later the first delivery's render lands, scored 88.
    const c = clock((n) => {
      if (n === 3) {
        Object.assign(db.generations[0], {
          status: "succeeded",
          result_url: `https://x.supabase.co/storage/v1/object/sign/generated-images/${USER}/garden.png?token=t`,
          match_score: 88,
          pipeline_log: FINISHED_LOG,
        });
      }
    });
    const outcome = await followRepeatSend(client, USER, { id: SEND }, { deadlineAt: 280_000, ...c });
    const answer = repeatRunResult(outcome);

    expect(c.sleeps).toBe(3);
    expect(answer).toEqual({
      error: null,
      id: SEND,
      succeeded: true,
      attempts: FINISHED_LOG,
      finalPrompt: "John laughing at a sunny garden party, string lights…",
      // Re-issued as the stable, signed media URL, as History does.
      resultUrl: expect.stringMatching(new RegExp(`^/api/media/generated-images/${USER}/garden\\.png\\?v=`)),
      matchScore: 88,
    });
    // Nothing was reserved, charged or written: the fake throws on any write.
    expect(db.calls.every((call) => call.includes(".select("))).toBe(true);
  });

  it("answers at once when the first delivery has already finished, failures included", async () => {
    const { db, client } = fakeDb();
    db.generations.push(row({ status: "failed", pipeline_log: FINISHED_LOG }));
    const c = clock();
    const answer = repeatRunResult(await followRepeatSend(client, USER, { id: SEND }, { deadlineAt: 280_000, ...c }));
    expect(c.sleeps).toBe(0);
    expect(answer).toMatchObject({ error: null, id: SEND, succeeded: false, resultUrl: null });
    expect(answer && "pending" in answer).toBe(false);
  });

  it("hands a queued video back as pending, so the composer polls it as it would have", async () => {
    const { db, client } = fakeDb();
    db.generations.push(row({ status: "generating" }));
    db.jobs.push({ generation_id: SEND, user_id: USER });
    const answer = repeatRunResult(
      await followRepeatSend(client, USER, { id: SEND }, { deadlineAt: 280_000, ...clock() }),
    );
    expect(answer).toMatchObject({
      error: null,
      id: SEND,
      succeeded: false,
      resultUrl: null,
      pending: true,
      progress: "Rendering your video",
    });
  });

  it("waits while a video is still being drafted, before its job exists", async () => {
    const { db, client } = fakeDb();
    db.generations.push(row({ status: "generating" }));
    const c = clock((n) => {
      if (n === 2) db.jobs.push({ generation_id: SEND, user_id: USER });
    });
    const outcome = await followRepeatSend(client, USER, { id: SEND }, { deadlineAt: 280_000, ...c });
    expect(c.sleeps).toBe(2);
    expect(repeatRunResult(outcome)).toMatchObject({ pending: true });
  });

  it("is not a repeat when this user has no row under that id, and asks only once", async () => {
    const { db, client } = fakeDb();
    // Someone else's row under the same id is never followed or shown.
    db.generations.push(row({ user_id: "someone-else", status: "succeeded" }));
    const c = clock();
    const outcome = await followRepeatSend(client, USER, { id: SEND }, { deadlineAt: 280_000, ...c });
    expect(outcome).toEqual({ kind: "none" });
    expect(repeatRunResult(outcome)).toBeNull();
    expect(c.sleeps).toBe(0);
    expect(db.calls).toEqual(["generations.select(id, status, result_url, pipeline_log, match_score, angle)"]);
  });

  it("a failed first read leaves an ordinary send alone; once the row is seen, a failed read is retried", async () => {
    const { db, client } = fakeDb();
    db.failNextReads = 1;
    expect(await followRepeatSend(client, USER, { id: SEND }, { deadlineAt: 280_000, ...clock() })).toEqual({
      kind: "none",
    });

    db.generations.push(row({ status: "generating" }));
    const c = clock((n) => {
      if (n === 1) db.failNextReads = 1;
      if (n === 2) Object.assign(db.generations[0], { status: "succeeded", match_score: 85 });
    });
    const outcome = await followRepeatSend(client, USER, { id: SEND }, { deadlineAt: 280_000, ...c });
    expect(outcome.kind).toBe("settled");
    expect(repeatRunResult(outcome)).toMatchObject({ succeeded: true, matchScore: 85 });
  });

  it("when the clock runs out mid-render, says the take is still going, in every language, never that it did not start", async () => {
    const { db, client } = fakeDb();
    db.generations.push(row({ status: "generating" }));
    const outcome = await followRepeatSend(client, USER, { id: SEND }, { deadlineAt: 10_000, ...clock() });
    expect(outcome).toEqual({ kind: "running" });
    const answer = repeatRunResult(outcome);
    expect(answer).toEqual({ error: REPEAT_STILL_RUNNING });
    expect(REPEAT_STILL_RUNNING).not.toMatch(/couldn't start|try again/i);
    for (const t of [es, it_, pt]) {
      const shown = localizeServerText(REPEAT_STILL_RUNNING, t);
      expect(shown).toBe(t.serverText.repeatStillGoing);
      expect(shown).not.toBe(REPEAT_STILL_RUNNING);
    }
    expect(localizeServerText(REPEAT_STILL_RUNNING, en)).toBe(REPEAT_STILL_RUNNING);
  });

  it("only a duplicate key reads as a repeat: any other reservation failure may be this request's own row", () => {
    expect(isRepeatReservation({ code: "23505" })).toBe(true);
    for (const e of [null, undefined, {}, { code: "57014" }, { code: "PGRST301" }, { code: "" }]) {
      expect(isRepeatReservation(e)).toBe(false);
    }
  });
});

describe("a second delivery of the same multi-angle batch", () => {
  const GROUP = "7d1c1a0e-3f7b-4a51-8a0e-2b7f1c9d0e44";
  const angle = (id: string, a: string, over: Partial<Row> = {}) =>
    row({ id, angle_group_id: GROUP, angle: a, ...over });

  it("waits until every angle is queued, then answers with the whole batch in display order", async () => {
    const { db, client } = fakeDb();
    db.generations.push(angle("g-back", "back"), angle("g-front", "front"), angle("g-side", "side"));
    db.jobs.push({ generation_id: "g-back", user_id: USER }, { generation_id: "g-front", user_id: USER });
    const c = clock((n) => {
      if (n === 1) db.jobs.push({ generation_id: "g-side", user_id: USER });
    });
    const outcome = await followRepeatSend(client, USER, { groupId: GROUP }, { deadlineAt: 280_000, ...c });
    expect(c.sleeps).toBe(1);
    const answer = repeatMultiResult(outcome, GROUP);
    expect(answer).toMatchObject({ error: null, groupId: GROUP });
    const angles = (answer as { angles: { angleId: string; id: string; pending?: boolean }[] }).angles;
    expect(angles.map((a) => a.angleId)).toEqual(["front", "side", "back"]);
    expect(angles.every((a) => a.pending)).toBe(true);
  });

  it("a finished angle comes back finished beside the ones still rendering", async () => {
    const { db, client } = fakeDb();
    db.generations.push(
      angle("g-front", "front", { status: "succeeded", result_url: `generated-videos/${USER}/front.mp4` }),
      angle("g-side", "side"),
    );
    db.jobs.push({ generation_id: "g-side", user_id: USER });
    const answer = repeatMultiResult(
      await followRepeatSend(client, USER, { groupId: GROUP }, { deadlineAt: 280_000, ...clock() }),
      GROUP,
    ) as { angles: { angleId: string; succeeded: boolean; pending?: boolean; resultUrl: string | null }[] };
    expect(answer.angles[0]).toMatchObject({ angleId: "front", succeeded: true });
    expect(answer.angles[0].resultUrl).toBeTruthy();
    expect(answer.angles[0].pending).toBeUndefined();
    expect(answer.angles[1]).toMatchObject({ angleId: "side", pending: true, resultUrl: null });
  });

  it("not a repeat, and still going at the deadline, map as the single send's do", () => {
    const none: FollowOutcome = { kind: "none" };
    const running: FollowOutcome = { kind: "running" };
    expect(repeatMultiResult(none, GROUP)).toBeNull();
    expect(repeatMultiResult(running, GROUP)).toEqual({ error: REPEAT_STILL_RUNNING });
  });
});

describe("both send actions follow a repeat before they can refuse it", () => {
  // generations/actions.ts cannot load under vitest (its "@/" imports are
  // unresolved here), so its wiring is pinned from the source, as the rest of
  // the suite does.
  const src = readFileSync(join(__dirname, "actions.ts"), "utf8");
  const between = (start: string, end: string) => {
    const from = src.indexOf(start);
    expect(from, start).toBeGreaterThan(-1);
    const to = src.indexOf(end, from + start.length);
    expect(to, end).toBeGreaterThan(from);
    return src.slice(from, to);
  };

  it("runGeneration: first, before the cooldown and credit checks; then on every refusal a first delivery could cause", () => {
    const run = between("export async function runGeneration(", "\nexport async function pollGeneration(");
    const first = run.indexOf("const repeatOfRunning = await followRepeat();\n  if (repeatOfRunning) return repeatOfRunning;");
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(run.indexOf("checkGenerationAllowance("));
    expect(first).toBeLessThan(run.indexOf("gatePrompt("));
    expect(run).toContain("{ id: clientGenerationId }");
    expect(run).toContain("if (allowance.error) return (await followRepeat()) ?? { error: allowance.error };");
    expect(run).toContain("if (reAllowance.error) return (await followRepeat()) ?? { error: reAllowance.error };");
    // The duplicate key is followed BEFORE the start error can be returned.
    const reserve = run.slice(run.indexOf('admin.rpc("reserve_generation"'));
    const follow = reserve.indexOf("if (isRepeatReservation(reserveError)) {\n        const repeat = await followRepeat();\n        if (repeat) return repeat;");
    expect(follow).toBeGreaterThan(-1);
    expect(follow).toBeLessThan(reserve.indexOf(`return { error: "Couldn't start this generation — try again." };`));
    expect(run).toMatch(/\(await followRepeat\(\)\) \?\? \{ error: "You've used all the credits included in your plan this month\." \}/);
  });

  it("runMultiAngleGeneration: the same points, keyed by the batch's group", () => {
    const multi = between("export async function runMultiAngleGeneration(", "\nexport async function requestMultiAngleGenerationCancel(");
    const first = multi.indexOf("const repeatOfRunning = await followRepeatBatch();\n  if (repeatOfRunning) return repeatOfRunning;");
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(multi.indexOf("checkGenerationAllowance("));
    expect(multi).toContain("{ groupId: clientGroupId }");
    expect(multi).toContain("if (multiAllowance.error) return (await followRepeatBatch()) ?? { error: multiAllowance.error };");
    expect(multi).toContain("if (reAllowance.error) return (await followRepeatBatch()) ?? { error: reAllowance.error };");
    expect(multi).toContain(`return (await followRepeatBatch()) ?? { error: "That request was already started — try again." };`);
    expect(multi).toMatch(/\(await followRepeatBatch\(\)\) \?\? \{\s*error: "Your last multi-shot render is still running/);
    const reserve = multi.slice(multi.indexOf('admin.rpc("reserve_generations"'));
    const follow = reserve.indexOf("if (isRepeatReservation(reserveError)) {\n        const repeat = await followRepeatBatch();\n        if (repeat) return repeat;");
    expect(follow).toBeGreaterThan(-1);
    expect(follow).toBeLessThan(reserve.indexOf(`return { error: "Couldn't start these generations — try again." };`));
    expect(multi).toMatch(/\(await followRepeatBatch\(\)\) \?\? \{ error: "You've used all the credits included in your plan this month\." \}/);
  });

  it("the composer still names its own id per send, which is what makes a repeat recognisable", () => {
    const form = readFileSync(join(__dirname, "../../components/generate-form.tsx"), "utf8");
    expect(form).toContain("const generationId = crypto.randomUUID();");
    expect(form).toContain('formData.set("generation_id", generationId);');
  });
});
