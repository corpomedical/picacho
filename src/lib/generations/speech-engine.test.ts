import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SYNCED_STEP_DETAIL, speechEngineForCharacter } from "./speech-engine";
import { SPEECH_ENDPOINT_V3, SPEECH_ENDPOINT_V4 } from "./voice-lock";

// "Keep old characters on v3" (operator, 2026-10-01): the engine is read from
// the character's own takes. A stand-in client that answers the two queries
// and records the filters each one used.
type Answer = { data: unknown[] | null; error: unknown };
function fakeClient(recorded: Answer, legacy: Answer) {
  const calls: { filters: [string, string, unknown][]; answer: Answer }[] = [];
  const client = {
    from(table: string) {
      const filters: [string, string, unknown][] = [["from", table, null]];
      const isLegacy = () => filters.some(([op]) => op === "contains");
      const q = {
        select: (cols: string) => (filters.push(["select", cols, null]), q),
        eq: (col: string, v: unknown) => (filters.push(["eq", col, v]), q),
        order: (col: string, o: unknown) => (filters.push(["order", col, o]), q),
        contains: (col: string, v: unknown) => (filters.push(["contains", col, v]), q),
        limit: (n: number) => {
          filters.push(["limit", String(n), null]);
          const answer = isLegacy() ? legacy : recorded;
          calls.push({ filters, answer });
          return Promise.resolve(answer);
        },
      };
      return q;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const none: Answer = { data: [], error: null };

describe("speechEngineForCharacter", () => {
  it("starts a character who never spoke on v4", async () => {
    const { client, calls } = fakeClient(none, none);
    expect(await speechEngineForCharacter(client, "c1")).toBe("v4");
    expect(calls.length).toBe(2);
  });

  it("keeps a character on the engine of their first recorded take", async () => {
    const v3 = fakeClient({ data: [{ voice_settings: { endpoint: SPEECH_ENDPOINT_V3 } }], error: null }, none);
    expect(await speechEngineForCharacter(v3.client, "c1")).toBe("v3");
    expect(v3.calls.length).toBe(1);
    const v4 = fakeClient({ data: [{ voice_settings: { endpoint: SPEECH_ENDPOINT_V4 } }], error: null }, none);
    expect(await speechEngineForCharacter(v4.client, "c1")).toBe("v4");
  });

  it("asks for this character's FIRST spoken take", async () => {
    const { client, calls } = fakeClient(none, none);
    await speechEngineForCharacter(client, "c1");
    expect(calls[0].filters).toEqual([
      ["from", "generations", null],
      ["select", "voice_settings", null],
      ["eq", "character_profile_id", "c1"],
      ["eq", "voice_source", "character"],
      ["order", "created_at", { ascending: true }],
      ["limit", "1", null],
    ]);
  });

  it("keeps a character who spoke before takes were recorded on v3, found by the lip-sync step", async () => {
    const { client, calls } = fakeClient(none, { data: [{ id: "g1" }], error: null });
    expect(await speechEngineForCharacter(client, "c1")).toBe("v3");
    expect(calls[1].filters).toContainEqual(["eq", "status", "succeeded"]);
    expect(calls[1].filters).toContainEqual([
      "contains",
      "pipeline_log",
      [{ steps: [{ step: "lipsync", detail: SYNCED_STEP_DETAIL }] }],
    ]);
  });

  it("says v3 when it can't read the history: a voice must never change between two takes", async () => {
    const broken = fakeClient({ data: null, error: { message: "down" } }, none);
    expect(await speechEngineForCharacter(broken.client, "c1")).toBe("v3");
    const brokenLegacy = fakeClient(none, { data: null, error: { message: "down" } });
    expect(await speechEngineForCharacter(brokenLegacy.client, "c1")).toBe("v3");
  });
});

describe("the engine rides with the send", () => {
  const read = (p: string) => readFileSync(join(__dirname, p), "utf8");

  it("is chosen once per send and handed to both the inline and queued lanes", () => {
    const actions = read("actions.ts");
    expect(actions.match(/await speechEngineForCharacter\(supabase, character\.id\)/g)?.length).toBe(1);
    expect(actions.match(/^\s+dialogueEngine,$/gm)?.length).toBe(2);
  });

  it("is kept on the job, and a job from before it existed speaks v3", () => {
    const runner = read("job-runner.ts");
    expect(runner).toContain('...(params.dialogueEngine ? { dialogueEngine: params.dialogueEngine } : {}),');
    expect(runner).toContain('row.resume.dialogueEngine ?? "v3",');
    expect(runner).toContain('jobRow?.resume?.dialogueEngine ?? "v3",');
    expect(read("pipeline.ts")).toContain('options.dialogueEngine ?? "v3",');
  });

  it("writes the lip-sync step with the very words the lookup searches for", () => {
    expect(read("job-runner.ts")).toContain("SYNCED_STEP_DETAIL,");
    expect(read("pipeline.ts")).toContain('{ step: "lipsync", detail: SYNCED_STEP_DETAIL }');
    expect(SYNCED_STEP_DETAIL).toBe("Synced the character's mouth to the dialogue via Sync Labs.");
  });
});
