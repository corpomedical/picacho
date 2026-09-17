import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import raceTrack from "./fixtures-race-track.json";
import { normaliseSetSpec, type SetSpec } from "./set-spec";
import { SET_BRIEF_TOO_SHORT, SET_EDIT_FAILED, SET_EDIT_TOO_BIG, SET_EDIT_TOO_FAST, setEditMonthlyCapMessage } from "./messages";
import { SET_EDIT_MAX_SPEC_CHARS, SET_EDITS_MONTH_SCOPE, setEditsMonthlyLimit } from "./set-config";

// Astra's changes to a set, bounded (2026-09-16). An edit is a build's call
// and free to the person: only a 10-minute pace held it, and a working copy
// of any size was sent — up to $1.21 a call, and an answer cut off past the
// 10,000-token cap, failed and paid for all the same. Now a set too big to
// answer whole is not sent, and the month's changes are counted per plan,
// from the billing month's start, after the gate and the pace. Every answer
// from the count on says how many are left.
//
// editor-actions.ts imports through "@/", which this suite does not resolve:
// the session, the database, the limiter, the gate and Astra are stood in
// for; the Sets modules are the real ones.

const USER = "11111111-1111-4111-8111-111111111111";
const SET = "22222222-2222-4222-8222-222222222222";
const PERIOD = "2026-09-01T00:00:00.000Z";

const n = normaliseSetSpec(raceTrack);
if (!n.ok) throw new Error("fixture");
const SPEC: SetSpec = n.spec;
/** A working copy grown past what Astra can answer whole: the same set, its objects repeated. */
const BIG: SetSpec = { ...SPEC, objects: [...SPEC.objects, ...SPEC.objects, ...SPEC.objects].slice(0, 150) };

type Access = { error: null; supabase: unknown; userId: string; plan: string; isAdmin: boolean; periodStart: string | null };
let access: Access;
let edited: SetSpec | null;
let limited: Record<string, boolean>;
let used: number | null;
let answer: { state: "done"; text: string; usage: null; costUsd: number } | { state: "failed"; kind: "incomplete"; detail: string; usage: null; costUsd: number };
const steps: string[] = [];
const limits: { scope: string; windowSeconds: number; max: number }[] = [];
const writes: unknown[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({
    from: () => {
      let cols = "";
      const builder = {
        select: (c: string) => ((cols = c), builder),
        eq: () => builder,
        is: () => builder,
        maybeSingle: async () =>
          cols === "edited_spec"
            ? { data: { edited_spec: edited }, error: null }
            : { data: { status: "ready", spec: SPEC }, error: null },
        update: (values: unknown) => {
          writes.push(values);
          const done = { eq: () => done, is: async () => ({ error: null }) };
          return done;
        },
      };
      return builder;
    },
  }),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimited: async (_user: string, scope: string, windowSeconds: number, max: number) => {
    steps.push(scope === "set-astra-edit" ? "pace" : scope === SET_EDITS_MONTH_SCOPE ? "month" : scope);
    limits.push({ scope, windowSeconds, max });
    return limited[scope] === true;
  },
}));
vi.mock("@/lib/generations/core", () => ({ monthlyWindowStart: (p: string | null) => new Date(p ?? "2026-09-10T00:00:00.000Z") }));
vi.mock("@/lib/generations/content-policy", () => ({
  ContentPolicyRefusal: class ContentPolicyRefusal extends Error {
    reason = "test";
    userMessage = "Refused by the gate.";
  },
  assertPromptAllowed: async () => {
    steps.push("answer gate");
  },
}));
vi.mock("@/lib/generations/policy-log", () => ({
  gatePrompt: async ({ prompt }: { prompt: string }) => {
    steps.push("gate");
    if (prompt.includes("forbidden")) {
      const { ContentPolicyRefusal } = await import("@/lib/generations/content-policy");
      throw new ContentPolicyRefusal("test" as never, "Refused by the gate.");
    }
  },
  recordPolicyRefusal: async () => {},
}));
vi.mock("@/lib/generations/providers/astra", () => ({
  submitAstraJob: async () => {
    steps.push("astra");
    return { ok: true, responseId: "resp_1" };
  },
  pollAstraJob: async () => answer,
  cancelAstraJob: async () => {},
}));
vi.mock("@/lib/openai/safety-id", () => ({ openAiSafetyId: () => "safety" }));
vi.mock("@/lib/sets/access", () => ({
  setsAccess: async () => access,
  UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
}));
vi.mock("@/lib/sets/data", () => ({
  countAstraEditsThisMonth: async () => {
    steps.push("count");
    return used;
  },
}));
vi.mock("@/lib/sets/editor-model", async () => await import("./editor-model"));
vi.mock("@/lib/sets/messages", async () => await import("./messages"));
vi.mock("@/lib/sets/set-edit-prompt", async () => await import("./set-edit-prompt"));
vi.mock("@/lib/sets/set-config", async () => await import("./set-config"));
vi.mock("@/lib/sets/set-spec", async () => await import("./set-spec"));

import { editSetWithAstra } from "./editor-actions";

const recoloured = (): string => JSON.stringify({ ...SPEC, objects: SPEC.objects.map((o, i) => (i === 0 ? { ...o, color: "#aa3322" } : o)) });

beforeEach(() => {
  access = { error: null, supabase: {}, userId: USER, plan: "growth", isAdmin: false, periodStart: PERIOD };
  edited = null;
  limited = {};
  used = 3;
  answer = { state: "done", text: recoloured(), usage: null, costUsd: 0.31 };
  steps.length = 0;
  limits.length = 0;
  writes.length = 0;
});

describe("an Astra change", () => {
  it("is counted among the month's after the gate and the pace, then sent, and says how many are left", async () => {
    const out = await editSetWithAstra(SET, "make the first barrier brick red");
    expect(out.error).toBeNull();
    expect(steps).toEqual(["gate", "pace", "month", "count", "astra", "answer gate"]);
    const cap = setEditsMonthlyLimit("growth", false);
    expect(out.editsLeft).toBe(cap - 3);
    const month = limits.find((l) => l.scope === SET_EDITS_MONTH_SCOPE)!;
    expect(month.max).toBe(cap);
    // The window reaches back to the billing month's start, no further.
    const since = (new Date().getTime() - new Date(PERIOD).getTime()) / 1000;
    expect(month.windowSeconds).toBeGreaterThanOrEqual(Math.floor(since));
    expect(month.windowSeconds).toBeLessThanOrEqual(Math.ceil(since) + 5);
    expect(writes).toHaveLength(1);
  });

  it("is refused at the month's cap before Astra is asked, and says none are left", async () => {
    limited[SET_EDITS_MONTH_SCOPE] = true;
    const out = await editSetWithAstra(SET, "make the first barrier brick red");
    expect(out).toEqual({ error: setEditMonthlyCapMessage(setEditsMonthlyLimit("growth", false)), editsLeft: 0 });
    expect(steps).not.toContain("astra");
    expect(writes).toEqual([]);
  });

  it("counts nothing for an admin, and says nothing of a count", async () => {
    access = { ...access, plan: "none", isAdmin: true };
    const out = await editSetWithAstra(SET, "make the first barrier brick red");
    expect(out.error).toBeNull();
    expect(out.editsLeft).toBeNull();
    expect(steps).toEqual(["gate", "pace", "astra", "answer gate"]);
  });

  it("counts nothing the gate or the pace refused", async () => {
    expect((await editSetWithAstra(SET, "something forbidden")).error).toBe("Refused by the gate.");
    expect(steps).toEqual(["gate"]);
    steps.length = 0;
    limited["set-astra-edit"] = true;
    expect(await editSetWithAstra(SET, "make the first barrier brick red")).toEqual({ error: SET_EDIT_TOO_FAST });
    expect(steps).toEqual(["gate", "pace"]);
  });

  it("does not send a set too big for Astra to answer whole, and counts nothing for it", async () => {
    expect(JSON.stringify(SPEC).length).toBeLessThanOrEqual(SET_EDIT_MAX_SPEC_CHARS);
    edited = BIG;
    expect(JSON.stringify(BIG).length).toBeGreaterThan(SET_EDIT_MAX_SPEC_CHARS);
    expect(await editSetWithAstra(SET, "make the first barrier brick red")).toEqual({ error: SET_EDIT_TOO_BIG });
    expect(steps).toEqual([]);
    // Too short a request is still said first.
    expect(await editSetWithAstra(SET, "hi")).toEqual({ error: SET_BRIEF_TOO_SHORT });
  });

  it("still says how many are left when Astra's answer fails after the count", async () => {
    answer = { state: "failed", kind: "incomplete", detail: "max_output_tokens", usage: null, costUsd: 0.62 };
    used = 10;
    const out = await editSetWithAstra(SET, "make the first barrier brick red");
    expect(out).toEqual({ error: SET_EDIT_FAILED, editsLeft: 0 });
    used = null;
    const unread = await editSetWithAstra(SET, "make the first barrier brick red");
    expect(unread).toEqual({ error: SET_EDIT_FAILED, editsLeft: null });
  });
});

// The prompt bar says what the server holds (set-editor.tsx, a client
// component, read as source).
describe("the editor's prompt bar", () => {
  const editor = readFileSync(join(__dirname, "../../components/sets/set-editor.tsx"), "utf8");
  const send = editor.slice(editor.indexOf("async function sendAsk()"), editor.indexOf("// ---- the stage ----"));

  it("shows the month's changes left, and holds send at none or at a set too big", () => {
    expect(editor).toContain("const [editsLeft, setEditsLeft] = useState<number | null>(astraEditsLeft);");
    expect(editor).toContain("const astraTooBig = useMemo(() => JSON.stringify(spec).length > SET_EDIT_MAX_SPEC_CHARS, [spec]);");
    expect(editor).toContain("{editsLeft !== null && (");
    expect(editor).toContain("editsLeft === 0 ? s.editorAskLeftNone : editsLeft === 1 ? s.editorAskLeftOne : formatMsg(s.editorAskLeft, { n: editsLeft })");
    // Send is no longer held at the cap in silence: it says why (below).
    expect(editor).toContain("disabled={asking || ask.trim().length === 0 || astraTooBig}");
    expect(editor).toContain("<span className=\"text-[#9aa0ad]\">{localizeServerText(SET_EDIT_TOO_BIG, t)}</span>");
    expect(send).toContain("if (!text || asking || astraTooBig) return;");
    // Whatever the server says of the count, the bar keeps.
    expect(send).toContain("if (r.editsLeft !== undefined) setEditsLeft(r.editsLeft);");
  });

  it("says why at the month's cap instead of holding Send in silence, and spends nothing", () => {
    // Send was disabled with no sentence anywhere, and Enter was not held at
    // all: it flushed a save and called the action, which reads the words
    // through the gate and takes one of the pace's hits before answering
    // with the cap (found reviewing Helios, fixed 2026-09-18).
    const cap = send.indexOf("if (editsLeft === 0) {");
    expect(cap).toBeGreaterThan(-1);
    expect(send.slice(cap, send.indexOf("}", cap))).toContain("setAskError(s.editorAskCapped);");
    // Before the flush and before the call: nothing saved, gated or paced.
    expect(cap).toBeLessThan(send.indexOf("await saveCopy("));
    expect(cap).toBeLessThan(send.indexOf("r = await editSetWithAstra(setId, text);"));
  });

  it("names a history row for what it holds, not for where it sits", () => {
    // Row 0 is the copy the editor OPENED on — Astra's original only when
    // nothing had been saved before — and the original can sit further down,
    // put back by restoreOriginal. It was named by its index, so every return
    // visit to an edited set promised "Astra's original" and restored the
    // working copy, and the bar read "Edit 0" (fixed 2026-09-18).
    expect(editor).toContain("const originalKey = useMemo(() => JSON.stringify(original), [original]);");
    expect(editor).toContain(
      "history[i] === originalKey ? s.editorOriginal : i === 0 ? s.editorOpened : formatMsg(s.editorEditN, { n: i });",
    );
    expect(editor).toContain("<span>{rowLabel(i)}</span>");
    expect(editor).toContain("{rowLabel(at)}");
    expect(editor).not.toContain("{i === 0 ? s.editorOriginal : formatMsg(s.editorEditN, { n: i })}");
  });

  it("never stays on 'Astra is changing the set…' when the call throws", () => {
    expect(send).toMatch(/try \{\s*r = await editSetWithAstra\(setId, text\);\s*\} catch \(err\) \{/);
    expect(send).toMatch(/\} finally \{\s*setAsking\(false\);\s*\}/);
    expect(send).toContain("setAskError(stale ? t.generate.refreshNeeded : t.generate.submitFailed);");
  });

  it("is handed the count by the set page", () => {
    expect(readFileSync(join(__dirname, "../../app/app/sets/[id]/page.tsx"), "utf8")).toContain("astraEditsLeft={data.astraEditsLeft}");
  });
});
