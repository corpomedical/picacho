// Director's Cut's credits (operator, 2026-10-03: "Pay what it uses"): a
// cut or a change HOLDS credits before Opus starts, and the hold is settled
// when the turn ends — what it used kept, the rest back, everything back
// when no video came out. Music and Export are fixed prices on the same
// rails, refunded when they fail. The prices are pricing.ts's.
//
// A hold is a generations row, like every other charge in the product: its
// credits_used counts against the month (monthly_credits_used reads every
// row), and its purchased/bonus parts were taken from those balances. That
// is checkGenerationAllowance + reserve_generations, the same two steps
// Live and every render take (lib/live/actions.ts startLiveTake).
//
//  - A cut's or a change's hold IS the first video that turn delivers
//    (advance.ts gives that video the hold's id), hidden from History until
//    the video lands on it. Each attempt holds under a fresh id, so a change
//    that failed to send can be asked for again.
//  - Music and Export holds stay hidden: they are a charge, not a picture.
//
// Settling is guarded on the row's status and its three credit columns, so
// two ticks (or a tick and the backstop) can never refund twice.

import type { SupabaseClient } from "@supabase/supabase-js";
import { liveRefundSplit } from "../live/live";

/** A cut's or a change's hold, and the video it becomes (advance.ts deliverOne). */
export const EDITOR_MODEL_ID = "video-editor";
export const EDITOR_MUSIC_MODEL_ID = "video-editor-music";
export const EDITOR_EXPORT_MODEL_ID = "video-editor-export";
/** Every row this file writes — the reaper leaves them to the editor's own backstop. */
export const EDITOR_CHARGE_MODEL_IDS: readonly string[] = [EDITOR_MODEL_ID, EDITOR_MUSIC_MODEL_ID, EDITOR_EXPORT_MODEL_ID];

/** A hold the backstop settles when nothing else has, hours after it was placed. */
export const HOLD_BACKSTOP_MS = 3 * 60 * 60 * 1000;
/** Failed cuts and changes a customer may have refunded in a day before new ones wait for tomorrow. */
export const DAILY_FAILED_LIMIT = 3;

/** checkGenerationAllowance's answer, as far as a hold reads it. */
export type Allowance = {
  error: string | null;
  isAdmin: boolean;
  consumePurchased?: number;
  consumeBonus?: number;
  monthlyLimit?: number;
  periodStartIso?: string;
};

export type HoldDeps = {
  admin: SupabaseClient;
  /** core.ts checkGenerationAllowance for the person asking, for this many credits. */
  allowance: (credits: number) => Promise<Allowance>;
  /** core.ts consumePurchasedCredits / consumeBonusCredits for the person asking. */
  consumePurchased: (n: number) => Promise<boolean>;
  consumeBonus: (n: number) => Promise<boolean>;
};

export type Hold = { error: null; rowId: string | null; credits: number } | { error: string; code: "noCredits" | "busy" };

/** What a hold is told about itself in History's log. */
function logStep(detail: string) {
  return { attempt: 1, steps: [{ step: "generate" as const, detail }], passed: true, issues: [] as string[], compiledPrompt: "" };
}

/**
 * Takes `credits` before the work starts. Admins are not charged: no row is
 * written, and rowId comes back null. `hidden` keeps the row out of History
 * (deleted_at); a cut's hold is revealed when its video lands on it.
 */
export async function placeHold(
  deps: HoldDeps,
  input: { userId: string; rowId: string; credits: number; modelId: string; prompt: string; detail: string; hidden: boolean },
): Promise<Hold> {
  const allowance = await deps.allowance(input.credits);
  if (allowance.error) return { error: allowance.error, code: "noCredits" };
  if (allowance.isAdmin) return { error: null, rowId: null, credits: 0 };

  const purchased = allowance.consumePurchased ?? 0;
  const bonus = allowance.consumeBonus ?? 0;
  const monthly = Math.max(0, input.credits - purchased - bonus);
  const row = {
    id: input.rowId,
    prompt_input: input.prompt.slice(0, 200),
    content_type: "video",
    status: "generating",
    attempts: 0,
    result_url: null,
    pipeline_log: [logStep(input.detail)],
    model_id: input.modelId,
    credits_used: input.credits,
    purchased_credits_used: purchased,
    bonus_credits_used: bonus,
    free_generation_used: false,
    deleted_at: input.hidden ? new Date().toISOString() : null,
  };
  const { data: ids, error } = await deps.admin.rpc("reserve_generations", {
    p_user_id: input.userId,
    p_monthly_portion: monthly,
    p_limit: allowance.monthlyLimit ?? 0,
    p_since: allowance.periodStartIso ?? new Date(0).toISOString(),
    p_rows: [row],
  });
  if (error) {
    // The same press twice: the first already holds this turn.
    if (/duplicate key/i.test(error.message)) return { error: "This is already on its way.", code: "busy" };
    console.error("[editor] hold failed:", error.message);
    return { error: "Couldn't hold the credits for this. Try again.", code: "noCredits" };
  }
  if (!((ids as string[] | null) ?? []).length) {
    return { error: "You've used all the credits included in your plan this month.", code: "noCredits" };
  }
  const bonusOk = await deps.consumeBonus(bonus);
  if (!(await deps.consumePurchased(purchased)) || !bonusOk) {
    await deps.admin
      .from("generations")
      .update({ status: "failed", credits_used: 0, purchased_credits_used: 0, bonus_credits_used: 0 })
      .eq("id", input.rowId);
    return { error: "You're out of credits — that couldn't be covered.", code: "noCredits" };
  }
  return { error: null, rowId: input.rowId, credits: input.credits };
}

type HoldRow = {
  id: string;
  user_id: string;
  status: string;
  credits_used: number | null;
  purchased_credits_used: number | null;
  bonus_credits_used: number | null;
  result_url: string | null;
};

export type Settled = { settled: boolean; charged: number; refunded: number };

/**
 * Ends a hold: `charge` credits kept (never more than were held), the rest
 * back — purchased first, then bonus, then off the month (Live's order).
 * `outcome` is the row's final status. Runs once: a row already settled,
 * missing, or changed underneath answers settled: false.
 */
export async function settleHold(
  admin: SupabaseClient,
  rowId: string,
  input: { charge: number; outcome: "succeeded" | "failed"; detail: string },
): Promise<Settled> {
  const { data: row } = await admin
    .from("generations")
    .select("id, user_id, status, credits_used, purchased_credits_used, bonus_credits_used, result_url")
    .eq("id", rowId)
    .maybeSingle<HoldRow>();
  const none: Settled = { settled: false, charged: 0, refunded: 0 };
  if (!row) return none;
  // Settled already: a failed row gave everything back; a finished one kept its charge.
  if (row.status === "failed" || (row.status === "succeeded" && input.outcome === "succeeded")) return none;
  const creditsUsed = Number(row.credits_used) || 0;
  const purchasedUsed = Number(row.purchased_credits_used) || 0;
  const bonusUsed = Number(row.bonus_credits_used) || 0;
  const charge = input.outcome === "failed" ? 0 : Math.max(0, Math.min(creditsUsed, Math.round(input.charge)));
  const split = liveRefundSplit({ refund: creditsUsed - charge, creditsUsed, purchasedUsed, bonusUsed });

  const { data: claimed, error } = await admin
    .from("generations")
    .update({
      status: input.outcome,
      progress_stage: null,
      credits_used: split.creditsUsed,
      purchased_credits_used: split.purchasedUsed,
      bonus_credits_used: split.bonusUsed,
      pipeline_log: [logStep(input.detail)],
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("status", row.status)
    .eq("credits_used", creditsUsed)
    .eq("purchased_credits_used", purchasedUsed)
    .eq("bonus_credits_used", bonusUsed)
    .select("id");
  if (error) throw new Error(`couldn't settle ${row.id}: ${error.message}`);
  if (!claimed?.length) return none;

  // Atomic adds — a read-then-write would race a concurrent spend.
  if (split.purchasedBack > 0) {
    const { error: e } = await admin.rpc("add_purchased_credits", { p_user_id: row.user_id, p_amount: split.purchasedBack });
    if (e) console.error("[editor] purchased refund failed:", e.message, row.id, split.purchasedBack);
  }
  if (split.bonusBack > 0) {
    const { error: e } = await admin.rpc("add_bonus_credits", { p_user_id: row.user_id, p_amount: split.bonusBack });
    if (e) console.error("[editor] bonus refund failed:", e.message, row.id, split.bonusBack);
  }
  return { settled: true, charged: split.creditsUsed, refunded: creditsUsed - split.creditsUsed };
}

/** How many of this customer's cuts and changes failed (and were refunded) in the last day. */
export async function failedToday(admin: SupabaseClient, userId: string, nowMs = Date.now()): Promise<number> {
  const { count } = await admin
    .from("generations")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("model_id", EDITOR_MODEL_ID)
    .eq("status", "failed")
    .gte("created_at", new Date(nowMs - 24 * 60 * 60 * 1000).toISOString());
  return count ?? 0;
}

/**
 * The backstop: holds nothing settled for HOLD_BACKSTOP_MS — a function that
 * died between its hold and its settle — are given back whole. A cut whose
 * video did land keeps it (succeeded), free. Run by the editor's cron.
 */
export async function settleForgottenHolds(admin: SupabaseClient, nowMs = Date.now()): Promise<number> {
  const { data } = await admin
    .from("generations")
    .select("id, result_url")
    .in("model_id", [...EDITOR_CHARGE_MODEL_IDS])
    .eq("status", "generating")
    .lt("created_at", new Date(nowMs - HOLD_BACKSTOP_MS).toISOString())
    .limit(20);
  let n = 0;
  for (const r of (data ?? []) as { id: string; result_url: string | null }[]) {
    try {
      const done = await settleHold(admin, r.id, {
        charge: 0,
        outcome: r.result_url ? "succeeded" : "failed",
        detail: "Director's Cut didn't finish settling this one, so every credit came back.",
      });
      if (done.settled) n++;
    } catch (err) {
      console.error("[editor] backstop settle failed:", r.id, err instanceof Error ? err.message : err);
    }
  }
  return n;
}
