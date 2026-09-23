import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { authenticateApiRequest } from "@/lib/api/keys";
import { getMonthlyUsageWith } from "@/lib/generations/core";
import { PLAN_LABELS, PLAN_LIMITS } from "@/lib/plans";

// GET /api/v1/usage — what's left before generating stops working.
//
// Exists so an integration can check its budget before firing a batch of 300,
// rather than discovering the ceiling as a wall of 402s halfway through.

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = createAdminClient();

  const { caller, error: authError } = await authenticateApiRequest(
    supabase,
    request.headers.get("authorization"),
  );
  if (!caller) {
    return NextResponse.json(
      { error: { code: authError.code, message: authError.message } },
      { status: authError.status },
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("plan, plan_status, bonus_credits, purchased_credits, current_period_start")
    .eq("id", caller.userId)
    .single();

  const used = await getMonthlyUsageWith(
    supabase,
    caller.userId,
    profile?.current_period_start as string | null | undefined,
  );
  // Same rule as enforcement (checkGenerationAllowance): the plan portion is
  // zero while plan_status says the subscription lapsed (NULL passes —
  // comped plans never had one). This endpoint exists so an integration can
  // check its budget instead of discovering the ceiling as a wall of 402s —
  // reporting a full allowance the spend path would refuse was exactly that.
  const planStatus = ((profile as { plan_status?: string | null } | null)?.plan_status ?? null) as
    | string
    | null;
  const planAllowanceActive = planStatus === null || planStatus === "active";
  // The PLAN's allowance alone. Bonus credits became a depleting balance on
  // 2026-09-23 and are reported beside purchased credits below, because that
  // is what they now are — a balance that does not come back next period.
  const included = planAllowanceActive ? (PLAN_LIMITS[caller.plan] ?? 0) : 0;

  return NextResponse.json({
    plan: caller.plan,
    plan_label: PLAN_LABELS[caller.plan],
    included_this_period: included,
    used_this_period: used,
    remaining_this_period: Math.max(0, included - used),
    // Balances, which cover anything the monthly allowance can't. Both
    // deplete and neither renews with the billing period.
    bonus_credits: (profile?.bonus_credits ?? 0) as number,
    purchased_credits: (profile?.purchased_credits ?? 0) as number,
    period_started_at: profile?.current_period_start ?? null,
  });
}
