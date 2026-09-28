import type { SupabaseClient } from "@supabase/supabase-js";
import { PLAN_LABELS, PLAN_LIMITS, type PlanId } from "@/lib/plans";
import { getMonthlyUsageWith, monthlyWindowStart, nextMonthlyReset } from "@/lib/generations/core";
import { loadAllowances, loadCreditSpend } from "@/lib/settings/account-data";

// read_account (2026-09-28, operator: "She almost never has an answer to the
// question. Make her as good as you"): the person's own account, read the
// same way Settings reads it (account-data.ts, the Overview), so what Aly
// says and what Settings shows can't disagree. Only this person's rows, with
// their own session client (RLS) — never anyone else's. Loaded on demand by
// run-tools.ts, so the tools' tests don't need the app's aliases.

const ALLOWANCE_NAMES = {
  helios: "Helios 3D set builds",
  photos: "AI character photos",
  assists: "prompt assists (Enhance)",
  assistant: "your own allowance (you and the composer's chat assistant share it)",
} as const;

// credit-spend.ts SpendKind, in the words Settings uses.
const SPEND_NAMES: Record<string, string> = {
  videos: "videos",
  images: "images",
  helios: "Helios 3D stills and takes",
  upscales: "upscales",
  layers: "Layers",
  mystique: "Recast",
};

function day(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export async function readAccount(supabase: SupabaseClient, userId: string, extra?: { topUpUnits?: number | null }): Promise<string> {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select(
      "plan, plan_status, role, bonus_credits, purchased_credits, current_period_start, current_period_end, producer_access, free_reference_generations_used, created_at",
    )
    .eq("id", userId)
    .single();
  if (error || !profile) return "Their account couldn't be read just now. Say so, and point them to Settings (Overview) for the numbers.";

  const plan = ((profile.plan as string | null) ?? "none") as PlanId;
  const planStatus = (profile.plan_status as string | null) ?? null;
  const isAdmin = profile.role === "admin";
  const periodStart = (profile.current_period_start as string | null) ?? null;
  const lines: string[] = [];

  lines.push(
    `Plan: ${PLAN_LABELS[plan] ?? plan}${planStatus && planStatus !== "active" ? ` (payment status: ${planStatus})` : ""}${isAdmin ? " — an admin account" : ""}.`,
  );
  const since = monthlyWindowStart(periodStart);
  // Two different dates (core.ts): the monthly allowances refill on the
  // billing month's anniversary; the plan itself renews (is charged) on
  // Stripe's period end, which for an annual plan is a year out.
  const refill = nextMonthlyReset(periodStart).toISOString().slice(0, 10);
  const renews = day(profile.current_period_end as string | null);
  lines.push(
    plan === "none"
      ? "No paid plan: the free tier (one free generation a day, a small lifetime allowance for the rest)."
      : `This billing month began ${since.toISOString().slice(0, 10)}; plan credits and the monthly allowances refill on ${refill}${
          renews ? `; the plan's next charge (renewal) is ${renews}` : ""
        }.`,
  );

  if (isAdmin) {
    lines.push("Credits: an admin account has no credit limit.");
  } else {
    const used = await getMonthlyUsageWith(supabase, userId, periodStart).catch(() => null);
    const allowance = (PLAN_LIMITS[plan] ?? 0) + Number(profile.bonus_credits ?? 0);
    const bought = Number(profile.purchased_credits ?? 0);
    lines.push(
      used === null
        ? `Credits: ${allowance} in the plan this month (plus ${bought} bought); what's been used couldn't be read.`
        : `Credits: ${Math.max(0, allowance - used)} of ${allowance} plan credits left this month (${used} used), plus ${bought} bought credits that don't expire.`,
    );
    const spend = await loadCreditSpend(supabase, userId, periodStart).catch(() => null);
    if (spend && spend.length > 0) {
      lines.push(
        `Where this month's credits went: ${spend
          .filter((p) => p.credits > 0)
          .map((p) => `${SPEND_NAMES[p.kind] ?? p.kind} ${p.credits}`)
          .join(", ")}.`,
      );
    }
  }

  const allowances = await loadAllowances(supabase, {
    userId,
    plan,
    planStatus,
    isAdmin,
    periodStart,
    setsOn: plan !== "none",
    freeReferenceUsed: Number(profile.free_reference_generations_used ?? 0),
    producerGranted: profile.producer_access === true,
  }).catch(() => null);
  if (allowances) {
    for (const a of allowances.items) {
      const name = ALLOWANCE_NAMES[a.key];
      if (a.cap === null || a.left === null) {
        lines.push(`${name}: unlimited.`);
      } else if (a.asPercent) {
        const usedPct = a.cap > 0 ? Math.round(((a.cap - a.left) / a.cap) * 100) : 100;
        lines.push(`${name}: ${usedPct}% used ${allowances.lifetime ? "for the life of the free account" : "this month"} (${a.cap - a.left} of ${a.cap} units).`);
      } else {
        lines.push(`${name}: ${a.left} of ${a.cap} left ${allowances.lifetime ? "for the life of the free account" : "this month"}.`);
      }
    }
  }
  if (typeof extra?.topUpUnits === "number" && extra.topUpUnits > 0) {
    lines.push(`Topped-up units for you, kept until used (spent after the month's allowance): ${extra.topUpUnits}.`);
  }
  lines.push(
    "Where they see it: Settings opens on an Overview with all of this; Settings → Plan & billing has the plan, credit packs and invoices.",
  );
  return lines.join("\n");
}
