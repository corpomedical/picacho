import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { mediaUrl } from "@/lib/media/url";
import { PLAN_LABELS, PLAN_LIMITS, onDailyFreeTier, freeSlotOpen, type PlanId } from "@/lib/plans";
import { FREE_TIER_GENERATION_CREDITS } from "@/lib/generations/providers/video-models";

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
export function latestMonthlyAnniversary(periodStart: Date): Date {
  const now = new Date();
  let current = new Date(periodStart);
  // A malformed current_period_start would make `next > now` never true
  // (every comparison against an Invalid Date is false), spinning this loop
  // forever and hanging every allowance check for that user. Fall back to the
  // start of the current month rather than loop.
  if (Number.isNaN(current.getTime())) {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  for (;;) {
    const next = new Date(current);
    next.setMonth(next.getMonth() + 1);
    if (next > now) return current;
    current = next;
  }
}

// The start of the caller's current monthly usage window — the anchor both the
// usage sum and the atomic reservation must agree on. Extracted so they can't
// drift.
export function monthlyWindowStart(periodStart?: string | null): Date {
  if (periodStart) return latestMonthlyAnniversary(new Date(periodStart));
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  return startOfMonth;
}

// Sums credits used since the start of the caller's current monthly window.
//
// Takes the client: with a cookie-scoped client RLS narrows this to the
// caller's own rows, but a service client sees every row in the table, so the
// user_id filter below is what makes it correct in both cases. Dropping it
// would silently bill one account for the whole platform's usage.
export async function getMonthlyUsageWith(
  // Kept in the signature for its callers, but the sum now runs through a
  // service-role RPC (below) rather than this client: a PostgREST select is
  // capped at ~1000 rows, so summing rows in JS silently undercounted usage for
  // any account with >1000 generations in its window — lifting the plan cap for
  // exactly the heaviest accounts. A SQL sum has no such cap.
  _supabase: SupabaseClient,
  userId: string,
  periodStart?: string | null,
) {
  const start = monthlyWindowStart(periodStart);

  // monthly_credits_used counts NULL credits_used as 1 (legacy rows) and a real
  // 0 as 0, exactly as the previous JS reduce did — EXECUTE is revoked from
  // authenticated, so it goes through the service-role client. The explicit
  // user_id argument is what scopes it (the service role bypasses RLS).
  const admin = createAdminClient();
  const { data } = await admin.rpc("monthly_credits_used", {
    p_user_id: userId,
    p_since: start.toISOString(),
  });
  return Number(data) || 0;
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
  // The 3-second cooldown imitates a human clicking; a script calling the
  // public API is EXPECTED to be faster than that, and the API has its own
  // per-minute limit. Leaving this on made the API's real ceiling 20/min
  // while its documentation promised 30, and reported the refusal as a
  // billing error rather than a rate limit.
  options?: { skipCooldown?: boolean },
): Promise<{
  error: string | null;
  plan: PlanId;
  isAdmin: boolean;
  consumePurchased?: number;
  consumeFree?: boolean;
  // For the caller's atomic reservation (reserve_generation): the plan+bonus
  // monthly limit and the ISO start of the usage window this decision was made
  // against, so the RPC re-checks the exact same window under its lock.
  monthlyLimit?: number;
  periodStartIso?: string;
}> {
  const [{ data: profile }, { data: recent }] = await Promise.all([
    supabase
      .from("profiles")
      .select("plan, plan_status, role, status, bonus_credits, purchased_credits, free_generation_last_at, current_period_start")
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
  const periodStartIso = monthlyWindowStart(
    profile?.current_period_start as string | null | undefined,
  ).toISOString();

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

  if (isAdmin) return { error: null, plan, isAdmin, periodStartIso };

  const lastCreatedAt = recent?.[0]?.created_at as string | undefined;
  if (
    !options?.skipCooldown &&
    lastCreatedAt &&
    Date.now() - new Date(lastCreatedAt).getTime() < COOLDOWN_MS
  ) {
    return {
      error: "You're generating a bit fast — wait a few seconds and try again.",
      plan,
      isAdmin,
    };
  }

  // Free tier: ONE free generation per day (2026-08-19, replacing the
  // lifetime five — see the free-tier note in plans.ts), checked before the
  // monthly-allowance logic below because it works on a different axis
  // entirely (resets at the database's UTC midnight, isn't affected by
  // billing periods). Accounts that have been granted bonus credits fall
  // through to the normal path instead — those are a deliberate gift and
  // shouldn't be capped at one a day.
  if (onDailyFreeTier(plan, profile?.bonus_credits as number | null | undefined)) {
    // Eligibility and the UTC-midnight arithmetic live in plans.ts now (the
    // audit found five hand-kept copies of this rule) — the RPC's guarded
    // UPDATE remains what makes the actual spend atomic.
    const slotOpen = freeSlotOpen(profile?.free_generation_last_at as string | null | undefined);
    // The day's slot only ever covers a request no bigger than the trial's
    // own pinned shape — the free model at its default duration, whose
    // weight is FREE_TIER_GENERATION_CREDITS (derived from the catalog,
    // 2026-08-19; this was a literal `=== 1`, which meant reassigning
    // FREE_TIER_VIDEO_MODEL_ID to any 2-credit model would have silently
    // bricked the trial for every new signup). The trial is counted per
    // generation (one a day), not per credit, which is safe precisely
    // because a pure trial account is pinned to that exact shape (enforced
    // in runGeneration). But an account that BOUGHT credits is deliberately
    // unpinned (see isFreeTierAccount in actions.ts), so with today's slot
    // still open it could otherwise pay for an expensive Veo render with
    // the one daily slot — a many-x mispricing of the trial budget.
    // Requests above the ceiling fall through to the purchased-credit spend
    // below instead; requests at or under it keep the existing priority
    // (trial first, purchased after), where one generation is at most one
    // trial-generation's worth of cost and the two can't drift apart. A
    // pure trial account is never blocked by this: the composer only ever
    // sends it the pinned shape, and if a direct call asks for more, the
    // top-up error below is the honest answer.
    if (slotOpen && requestedCredits <= FREE_TIER_GENERATION_CREDITS) {
      return { error: null, plan, isAdmin, consumeFree: true, periodStartIso };
    }

    // Today's slot spent — but purchased credits still spend here. Anyone
    // can buy a credit pack by design (see the "deliberately no plan gating"
    // note in stripe/credit-packs.ts), so a free-tier account that topped up
    // must be able to use what it paid for. The old code returned "used it
    // all" without ever reading purchased_credits, which made every pack
    // sold to a free account dead money — paid for and unspendable.
    const freeTierPurchased = (profile?.purchased_credits ?? 0) as number;
    if (freeTierPurchased >= requestedCredits) {
      return {
        error: null,
        plan,
        isAdmin,
        consumePurchased: requestedCredits,
        monthlyLimit: 0,
        periodStartIso,
      };
    }
    return {
      error:
        freeTierPurchased > 0
          ? `That would use ${requestedCredits} credits (some models cost more than 1 per video), but you only have ${freeTierPurchased} left. Top up or pick a plan to keep going.`
          : // Today's slot still open but the request costs more than a
            // trial generation covers (only reachable by a direct call — the
            // composer pins trial accounts to the trial shape): say what the
            // trial actually covers rather than falsely claiming it's used up.
            slotOpen
            ? `That would use ${requestedCredits} credits (some models cost more than 1 per video) — the free trial only covers generations of up to ${FREE_TIER_GENERATION_CREDITS} credit${FREE_TIER_GENERATION_CREDITS === 1 ? "" : "s"}. Top up credits or pick a plan to use this one.`
            : `You've used today's free generation — it comes back tomorrow. Pick a plan or top up credits to keep going — ` +
              `your characters and history stay exactly as they are.`,
      plan,
      isAdmin,
    };
  }

  // The plan's monthly allowance only exists while Stripe says the
  // subscription is in good standing. Quota used to read profiles.plan alone
  // and never plan_status, so a subscriber whose card failed (past_due) kept
  // burning their full allowance for as long as the row still said "growth" —
  // free renders against a payment that never arrived. plan_status is written
  // by the webhook's statusToPlanStatus: "active" covers Stripe's active AND
  // trialing; past_due covers past_due/unpaid; canceled and inactive are the
  // dead states. NULL passes on purpose — comped plans (setUserPlan) and
  // pre-Stripe accounts never had a plan_status, and those allowances are a
  // deliberate grant, not a lapsed payment. A gated account keeps spending
  // bonus and purchased credits below; only the plan portion is paused.
  const planStatus = (profile?.plan_status ?? null) as string | null;
  const planAllowanceActive = planStatus === null || planStatus === "active";

  // Bonus credits (admin-granted, see setBonusCredits) stack on top of the
  // plan's normal allowance rather than replacing it.
  const limit = (planAllowanceActive ? (PLAN_LIMITS[plan] ?? 0) : 0) + (profile?.bonus_credits ?? 0);
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
    return { error: null, plan, isAdmin, consumePurchased: overflow, monthlyLimit: limit, periodStartIso };
  }

  if (used + requestedCredits > limit) {
    // A paused subscription gets its own message — "you've used all 0
    // credits included in your Growth plan" would be both baffling and
    // wrong. Says what happened and what unblocks it.
    if (!planAllowanceActive && plan !== "none") {
      return {
        error:
          planStatus === "past_due"
            ? `Your last payment for the ${PLAN_LABELS[plan]} plan failed, so its monthly credits are paused — update your payment method in Settings, or top up credits to keep going.`
            : `Your ${PLAN_LABELS[plan]} plan isn't active anymore, so its monthly credits are paused. Pick a plan or top up credits to keep going.`,
        plan,
        isAdmin,
      };
    }
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

  return { error: null, plan, isAdmin, monthlyLimit: limit, periodStartIso };
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
  _supabase: SupabaseClient,
  userId: string,
  amount: number,
): Promise<boolean> {
  if (!amount || amount <= 0) return true;
  // Atomic GUARDED spend: decrements only if the balance covers it, and returns
  // whether it did. This fixes the lost-update race AND lets the caller abort
  // before any paid work when a concurrent request already spent the credit —
  // the read in checkGenerationAllowance can't be trusted under concurrency.
  // `authenticated` cannot call this RPC.
  const admin = createAdminClient();
  const { data } = await admin.rpc("spend_purchased_credits", { p_user_id: userId, p_amount: amount });
  return data === true;
}

// Free-tier equivalent of consumePurchasedCredits — spends today's daily
// slot (2026-08-19 daily trial). No limit argument: "one per day" is
// structural in the RPC's WHERE clause, not a tunable count.
export async function consumeFreeGeneration(
  _supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  // Atomic GUARDED spend: stamps free_generation_last_at only while today's
  // slot is unspent, and returns whether it did — so concurrent free
  // generations can't all pass a stale read and run several free paid
  // renders in one day. The caller aborts before any paid work when this
  // returns false — which is also what happens while the RPC doesn't exist
  // yet (supabase/applied/2026-08-19/daily-trial.sql not applied): no data
  // reads as false, so the path fails closed rather than unmetered.
  const admin = createAdminClient();
  const { data } = await admin.rpc("spend_daily_free_generation", {
    p_user_id: userId,
  });
  return data === true;
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

/**
 * Copy a finished VIDEO off the provider's CDN into our own bucket, and hand
 * back the stable media URL.
 *
 * WHY THIS EXISTS (2026-09-04). Until today a finished video was never copied
 * anywhere: the collect path wrote the provider's own CDN URL straight into
 * generations.result_url. fal support then told us, asked directly, that "if
 * not set, by default we can only guarantee 7 days" — so every video in every
 * customer's History was a link with a week's promise behind it. A lifecycle
 * header now asks fal for no expiration, which stopped the bleeding, but a
 * promise from someone else's CDN is not the same as owning the file. This is.
 *
 * NEVER LOSES A RENDER. Every failure path returns null and the caller keeps
 * the provider URL — a video that plays from fal is strictly better than a
 * generation that reports success with a dead link. That fallback is only
 * honest because of the lifecycle header; without it, falling back would be
 * choosing the seven-day version.
 *
 * The size cap is a memory guard, not a policy: this buffers the whole file to
 * upload it, and a serverless invocation that tries to hold a 30-second 1080p
 * render can die in a way that takes the terminal write with it.
 */
const MAX_PERSISTED_VIDEO_BYTES = 200 * 1024 * 1024;

export async function persistGeneratedVideo(
  supabase: SupabaseClient,
  userId: string,
  providerUrl: string,
): Promise<string | null> {
  try {
    // Bounded: this runs while the caller holds the 90s advance claim, and a
    // download that outlives the lease invites a second caller to re-collect
    // the same stage and double-submit the paid dialogue jobs. A file too big
    // or a CDN too slow for 45s falls back to the provider URL — the designed,
    // honest fallback. (The upload below has no abort hook in storage-js; the
    // Vercel-to-Supabase leg is the fast one.)
    const res = await fetch(providerUrl, { signal: AbortSignal.timeout(45_000) });
    if (!res.ok) {
      console.warn(`persistGeneratedVideo: provider returned ${res.status}; keeping their URL.`);
      return null;
    }
    // Trust the header when it is there, and check the real length after the
    // read as well — a chunked response carries no content-length.
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > MAX_PERSISTED_VIDEO_BYTES) {
      console.warn(`persistGeneratedVideo: ${declared} bytes is over the cap; keeping their URL.`);
      return null;
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength > MAX_PERSISTED_VIDEO_BYTES) {
      console.warn(`persistGeneratedVideo: ${bytes.byteLength} bytes is over the cap; keeping their URL.`);
      return null;
    }

    const contentType = res.headers.get("content-type") ?? "video/mp4";
    // .mov only when the provider says so — ModelArk's 2.5 can return it.
    const ext = contentType.includes("quicktime") ? "mov" : "mp4";
    const path = `${userId}/${crypto.randomUUID()}.${ext}`;

    const { error } = await supabase.storage
      .from("generated-videos")
      .upload(path, bytes, { contentType, upsert: false });
    if (error) {
      console.warn(`persistGeneratedVideo: upload failed (${error.message}); keeping their URL.`);
      return null;
    }
    return mediaUrl("generated-videos", path);
  } catch (err) {
    console.warn(
      `persistGeneratedVideo: ${err instanceof Error ? err.message : String(err)}; keeping their URL.`,
    );
    return null;
  }
}

/**
 * Store image bytes at a CHOSEN path in generated-images and return the
 * stable media URL. Layers need deterministic paths
 * (userId/layers/generationId/zN.png) so a stack can be re-read by
 * generation id.
 *
 * Two invariants persistGeneratedImage gets for free are enforced here
 * rather than trusted from callers. The path must sit under the owner's
 * folder — the bucket's RLS is keyed on it. And an existing object is never
 * rewritten: the media route serves everything immutable for a year, so a
 * rewrite with different bytes would ship stale pixels to anyone who had
 * already looked. A retry that finds its own earlier upload (a transport
 * blip mid-loop re-runs the pass) is a success, not a conflict; a step that
 * wants new pixels must choose a new path.
 */
export async function persistImageBytes(
  supabase: SupabaseClient,
  userId: string,
  path: string,
  bytes: Uint8Array,
  contentType = "image/png",
): Promise<string> {
  if (!path.startsWith(`${userId}/`) || path.includes("..")) {
    throw new Error("persistImageBytes: path must sit under the owner's folder.");
  }
  const { error } = await supabase.storage
    .from("generated-images")
    .upload(path, bytes, { contentType, upsert: false });
  if (error) {
    const alreadyThere =
      /already exists|duplicate/i.test(error.message) ||
      (error as { statusCode?: string | number }).statusCode === "409" ||
      (error as { statusCode?: string | number }).statusCode === 409;
    if (!alreadyThere) throw new Error(`Couldn't save the image: ${error.message}`);
  }
  return mediaUrl("generated-images", path);
}

/**
 * Resize a re-cut layer back to the pixel size of the layer it replaces.
 *
 * The edit endpoint normalises dimensions — a 605×1088 layer came back
 * 592×1088 on 2026-09-04 — so a straight swap would squash the subject by
 * about 2% against its bounding box. The silhouette fills its frame the same
 * way before and after (measured: 0.1% drift), so scaling to the original's
 * exact width and height restores registration without touching the box.
 *
 * `fit: "fill"` on purpose: the aspect difference IS the correction. Any
 * other fit would letterbox or crop, which is what moves a subject.
 */
export async function fitLayerToOriginal(
  bytes: Uint8Array,
  width: number,
  height: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const sharp = (await import("sharp")).default;
  const out = await sharp(bytes)
    .resize(width, height, { fit: "fill" })
    .png()
    .toBuffer();
  // Copy into a plain ArrayBuffer: Buffer's is ArrayBufferLike, which the
  // storage client's Uint8Array<ArrayBuffer> parameter will not take.
  const copy = new Uint8Array(new ArrayBuffer(out.byteLength));
  copy.set(out);
  return copy;
}
