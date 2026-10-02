// Cancellations, written down (2026-10-03, "Who comes back"). Until now a
// Stripe cancellation reset the profile and left no trace, and a Play one
// was only logged to the console — so Admin couldn't tell who left, or when,
// and the operator found out by noticing a missing payment.
//
// The webhooks call noteSubscriptionEvent; it never throws, so a missing
// table (supabase/pending/who-comes-back.sql not run yet) or a failed write
// can't make Stripe or RevenueCat redeliver a payment event.
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyAdmins } from "@/lib/push/web-push";
import { cancelPush } from "./alerts";

export type SubscriptionEventKind = "cancel_scheduled" | "cancel_undone" | "ended";

type CancelFields = { cancel_at_period_end?: boolean | null; cancel_at?: number | null };

function scheduled(s: CancelFields): boolean {
  return s.cancel_at_period_end === true || (typeof s.cancel_at === "number" && s.cancel_at > 0);
}

/**
 * What a Stripe customer.subscription.updated event changed about the
 * cancellation, from its previous_attributes: they pressed Cancel
 * (cancel_scheduled), took it back (cancel_undone), or neither (null).
 */
export function cancelTransition(
  previous: CancelFields | null | undefined,
  current: CancelFields,
): "cancel_scheduled" | "cancel_undone" | null {
  if (!previous || !("cancel_at_period_end" in previous || "cancel_at" in previous)) return null;
  const before = scheduled({
    cancel_at_period_end: "cancel_at_period_end" in previous ? previous.cancel_at_period_end : current.cancel_at_period_end,
    cancel_at: "cancel_at" in previous ? previous.cancel_at : current.cancel_at,
  });
  const after = scheduled(current);
  if (after && !before) return "cancel_scheduled";
  if (before && !after) return "cancel_undone";
  return null;
}

export type SubscriptionEvent = {
  userId: string;
  kind: SubscriptionEventKind;
  source: "stripe" | "play";
  plan: string | null;
  subscriptionId: string | null;
  endsAt: string | null;
  /** The webhook event's id: a redelivery writes nothing and buzzes nobody. */
  externalId: string;
};

/**
 * Records the event and, the first time it's seen, tells the operator's
 * phone: every cancellation, and a plan ending that wasn't announced by a
 * cancellation first (cancelled on the spot, or renewals that kept failing).
 */
export async function noteSubscriptionEvent(admin: SupabaseClient, event: SubscriptionEvent): Promise<void> {
  try {
    const { error } = await admin.from("subscription_events").insert({
      user_id: event.userId,
      kind: event.kind,
      source: event.source,
      plan: event.plan,
      subscription_id: event.subscriptionId,
      ends_at: event.endsAt,
      external_id: event.externalId,
    });
    if (error) {
      if (error.code !== "23505") console.warn("subscription_events: not recorded —", error.message);
      return;
    }
    if (event.kind === "cancel_undone") return;

    if (event.kind === "ended" && event.subscriptionId) {
      const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      const { data: announced } = await admin
        .from("subscription_events")
        .select("id")
        .eq("subscription_id", event.subscriptionId)
        .eq("kind", "cancel_scheduled")
        .gte("created_at", since)
        .limit(1);
      if (announced?.length) return;
    }

    const { data: person } = await admin
      .from("profiles")
      .select("full_name, username, email")
      .eq("id", event.userId)
      .maybeSingle();
    const name =
      (person?.full_name as string | null)?.trim() ||
      (person?.username as string | null)?.trim() ||
      ((person?.email as string | null) ?? "").split("@")[0] ||
      "Someone";
    await notifyAdmins(
      cancelPush({ userId: event.userId, name, kind: event.kind, plan: event.plan, endsAt: event.endsAt, source: event.source }),
    );
  } catch (err) {
    console.warn("subscription_events: failed —", err instanceof Error ? err.message : err);
  }
}
