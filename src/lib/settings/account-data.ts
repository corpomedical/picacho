import type { SupabaseClient } from "@supabase/supabase-js";
import { monthlyWindowStart } from "@/lib/generations/core";
import {
  FREE_CHAT_UNIT_LIMIT,
  FREE_PROMPT_ASSIST_LIMIT,
  PLAN_CHAT_UNIT_LIMITS,
  PLAN_PROMPT_ASSIST_LIMITS,
  PLAN_REFERENCE_IMAGE_LIMITS,
  type PlanId,
} from "@/lib/plans";
import { setBuildsMonthlyLimit } from "@/lib/sets/set-config";
import { countSetBuildsThisMonth } from "@/lib/sets/data";
import { classifySpend, type SpendPart } from "@/lib/settings/credit-spend";

// What Settings shows about the month (2026-09-19): where the credits went,
// and the four allowances that are NOT credits — Helios sets, character
// photos, prompt assists, the assistant. Until now nobody could see the
// last four anywhere; the first time most people learned of them was the
// message saying they had run out.
//
// Every count here reads the same rows, over the same window, that the
// action enforcing it reads (named beside each), so the page and the cap
// cannot disagree. Each read fails soft to null: the row is then left off
// rather than shown as zero.

// The free photos an account without a plan gets for good
// (lib/characters/actions.ts FREE_REFERENCE_GENERATIONS_LIMIT).
const FREE_REFERENCE_PHOTOS = 2;

export async function loadCreditSpend(
  supabase: SupabaseClient,
  userId: string,
  periodStart: string | null,
): Promise<SpendPart[] | null> {
  const since = monthlyWindowStart(periodStart);
  const [{ data: rows, error }, { data: shots }] = await Promise.all([
    supabase
      .from("generations")
      .select("id, content_type, model_id, credits_used")
      .eq("user_id", userId)
      .gte("created_at", since.toISOString())
      .gt("credits_used", 0)
      .limit(5000),
    // A Helios still or take is a generation linked to a set. The link is
    // written around the same moment as the row; a day's margin catches one
    // made just before the window turned.
    supabase
      .from("location_set_shots")
      .select("generation_id")
      .eq("user_id", userId)
      .gte("created_at", new Date(since.getTime() - 86_400_000).toISOString())
      .limit(5000),
  ]);
  if (error) {
    console.error("settings: credit spend read failed", error.message);
    return null;
  }
  const helios = new Set((shots ?? []).map((s) => s.generation_id as string));
  return classifySpend((rows ?? []) as Parameters<typeof classifySpend>[0], helios);
}

export type Allowance = {
  key: "helios" | "photos" | "assists" | "assistant";
  /** How many are left, or null when unlimited. */
  left: number | null;
  cap: number | null;
  /** The assistant is metered in units nobody can picture: it is shown as a share. */
  asPercent: boolean;
};

export type Allowances = { lifetime: boolean; items: Allowance[] };

async function countSince(
  supabase: SupabaseClient,
  table: "prompt_assists" | "reference_image_generations",
  userId: string,
  since: string | null,
): Promise<number | null> {
  let q = supabase.from(table).select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (since) q = q.gte("created_at", since);
  const { count, error } = await q;
  if (error) return null;
  return count ?? 0;
}

async function unitsSince(supabase: SupabaseClient, userId: string, since: string | null): Promise<number | null> {
  let q = supabase.from("agent_usage").select("units").eq("user_id", userId).limit(10000);
  if (since) q = q.gte("created_at", since);
  const { data, error } = await q;
  if (error) return null;
  return (data ?? []).reduce((a, r) => a + ((r.units as number | null) ?? 0), 0);
}

export async function loadAllowances(
  supabase: SupabaseClient,
  a: {
    userId: string;
    plan: PlanId;
    planStatus: string | null;
    isAdmin: boolean;
    periodStart: string | null;
    setsOn: boolean;
    freeReferenceUsed: number;
    /** Granted the Producer by an admin: one assistant allowance, Elite's, each month (api/agent/chat). */
    producerGranted?: boolean;
  },
): Promise<Allowances> {
  const planActive = a.planStatus === null || a.planStatus === "active";
  // Metered as a free account exactly where the caps do it: no plan, or a
  // plan whose payment has not gone through (prompts/actions.ts,
  // characters/actions.ts, api/agent/chat).
  const freeTier = a.plan === "none" || !planActive;
  const left = (cap: number, used: number | null) => (used === null ? null : Math.max(0, cap - used));

  if (a.isAdmin) {
    return {
      lifetime: false,
      items: [
        { key: "photos", left: null, cap: null, asPercent: false },
        { key: "assists", left: null, cap: null, asPercent: false },
      ],
    };
  }

  if (freeTier) {
    const [assists, units] = await Promise.all([
      countSince(supabase, "prompt_assists", a.userId, null),
      unitsSince(supabase, a.userId, null),
    ]);
    const items: Allowance[] = [
      { key: "photos", left: left(FREE_REFERENCE_PHOTOS, a.freeReferenceUsed), cap: FREE_REFERENCE_PHOTOS, asPercent: false },
    ];
    if (assists !== null) items.push({ key: "assists", left: left(FREE_PROMPT_ASSIST_LIMIT, assists), cap: FREE_PROMPT_ASSIST_LIMIT, asPercent: false });
    // Granted the Producer: its assistant allowance is Elite's and monthly, which
    // this card ("for the life of a free account") would misstate — the
    // lamp's own dial shows it instead.
    if (units !== null && !a.producerGranted) {
      items.push({ key: "assistant", left: left(FREE_CHAT_UNIT_LIMIT, units), cap: FREE_CHAT_UNIT_LIMIT, asPercent: true });
    }
    return { lifetime: true, items };
  }

  // The billing month every cap counts in (monthlyWindowStart, core.ts).
  const since = monthlyWindowStart(a.periodStart).toISOString();
  const setCap = a.setsOn ? setBuildsMonthlyLimit(a.plan, false) : 0;
  const assistCap = PLAN_PROMPT_ASSIST_LIMITS[a.plan];
  const [sets, photos, assists, units] = await Promise.all([
    setCap > 0 ? countSetBuildsThisMonth(a.userId, a.periodStart) : Promise.resolve(null),
    countSince(supabase, "reference_image_generations", a.userId, since),
    Number.isFinite(assistCap) ? countSince(supabase, "prompt_assists", a.userId, since) : Promise.resolve(0),
    unitsSince(supabase, a.userId, since),
  ]);
  const items: Allowance[] = [];
  if (setCap > 0 && sets !== null) items.push({ key: "helios", left: left(setCap, sets), cap: setCap, asPercent: false });
  if (photos !== null) {
    const cap = PLAN_REFERENCE_IMAGE_LIMITS[a.plan];
    items.push({ key: "photos", left: left(cap, photos), cap, asPercent: false });
  }
  if (!Number.isFinite(assistCap)) items.push({ key: "assists", left: null, cap: null, asPercent: false });
  else if (assists !== null) items.push({ key: "assists", left: left(assistCap, assists), cap: assistCap, asPercent: false });
  if (units !== null) {
    const cap = a.producerGranted ? PLAN_CHAT_UNIT_LIMITS.elite : PLAN_CHAT_UNIT_LIMITS[a.plan];
    items.push({ key: "assistant", left: left(cap, units), cap, asPercent: true });
  }
  return { lifetime: false, items };
}
