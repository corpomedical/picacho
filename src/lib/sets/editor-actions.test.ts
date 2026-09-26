import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import raceTrack from "./fixtures-race-track.json";
import { normaliseSetSpec, type SetSpec } from "./set-spec";
import {
  SET_BRIEF_TOO_SHORT,
  SET_EDIT_ANSWER_UNCHECKED,
  SET_EDIT_FAILED,
  SET_EDIT_REFUSED,
  SET_EDIT_STILL_WORKING,
  SET_EDIT_TOO_BIG,
  SET_EDIT_TOO_FAST,
  SET_EDIT_TRIES_USED,
  SET_EDIT_UNAVAILABLE,
  SET_NOT_FOUND,
  SET_SAVE_FAILED,
  SETS_SESSION_EXPIRED,
  setEditMonthlyCapMessage,
} from "./messages";
import {
  SET_EDIT_MAX_SPEC_CHARS,
  SET_EDIT_TRIES_MONTH_SCOPE,
  SET_EDITS_MONTH_SCOPE,
  setEditTriesMonthlyLimit,
  setEditsMonthlyLimit,
} from "./set-config";
import type { AstraPressKind } from "./astra-follow";

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
//
// One Astra job per press, and only saved changes counted (2026-09-25, Cut
// 1 — operator: "GO ahead"): the claim, the end marker and the give-back
// (astra-press.ts) are stood in for with stateful fakes that write steps;
// astra-press.test.ts holds the real ones against a fake table.

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
/**
 * What submitAstraJob does: accept, refuse, or throw — or fail as
 * providers/astra.ts reports it (Helios Cut 4, step A2): "unbilled", OpenAI
 * answered the POST without a job (neverBilled); "unsure", a job may exist
 * (a 200 with no response id).
 */
let submit: "ok" | "refused" | "throws" | "unbilled" | "unsure";
/** Whether the gate refuses Astra's answer (and why), the save fails, the kept model's move throws. */
let answerGateRefuses: boolean;
let answerGateReason: string;
let saveFails: boolean;
let moveThrows: boolean;
let rebuildOpen: boolean;
/** The press claims: ids seen, and whether the claim can be asked at all. */
const claimed = new Set<string>();
let claimDown: boolean;
/** Where readAstraPress says the press stands, and what else happens as it reads. */
let pressState: AstraPressKind;
let onReadPress: () => void;
/** Each end marker, with how many writes had landed when it was left. */
const ends: { end: string; writes: number }[] = [];
const steps: string[] = [];
const limits: { scope: string; windowSeconds: number; max: number }[] = [];
const writes: unknown[] = [];
/** The rebuild's side: the thing's photos, the model files, what storage was asked, what Astra was sent. */
let photos: { refId: string; anchor: string | null; slot: 1 | 2 | 3 | 4 | null; at: number; url: string; path: string }[];
let modelFiles: { path: string; key: string; at: number; flip: boolean }[];
const storage: string[] = [];
const sent: { input: unknown; instructions: string }[] = [];

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
          if (!saveFails) writes.push(values);
          const done = { eq: () => done, is: async () => ({ error: saveFails ? { message: "timeout" } : null }) };
          return done;
        },
      };
      return builder;
    },
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) => {
          storage.push(`download ${bucket} ${path}`);
          return { data: new Blob([new Uint8Array([0xff, 0xd8, 0xff])]), error: null };
        },
        move: async (from: string, to: string) => {
          if (moveThrows) throw new Error("storage down");
          storage.push(`move ${bucket} ${from} → ${to}`);
          return { error: null };
        },
      }),
    },
  }),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimited: async (_user: string, scope: string, windowSeconds: number, max: number) => {
    steps.push(scope === "set-astra-edit" ? "pace" : scope === SET_EDITS_MONTH_SCOPE ? "month" : scope === SET_EDIT_TRIES_MONTH_SCOPE ? "tries" : scope);
    limits.push({ scope, windowSeconds, max });
    return limited[scope] === true;
  },
}));
vi.mock("@/lib/generations/core", () => ({ monthlyWindowStart: (p: string | null) => new Date(p ?? "2026-09-10T00:00:00.000Z") }));
vi.mock("@/lib/generations/content-policy", () => ({
  ContentPolicyRefusal: class ContentPolicyRefusal extends Error {
    reason: string;
    userMessage: string;
    constructor(reason = "test", userMessage = "Refused by the gate.") {
      super(userMessage);
      this.reason = reason;
      this.userMessage = userMessage;
    }
  },
  assertPromptAllowed: async () => {
    steps.push("answer gate");
    if (answerGateRefuses) {
      const { ContentPolicyRefusal } = await import("@/lib/generations/content-policy");
      throw new ContentPolicyRefusal(answerGateReason as never, "Refused by the gate.");
    }
  },
}));
/** What the gate read, and each refusal it logged with whose words it put it on (null: the person's, which counts). */
const gated: string[] = [];
const refusals: { prompt: string; provider: string | null }[] = [];
vi.mock("@/lib/generations/policy-log", () => ({
  // The real gate's attribution (policy-log.ts gatePrompt): on a refusal it
  // asks refusal-attribution.ts whose words they were, judging the
  // model-written part alone — here, refused when it holds "forbidden".
  gatePrompt: async ({ prompt }: { prompt: string }) => {
    steps.push("gate");
    gated.push(prompt);
    if (prompt.includes("forbidden")) {
      const { refusalProviderFor } = await import("../generations/refusal-attribution");
      refusals.push({ prompt, provider: await refusalProviderFor(prompt, async (text) => text.includes("forbidden")) });
      const { ContentPolicyRefusal } = await import("@/lib/generations/content-policy");
      throw new ContentPolicyRefusal("test" as never, "Refused by the gate.");
    }
  },
  recordPolicyRefusal: async () => {},
}));
// The real attribution (AsyncLocalStorage), the same module the gate above reads.
vi.mock("@/lib/generations/refusal-attribution", async () => await import("../generations/refusal-attribution"));
vi.mock("@/lib/generations/providers/astra", () => ({
  submitAstraJob: async (req: { input: unknown; instructions: string }) => {
    sent.push(req);
    steps.push("astra");
    if (submit === "throws") throw new Error("network down");
    if (submit === "refused") return { ok: false, kind: "refused", detail: "safety", neverBilled: false };
    if (submit === "unbilled") return { ok: false, kind: "rate_limited", detail: "429", neverBilled: true };
    if (submit === "unsure") return { ok: false, kind: "unavailable", detail: "no response id", neverBilled: false };
    return { ok: true, responseId: "resp_1" };
  },
  // A later tick, so two deliveries of one press really overlap.
  pollAstraJob: async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    return answer;
  },
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
  astraEditsLeft: async () => {
    steps.push("left");
    return used === null ? null : 10 - used;
  },
}));
vi.mock("@/lib/sets/astra-press", async () => ({
  ...(await import("./astra-press")),
  claimAstraPress: async (_admin: unknown, _user: string, id: string) => {
    steps.push("claim");
    if (claimDown) return "unavailable";
    if (claimed.has(id)) return "repeat";
    claimed.add(id);
    return "first";
  },
  endAstraPress: async (_admin: unknown, _user: string, _id: string, end: string) => {
    steps.push(`end ${end}`);
    ends.push({ end, writes: writes.length });
  },
  readAstraPress: async () => {
    steps.push("read press");
    onReadPress();
    return pressState;
  },
  giveBackAstraEdit: async (_admin: unknown, _user: string, scope: string = SET_EDITS_MONTH_SCOPE) => {
    if (scope === SET_EDIT_TRIES_MONTH_SCOPE) {
      steps.push("give back try");
      return true;
    }
    steps.push("give back");
    if (typeof used === "number") used -= 1;
    return true;
  },
}));
vi.mock("@/lib/sets/editor-model", async () => await import("./editor-model"));
vi.mock("@/lib/sets/edit-seal", async () => await import("./edit-seal"));
// The seal's key (edit-seal.ts): any will do here.
vi.stubEnv("MEDIA_SIGNING_SECRET", "test-only");
vi.mock("@/lib/sets/messages", async () => await import("./messages"));
vi.mock("@/lib/sets/set-edit-prompt", async () => await import("./set-edit-prompt"));
vi.mock("@/lib/sets/set-config", async () => await import("./set-config"));
vi.mock("@/lib/sets/set-spec", async () => await import("./set-spec"));
vi.mock("@/lib/sets/elements", async () => await import("./elements"));
// The rebuild is admins' until its first live proof; `rebuildOpen` opens it
// here so its month's arithmetic can be held as a plan will meet it.
vi.mock("@/lib/sets/thing-rebuild", async () => {
  const real = await import("./thing-rebuild");
  return {
    ...real,
    get THING_REBUILD_OPEN_TO_ALL() {
      return rebuildOpen;
    },
  };
});
vi.mock("@/lib/sets/thing-model", async () => await import("./thing-model"));
vi.mock("@/lib/sets/references", () => ({ listElementPhotos: async () => ({ photos, sheets: [] }) }));
vi.mock("@/lib/sets/thing-model-store", () => ({ listModelFiles: async () => modelFiles }));

import { editSetWithAstra, readAstraEdit, rebuildThingFromPhotos, undoAstraEdit } from "./editor-actions";
import { SET_EDIT_MEANING_MAX_CHARS, setEditInput } from "./set-edit-prompt";
import { editTextOf, openEditSeal, sealReaderMeaning } from "./edit-seal";
import { buildSetShotPrompt } from "./set-shot-prompt";
import { resolvePhotos, setElements, type ElementPhoto } from "./elements";
import { THING_REBUILD_MAX_SENT_CHARS, thingLocalBlocks } from "./thing-rebuild";
import { THING_REBUILD_ADMINS_ONLY, THING_REBUILD_DIDNT_FIT, THING_REBUILD_FAILED, THING_REBUILD_NO_PHOTOS, THING_REBUILD_TOO_BIG } from "./messages";

const PRESS = "3f2a4b5c-6d7e-4f80-9a1b-2c3d4e5f6a7b";
const LATER = "4f2a4b5c-6d7e-4f80-9a1b-2c3d4e5f6a7b";

const recoloured = (): string => JSON.stringify({ ...SPEC, objects: SPEC.objects.map((o, i) => (i === 0 ? { ...o, color: "#aa3322" } : o)) });

beforeEach(() => {
  access = { error: null, supabase: {}, userId: USER, plan: "growth", isAdmin: false, periodStart: PERIOD };
  edited = null;
  limited = {};
  used = 3;
  answer = { state: "done", text: recoloured(), usage: null, costUsd: 0.31 };
  submit = "ok";
  answerGateRefuses = false;
  answerGateReason = "test";
  saveFails = false;
  moveThrows = false;
  rebuildOpen = false;
  claimed.clear();
  claimDown = false;
  pressState = "none";
  onReadPress = () => {};
  ends.length = 0;
  steps.length = 0;
  limits.length = 0;
  writes.length = 0;
  photos = [];
  modelFiles = [];
  storage.length = 0;
  sent.length = 0;
  gated.length = 0;
  refusals.length = 0;
});

describe("an Astra change", () => {
  it("is reserved from the month's after the gate and the pace, with its try counted, then sent, and says how many are left", async () => {
    const out = await editSetWithAstra(SET, "make the first barrier brick red");
    expect(out.error).toBeNull();
    expect(steps).toEqual(["gate", "pace", "month", "tries", "count", "astra", "answer gate"]);
    const cap = setEditsMonthlyLimit("growth", false);
    expect(out.editsLeft).toBe(cap - 3);
    const month = limits.find((l) => l.scope === SET_EDITS_MONTH_SCOPE)!;
    expect(month.max).toBe(cap);
    // The window reaches back to the billing month's start, no further.
    const since = (new Date().getTime() - new Date(PERIOD).getTime()) / 1000;
    expect(month.windowSeconds).toBeGreaterThanOrEqual(Math.floor(since));
    expect(month.windowSeconds).toBeLessThanOrEqual(Math.ceil(since) + 5);
    // The month's tries: the changes plus the spare ones, over the same window.
    const tries = limits.find((l) => l.scope === SET_EDIT_TRIES_MONTH_SCOPE)!;
    expect(tries.max).toBe(setEditTriesMonthlyLimit("growth", false));
    expect(tries.max).toBe(13);
    expect(tries.windowSeconds).toBe(month.windowSeconds);
    expect(writes).toHaveLength(1);
  });

  it("is refused at the month's cap before Astra is asked, says none are left, and gives nothing back", async () => {
    limited[SET_EDITS_MONTH_SCOPE] = true;
    const out = await editSetWithAstra(SET, "make the first barrier brick red");
    expect(out).toEqual({ error: setEditMonthlyCapMessage(setEditsMonthlyLimit("growth", false)), editsLeft: 0 });
    expect(steps).not.toContain("astra");
    // Nothing was reserved: nothing is given back, and the tries are not counted.
    expect(steps).not.toContain("give back");
    expect(steps).not.toContain("tries");
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

  it("gives the change back when Astra's answer fails, and says how many are left after it", async () => {
    answer = { state: "failed", kind: "incomplete", detail: "max_output_tokens", usage: null, costUsd: 0.62 };
    // Ten counted, this reservation among them: given back, nine.
    used = 10;
    const out = await editSetWithAstra(SET, "make the first barrier brick red");
    expect(out).toEqual({ error: SET_EDIT_FAILED, editsLeft: 1 });
    expect(steps.filter((x) => x === "give back")).toHaveLength(1);
    expect(steps.indexOf("give back")).toBeLessThan(steps.lastIndexOf("count"));
    expect(steps.slice(steps.indexOf("give back"))).toEqual(["give back", "count"]);
    used = null;
    const unread = await editSetWithAstra(SET, "make the first barrier brick red");
    expect(unread).toEqual({ error: SET_EDIT_FAILED, editsLeft: null });
  });
});

// Only saved changes count against the month (2026-09-25, Cut 1). A change
// is reserved before Astra runs, so parallel presses never pass the cap,
// and every press that does not save gives it back — once.
describe("the month's change, given back unless it saves", () => {
  const ask = () => editSetWithAstra(SET, "make the first barrier brick red");
  const givenBack = () => steps.filter((x) => x === "give back").length;

  it("keeps a saved change", async () => {
    expect((await ask()).error).toBeNull();
    expect(givenBack()).toBe(0);
  });

  it("gives it back when Astra refuses the request", async () => {
    submit = "refused";
    expect(await ask()).toEqual({ error: SET_EDIT_REFUSED, editsLeft: setEditsMonthlyLimit("growth", false) - 2 });
    expect(givenBack()).toBe(1);
    expect(writes).toEqual([]);
  });

  it("gives it back when the gate refuses Astra's answer", async () => {
    answerGateRefuses = true;
    expect((await ask()).error).toBe(SET_EDIT_REFUSED);
    expect(givenBack()).toBe(1);
    expect(writes).toEqual([]);
  });

  it("gives it back when the answer can't be saved", async () => {
    saveFails = true;
    expect(await ask()).toEqual({ error: SET_SAVE_FAILED, editsLeft: setEditsMonthlyLimit("growth", false) - 2 });
    expect(givenBack()).toBe(1);
  });

  it("gives it back when the call throws, and passes the throw on", async () => {
    submit = "throws";
    await expect(ask()).rejects.toThrow("network down");
    expect(givenBack()).toBe(1);
  });

  it("gives nothing back for an admin, who reserves nothing", async () => {
    access = { ...access, plan: "none", isAdmin: true };
    submit = "refused";
    expect(await ask()).toEqual({ error: SET_EDIT_REFUSED, editsLeft: null });
    expect(givenBack()).toBe(0);
    expect(steps).not.toContain("tries");
  });

  it("pauses Astra once the month's tries are spent, giving back the change it had just reserved", async () => {
    limited[SET_EDIT_TRIES_MONTH_SCOPE] = true;
    const out = await ask();
    expect(out).toEqual({ error: SET_EDIT_TRIES_USED, editsLeft: setEditsMonthlyLimit("growth", false) - 2 });
    expect(steps).toEqual(["gate", "pace", "month", "tries", "give back", "count"]);
    expect(sent).toEqual([]);
    expect(writes).toEqual([]);
  });
});

// An answer that changes nothing (Helios Cut 4, step A1, 2026-09-26 — the
// owner's decision D11): it used to be saved and counted as one of the
// month's changes. Now it gives its change back and saves nothing, before
// the gate reads Astra's words a second time.
describe("an answer that changes nothing", () => {
  const ask = (press?: string) => editSetWithAstra(SET, "make the set look like it already does", press);

  it("gives its change back once, saves nothing, never reads the gate, and hands back the copy Astra was handed", async () => {
    answer = { state: "done", text: JSON.stringify(SPEC), usage: null, costUsd: 0.31 };
    const out = await ask(PRESS);
    expect(out).toEqual({ error: null, spec: SPEC, changed: 0, editsLeft: setEditsMonthlyLimit("growth", false) - 2, undo: null });
    expect(steps.filter((x) => x === "give back")).toHaveLength(1);
    expect(steps).not.toContain("answer gate");
    expect(writes).toEqual([]);
    // The press ends unsaved, so a read-back says nothing changed, never "saved".
    expect(ends.map((e) => e.end)).toEqual(["unsaved"]);
    // The try itself was billed and stays counted: only the change comes back.
    expect(steps.filter((x) => x === "tries")).toHaveLength(1);
  });

  it("is judged against the working copy Astra was handed, not Astra's original", async () => {
    edited = JSON.parse(recoloured()) as SetSpec;
    answer = { state: "done", text: recoloured(), usage: null, costUsd: 0.31 };
    const out = await ask();
    expect(out).toMatchObject({ error: null, changed: 0, undo: null });
    expect(writes).toEqual([]);
    // Astra's original, against that copy, is a change like any other.
    answer = { state: "done", text: JSON.stringify(SPEC), usage: null, costUsd: 0.31 };
    expect(await ask()).toMatchObject({ error: null, changed: 1 });
    expect(writes).toHaveLength(1);
  });

  it("still saves and counts a change of the description alone", async () => {
    answer = { state: "done", text: JSON.stringify({ ...SPEC, description: `${SPEC.description} Bunting hangs over the pit lane.`.slice(0, 300) }), usage: null, costUsd: 0.31 };
    const out = await ask(PRESS);
    expect(out).toMatchObject({ error: null, changed: 1 });
    expect(steps).toContain("answer gate");
    expect(steps).not.toContain("give back");
    expect(writes).toHaveLength(1);
    expect(ends.map((e) => e.end)).toEqual(["saved"]);
  });

  it("gives nothing back for an admin, who reserved nothing", async () => {
    access = { ...access, plan: "none", isAdmin: true };
    answer = { state: "done", text: JSON.stringify(SPEC), usage: null, costUsd: 0.31 };
    expect(await ask()).toEqual({ error: null, spec: SPEC, changed: 0, editsLeft: null, undo: null });
    expect(steps).not.toContain("give back");
    expect(writes).toEqual([]);
  });

  it("is asked before the answer's gate and after the parse (read as source)", () => {
    const src = readFileSync(join(__dirname, "editor-actions.ts"), "utf8");
    const body = src.slice(src.indexOf("export async function editSetWithAstra("), src.indexOf("export async function rebuildThingFromPhotos("));
    const nothing = body.indexOf("if (changesNothing(working, next)) {");
    expect(nothing).toBeGreaterThan(body.indexOf("const next = parsed.spec;"));
    expect(nothing).toBeLessThan(body.indexOf("const gateWords = specTextForGate(next);"));
    expect(body.slice(nothing, body.indexOf("\n      }\n", nothing))).toContain(
      "return { error: null, spec: working, changed: 0, editsLeft: await giveBackAstraChange(access, slot), undo: null };",
    );
  });
});

// Tries that were never billed come back (Helios Cut 4, step A2, 2026-09-26).
// A submit OpenAI refused before making a job (providers/astra.ts
// neverBilled) cost nothing, yet counted among the month's tries and said
// "try saying it differently". Only those come back: a try that may have
// made a job keeps its row (critic item 1), or the tries cap — which bounds
// what failed tries cost — would have a hole.
describe("a try OpenAI never billed", () => {
  const ask = (press?: string) => editSetWithAstra(SET, "make the first barrier brick red", press);
  const count = (step: string) => steps.filter((x) => x === step).length;

  it("gives back the try and the change, saves nothing, and says Astra couldn't be reached", async () => {
    submit = "unbilled";
    expect(await ask(PRESS)).toEqual({ error: SET_EDIT_UNAVAILABLE, editsLeft: setEditsMonthlyLimit("growth", false) - 2 });
    expect(count("give back try")).toBe(1);
    expect(count("give back")).toBe(1);
    // The try goes back before the count is read for the answer.
    expect(steps.indexOf("give back try")).toBeLessThan(steps.lastIndexOf("count"));
    expect(writes).toEqual([]);
    expect(ends.map((e) => e.end)).toEqual(["unsaved"]);
    expect(SET_EDIT_UNAVAILABLE).toMatch(/nothing was used/);
  });

  it("keeps the try whenever a job may exist: a submit it can't be sure of, a refusal, a failed poll, a throw", async () => {
    const tryKept = async (setup: () => void, error: string | RegExp) => {
      steps.length = 0;
      setup();
      const out = await ask().catch((err: Error) => ({ error: err.message }));
      if (typeof error === "string") expect(out.error).toBe(error);
      else expect(out.error).toMatch(error);
      expect(count("give back try")).toBe(0);
      expect(count("give back")).toBe(1);
    };
    await tryKept(() => (submit = "unsure"), SET_EDIT_FAILED);
    await tryKept(() => (submit = "refused"), SET_EDIT_REFUSED);
    await tryKept(() => {
      submit = "ok";
      answer = { state: "failed", kind: "incomplete", detail: "max_output_tokens", usage: null, costUsd: 0.62 };
    }, SET_EDIT_FAILED);
    await tryKept(() => (submit = "throws"), /network down/);
  });

  it("gives nothing back for an admin, who reserved nothing, and still says so", async () => {
    access = { ...access, plan: "none", isAdmin: true };
    submit = "unbilled";
    expect(await ask()).toEqual({ error: SET_EDIT_UNAVAILABLE, editsLeft: null });
    expect(count("give back try")).toBe(0);
    expect(count("give back")).toBe(0);
  });

  it("gives back a rebuild's try and change the same way", async () => {
    rebuildOpen = true;
    const car = setElements(SPEC).find((e) => e.kind === "car")!;
    photos = [{ refId: "33333331-3333-4333-8333-333333333333", anchor: car.key, slot: 1, at: 1, url: "", path: `${USER}/sets/${SET}.ref.${car.key}.1.x.jpg` }];
    submit = "unbilled";
    expect(await rebuildThingFromPhotos(SET, car.key, PRESS)).toEqual({ error: SET_EDIT_UNAVAILABLE, editsLeft: setEditsMonthlyLimit("growth", false) - 2 });
    expect(count("give back try")).toBe(1);
    expect(count("give back")).toBe(1);
    steps.length = 0;
    submit = "unsure";
    expect((await rebuildThingFromPhotos(SET, car.key, LATER)).error).toBe(THING_REBUILD_FAILED);
    expect(count("give back try")).toBe(0);
    expect(count("give back")).toBe(1);
  });
});

// An answer the gate could not check (critic item 2): Astra answered and was
// billed, so the try stays counted — and the page never says "nothing was
// used" or that the change was refused.
describe("an answer the gate could not check", () => {
  it("gives the change back, keeps the try, saves nothing, and says it couldn't be checked", async () => {
    answerGateRefuses = true;
    answerGateReason = "unavailable";
    const out = await editSetWithAstra(SET, "make the first barrier brick red", PRESS);
    expect(out).toEqual({ error: SET_EDIT_ANSWER_UNCHECKED, editsLeft: setEditsMonthlyLimit("growth", false) - 2 });
    expect(steps.filter((x) => x === "give back")).toHaveLength(1);
    expect(steps).not.toContain("give back try");
    expect(writes).toEqual([]);
    expect(SET_EDIT_ANSWER_UNCHECKED).not.toMatch(/nothing was used|can't be made/i);
    // A reading that refused it is still the refusal's sentence.
    answerGateReason = "test";
    expect((await editSetWithAstra(SET, "make the first barrier brick red", LATER)).error).toBe(SET_EDIT_REFUSED);
  });
});

// One Astra job per press (astra-press.ts, 2026-09-25, Cut 1). Chromium
// silently resends a POST whose connection dropped, and the second delivery
// ran a whole second job: the gate, the pace, one more of the month's
// changes, a second Astra bill and a second save.
describe("one Astra job per press", () => {
  const ask = (press?: string) => editSetWithAstra(SET, "make the first barrier brick red", press);

  it("runs a press once: a repeat is answered at once, never gated, paced, counted or sent", async () => {
    expect((await ask(PRESS)).error).toBeNull();
    steps.length = 0;
    expect(await ask(PRESS)).toEqual({ error: SET_EDIT_STILL_WORKING, pending: true });
    expect(steps).toEqual(["claim"]);
    expect(sent).toHaveLength(1);
    expect(writes).toHaveLength(1);
    expect(limits.filter((l) => l.scope === SET_EDITS_MONTH_SCOPE)).toHaveLength(1);
    // A new press is a new job.
    expect((await ask(LATER)).error).toBeNull();
    expect(sent).toHaveLength(2);
  });

  it("sends two deliveries of one press arriving together to Astra once", async () => {
    const [a, b] = await Promise.all([ask(PRESS), ask(PRESS)]);
    expect(sent).toHaveLength(1);
    expect(writes).toHaveLength(1);
    expect([a, b].filter((r) => r.error === null)).toHaveLength(1);
    expect([a, b].filter((r) => r.error === SET_EDIT_STILL_WORKING && "pending" in r && r.pending === true)).toHaveLength(1);
  });

  it("claims after the free checks and before the gate", async () => {
    await ask(PRESS);
    expect(steps.slice(0, 3)).toEqual(["claim", "gate", "pace"]);
    steps.length = 0;
    edited = BIG;
    expect(await ask(LATER)).toEqual({ error: SET_EDIT_TOO_BIG });
    edited = null;
    expect(await editSetWithAstra(SET, "hi", LATER)).toEqual({ error: SET_BRIEF_TOO_SHORT });
    expect(steps).toEqual([]);
    // Refused for free, so the same press can still run.
    expect((await ask(LATER)).error).toBeNull();
  });

  it("leaves a 'saved' marker after the save, and 'unsaved' for everything that did not save", async () => {
    await ask(PRESS);
    expect(ends).toEqual([{ end: "saved", writes: 1 }]);
    expect(steps.at(-1)).toBe("end saved");

    const unsaved = async (setup: () => void, id: string) => {
      ends.length = 0;
      setup();
      await ask(id).catch(() => {});
      expect(ends.map((e) => e.end), id).toEqual(["unsaved"]);
    };
    await unsaved(() => {
      answer = { state: "failed", kind: "incomplete", detail: "max_output_tokens", usage: null, costUsd: 0.62 };
    }, "5f2a4b5c-6d7e-4f80-9a1b-2c3d4e5f6a7b");
    await unsaved(() => {
      answer = { state: "done", text: recoloured(), usage: null, costUsd: 0.31 };
      answerGateRefuses = true;
    }, "6f2a4b5c-6d7e-4f80-9a1b-2c3d4e5f6a7b");
    await unsaved(() => {
      answerGateRefuses = false;
      submit = "throws";
    }, "7f2a4b5c-6d7e-4f80-9a1b-2c3d4e5f6a7b");
    // The throw still reaches the page, marker written.
    await expect(ask("8f2a4b5c-6d7e-4f80-9a1b-2c3d4e5f6a7b")).rejects.toThrow("network down");
    expect(ends.at(-1)?.end).toBe("unsaved");
    // The person's words refused by the gate: nothing ran, the marker says so.
    submit = "ok";
    ends.length = 0;
    expect((await editSetWithAstra(SET, "something forbidden", "9f2a4b5c-6d7e-4f80-9a1b-2c3d4e5f6a7b")).error).toBe("Refused by the gate.");
    expect(ends.map((e) => e.end)).toEqual(["unsaved"]);
  });

  it("refuses a press whose claim can't be asked, as the pace does in the same outage", async () => {
    claimDown = true;
    expect(await ask(PRESS)).toEqual({ error: SET_EDIT_TOO_FAST });
    expect(steps).toEqual(["claim"]);
    expect(sent).toEqual([]);
  });

  it("serves a page that sends no id, or no usable one, as before", async () => {
    expect((await ask()).error).toBeNull();
    expect((await ask("not-a-uuid")).error).toBeNull();
    expect(steps).not.toContain("claim");
    expect(ends).toEqual([]);
    expect(sent).toHaveLength(2);
  });
});

// What became of a press, for the page after a dropped connection
// (astra-follow.ts, 2026-09-25).
// Undo that gives back Astra's words too (Helios Cut 2, step 2, 2026-09-25 —
// critic item 4): an undone change used to leave Astra's description on the
// set, where every later still read it.
// What the set's chat adds to a change it asks for (Helios Cut 2, step 10,
// 2026-09-25 — operator: "Run, keep going."; critic item 12): the reader's
// short gloss and where the person and the camera stand. Astra still reads
// the person's own words as the request; the gloss is the reader's, and a
// refusal it earns alone is never put on the person.
describe("a change from the set's chat: meaning and frame", () => {
  const SAID = "put a red Ferrari by the pit wall";
  const FRAME = { mark: { x: 1.234, z: -2.5, facingDeg: 90 }, camera: { position: [4, 1.5, 6], target: [1.2, 1, -2.5] } };
  /** A meaning as readShotTurn hands it on: with the server's seal over these words and this gloss (review of Cut 2, R1). */
  const sealed = (said: string, meaning: string) => ({ meaning, meaningSeal: sealReaderMeaning(SET, USER, said, meaning) });

  it("with nothing more, gates and sends exactly as before", async () => {
    expect((await editSetWithAstra(SET, SAID, PRESS)).error).toBeNull();
    expect(gated).toEqual([SAID]);
    expect(sent[0].input).toBe(setEditInput(SPEC, SAID));
    // An empty or unusable `more` is nothing more.
    gated.length = 0;
    sent.length = 0;
    expect((await editSetWithAstra(SET, SAID, LATER, { meaning: "  ", frame: { mark: { x: Number.NaN, z: 0, facingDeg: 0 } } })).error).toBeNull();
    expect(gated).toEqual([SAID]);
    expect(sent[0].input).toBe(setEditInput(SPEC, SAID));
  });

  it("sends the person's words as the request, then the reader's meaning, labelled, then the frame", async () => {
    const out = await editSetWithAstra(SET, SAID, PRESS, { ...sealed(SAID, "a red sports car by the pit wall"), frame: FRAME });
    expect(out.error).toBeNull();
    const input = String(sent[0].input);
    expect(input).toContain(`The change request:\n${SAID}\n\n`);
    expect(input).toContain("What they mean, as read by the page (not their words): a red sports car by the pit wall");
    expect(input).toContain("Where the person stands now (never add a person): x 1.23, z -2.5, facing 90°. The camera now: (4, 1.5, 6) → (1.2, 1, -2.5).");
    expect(input.indexOf(SAID)).toBeLessThan(input.indexOf("What they mean"));
    // The gate read their words and the meaning together.
    expect(gated).toEqual([`${SAID}\na red sports car by the pit wall`]);
  });

  it("puts a refusal the reader's meaning earns on its own under the reader, never on the person", async () => {
    const out = await editSetWithAstra(SET, SAID, PRESS, sealed(SAID, "something forbidden by the wall"));
    expect(out.error).toBe("Refused by the gate.");
    expect(refusals).toEqual([{ prompt: `${SAID}\nsomething forbidden by the wall`, provider: "reader" }]);
    // Refused before the pace, the month and Astra: nothing is spent.
    expect(steps).toEqual(["claim", "gate", "end unsaved"]);
    expect(sent).toEqual([]);
  });

  it("puts a refusal of the person's own words on the person, as it always was", async () => {
    const out = await editSetWithAstra(SET, "put something forbidden by the wall", PRESS, sealed("put something forbidden by the wall", "a thing by the wall"));
    expect(out.error).toBe("Refused by the gate.");
    expect(refusals).toEqual([{ prompt: "put something forbidden by the wall\na thing by the wall", provider: null }]);
    // With no meaning there is no attribution: their words, counted.
    refusals.length = 0;
    await editSetWithAstra(SET, "put something forbidden by the wall", LATER);
    expect(refusals).toEqual([{ prompt: "put something forbidden by the wall", provider: null }]);
  });

  it("holds the meaning to its cap and the frame to the set", async () => {
    const long = "a row of small flags ".repeat(20);
    await editSetWithAstra(SET, SAID, PRESS, {
      ...sealed(SAID, long),
      // The figure off the set: no frame at all.
      frame: { mark: { x: SPEC.bounds.x, z: 0, facingDeg: 0 }, camera: FRAME.camera },
    });
    const input = String(sent[0].input);
    const line = input.slice(input.indexOf("What they mean"));
    expect(Array.from(line.slice(line.indexOf(": ") + 2)).length).toBeLessThanOrEqual(SET_EDIT_MEANING_MAX_CHARS);
    expect(input).not.toContain("Where the person stands");
    // A camera out of reach is left out; the figure still rides.
    sent.length = 0;
    await editSetWithAstra(SET, SAID, LATER, { frame: { mark: FRAME.mark, camera: { position: [0, SPEC.bounds.height * 3, 0], target: [0, 1, 0] } } });
    const input2 = String(sent[0].input);
    expect(input2).toContain("Where the person stands now (never add a person): x 1.23, z -2.5, facing 90°.");
    expect(input2).not.toContain("The camera now");
  });

  // Review of Cut 2, R1 (2026-09-25): `more.meaning` came from the browser
  // and was judged as the reader's, so any account could send its own words
  // there and have their refusals logged under "reader", never counted.
  it("drops a meaning without the reader's seal, or with one for other words, another set or another person: gated and sent as their words alone", async () => {
    const forged = [
      { meaning: "something forbidden by the wall" },
      { meaning: "something forbidden by the wall", meaningSeal: "x".repeat(32) },
      { meaning: "something forbidden by the wall", meaningSeal: sealReaderMeaning(SET, USER, SAID, "a harmless gloss") },
      { meaning: "something forbidden by the wall", meaningSeal: sealReaderMeaning(SET, USER, "other words", "something forbidden by the wall") },
      { meaning: "something forbidden by the wall", meaningSeal: sealReaderMeaning("33333333-3333-4333-8333-333333333333", USER, SAID, "something forbidden by the wall") },
      { meaning: "something forbidden by the wall", meaningSeal: sealReaderMeaning(SET, "44444444-4444-4444-8444-444444444444", SAID, "something forbidden by the wall") },
    ];
    for (const [i, more] of forged.entries()) {
      gated.length = 0;
      sent.length = 0;
      refusals.length = 0;
      const out = await editSetWithAstra(SET, SAID, `${PRESS.slice(0, -2)}${String(10 + i)}`, more);
      expect(out.error).toBeNull();
      // Exactly the gate and the request of a change with nothing more.
      expect(gated).toEqual([SAID]);
      expect(sent[0].input).toBe(setEditInput(SPEC, SAID));
      expect(refusals).toEqual([]);
    }
    // And a forged meaning on words the gate refuses is the person's refusal, counted.
    refusals.length = 0;
    await editSetWithAstra(SET, "put something forbidden by the wall", LATER, { meaning: "a thing by the wall", meaningSeal: "y".repeat(32) });
    expect(refusals).toEqual([{ prompt: "put something forbidden by the wall", provider: null }]);
  });

  it("lets the meaning reach the gate only inside the reader's attribution (read as source)", () => {
    const src = readFileSync(join(__dirname, "editor-actions.ts"), "utf8");
    const body = src.slice(src.indexOf("export async function editSetWithAstra("), src.indexOf("export async function rebuildThingFromPhotos("));
    const gates = [...body.matchAll(/gatePrompt\(\{ prompt: [^\n]*?hasRealPersonReference: false \}\)/g)].map((m) => m[0]);
    expect(gates).toHaveLength(2);
    // The one that carries the meaning sits inside withModelWrittenPrompt, under "reader".
    const withMeaning = gates.filter((g) => g.includes("meaning"));
    expect(withMeaning).toHaveLength(1);
    const at = body.indexOf(withMeaning[0]);
    const opened = body.lastIndexOf("withModelWrittenPrompt(", at);
    expect(opened).toBeGreaterThan(-1);
    expect(body.slice(opened, at)).toContain('provider: "reader"');
    // The other is exactly today's call.
    expect(gates).toContain("gatePrompt({ prompt: text, userId, hasRealPersonReference: false })");
  });
});

describe("undoing an Astra change", () => {
  /** Astra's answer: the first barrier red, and new words for the set. */
  const flagged = (): string =>
    JSON.stringify({
      ...SPEC,
      title: "Flagged circuit",
      description: "A race track lined with a row of flags along the pit wall.",
      objects: SPEC.objects.map((o, i) => (i === 0 ? { ...o, color: "#aa3322" } : o)),
    });
  /** The copy the last update wrote. */
  const lastWrite = () => (writes[writes.length - 1] as { edited_spec: SetSpec }).edited_spec;

  it("seals the words of the copy Astra was handed", async () => {
    answer = { state: "done", text: flagged(), usage: null, costUsd: 0.31 };
    const out = await editSetWithAstra(SET, "add a row of flags along the pit wall");
    if (out.error !== null) throw new Error(out.error);
    expect(out.undo).not.toBeNull();
    expect(out.undo!.text).toEqual(editTextOf(SPEC));
    expect(openEditSeal(SET, USER, out.undo!.text, out.undo!.seal)).toBe(true);
    expect(out.spec.description).toBe("A race track lined with a row of flags along the pit wall.");
  });

  it("with the seal, brings the words back — and the next still reads the description from before", async () => {
    answer = { state: "done", text: flagged(), usage: null, costUsd: 0.31 };
    const out = await editSetWithAstra(SET, "add a row of flags along the pit wall");
    if (out.error !== null) throw new Error(out.error);
    // The server now holds Astra's copy.
    edited = out.spec;
    steps.length = 0;
    sent.length = 0;
    const undone = await undoAstraEdit(SET, SPEC, out.undo);
    expect(undone).toMatchObject({ error: null, textRestored: true });
    const saved = lastWrite();
    expect(saved.title).toBe(SPEC.title);
    expect(saved.description).toBe(SPEC.description);
    expect(saved.objects).toEqual(SPEC.objects);
    if (undone.error === null) expect(undone.spec).toEqual(saved);
    // What a still is told of the place is the set's description (actions.ts shootStill).
    const prompt = buildSetShotPrompt({ description: saved.description, direction: "" });
    expect(prompt).toContain(SPEC.description);
    expect(prompt).not.toContain("flags");
    // Never Astra, never the month.
    expect(sent).toHaveLength(0);
    for (const step of ["astra", "pace", "month", "tries", "count", "give back", "claim"]) expect(steps, step).not.toContain(step);
    expect(steps).toEqual(["set-edit"]);
  });

  it("without a seal that opens, brings the pieces back and keeps the server's words", async () => {
    answer = { state: "done", text: flagged(), usage: null, costUsd: 0.31 };
    const out = await editSetWithAstra(SET, "add a row of flags along the pit wall");
    if (out.error !== null) throw new Error(out.error);
    edited = out.spec;
    const forged = { text: { ...out.undo!.text, description: "Anything the page likes." }, seal: out.undo!.seal };
    for (const undo of [undefined, null, forged, { text: out.undo!.text, seal: "x".repeat(32) }]) {
      const undone = await undoAstraEdit(SET, SPEC, undo);
      expect(undone, JSON.stringify(undo)).toMatchObject({ error: null, textRestored: false });
      const saved = lastWrite();
      expect(saved.objects).toEqual(SPEC.objects);
      expect(saved.description).toBe("A race track lined with a row of flags along the pit wall.");
      expect(saved.title).toBe("Flagged circuit");
    }
    expect(sent).toHaveLength(1);
  });

  it("says the words are back when Astra never changed them, seal or not", async () => {
    // The default answer recolours a barrier and keeps the set's words.
    const out = await editSetWithAstra(SET, "make the first barrier brick red");
    if (out.error !== null) throw new Error(out.error);
    edited = out.spec;
    expect(await undoAstraEdit(SET, SPEC, null)).toMatchObject({ error: null, textRestored: true });
    expect(lastWrite().description).toBe(SPEC.description);
  });

  it("keeps to the editor's pace, and to the person's own set", async () => {
    limited["set-edit"] = true;
    expect(await undoAstraEdit(SET, SPEC, null)).toEqual({ error: SET_SAVE_FAILED });
    expect(writes).toEqual([]);
    limited = {};
    expect(await undoAstraEdit("not-a-set", SPEC, null)).toEqual({ error: SET_NOT_FOUND });
    expect(await undoAstraEdit(SET, { not: "a set" }, null)).toEqual({ error: SET_SAVE_FAILED });
    access = { error: SETS_SESSION_EXPIRED } as never;
    expect(await undoAstraEdit(SET, SPEC, null)).toEqual({ error: SETS_SESSION_EXPIRED });
    expect(writes).toEqual([]);
  });

  it("never asks Astra or the month (read as source)", () => {
    const src = readFileSync(join(__dirname, "editor-actions.ts"), "utf8");
    const body = src.slice(src.indexOf("export async function undoAstraEdit("), src.indexOf("\n}\n", src.indexOf("export async function undoAstraEdit(")));
    for (const call of ["askAstra(", "astraChangeSlot(", "giveBackAstraChange(", "oncePerPress(", "submitAstraJob("]) expect(body, call).not.toContain(call);
    expect(body.indexOf("await setsAccess()")).toBeGreaterThan(-1);
    expect(body).toContain('if (await rateLimited(access.userId, "set-edit", 60, 40)) return { error: SET_SAVE_FAILED };');
  });
});

describe("readAstraEdit", () => {
  const RECOLOURED: SetSpec = JSON.parse(recoloured()) as SetSpec;

  it("asks who is asking first, and reads nothing for a stranger", async () => {
    access = { error: SETS_SESSION_EXPIRED } as unknown as Access;
    expect(await readAstraEdit(SET, PRESS)).toEqual({ error: SETS_SESSION_EXPIRED });
    expect(steps).toEqual([]);
  });

  it("knows no press without a usable id", async () => {
    expect(await readAstraEdit(SET, "not-a-uuid")).toEqual({ error: SET_NOT_FOUND });
    expect(await readAstraEdit("not-a-set", PRESS)).toEqual({ error: SET_NOT_FOUND });
  });

  it("hands back the working copy as saved and where the press stands, and the count only once it has ended", async () => {
    pressState = "running";
    expect(await readAstraEdit(SET, PRESS)).toEqual({ error: null, press: "running", spec: SPEC });
    expect(steps).not.toContain("left");
    edited = RECOLOURED;
    for (const press of ["saved", "unsaved", "lost"] as const) {
      pressState = press;
      const r = await readAstraEdit(SET, PRESS);
      expect(r).toMatchObject({ error: null, press, editsLeft: 7 });
      if (r.error === null) expect(r.spec.objects[0].color).toBe("#aa3322");
    }
    for (const press of ["none", "unread"] as const) {
      pressState = press;
      expect("editsLeft" in (await readAstraEdit(SET, PRESS))).toBe(false);
    }
  });

  it("reads the press before the set, so a 'saved' never comes with the copy from before the save", async () => {
    pressState = "saved";
    onReadPress = () => {
      edited = JSON.parse(recoloured()) as SetSpec;
    };
    const r = await readAstraEdit(SET, PRESS);
    expect(r.error).toBeNull();
    if (r.error === null) expect(r.spec.objects[0].color).toBe("#aa3322");
  });
});

// A thing rebuilt from its photos (thing-rebuild.ts, 2026-09-24): Astra sees
// the thing's blocks and its photos, and answers with the thing's new blocks.
describe("a thing rebuilt from its photos", () => {
  const car = setElements(SPEC).find((e) => e.kind === "car")!;
  const onCar = (slot: 1 | 2) => ({ refId: `3333333${slot}-3333-4333-8333-333333333333`, anchor: car.key, slot, at: slot, url: "", path: `${USER}/sets/${SET}.ref.${car.key}.${slot}.x.jpg` });
  const blue = () => JSON.stringify({ objects: thingLocalBlocks(SPEC, car).map((o) => (o.material === "paint" ? { ...o, color: "#1d4fb8" } : o)) });

  it("is an admin's while the first live rebuild is owed, and asks nothing of anyone else", async () => {
    photos = [onCar(1)];
    expect(await rebuildThingFromPhotos(SET, car.key)).toEqual({ error: THING_REBUILD_ADMINS_ONLY });
    expect(steps).toEqual([]);
  });

  it("needs a photo on the thing before it spends a change", async () => {
    access.isAdmin = true;
    expect(await rebuildThingFromPhotos(SET, car.key)).toEqual({ error: THING_REBUILD_NO_PHOTOS });
    expect(steps).toEqual([]);
  });

  it("claims a press once: the same press delivered twice asks Astra once", async () => {
    access.isAdmin = true;
    photos = [onCar(1)];
    answer = { state: "done", text: blue(), usage: null, costUsd: 0.2 };
    expect((await rebuildThingFromPhotos(SET, car.key, PRESS)).error).toBeNull();
    expect(await rebuildThingFromPhotos(SET, car.key, PRESS)).toEqual({ error: SET_EDIT_STILL_WORKING, pending: true });
    expect(sent).toHaveLength(1);
    expect(writes).toHaveLength(1);
    // The claim comes before the photos are read, so a repeat reads none.
    expect(storage.filter((x) => x.startsWith("download"))).toHaveLength(1);
    expect(ends.map((e) => e.end)).toEqual(["saved"]);
  });

  it("stays saved when the kept model's move throws after the save", async () => {
    access.isAdmin = true;
    photos = [onCar(1)];
    modelFiles = [{ path: `${USER}/sets/${SET}.model.${car.key}.abc.f.glb`, key: car.key, at: 1790205070123, flip: true }];
    moveThrows = true;
    answer = { state: "done", text: blue(), usage: null, costUsd: 0.2 };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await rebuildThingFromPhotos(SET, car.key, PRESS);
    warn.mockRestore();
    expect(r.error).toBeNull();
    expect(writes).toHaveLength(1);
    expect(ends).toEqual([{ end: "saved", writes: 1 }]);
    expect(steps).not.toContain("give back");
  });

  it("counts against the month only when it saves: new blocks that don't fit give the change back", async () => {
    // As a Growth plan will meet it once the rebuild opens (THING_REBUILD_OPEN_TO_ALL).
    rebuildOpen = true;
    photos = [onCar(1)];
    const apart = thingLocalBlocks(SPEC, car).map((o, i) => (i === 0 ? { ...o, position: [40, 0.5, 40] } : o));
    answer = { state: "done", text: JSON.stringify({ objects: apart }), usage: null, costUsd: 0.2 };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await rebuildThingFromPhotos(SET, car.key, PRESS)).toEqual({ error: THING_REBUILD_DIDNT_FIT, editsLeft: setEditsMonthlyLimit("growth", false) - 2 });
    warn.mockRestore();
    expect(steps.filter((x) => x === "give back")).toHaveLength(1);
    expect(ends.map((e) => e.end)).toEqual(["unsaved"]);
    // A rebuild that saves keeps its change.
    steps.length = 0;
    answer = { state: "done", text: blue(), usage: null, costUsd: 0.2 };
    expect((await rebuildThingFromPhotos(SET, car.key, LATER)).error).toBeNull();
    expect(steps).not.toContain("give back");
    expect(steps).toEqual(["claim", "pace", "month", "tries", "count", "astra", "end saved"]);
  });

  it("gives the change back when the call throws, and passes the throw on", async () => {
    rebuildOpen = true;
    photos = [onCar(1)];
    submit = "throws";
    await expect(rebuildThingFromPhotos(SET, car.key, PRESS)).rejects.toThrow("network down");
    expect(steps.filter((x) => x === "give back")).toHaveLength(1);
    expect(ends.map((e) => e.end)).toEqual(["unsaved"]);
  });

  it("rebuilds a thing on a set too big for a chat edit: only the thing is sent", async () => {
    access.isAdmin = true;
    photos = [onCar(1)];
    const box = SPEC.objects.find((o) => o.shape === "box")!;
    // Seventy small boxes far from the car, apart from each other and from it.
    const far = Array.from({ length: 70 }, (_, i) => ({ ...box, repeat: null, size: [0.5, 0.5, 0.5] as [number, number, number], position: [-80 + i * 2, 0.25, 80] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] }));
    const grown = normaliseSetSpec({ ...SPEC, objects: [...SPEC.objects, ...far] });
    if (!grown.ok) throw new Error("grown");
    edited = grown.spec;
    expect(JSON.stringify(edited).length).toBeGreaterThan(SET_EDIT_MAX_SPEC_CHARS);
    const carThere = setElements(edited).find((e) => e.key === car.key)!;
    expect(JSON.stringify(thingLocalBlocks(edited, carThere))).toBe(JSON.stringify(thingLocalBlocks(SPEC, car)));
    answer = { state: "done", text: blue(), usage: null, costUsd: 0.2 };
    const r = await rebuildThingFromPhotos(SET, car.key);
    expect(r.error).toBeNull();
    expect(steps).toContain("astra");
    expect(writes).toHaveLength(1);
    // A chat edit of the same set is still refused whole.
    expect(await editSetWithAstra(SET, "make the first barrier brick red")).toEqual({ error: SET_EDIT_TOO_BIG });
  });

  it("refuses a thing too detailed to send whole, before anything is read, claimed or spent", async () => {
    access.isAdmin = true;
    // The car's own objects again where they stand: they join the car.
    const carObjects = [...new Set(car.members.map(([oi]) => oi))].map((oi) => SPEC.objects[oi]);
    const doubled = normaliseSetSpec({ ...SPEC, objects: [...SPEC.objects, ...carObjects] });
    if (!doubled.ok) throw new Error("doubled");
    edited = doubled.spec;
    const probe: ElementPhoto = { refId: "00000000-0000-4000-8000-000000000000", anchor: car.key, slot: 1, at: 0, url: "" };
    const els = setElements(edited);
    const found = els.find((e) => e.key === resolvePhotos(els, [probe]).held[0]?.key)!;
    expect(JSON.stringify(thingLocalBlocks(edited, found)).length).toBeGreaterThan(THING_REBUILD_MAX_SENT_CHARS);
    photos = [{ ...onCar(1), anchor: found.key }];
    expect(await rebuildThingFromPhotos(SET, car.key, PRESS)).toEqual({ error: THING_REBUILD_TOO_BIG });
    expect(steps).toEqual([]);
    expect(storage.filter((x) => x.startsWith("download"))).toEqual([]);
  });

  it("sends the thing's blocks and every photo on it, and saves the new blocks where the old ones stood", async () => {
    access.isAdmin = true;
    photos = [onCar(1), onCar(2)];
    answer = { state: "done", text: blue(), usage: null, costUsd: 0.2 };
    const r = await rebuildThingFromPhotos(SET, car.key);
    expect(r.error).toBeNull();
    if (r.error !== null) return;
    // The pace, then Astra: an admin's month has no cap.
    expect(steps).toEqual(["pace", "astra"]);
    expect(storage.filter((x) => x.startsWith("download generated-images"))).toHaveLength(2);
    const parts = (sent[0].input as { content: { type: string }[] }[])[0].content;
    expect(parts.filter((p) => p.type === "input_image")).toHaveLength(2);
    expect(r.key).not.toBe(car.key);
    expect(setElements(r.spec).find((e) => e.key === r.key)?.kind).toBe("car");
    expect(writes).toHaveLength(1);
    expect(r.changed).toBeGreaterThan(0);
  });

  it("leaves the set as it was when the new blocks would not be one thing where the old one stood", async () => {
    access.isAdmin = true;
    photos = [onCar(1)];
    const apart = thingLocalBlocks(SPEC, car).map((o, i) => (i === 0 ? { ...o, position: [40, 0.5, 40] } : o));
    answer = { state: "done", text: JSON.stringify({ objects: apart }), usage: null, costUsd: 0.2 };
    expect(await rebuildThingFromPhotos(SET, car.key)).toMatchObject({ error: THING_REBUILD_DIDNT_FIT });
    expect(writes).toHaveLength(0);
  });

  it("takes a model file kept on the thing along to its new key", async () => {
    access.isAdmin = true;
    photos = [onCar(1)];
    modelFiles = [{ path: `${USER}/sets/${SET}.model.${car.key}.abc.f.glb`, key: car.key, at: 1790205070123, flip: true }];
    answer = { state: "done", text: blue(), usage: null, costUsd: 0.2 };
    const r = await rebuildThingFromPhotos(SET, car.key);
    if (r.error !== null) throw new Error(r.error);
    const moved = storage.find((x) => x.startsWith("move generated-videos"));
    expect(moved).toContain(`.model.${r.key}.`);
    expect(moved?.endsWith(".f.glb")).toBe(true);
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
    expect(editor).toContain("<span className=\"text-[#c6c9d1]\">{localizeServerText(SET_EDIT_TOO_BIG, t)}</span>");
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
    expect(cap).toBeLessThan(send.indexOf("r = await editSetWithAstra(setId, text, pressId);"));
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

  it("never stays on 'Astra is changing the set…' when the call throws, and reads back what was saved", () => {
    expect(send).toContain("const pressId = newPressId();");
    expect(send).toMatch(/try \{\s*r = await editSetWithAstra\(setId, text, pressId\);\s*\} catch \(err\) \{/);
    expect(send).toMatch(/\} finally \{\s*setAsking\(false\);\s*\}/);
    // A stale deploy keeps the copy and says to refresh, as before.
    expect(send).toMatch(/if \(isStaleDeployError\(err\)\) \{\s*saveMissed\(specRef\.current, err\);\s*setAskError\(t\.generate\.refreshNeeded\);\s*return;\s*\}/);
    // Anything else is followed (astra-follow.ts), inside the busy state.
    const follow = send.indexOf("followed = await followAstraEdit(() => readAstraEdit(setId, pressId).catch((thrown: unknown) => ({ thrown })), {");
    expect(follow).toBeGreaterThan(-1);
    expect(follow).toBeLessThan(send.indexOf("setAsking(false);\n    }"));
    expect(send).toContain("if (r === null || (r.error !== null && r.pending)) {");
    // "Try again" only when nothing reached the server.
    expect(send).toContain('} else if (followed.kind === "none") setAskError(t.generate.submitFailed);');
    expect(send.match(/t\.generate\.submitFailed/g)).toHaveLength(1);
    expect(send).not.toContain("setAskError(stale ? t.generate.refreshNeeded : t.generate.submitFailed);");
    // A saved press lands like an answered one: history, the counter, the note.
    expect(send).toMatch(/if \(followed\.kind === "saved"\) \{\s*setAsk\(""\);\s*commitFromServer\(followed\.spec\);\s*dropUnsaved\(setId, "edit", askedAt\);\s*setAskNote\(followed\.changed\);/);
    expect(send).toContain("followed.editsLeft !== undefined) setEditsLeft(followed.editsLeft);");
  });

  it("is handed the count by the set page", () => {
    expect(readFileSync(join(__dirname, "../../app/app/sets/[id]/page.tsx"), "utf8")).toContain("astraEditsLeft={data.astraEditsLeft}");
  });
});
