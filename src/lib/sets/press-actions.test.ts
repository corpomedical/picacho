import { beforeEach, describe, expect, it, vi } from "vitest";
import { filmBeatPressId, pressClipId } from "./press";
import { SET_NOT_FOUND } from "./messages";

// What became of a Helios press (operator, 2026-09-25: "GO ahead" on Cut 1).
// After a dropped connection the page asks here instead of saying "try
// again" while the paid render carries on. Never "not-found" for a press
// that was charged: that would invite a second charge.
//
// press-actions.ts imports through "@/", which this suite does not resolve:
// the session and the database are stood in for; the press module is the
// real one.

const USER = "11111111-1111-4111-8111-111111111111";
const SET = "22222222-2222-4222-8222-222222222222";
const PRESS = "44444444-4444-4444-8444-444444444444";

type Filters = [string, string, unknown][];
type LedgerRow = { kind: string; state: string; result: unknown; created_at: string } | null;
let access: { error: string } | { error: null; supabase: unknown; userId: string; plan: string; isAdmin: boolean };
let ledger: { row: LedgerRow; error: { code?: string; message: string } | null };
let generations: { rows: { id: string; status: string; result_url?: string | null; poster_url?: string | null }[]; error: { message: string } | null };
let ledgerReads: Filters[];
let generationReads: Filters[];
let writes: string[];

/** A read-only table: every read is recorded, every write throws. */
function table(onRead: (filters: Filters) => Promise<{ data: unknown; error: unknown }>, reads: Filters[]) {
  const filters: Filters = [];
  reads.push(filters);
  const refuse = (op: string) => () => {
    writes.push(op);
    throw new Error(`no ${op} here`);
  };
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (c: string, v: unknown) => (filters.push(["eq", c, v]), builder),
    in: (c: string, v: unknown) => (filters.push(["in", c, v]), builder),
    maybeSingle: () => onRead(filters),
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => onRead(filters).then(resolve, reject),
    insert: refuse("insert"),
    update: refuse("update"),
    delete: refuse("delete"),
    upsert: refuse("upsert"),
  };
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({
    from: (name: string) => {
      if (name !== "location_set_presses") throw new Error(`the admin client reads only the ledger, not ${name}`);
      return table(async () => ({ data: ledger.row, error: ledger.error }), ledgerReads);
    },
  }),
}));
vi.mock("@/lib/sets/access", () => ({
  setsAccess: async () => access,
  UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
}));
vi.mock("@/lib/sets/press", async () => await import("./press"));
// Signing stood in for: a stored path becomes a media url, and a thumbnail says its width.
vi.mock("@/lib/media/url", () => ({
  toMediaUrl: (stored: string | null | undefined) => (stored ? `/api/media/${stored}` : null),
  thumbUrl: (url: string | null | undefined, width = 640) => (url ? `${url}?w=${width}` : null),
}));
vi.mock("@/lib/sets/messages", async () => await import("./messages"));

const { readSetPress } = await import("./press-actions");

const userDb = {
  from: (name: string) => {
    if (name !== "generations") throw new Error(`the person's client reads only generations, not ${name}`);
    return table(async () => ({ data: generations.error ? null : generations.rows, error: generations.error }), generationReads);
  },
};

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const SHOT_ANSWER = { error: null, generationId: PRESS, succeeded: true, resultUrl: "/api/media/x", score: 88 };
const TAKE_ANSWER = { error: null, still: SHOT_ANSWER, reusedEnd: false, takeGenerationId: pressClipId(PRESS), takeError: null };

beforeEach(() => {
  access = { error: null, supabase: userDb, userId: USER, plan: "starter", isAdmin: false };
  ledger = { row: null, error: null };
  generations = { rows: [], error: null };
  ledgerReads = [];
  generationReads = [];
  writes = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("readSetPress", () => {
  it("passes an access error straight through", async () => {
    access = { error: "Your session expired — please log in again." };
    expect(await readSetPress(SET, { pressId: PRESS })).toEqual({ error: "Your session expired — please log in again." });
    expect(ledgerReads).toEqual([]);
  });

  it("refuses a bad set, a bad press id or a beat a film cannot have", async () => {
    expect(await readSetPress("nope", { pressId: PRESS })).toEqual({ error: SET_NOT_FOUND });
    expect(await readSetPress(SET, { pressId: "nope" })).toEqual({ error: SET_NOT_FOUND });
    expect(await readSetPress(SET, { pressId: PRESS, filmBeat: 3 })).toEqual({ error: SET_NOT_FOUND });
    expect(ledgerReads).toEqual([]);
  });

  it("answers a finished shot with its own answer", async () => {
    ledger.row = { kind: "shot", state: "done", result: SHOT_ANSWER, created_at: ago(20_000) };
    expect(await readSetPress(SET, { pressId: PRESS })).toEqual({ error: null, state: "answered", kind: "shot", answer: SHOT_ANSWER });
  });

  it("answers a finished take with its own answer", async () => {
    ledger.row = { kind: "take", state: "done", result: TAKE_ANSWER, created_at: ago(20_000) };
    expect(await readSetPress(SET, { pressId: PRESS })).toEqual({ error: null, state: "answered", kind: "take", answer: TAKE_ANSWER });
  });

  it("says running while the press is inside its request's time", async () => {
    ledger.row = { kind: "shot", state: "running", result: null, created_at: ago(10_000) };
    expect(await readSetPress(SET, { pressId: PRESS })).toEqual({ error: null, state: "running" });
    expect(generationReads).toEqual([]);
  });

  it("says what a press the platform stopped left behind, and that its request is over", async () => {
    ledger.row = { kind: "take", state: "running", result: null, created_at: ago(400_000) };
    generations.rows = [{ id: PRESS, status: "succeeded", result_url: "u/still.png" }];
    expect(await readSetPress(SET, { pressId: PRESS })).toEqual({
      error: null,
      state: "unanswered",
      // Signed as the page's loader signs a shot (data.ts): the still at the strip's size.
      still: { id: PRESS, status: "succeeded", resultUrl: "/api/media/u/still.png?w=640", viewUrl: "/api/media/u/still.png?w=1600", posterUrl: null },
      take: null,
      ended: true,
    });
  });

  it("says a press that threw is over at once, with what it left or nothing (review, 2026-09-25)", async () => {
    // press.ts runPress marks a press whose work threw as done, with no answer.
    ledger.row = { kind: "shot", state: "done", result: null, created_at: ago(5_000) };
    expect(await readSetPress(SET, { pressId: PRESS })).toEqual({ error: null, state: "not-found", ended: true });
    generations.rows = [{ id: PRESS, status: "failed" }];
    expect(await readSetPress(SET, { pressId: PRESS })).toMatchObject({ state: "unanswered", still: { id: PRESS, status: "failed" }, take: null, ended: true });
  });

  it("says not-found only when nothing was started under the press, and not over while it may still arrive", async () => {
    expect(await readSetPress(SET, { pressId: PRESS })).toEqual({ error: null, state: "not-found", ended: false });
  });

  it("finds the rows of a press that never claimed a ledger row, and never calls it over", async () => {
    generations.rows = [
      { id: pressClipId(PRESS), status: "generating", result_url: null, poster_url: null },
      { id: PRESS, status: "succeeded", result_url: "u/still.png" },
    ];
    expect(await readSetPress(SET, { pressId: PRESS })).toEqual({
      error: null,
      state: "unanswered",
      still: { id: PRESS, status: "succeeded", resultUrl: "/api/media/u/still.png?w=640", viewUrl: "/api/media/u/still.png?w=1600", posterUrl: null },
      take: { id: pressClipId(PRESS), status: "generating", resultUrl: null, viewUrl: null, posterUrl: null },
      ended: false,
    });
  });

  it("reads History even when the ledger isn't there (its SQL not run yet)", async () => {
    ledger.error = { code: "PGRST205", message: "Could not find the table in the schema cache" };
    generations.rows = [{ id: PRESS, status: "succeeded", result_url: "u/still.png" }];
    expect(await readSetPress(SET, { pressId: PRESS })).toMatchObject({ state: "unanswered", still: { id: PRESS, status: "succeeded" }, ended: false });
    expect(generationReads).toHaveLength(1);
  });

  it("says unknown when neither can say: no ledger and no rows, or the rows can't be read", async () => {
    ledger.error = { code: "PGRST205", message: "Could not find the table in the schema cache" };
    expect(await readSetPress(SET, { pressId: PRESS })).toEqual({ error: null, state: "unknown" });
    ledger.error = null;
    generations.error = { message: "timeout" };
    expect(await readSetPress(SET, { pressId: PRESS })).toEqual({ error: null, state: "unknown" });
  });

  it("reads a film beat under its own id, not its Render's", async () => {
    const beatId = filmBeatPressId(PRESS, 1);
    await readSetPress(SET, { pressId: PRESS, filmBeat: 1 });
    expect(ledgerReads[0]).toContainEqual(["eq", "id", beatId]);
    expect(generationReads[0]).toContainEqual(["in", "id", [beatId, pressClipId(beatId)]]);
  });

  it("reads only the person's own rows, the ledger on this set too, and writes nothing", async () => {
    ledger.row = { kind: "shot", state: "running", result: null, created_at: ago(900_000) };
    generations.rows = [{ id: PRESS, status: "failed" }];
    // The press id as the page may send it: upper case reads as the same press.
    await readSetPress(SET, { pressId: PRESS.toUpperCase() });
    expect(ledgerReads[0]).toEqual([
      ["eq", "id", PRESS],
      ["eq", "user_id", USER],
      ["eq", "set_id", SET],
    ]);
    expect(generationReads[0]).toContainEqual(["eq", "user_id", USER]);
    expect(writes).toEqual([]);
  });
});
