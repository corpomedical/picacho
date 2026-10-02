// The account menu (operator, 2026-10-02: "a dropdown menu that appears when
// clicking on the credits or the name of the user ... like higgsfield", then
// "Go with B, build it. Give an animation to the progress bar"). Draft B,
// "The Ledger": claude.ai/artifact/UojgUj9wjy7Yjk46UBRCGh.
//
// What the menu shows, as plain data, and the pure arithmetic behind it —
// kept apart from the reads (summary.ts) so the bar and the "that's about"
// counts are tested without a database.

import type { PlanId } from "@/lib/plans";
import type { Allowance } from "@/lib/settings/account-data";

export type AccountMenuCredits =
  | {
      mode: "plan";
      /** The plan's credits left this month (0 while the plan is paused). */
      left: number;
      /** The plan's monthly credits (0 while paused, or with no plan and only extra credits). */
      limit: number;
      /** Bonus + purchased: the balances that never expire. */
      extra: number;
      /** What a send may spend: left + extra (plans.ts spendableCredits). */
      spendable: number;
      /** When the plan's credits come back (ISO), or null. */
      resetsOn: string | null;
      paused: boolean;
    }
  | { mode: "free"; slotOpen: boolean; extra: number };

export type AccountMenuStatus = "active" | "pastDue" | "ended" | "granted" | "none";

export type AccountMenuData = {
  name: string;
  initial: string;
  plan: PlanId;
  status: AccountMenuStatus;
  credits: AccountMenuCredits;
  /** Roughly how many of each the balance still buys, at today's default engines; null when it doesn't apply. */
  about: { pictures: number | null; quick: number | null; hd: number | null } | null;
  /** The month's other allowances, as Settings → Overview lists them. */
  allowances: Allowance[];
  /** True for a free account: its allowances are for good, not monthly. */
  lifetime: boolean;
  /** Upgrade and Buy credits are web-only (store rules): false inside the apps. */
  canBuy: boolean;
};

export type Segment = "plan" | "used" | "extra";

/** Segments in the Ledger's bar, matching the draft's look at any balance. */
export const SEGMENT_COUNT = 16;

/**
 * The bar, left to right: the plan's credits still left (ochre), the plan's
 * credits spent (empty), then the extra credits (pale). The whole bar is the
 * month's plan plus the extra. Any part that is not zero keeps at least one
 * segment, so 3 extra credits next to a 10,000 plan are still visible.
 */
export function creditSegments(left: number, limit: number, extra: number, count = SEGMENT_COUNT): Segment[] {
  const l = Math.max(0, left);
  const used = Math.max(0, limit - l);
  const x = Math.max(0, extra);
  const total = l + used + x;
  if (total <= 0) return Array<Segment>(count).fill("used");
  const parts: [Segment, number][] = [
    ["plan", l],
    ["used", used],
    ["extra", x],
  ];
  const sizes = parts.map(([, v]) => (v > 0 ? Math.max(1, Math.round((v / total) * count)) : 0));
  // Rounding and the one-segment floor can overshoot or fall short: take from
  // (or give to) the largest part, which can always spare one.
  let diff = sizes.reduce((a, b) => a + b, 0) - count;
  while (diff !== 0) {
    const i = sizes.indexOf(Math.max(...sizes));
    sizes[i] -= Math.sign(diff);
    diff -= Math.sign(diff);
  }
  return parts.flatMap(([kind], i) => Array<Segment>(sizes[i]).fill(kind));
}

/** Whole renders a balance pays for at one render's price; null when that render isn't on offer. */
export function rendersFor(balance: number, perRender: number | null): number | null {
  if (perRender === null || !(perRender > 0)) return null;
  return Math.floor(Math.max(0, balance) / perRender);
}

/** The avatar's letter: first name, else username, else email. */
export function menuInitial(name: string | null | undefined): string {
  return ((name ?? "").trim()[0] ?? "?").toUpperCase();
}

export function menuStatus(plan: PlanId, planStatus: string | null): AccountMenuStatus {
  if (plan === "none") return "none";
  if (planStatus === "past_due") return "pastDue";
  if (planStatus === "canceled" || planStatus === "inactive") return "ended";
  if (planStatus == null) return "granted";
  return "active";
}
