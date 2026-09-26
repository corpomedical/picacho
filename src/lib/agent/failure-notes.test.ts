import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttemptLog } from "../generations/pipeline";
import en from "../i18n/messages/en";
import {
  creditsKept,
  failedRenderNote,
  failureReasonForPerson,
  loadFailureNotes,
  type FailedRenderRow,
} from "./failure-notes";

const attempt = (steps: AttemptLog["steps"], issues: string[] = []): AttemptLog => ({
  attempt: 1,
  passed: false,
  issues,
  compiledPrompt: "a woman walking in the rain",
  steps,
});

const GENERIC = "Something went wrong generating that. Please try again in a moment.";

describe("failureReasonForPerson", () => {
  it("says what the composer said: the provider's own sentence, never its JSON", () => {
    const log = [
      attempt([
        {
          step: "generate",
          detail:
            'fal.ai (Seedance 2.0) error (422): {"detail":[{"msg":"The images or videos provided may contain likenesses of real people"}]}',
        },
      ]),
    ];
    expect(failureReasonForPerson(log)).toBe("The images or videos provided may contain likenesses of real people");
  });

  it("turns a raw dump with no sentence in it into the generic line", () => {
    const log = [attempt([{ step: "generate", detail: "fal.ai (Kling 2.1) error (500): <html>Bad Gateway</html>" }])];
    expect(failureReasonForPerson(log)).toBe(GENERIC);
  });

  it("gives the reaper's own words where the composer has no line", () => {
    const log = [attempt([{ step: "generate", detail: "This render didn't finish in time and was stopped." }])];
    expect(failureReasonForPerson(log)).toBe("This render didn't finish in time and was stopped.");
  });

  it("keeps the catalogue's lines for a stop, an unreadable photo and missing traits", () => {
    expect(failureReasonForPerson([attempt([{ step: "generate", detail: "x" }], ["cancelled"])])).toBe(
      en.generate.stoppedByUser,
    );
    const photo = [
      attempt([{ step: "generate", detail: 'OpenAI images error (400): {"error":{"message":"Invalid image file"}}' }]),
    ];
    expect(failureReasonForPerson(photo)).toBe(en.generate.failAttachmentUnreadable);
    const traits = [attempt([{ step: "generate", detail: "Generated with Kling 2.1." }], ["outfit"])];
    expect(failureReasonForPerson(traits)).toBe("The result was missing: outfit.");
  });

  it("says a brand-rules block in full, rule and fix included", () => {
    const detail = 'Blocked by brand rules: No logos (triggered by: "nike" — try: "running shoes")';
    const log = [attempt([{ step: "validate", detail }], ["No logos"])];
    expect(failureReasonForPerson(log)).toBe(detail);
  });

  it("says so when nothing was recorded", () => {
    expect(failureReasonForPerson([])).toBe("No reason was recorded.");
    expect(failureReasonForPerson([attempt([{ step: "draft", detail: "a woman walking in the rain" }])])).toBe(
      "No reason was recorded.",
    );
  });
});

const row = (over: Partial<FailedRenderRow> = {}): FailedRenderRow => ({
  id: "g1",
  pipeline_log: [attempt([{ step: "generate", detail: "This render didn't finish in time and was stopped." }])],
  credits_used: 0,
  purchased_credits_used: 0,
  bonus_credits_used: 0,
  free_generation_used: false,
  ...over,
});

describe("creditsKept", () => {
  it("reads every source a refund zeroes, not refunded_at", () => {
    expect(creditsKept(row())).toBe(false);
    expect(creditsKept(row({ credits_used: 2 }))).toBe(true);
    expect(creditsKept(row({ purchased_credits_used: 1 }))).toBe(true);
    expect(creditsKept(row({ bonus_credits_used: 1 }))).toBe(true);
    expect(creditsKept(row({ free_generation_used: true }))).toBe(true);
    expect(
      creditsKept(row({ credits_used: null, purchased_credits_used: null, bonus_credits_used: null, free_generation_used: null })),
    ).toBe(false);
  });
});

describe("failedRenderNote", () => {
  it("is one line: the reason, then the credits", () => {
    expect(failedRenderNote(row())).toBe(
      "failed because: This render didn't finish in time and was stopped. — its credits were returned (or never taken)",
    );
    expect(failedRenderNote(row({ credits_used: 3 }))).toContain("its credits were NOT returned");
  });

  it("survives a row with no log at all", () => {
    expect(failedRenderNote(row({ pipeline_log: null }))).toContain("failed because: No reason was recorded.");
  });
});

// Records the query the loader builds and answers with `rows`.
function fakeSupabase(rows: FailedRenderRow[] | null, error: { message: string } | null = null) {
  const seen: { table?: string; select?: string; eq?: [string, unknown][]; in?: [string, unknown[]] } = { eq: [] };
  let calls = 0;
  const query = {
    select(cols: string) {
      seen.select = cols;
      return query;
    },
    eq(col: string, value: unknown) {
      seen.eq!.push([col, value]);
      return query;
    },
    in(col: string, values: unknown[]) {
      seen.in = [col, values];
      return Promise.resolve({ data: rows, error });
    },
  };
  const client = {
    from(table: string) {
      calls += 1;
      seen.table = table;
      return query;
    },
  } as unknown as SupabaseClient;
  return { client, seen, calls: () => calls };
}

describe("loadFailureNotes", () => {
  it("reads only the person's own failed renders, once each, and notes them by id", async () => {
    const { client, seen } = fakeSupabase([row({ id: "a" }), row({ id: "b", credits_used: 1 })]);
    const notes = await loadFailureNotes(client, "user-1", ["a", "b", "a"]);
    expect(seen.table).toBe("generations");
    expect(seen.select).toContain("pipeline_log");
    expect(seen.eq).toEqual([["user_id", "user-1"]]);
    expect(seen.in).toEqual(["id", ["a", "b"]]);
    expect(notes.get("a")).toContain("its credits were returned");
    expect(notes.get("b")).toContain("its credits were NOT returned");
  });

  it("asks nothing when nothing failed, and at most thirty", async () => {
    const empty = fakeSupabase([]);
    expect((await loadFailureNotes(empty.client, "u", [])).size).toBe(0);
    expect(empty.calls()).toBe(0);
    const many = fakeSupabase([]);
    await loadFailureNotes(many.client, "u", Array.from({ length: 50 }, (_, i) => `g${i}`));
    expect(many.seen.in?.[1]).toHaveLength(30);
  });

  it("leaves the notes out when the read fails, rather than failing the turn", async () => {
    const { client } = fakeSupabase(null, { message: "column does not exist" });
    const original = console.error;
    console.error = () => {};
    try {
      expect((await loadFailureNotes(client, "u", ["a"])).size).toBe(0);
    } finally {
      console.error = original;
    }
  });
});

describe("the assistants", () => {
  const read = (p: string) => readFileSync(join(__dirname, "..", "..", "..", p), "utf8");

  it("no longer claim a log they are not given, and read the notes instead", () => {
    const context = read("src/lib/agent/context.ts");
    expect(context).not.toContain("You have the pipeline log");
    expect(context).toContain("loadFailureNotes(");
    expect(read("src/lib/producer/run-tools.ts")).toContain("loadFailureNotes(");
    expect(read("src/lib/agent/product-guide.ts")).not.toContain("you can read it in the render data above");
  });
});
