import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isProducerEnabled,
  isProducerOpenToElite,
  producerAccessState,
  producerAllowed,
  producerUnitCap,
  producerVisible,
  readProducerGrant,
  PRODUCER_NEEDS_ELITE,
  PRODUCER_NOT_OPEN,
  PRODUCER_SUSPENDED,
  type ProducerProfile,
} from "./enabled";
import { PLAN_CHAT_UNIT_LIMITS } from "../plans";
import { PRODUCER_ASK_EVENT, PRODUCER_ASK_MAX_CHARS, producerAskDraft, producerAskText } from "./ask-event";

// Who has the Producer's lamp on their pages (Helios Cut 2, step 12,
// 2026-09-25 — operator: "Run, keep going."). The app layout asked it
// inline; producerVisible lifts that question out, so a set's page can ask
// it too before its chat offers "Ask the Producer". It must answer exactly
// as the layout did, for every account and every switch.

/** The flags table as far as flagOn reads it, counting the reads. */
function flagsDb(flags: Record<string, boolean>, reads: string[]): SupabaseClient {
  return {
    from: (table: string) => {
      if (table !== "feature_flags") throw new Error(`no table ${table}`);
      let key = "";
      const builder = {
        select: () => builder,
        eq: (_col: string, v: string) => ((key = v), builder),
        maybeSingle: async () => {
          reads.push(key);
          return key in flags ? { data: { enabled: flags[key] }, error: null } : { data: null, error: null };
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

/** The layout's own rule as it stood before the lift (src/app/app/layout.tsx, 2026-09-24), kept here word for word. */
async function layoutRule(supabase: SupabaseClient, profile: ProducerProfile, isAdmin: boolean): Promise<boolean> {
  const producerEligible = isAdmin || (profile?.plan === "elite" && !producerAllowed(profile, true).error);
  return producerEligible && (isAdmin || (await isProducerOpenToElite(supabase))) && (await isProducerEnabled(supabase));
}

const KEY = process.env.ANTHROPIC_API_KEY;
const OFF = process.env.PRODUCER_DISABLED;
beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.PRODUCER_DISABLED;
});
afterEach(() => {
  if (KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = KEY;
  if (OFF === undefined) delete process.env.PRODUCER_DISABLED;
  else process.env.PRODUCER_DISABLED = OFF;
});

describe("producerVisible: the layout's rule, lifted", () => {
  const profiles: ProducerProfile[] = [
    null,
    { plan: "starter" },
    { plan: "growth", role: "admin" },
    { plan: "elite", plan_status: null },
    { plan: "elite", plan_status: "active" },
    { plan: "elite", plan_status: "past_due" },
    { plan: "elite", status: "suspended" },
    { plan: "studio", plan_status: "active" },
  ];
  const switches: Record<string, boolean>[] = [
    {},
    { producer: true },
    { producer: true, producer_elite: true },
    { producer: false, producer_elite: true },
  ];

  it("answers exactly as the layout did, for every account, plan standing and switch", async () => {
    let cases = 0;
    for (const profile of profiles) {
      for (const isAdmin of [false, true]) {
        for (const flags of switches) {
          for (const keyed of [true, false]) {
            if (keyed) process.env.ANTHROPIC_API_KEY = "test-key";
            else delete process.env.ANTHROPIC_API_KEY;
            const want = await layoutRule(flagsDb(flags, []), profile, isAdmin);
            const got = await producerVisible(flagsDb(flags, []), profile, isAdmin);
            expect(got, JSON.stringify({ profile, isAdmin, flags, keyed })).toBe(want);
            cases += 1;
          }
        }
      }
    }
    expect(cases).toBe(profiles.length * 2 * switches.length * 2);
  });

  it("reads no flag for an account that could never have the lamp", async () => {
    const reads: string[] = [];
    expect(await producerVisible(flagsDb({ producer: true, producer_elite: true }, reads), { plan: "studio" }, false)).toBe(false);
    expect(reads).toEqual([]);
  });

  it("opens for an admin with the Producer on, and for Elite only once producer_elite is on", async () => {
    expect(await producerVisible(flagsDb({ producer: true }, []), { plan: "growth", role: "admin" }, true)).toBe(true);
    expect(await producerVisible(flagsDb({ producer: true }, []), { plan: "elite", plan_status: "active" }, false)).toBe(false);
    expect(await producerVisible(flagsDb({ producer: true, producer_elite: true }, []), { plan: "elite", plan_status: "active" }, false)).toBe(true);
    expect(await producerVisible(flagsDb({ producer: true, producer_elite: true }, []), { plan: "elite", plan_status: "past_due" }, false)).toBe(false);
    // The switch off in the environment wins before any read.
    process.env.PRODUCER_DISABLED = "1";
    expect(await producerVisible(flagsDb({ producer: true }, []), { plan: "growth", role: "admin" }, true)).toBe(false);
  });

  it("is what the app layout asks now", () => {
    const layout = readFileSync(join(__dirname, "../../app/app/layout.tsx"), "utf8");
    expect(layout).toContain("if (await producerVisible(supabase, profile, isAdmin)) {");
    expect(layout).not.toContain("isProducerOpenToElite");
  });
});

// One account at a time (2026-09-26, operator: "Give me an option to grant
// users access to The assistant in the admin area"): profiles.producer_access,
// set on the admin's user page.
describe("the Producer granted to one account", () => {
  it("opens it on any plan, even while it isn't open to Elite, and never to a suspended account", () => {
    for (const plan of ["none", "basic", "starter", "growth", "studio", "elite"]) {
      expect(producerAllowed({ plan, producer_access: true }, false)).toEqual({ error: null, isAdmin: false, granted: true });
    }
    // A lapsed Elite subscription doesn't undo an admin's grant.
    expect(producerAllowed({ plan: "elite", plan_status: "past_due", producer_access: true }, true).error).toBeNull();
    expect(producerAllowed({ plan: "starter", status: "suspended", producer_access: true }, true).error).toBe(PRODUCER_SUSPENDED);
    // Without the grant, the rule is as before.
    expect(producerAllowed({ plan: "starter" }, true).error).toBe(PRODUCER_NEEDS_ELITE);
    expect(producerAllowed({ plan: "starter", producer_access: false }, false).error).toBe(PRODUCER_NOT_OPEN);
    // Only a real true grants: a string from a hand-made row does not.
    expect(producerAllowed({ plan: "starter", producer_access: "true" }, false).error).toBe(PRODUCER_NOT_OPEN);
    // An admin has it anyway; the grant changes nothing for them.
    expect(producerAllowed({ role: "admin", producer_access: true }, false)).toEqual({ error: null, isAdmin: true, granted: false });
  });

  it("meters a granted account against Elite's allowance, so a grant works on a free account too", () => {
    expect(producerUnitCap({ isAdmin: false, granted: true }, "none")).toBe(PLAN_CHAT_UNIT_LIMITS.elite);
    expect(producerUnitCap({ isAdmin: false, granted: true }, "starter")).toBe(PLAN_CHAT_UNIT_LIMITS.elite);
    expect(producerUnitCap({ isAdmin: true, granted: false }, "starter")).toBe(PLAN_CHAT_UNIT_LIMITS.elite);
    expect(producerUnitCap({ isAdmin: false, granted: false }, "elite")).toBe(PLAN_CHAT_UNIT_LIMITS.elite);
    expect(producerUnitCap({ isAdmin: false, granted: false }, "starter")).toBe(PLAN_CHAT_UNIT_LIMITS.starter);
    expect(producerUnitCap({ isAdmin: false, granted: false }, null)).toBe(0);
  });

  it("puts the lamp on a granted account's pages while the Producer is on, without asking the Elite switch", async () => {
    const reads: string[] = [];
    expect(await producerVisible(flagsDb({ producer: true, producer_elite: false }, reads), { plan: "starter", producer_access: true }, false)).toBe(true);
    expect(reads).toEqual(["producer"]);
    // The kill switch still wins, and the environment's before any read.
    expect(await producerVisible(flagsDb({ producer: false }, []), { plan: "starter", producer_access: true }, false)).toBe(false);
    process.env.PRODUCER_DISABLED = "1";
    expect(await producerVisible(flagsDb({ producer: true }, []), { plan: "starter", producer_access: true }, false)).toBe(false);
    delete process.env.PRODUCER_DISABLED;
    // Suspended: no lamp, grant or not.
    expect(await producerVisible(flagsDb({ producer: true }, []), { plan: "starter", status: "suspended", producer_access: true }, false)).toBe(false);
  });

  it("reads the grant on its own, and a missing column (before the SQL) reads as not granted", async () => {
    const row = (result: { data: unknown; error: unknown } | "throw"): SupabaseClient =>
      ({
        from: (table: string) => {
          expect(table).toBe("profiles");
          const b = {
            select: (cols: string) => (expect(cols).toBe("producer_access"), b),
            eq: () => b,
            maybeSingle: async () => {
              if (result === "throw") throw new Error("network");
              return result;
            },
          };
          return b;
        },
      }) as unknown as SupabaseClient;
    expect(await readProducerGrant(row({ data: { producer_access: true }, error: null }), "u1")).toBe(true);
    expect(await readProducerGrant(row({ data: { producer_access: false }, error: null }), "u1")).toBe(false);
    expect(await readProducerGrant(row({ data: null, error: null }), "u1")).toBe(false);
    expect(
      await readProducerGrant(row({ data: null, error: { message: 'column profiles.producer_access does not exist' } }), "u1"),
    ).toBe(false);
    expect(await readProducerGrant(row("throw"), "u1")).toBe(false);
  });

  it("the admin's row says exactly what the rule decides, for every account and switch", () => {
    const people: ProducerProfile[] = [];
    for (const role of [null, "admin"])
      for (const status of [null, "active", "suspended"])
        for (const plan of ["none", "starter", "elite"])
          for (const plan_status of [null, "active", "past_due"])
            for (const producer_access of [undefined, false, true]) people.push({ role, status, plan, plan_status, producer_access });
    for (const p of people) {
      for (const openToElite of [false, true]) {
        const state = producerAccessState(p!, openToElite);
        const has = ["admin", "granted", "elite"].includes(state);
        const isAdmin = p?.role === "admin";
        expect(has, JSON.stringify({ p, openToElite, state })).toBe(!producerAllowed(p, isAdmin || openToElite).error);
      }
    }
  });

  it("is asked everywhere the Producer is decided, with the grant read on its own", () => {
    const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
    const route = read("../../app/api/producer/route.ts");
    const actions = read("./actions.ts");
    const layout = read("../../app/app/layout.tsx");
    const sets = read("../sets/data.ts");
    for (const src of [route, actions, layout, sets]) expect(src).toContain("readProducerGrant(");
    for (const src of [route, actions]) expect(src).toContain("producerUnitCap(access,");
    // One assistant allowance for a granted account: the composer's chat and
    // Settings count the same ledger against Elite's monthly cap, so the
    // Producer's turns can't use up the plan's own (review of the grant).
    const chat = read("../../app/api/agent/chat/route.ts");
    expect(chat).toContain("const producerGranted = await readProducerGrant(admin, user.id);");
    expect(chat).toContain("const cap = producerGranted ? PLAN_CHAT_UNIT_LIMITS.elite :");
    expect(chat).toContain("isFree && !producerGranted");
    const allowances = read("../settings/account-data.ts");
    expect(allowances).toContain("a.producerGranted ? PLAN_CHAT_UNIT_LIMITS.elite : PLAN_CHAT_UNIT_LIMITS[a.plan]");
    expect(allowances).toContain("if (units !== null && !a.producerGranted) {");
    expect(read("../../app/app/settings/page.tsx")).toContain("producerGranted,");
    // Refused because it's no longer theirs, the lamp takes itself off the page.
    const lamp = read("../../components/producer/producer-lamp.tsx");
    expect(lamp).toContain("goneIfRefused(r.error);");
    expect(lamp).toContain("if (res.status === 403) goneIfRefused(body?.error);");
    expect(lamp).toContain("router.refresh();");
    // No profile read names the column (it would fail the whole read before the SQL runs).
    for (const src of [route, actions, layout, sets]) {
      for (const m of src.matchAll(/\.select\("([^"]*)"\)/g)) {
        if (m[1] !== "producer_access") expect(m[1]).not.toContain("producer_access");
      }
    }
  });
});

// The set chat's handoff (spec §8): the words go to the lamp's field,
// unsent — a Producer turn is always the person's own press.
describe("Ask the Producer: the words, unsent", () => {
  it("reads only an ask's words, held to the lamp's field", () => {
    expect(producerAskText({ detail: { text: "how many credits do I have?" } })).toBe("how many credits do I have?");
    expect(producerAskText({ detail: { text: "x".repeat(PRODUCER_ASK_MAX_CHARS + 10) } })?.length).toBe(PRODUCER_ASK_MAX_CHARS);
    for (const e of [null, undefined, {}, { detail: null }, { detail: {} }, { detail: { text: 7 } }, "text"]) expect(producerAskText(e), JSON.stringify(e)).toBeNull();
  });

  it("keeps a draft the person had started, the words after it", () => {
    expect(producerAskDraft("", "what's my plan?")).toBe("what's my plan?");
    expect(producerAskDraft("   ", "what's my plan?")).toBe("what's my plan?");
    expect(producerAskDraft("remind me tomorrow  ", "what's my plan?")).toBe("remind me tomorrow\n\nwhat's my plan?");
    expect(producerAskDraft("a".repeat(PRODUCER_ASK_MAX_CHARS), "b").length).toBe(PRODUCER_ASK_MAX_CHARS);
  });

  it("the lamp opens on the conversation with the words in its field, and never sends them", () => {
    const lamp = readFileSync(join(__dirname, "../../components/producer/producer-lamp.tsx"), "utf8");
    const at = lamp.indexOf("const onAsk = (e: Event) => {");
    expect(at).toBeGreaterThan(-1);
    const handler = lamp.slice(at, lamp.indexOf("};", at));
    expect(handler).toContain("const text = producerAskText(e);");
    expect(handler).toContain('setView("chat");');
    expect(handler).toContain("setInput((current) => producerAskDraft(current, text));");
    expect(handler).toContain("setOpen(true);");
    expect(handler).not.toMatch(/\bsend\(/);
    expect(lamp).toContain("window.addEventListener(PRODUCER_ASK_EVENT, onAsk);");
    expect(lamp).toContain("return () => window.removeEventListener(PRODUCER_ASK_EVENT, onAsk);");
    // The set page sends the person's words through the same event, and only from its reply's button.
    const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
    expect(view.match(/askProducer\(/g)).toHaveLength(1);
    expect(view).toContain('askProducer(turn.asked ?? "");');
    expect(view).not.toContain(`"${PRODUCER_ASK_EVENT}"`);
  });
});
