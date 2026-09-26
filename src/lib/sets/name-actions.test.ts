import { beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import raceTrack from "./fixtures-race-track.json";
import { setElements, setParts, thingNameOf } from "./elements";
import {
  SET_NAMING_ADMINS_ONLY,
  SET_NAMING_FAILED,
  SET_NAMING_REFUSED,
  SET_NAMING_STILL_WORKING,
  SET_NAMING_TOO_FAST,
  SET_NAMING_UNCHECKED,
  SET_NOT_READY,
  SET_SAVE_FAILED,
} from "./messages";
import { NAME_INSTRUCTIONS, NAME_MAX_COMPLETION } from "./name-prompt";
import { SET_EDITS_MONTH_SCOPE, SET_EDIT_TRIES_MONTH_SCOPE, SET_NAMING_AUTO, SET_NAMING_PER_HOUR } from "./set-config";
import { normaliseSetSpec, specTextForGate, type SetSpec } from "./set-spec";

// The naming pass (Helios Cut 4, step B4, 2026-09-26): a new paid call,
// admins only, once per press, behind a brake; the names checked in the
// strict lane before they are saved, and saved by block onto both stored
// copies. name-actions.ts imports through "@/", which this suite does not
// resolve: the session, the database, the limiter, the gate and the model
// are stood in for; the Sets modules are the real ones.

const USER = "11111111-1111-4111-8111-111111111111";
const SET = "22222222-2222-4222-8222-222222222222";
const PRESS = "33333333-3333-4333-8333-333333333333";

const n = normaliseSetSpec(raceTrack);
if (!n.ok) throw new Error("fixture");
const SPEC: SetSpec = n.spec;
/** Astra's original as stored: the fixture's own JSON, with a field no reader reads, so its other bytes can be seen to stay. */
const RAW = { ...(raceTrack as Record<string, unknown>), stored: "as built" };

type Access = { error: null; supabase: unknown; userId: string; plan: string; isAdmin: boolean; periodStart: string | null } | { error: string };
let access: Access;
let status: string;
/** The working copy each read of it returns, in turn (the last one repeats). */
let editedReads: (SetSpec | null)[];
let saveFails: boolean;
let limited: boolean;
let claim: "first" | "repeat" | "unavailable";
let answer: { text: string; usage: { prompt: number | null; cached: number | null; completion: number | null; model: string; reasoning: number | null; finish: string | null }; effort: "none" | "default" } | null;
let gate: "allow" | "refuse" | "unavailable";
const steps: string[] = [];
const writes: Record<string, unknown>[] = [];
const scopes: string[] = [];
const asked: { messages: unknown; opts: Record<string, unknown> }[] = [];
const gated: string[] = [];
const refusals: { provider: string | null; strictLane: boolean }[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      expect(table).toBe("location_sets");
      let cols = "";
      const builder = {
        select: (c: string) => ((cols = c), builder),
        eq: () => builder,
        is: () => builder,
        maybeSingle: async () => {
          if (cols === "edited_spec") {
            steps.push("read copy");
            const e = editedReads.length > 1 ? editedReads.shift()! : editedReads[0];
            return { data: { edited_spec: e }, error: null };
          }
          steps.push("read set");
          return { data: { status, spec: RAW, brief: "A race track with a red car" }, error: null };
        },
        update: (values: Record<string, unknown>) => {
          steps.push("save");
          if (!saveFails) writes.push(values);
          const done = { eq: () => done, is: async () => ({ error: saveFails ? { message: "timeout" } : null }) };
          return done;
        },
      };
      return builder;
    },
  }),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimited: async (_user: string, scope: string, windowSeconds: number, max: number) => {
    steps.push("brake");
    scopes.push(`${scope} ${windowSeconds} ${max}`);
    return limited;
  },
}));
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
  assertPromptAllowed: async ({ prompt, hasRealPersonReference }: { prompt: string; hasRealPersonReference: boolean }) => {
    steps.push("gate");
    gated.push(prompt);
    expect(hasRealPersonReference).toBe(true);
    if (gate !== "allow") {
      const { ContentPolicyRefusal } = await import("@/lib/generations/content-policy");
      throw new ContentPolicyRefusal(gate === "unavailable" ? "unavailable" : ("sexual" as never), "Refused by the gate.");
    }
  },
}));
vi.mock("@/lib/generations/policy-log", () => ({
  recordPolicyRefusal: async (r: { provider?: string | null; strictLane?: boolean }) => {
    refusals.push({ provider: r.provider ?? null, strictLane: r.strictLane === true });
  },
}));
vi.mock("@/lib/sets/access", () => ({
  setsAccess: async () => access,
  UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
}));
vi.mock("@/lib/sets/astra-press", async () => ({
  ...(await import("./astra-press")),
  claimNamingPress: async (_admin: unknown, _user: string, id: string) => {
    steps.push("claim");
    expect(id).toBe(PRESS);
    return claim;
  },
}));
vi.mock("@/lib/sets/shot-words", async () => ({
  ...(await import("./shot-words")),
  askShotReader: async (messages: unknown, opts: Record<string, unknown>) => {
    steps.push("model");
    asked.push({ messages, opts });
    return answer;
  },
}));
vi.mock("@/lib/sets/edit-seal", async () => await import("./edit-seal"));
vi.stubEnv("MEDIA_SIGNING_SECRET", "test-only");
vi.mock("@/lib/sets/editor-model", async () => await import("./editor-model"));
vi.mock("@/lib/sets/messages", async () => await import("./messages"));
vi.mock("@/lib/sets/name-prompt", async () => await import("./name-prompt"));
vi.mock("@/lib/sets/reader-prices", async () => await import("./reader-prices"));
vi.mock("@/lib/sets/set-config", async () => await import("./set-config"));
vi.mock("@/lib/sets/set-spec", async () => await import("./set-spec"));

import { nameSet } from "./name-actions";

const ADMIN: Access = { error: null, supabase: {}, userId: USER, plan: "elite", isAdmin: true, periodStart: null };
const usage = { model: "gpt-5.4-mini", prompt: 1500, cached: 0, completion: 300, reasoning: 0, finish: "stop" };
const says = (names: Record<string, string | null>) => ({
  text: JSON.stringify({ names: Object.entries(names).map(([alias, name]) => ({ alias, name })) }),
  usage,
  effort: "none" as const,
});
const RACE_NAMES = { t1: "red sports car", o11: "grandstand", o16: "grandstand", o4: "barriers", o7: null };

beforeEach(() => {
  access = ADMIN;
  status = "ready";
  editedReads = [null];
  saveFails = false;
  limited = false;
  claim = "first";
  answer = says(RACE_NAMES);
  gate = "allow";
  for (const xs of [steps, writes, scopes, asked, gated, refusals] as unknown[][]) xs.length = 0;
});

describe("who may name a set, and when", () => {
  it("admins only, checked before the set is read or anything is spent", async () => {
    access = { ...ADMIN, isAdmin: false };
    expect(await nameSet(SET, PRESS)).toEqual({ error: SET_NAMING_ADMINS_ONLY });
    expect(steps).toEqual([]);
    access = { error: "Your session expired — please log in again." };
    expect(await nameSet(SET, PRESS)).toEqual({ error: "Your session expired — please log in again." });
    expect(steps).toEqual([]);
  });

  it("a set still building is not named", async () => {
    status = "building";
    expect(await nameSet(SET, PRESS)).toEqual({ error: SET_NOT_READY });
    expect(steps).toEqual(["read set"]);
  });

  it("once per press: a resent delivery, a press without an id, or a claim that can't be asked spends nothing", async () => {
    claim = "repeat";
    expect(await nameSet(SET, PRESS)).toEqual({ error: SET_NAMING_STILL_WORKING });
    claim = "unavailable";
    expect(await nameSet(SET, PRESS)).toEqual({ error: SET_NAMING_TOO_FAST });
    claim = "first";
    expect(await nameSet(SET)).toEqual({ error: SET_NAMING_FAILED });
    expect(await nameSet(SET, "not-a-uuid")).toEqual({ error: SET_NAMING_FAILED });
    expect(asked).toEqual([]);
    expect(steps.filter((s) => s === "brake" || s === "model")).toEqual([]);
  });

  it("behind a brake of SET_NAMING_PER_HOUR an hour, its own bucket, and never the month's", async () => {
    limited = true;
    expect(await nameSet(SET, PRESS)).toEqual({ error: SET_NAMING_TOO_FAST });
    expect(asked).toEqual([]);
    expect(scopes).toEqual([`set-name 3600 ${SET_NAMING_PER_HOUR}`]);
    expect(SET_NAMING_PER_HOUR).toBe(10);
    limited = false;
    await nameSet(SET, PRESS);
    expect(scopes.every((s) => s.startsWith("set-name "))).toBe(true);
    expect(scopes.some((s) => s.startsWith(SET_EDITS_MONTH_SCOPE) || s.startsWith(SET_EDIT_TRIES_MONTH_SCOPE))).toBe(false);
  });
});

describe("a press", () => {
  it("claims, brakes, asks once, checks the names in the strict lane, then saves them on Astra's original by block", async () => {
    const res = await nameSet(SET, PRESS);
    expect(steps).toEqual(["read set", "read copy", "claim", "brake", "model", "gate", "read set", "read copy", "save"]);
    // One call, through the reader's own client and format, with the pass's cap and its log tag.
    expect(asked).toHaveLength(1);
    expect(asked[0].opts).toEqual({ maxCompletionTokens: NAME_MAX_COMPLETION, reader: "naming" });
    const messages = asked[0].messages as { role: string; content: string }[];
    expect(messages[0]).toEqual({ role: "system", content: NAME_INSTRUCTIONS });
    expect(messages[1].content).toContain("BRIEF: A race track with a red car");
    if (res.error !== null) throw new Error(res.error);
    expect(res.named).toBe(4);
    // What the gate read: every word of the set, the names with them.
    expect(gated).toEqual([specTextForGate(res.spec)]);
    expect(gated[0]).toContain("grandstand");
    // No working copy: Astra's original takes the names, as stored — its other bytes don't move.
    expect(writes).toHaveLength(1);
    expect(Object.keys(writes[0]).sort()).toEqual(["spec", "updated_at"]);
    const saved = writes[0].spec as Record<string, unknown> & { objects: Record<string, unknown>[] };
    expect(saved.stored).toBe("as built");
    const raw = RAW as unknown as { objects: Record<string, unknown>[] };
    saved.objects.forEach((o, i) => {
      const { name, ...rest } = o;
      expect(rest, `object ${i}`).toEqual(raw.objects[i]);
      expect(name === undefined || typeof name === "string").toBe(true);
    });
    // Read back, the set is named: the car, and its parts.
    const back = normaliseSetSpec(saved);
    if (!back.ok) throw new Error("saved set");
    expect(back.spec).toEqual(res.spec);
    const els = setElements(back.spec);
    expect(thingNameOf(els[0], back.spec)).toBe("red sports car");
    expect(setParts(back.spec, els).map((p) => p.name)).toEqual(["barriers", "grandstand"]);
    expect(els.map((e) => e.key)).toEqual(setElements(SPEC).map((e) => e.key));
  });

  it("with a working copy, names it too, and only the blocks still as the model saw them", async () => {
    // A copy with the grandstand's roof (object 16) lowered; between the read and the save, the barriers (object 4) move.
    const copy = { ...SPEC, objects: SPEC.objects.map((o, i) => (i === 16 ? { ...o, position: [o.position[0], 15, o.position[2]] as typeof o.position } : o)) };
    const moved = { ...copy, objects: copy.objects.map((o, i) => (i === 4 ? { ...o, position: [o.position[0] + 1, o.position[1], o.position[2]] as typeof o.position } : o)) };
    editedReads = [copy, moved];
    const res = await nameSet(SET, PRESS);
    if (res.error !== null) throw new Error(res.error);
    expect(Object.keys(writes[0]).sort()).toEqual(["edited_spec", "spec", "updated_at"]);
    const edited = writes[0].edited_spec as SetSpec;
    expect(edited.objects[11].name).toBe("grandstand");
    expect(edited.objects[16].name).toBe("grandstand");
    // Moved after the model read it: no longer the block it named.
    expect(edited.objects[4].name).toBeUndefined();
    expect(res.spec).toEqual(edited);
    // Astra's original: its roof is not the block the copy has, so only the blocks that are the same take the names.
    const original = normaliseSetSpec(writes[0].spec);
    if (!original.ok) throw new Error("original");
    expect(original.spec.objects[16].name).toBeUndefined();
    expect(original.spec.objects[11].name).toBe("grandstand");
    expect(original.spec.objects[4].name).toBe("barriers");
  });

  it("a name already there that the model answers null for stays; a new name replaces an old one", async () => {
    const copy = { ...SPEC, objects: SPEC.objects.map((o, i) => (i === 7 ? { ...o, name: "pit garages" } : i === 11 ? { ...o, name: "stands" } : o)) };
    editedReads = [copy];
    const res = await nameSet(SET, PRESS);
    if (res.error !== null) throw new Error(res.error);
    expect(res.spec.objects[7].name).toBe("pit garages");
    expect(res.spec.objects[11].name).toBe("grandstand");
  });

  it("refused names, or names that couldn't be checked, save nothing and say which", async () => {
    gate = "refuse";
    expect(await nameSet(SET, PRESS)).toEqual({ error: SET_NAMING_REFUSED });
    gate = "unavailable";
    expect(await nameSet(SET, PRESS)).toEqual({ error: SET_NAMING_UNCHECKED });
    expect(writes).toEqual([]);
    // Logged as a model's words, never against the person.
    expect(refusals).toEqual([
      { provider: "naming", strictLane: true },
      { provider: "naming", strictLane: true },
    ]);
  });

  it("an answer that isn't the shape, or no answer, names nothing and saves nothing", async () => {
    answer = { ...says({}), text: '{"names": [], "extra": 1}' };
    expect(await nameSet(SET, PRESS)).toEqual({ error: SET_NAMING_FAILED });
    answer = { ...says({}), text: "Here are the names: grandstand" };
    expect(await nameSet(SET, PRESS)).toEqual({ error: SET_NAMING_FAILED });
    answer = null;
    expect(await nameSet(SET, PRESS)).toEqual({ error: SET_NAMING_FAILED });
    expect(gated).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("nothing named: no check, no save", async () => {
    answer = says({ t1: null, o4: null });
    const res = await nameSet(SET, PRESS);
    expect(res).toMatchObject({ error: null, named: 0 });
    expect(steps).not.toContain("gate");
    expect(writes).toEqual([]);
  });

  it("a save that fails says so", async () => {
    saveFails = true;
    expect(await nameSet(SET, PRESS)).toEqual({ error: SET_SAVE_FAILED });
  });
});

describe("never on its own (critic item 9)", () => {
  it("SET_NAMING_AUTO is off, and nothing but the set page's button calls the pass", () => {
    expect(SET_NAMING_AUTO).toBe(false);
    const root = join(__dirname, "../..");
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f)) {
          const text = readFileSync(p, "utf8");
          if (/\bnameSet\(|\bnameMessages\(|\bNAME_INSTRUCTIONS\b/.test(text)) callers.push(p.slice(root.length + 1));
        }
      }
    };
    walk(root);
    expect(callers.sort()).toEqual(["components/sets/set-view.tsx", "lib/sets/name-actions.ts", "lib/sets/name-prompt.ts"]);
    const view = readFileSync(join(root, "components/sets/set-view.tsx"), "utf8");
    // The one call, on a press of the button, with a fresh press id.
    expect(view.match(/\bnameSet\(/g)).toHaveLength(1);
    expect(view).toContain("res = await nameSet(setId, newPressId());");
    expect(view).toContain("onClick={() => void nameThings()}");
    expect(view).toContain("onName: () => void nameThings()");
    // A build and an Astra edit never import the pass.
    for (const f of ["lib/sets/build-tick.ts", "lib/sets/editor-actions.ts", "lib/sets/actions.ts"]) {
      expect(readFileSync(join(root, f), "utf8"), f).not.toMatch(/name-actions|name-prompt|SET_NAMING_AUTO/);
    }
  });

  it("the button carries its price, rounded up, in every language, and is offered to admins only", () => {
    const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
    expect(view).toContain("const worst = Math.ceil(NAME_SET_MAX_USD * 1000) / 1000;");
    expect(view).toContain("fill(s.cast.nameButton, { price: namingPrice(locale) })");
    expect(view).toContain('naming={el.kind === "structure" && namingOn ?');
    expect(view).toContain("{namingOn && (");
    const data = readFileSync(join(__dirname, "data.ts"), "utf8");
    expect(data).toContain("    namingOn: access.isAdmin,");
    for (const l of ["en", "es", "pt", "it"]) {
      const cat = readFileSync(join(__dirname, `../i18n/messages/${l}.ts`), "utf8");
      const line = cat.split("\n").find((x) => x.trim().startsWith("nameButton:"));
      expect(line, l).toContain("≤ {price}");
    }
  });
});
