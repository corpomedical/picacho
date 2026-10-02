import type { SupabaseClient } from "@supabase/supabase-js";
import { getMonthlyUsage } from "@/lib/generations/actions";
import { nextMonthlyReset } from "@/lib/generations/core";
import { PLAN_LIMITS, freeSlotOpen, onDailyFreeTier, spendableCredits, type PlanId } from "@/lib/plans";
import { loadAllowances } from "@/lib/settings/account-data";
import { isSetsEnabled } from "@/lib/sets/enabled";
import { setsEligible } from "@/lib/sets/set-config";
import { readProducerGrant } from "@/lib/producer/enabled";
import { isNativeApp } from "@/lib/native/server";
import { firstName } from "@/lib/light/mode";
import { getModelControls } from "@/lib/models/controls";
import { readExperimentalModelsFlag, buildVideoModelOptions } from "@/lib/generations/workspace-data";
import { defaultCreditCost, getVideoModel } from "@/lib/generations/providers/video-models";
import {
  DEFAULT_IMAGE_QUALITY,
  defaultImageResolution,
  imageRenderCreditWeight,
} from "@/lib/generations/providers/image-resolution";
import { menuInitial, menuStatus, rendersFor, type AccountMenuCredits, type AccountMenuData } from "./shape";

// The account menu's numbers (draft B, 2026-10-02). Every figure is read the
// way Settings reads it (app/app/settings/page.tsx): the same plan limit,
// the same billing-month usage, the same allowances (loadAllowances), so the
// menu and Settings → Billing can never disagree.

/** The two videos the "that's about" row counts: the quick lane and the HD one. */
const QUICK_VIDEO_ID = "wan-turbo";
const HD_VIDEO_ID = "minimax-h3";

export async function loadAccountMenu(supabase: SupabaseClient, userId: string, email: string): Promise<AccountMenuData> {
  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "role, username, full_name, plan, plan_status, bonus_credits, purchased_credits, current_period_start, free_generation_last_at, free_reference_generations_used",
    )
    .eq("id", userId)
    .single();

  const plan = ((profile?.plan as PlanId | null) ?? "none") as PlanId;
  const planStatus = (profile?.plan_status as string | null) ?? null;
  const isAdmin = profile?.role === "admin";
  const periodStart = (profile?.current_period_start as string | null) ?? null;
  const bonus = (profile?.bonus_credits as number | null) ?? 0;
  const purchased = (profile?.purchased_credits as number | null) ?? 0;
  const planActive = planStatus == null || planStatus === "active";
  const limit = planActive ? PLAN_LIMITS[plan] : 0;
  const free = onDailyFreeTier(plan, bonus);

  const [used, native, setsOn, producerGranted, buys] = await Promise.all([
    free ? Promise.resolve(0) : getMonthlyUsage(userId, periodStart),
    isNativeApp(),
    setsEligible(plan, isAdmin) ? isSetsEnabled(supabase) : Promise.resolve(false),
    readProducerGrant(supabase, userId),
    renderPrices(supabase),
  ]);

  const allowances = await loadAllowances(supabase, {
    userId,
    plan,
    planStatus,
    isAdmin,
    periodStart,
    setsOn,
    freeReferenceUsed: (profile?.free_reference_generations_used as number | null) ?? 0,
    producerGranted,
  });

  const left = Math.max(0, limit - Math.min(used, limit));
  const credits: AccountMenuCredits = free
    ? { mode: "free", slotOpen: freeSlotOpen(profile?.free_generation_last_at as string | null | undefined), extra: purchased }
    : {
        mode: "plan",
        left,
        limit,
        extra: bonus + purchased,
        spendable: spendableCredits({ monthlyLimit: limit, used, bonus, purchased }),
        resetsOn: limit > 0 ? nextMonthlyReset(periodStart).toISOString() : null,
        paused: !planActive && plan !== "none",
      };

  // The name the sidebar already shows (username, else the email's start);
  // the letter is Light's (first name first), so both frames draw the same one.
  const name = (profile?.username as string | null) ?? email.split("@")[0] ?? "";
  const letterFrom = firstName(profile?.full_name as string | null) ?? name;
  const balance = credits.mode === "plan" ? credits.spendable : 0;

  return {
    name,
    initial: menuInitial(letterFrom || email),
    plan,
    status: menuStatus(plan, planStatus),
    credits,
    about:
      credits.mode === "plan" && balance > 0
        ? {
            pictures: rendersFor(balance, buys.picture),
            quick: rendersFor(balance, buys.quick),
            hd: rendersFor(balance, buys.hd),
          }
        : null,
    allowances: allowances.items,
    lifetime: allowances.lifetime,
    canBuy: !native,
  };
}

/**
 * One render's price in credits at today's defaults: a picture on the lane
 * Admin picked (its default size and quality), and the quick and HD videos
 * at their default length. A video that is switched off or not on offer
 * reads null, and its count is left out.
 */
async function renderPrices(supabase: SupabaseClient): Promise<{ picture: number; quick: number | null; hd: number | null }> {
  const [{ data: imageSetting }, experimental, controls] = await Promise.all([
    supabase.from("app_settings").select("value").eq("key", "image_model").maybeSingle(),
    readExperimentalModelsFlag(supabase),
    getModelControls(),
  ]);
  const imageModelId = (imageSetting?.value as string | undefined) ?? "gpt-image";
  const offered = new Set(buildVideoModelOptions(experimental, controls.off.video).map((m) => m.id));
  const videoPrice = (id: string) => (offered.has(id) ? defaultCreditCost(getVideoModel(id)) : null);
  return {
    picture: imageRenderCreditWeight(imageModelId, defaultImageResolution(imageModelId), DEFAULT_IMAGE_QUALITY),
    quick: videoPrice(QUICK_VIDEO_ID),
    hd: videoPrice(HD_VIDEO_ID),
  };
}
