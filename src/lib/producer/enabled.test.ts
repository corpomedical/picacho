import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isProducerEnabled, isProducerOpenToElite, producerAllowed, producerVisible, type ProducerProfile } from "./enabled";
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
