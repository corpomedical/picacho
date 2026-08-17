import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mediaUrl } from "@/lib/media/url";
import { FREE_GENERATION_LIMIT, PLAN_LABELS, PLAN_LIMITS, type PlanId } from "@/lib/plans";

// Generation credits, and where a generated image is written.
//
// This module exists because generations/actions.ts is a "use server" file:
// every export there is a wire-callable endpoint, so shared internals can't
// live in it. They used to be private functions inside that file, which was
// fine while the composer was the only caller. The public API (api/v1) is a
// second caller, and billing logic is the last place to keep two copies of
// anything — so it moved here, unchanged, and actions.ts imports it.
//
// Every function takes its Supabase client rather than creating one. The
// composer passes a cookie-scoped client (RLS applies); the API passes a
// service client and does its own ownership checks. Getting that wrong would
// mean either a broken quota or an open door, so it is always the caller's
// explicit decision.

// Blocks a direct, scripted call from firing faster than a real person could
// ever click — independent of the monthly plan cap. The API has its own,
// higher limit: a script is EXPECTED to be fast there, and the point is to
// bound it, not to imitate a human.
export const COOLDOWN_MS = 3000;

// Advances a billing-period start to the most recent MONTHLY anniversary at
// or before now. Monthly subscriptions pass through unchanged (their period
// start is already within the last month); annual subscriptions get their
// quota window derived from the same anniversary day, one month at a time —
// without this, an annual subscriber's "monthly" window spanned the whole
// year, so the quota effectively reset once every twelve months.
// (Anniversary days past a month's end roll forward per JS Date semantics —
// a Jan 31 anchor gives Feb 28/29 → Mar 3 windows; imperfect, harmless.)
function latestMonthlyAnniversary(periodStart: Date): Date {
  const now = new Date();
  let current = new Date(periodStart);
  for (;;) {
    const next = new Date(current);
    next.setMonth(next.getMonth() + 1);
    if (next > now) return current;
    current = next;
  }
}

// Sums credits used since the start of the caller's current monthly window.
//
// Takes the client: with a cookie-scoped client RLS narrows this to the
// caller's own rows, but a service client sees every row in the table, so the
// user_id filter below is what makes it correct in both cases. Dropping it
// would silently bill one account for the whole platform's usage.
export async function getMonthlyUsageWith(
  supabase: SupabaseClient,
  userId: string,
  periodStart?: string | null,
) {
  const start = periodStart
    ? latestMonthlyAnniversary(new Date(periodStart))
    : (() => {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        return startOfMonth;
      })();

  const { data } = await supabase
    .from("generations")
    .select("credits_used")
    .eq("user_id", userId)
    .gte("created_at", start.toISOString());

  return (data ?? []).reduce((sum, row) => sum + (Number(row.credits_used) || 1), 0);
}

// Enforced here, server-side — previously the plan limits were only ever
// used to *display* a number in Settings, never checked before a generation
// actually ran, so any account (or a direct script bypassing the UI) could
// call the paid pipeline without limit. Admins are exempt so testing and
// support work is never blocked by a customer-facing quota.
//
// requestedCredits, not a raw generation count: pricier models (e.g. Kling
// O3) consume more than 1 credit per video (see creditWeight in
// video-models.ts), so a single video can request >1 here, and a 3-angle
// multi-angle request on a premium model requests angles × weight.
export async function checkGenerationAllowance(
  supabase: SupabaseClient,
  userId: string,
  requestedCredits: number,
): Promise<{ error: string | null; plan: PlanId; isAdmin: boolean; consumePurchased?: number; consumeFree?: boolean }> {
  const [{ data: profile }, { data: recent }] = await Promise.all([
    supabase
      .from("profiles")
      .select("plan, role, status, bonus_credits, purchased_credits, free_generations_used, current_period_start")
      .eq("id", userId)
      .single(),
    supabase
      .from("generations")
      .select("created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const plan = (profile?.plan ?? "none") as PlanId;
  const isAdmin = profile?.role === "admin";

  // Suspended accounts can't generate — enforced here as well as in
  // middleware, so a direct call to this action (not just a page load) is
  // still blocked. Checked before the admin bypass so a suspended admin is
  // stopped too.
  if (profile?.status === "suspended") {
    return {
      error: "Your account is suspended. Contact support if you think this is a mistake.",
      plan,
      isAdmin,
    };
  }

  if (isAdmin) return { error: null, plan, isAdmin };

  const lastCreatedAt = recent?.[0]?.created_at as string | undefined;
  if (lastCreatedAt && Date.now() - new Date(lastCreatedAt).getTime() < COOLDOWN_MS) {
    return {
      error: "You're generating a bit fast — wait a few seconds and try again.",
      plan,
      isAdmin,
    };
  }

  // Free tier: a lifetime trial counted in generations, checked before the
  // monthly-allowance logic below because it works on a different axis
  // entirely (never resets, isn't affected by billing periods). Accounts
  // that have been granted bonus credits fall through to the normal path
  // instead — those are a deliberate gift and shouldn't be capped at five.
  if (plan === "none" && (profile?.bonus_credits ?? 0) === 0) {
    const freeUsed = (profile?.free_generations_used ?? 0) as number;
    if (freeUsed >= FREE_GENERATION_LIMIT) {
      return {
        error:
          `You've used all ${FREE_GENERATION_LIMIT} free generations. Pick a plan to keep going — ` +
          `your characters and history stay exactly as they are.`,
        plan,
        isAdmin,
      };
    }
    // Counted per generation, not per credit: the free tier is pinned to the
    // cheapest model (enforced in runGeneration), so one generation is one
    // credit's worth of cost and the two can't drift apart.
    return { error: null, plan, isAdmin, consumeFree: true };
  }

  // Bonus credits (admin-granted, see setBonusCredits) stack on top of the
  // plan's normal allowance rather than replacing it.
  const limit = (PLAN_LIMITS[plan] ?? 0) + (profile?.bonus_credits ?? 0);
  const used = await getMonthlyUsageWith(
    supabase,
    userId,
    profile?.current_period_start as string | null | undefined,
  );
  const purchased = (profile?.purchased_credits ?? 0) as number;

  // How much of THIS request the monthly allowance can't cover. Written as
  // the difference between how far over the line we'd end up and how far
  // over we already are — not simply (used + requested - limit), which
  // would re-charge the overspend from every previous generation this
  // period on every subsequent one.
  const alreadyOver = Math.max(0, used - limit);
  const wouldBeOver = Math.max(0, used + requestedCredits - limit);
  const overflow = wouldBeOver - alreadyOver;

  // Purchased credits (see credit_purchases) cover anything the monthly
  // allowance can't. They deplete, unlike bonus_credits.
  if (overflow > 0 && purchased >= overflow) {
    return { error: null, plan, isAdmin, consumePurchased: overflow };
  }

  if (used + requestedCredits > limit) {
    // Only the true zero-allowance case (no plan, and no bonus credits
    // covering them either) gets the "no plan yet" message — a "none" plan
    // user who's been granted bonus credits and used all of those should see
    // the normal "used them all" message instead, not be told they have no
    // plan when they clearly did have some allowance a moment ago.
    if (plan === "none" && limit === 0) {
      return {
        error:
          "Your account doesn't have an active plan yet, so generations aren't available yet. Reach out and we'll get you set up.",
        plan,
        isAdmin,
      };
    }
    const remaining = Math.max(limit - used, 0);
    const planOrBonusLabel = plan === "none" ? "bonus" : PLAN_LABELS[plan];
    return {
      error:
        requestedCredits > 1
          ? `That would use ${requestedCredits} credits (some models cost more than 1 per video), but you only have ${remaining} left${plan === "none" ? "" : ` on your ${planOrBonusLabel} plan`} this month.`
          : `You've used all ${limit} credits${plan === "none" ? " you've been given" : ` included in your ${planOrBonusLabel} plan`} this month.`,
      plan,
      isAdmin,
    };
  }

  return { error: null, plan, isAdmin };
}

// Draws down the one-time credit balance by the amount the monthly allowance
// couldn't cover (see checkGenerationAllowance). Called right after the
// placeholder row is written, because that row is what getMonthlyUsage
// counts — the credit is spent at insert time, whether or not the
// generation goes on to succeed.
//
// Floored at zero rather than trusted blindly: the balance is re-read here
// instead of reusing the value the allowance check saw, so two requests
// racing each other can't drive it negative.
export async function consumePurchasedCredits(
  supabase: SupabaseClient,
  userId: string,
  amount: number,
): Promise<void> {
  if (!amount || amount <= 0) return;
  const { data } = await supabase
    .from("profiles")
    .select("purchased_credits")
    .eq("id", userId)
    .single();
  const current = (data?.purchased_credits ?? 0) as number;
  await supabase
    .from("profiles")
    .update({ purchased_credits: Math.max(0, current - amount) })
    .eq("id", userId);
}

// Free-tier equivalent of consumePurchasedCredits — a lifetime counter, so
// it is never reset by a billing period rolling over.
export async function consumeFreeGeneration(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const { data } = await supabase
    .from("profiles")
    .select("free_generations_used")
    .eq("id", userId)
    .single();
  await supabase
    .from("profiles")
    .update({ free_generations_used: ((data?.free_generations_used ?? 0) as number) + 1 })
    .eq("id", userId);
}

export async function persistGeneratedImage(
  supabase: SupabaseClient,
  userId: string,
  base64: string,
): Promise<string> {
  const bytes = Buffer.from(base64, "base64");
  const path = `${userId}/${crypto.randomUUID()}.png`;

  const { error } = await supabase.storage
    .from("generated-images")
    .upload(path, bytes, { contentType: "image/png" });
  if (error) throw new Error(`Couldn't save the generated image: ${error.message}`);

  // Stable capability URL (lib/media/url.ts). The previous 7-day signed URL
  // was stored verbatim in generations.result_url — meaning every image in
  // History silently broke a week after it was made. This one never expires.
  return mediaUrl("generated-images", path);
}
