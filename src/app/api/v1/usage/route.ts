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
    .select("plan, bonus_credits, purchased_credits, current_period_start")
    .eq("id", caller.userId)
    .single();

  const used = await getMonthlyUsageWith(
    supabase,
    caller.userId,
    profile?.current_period_start as string | null | undefined,
  );
  const included = (PLAN_LIMITS[caller.plan] ?? 0) + ((profile?.bonus_credits ?? 0) as number);

  return NextResponse.json({
    plan: caller.plan,
    plan_label: PLAN_LABELS[caller.plan],
    included_this_period: included,
    used_this_period: used,
    remaining_this_period: Math.max(0, included - used),
    // One-off credits, which cover anything the monthly allowance can't.
    purchased_credits: (profile?.purchased_credits ?? 0) as number,
    period_started_at: profile?.current_period_start ?? null,
  });
}
