// What reaches the operator's phone when someone is slipping away
// (2026-10-03, "Who comes back", the alerts board on canvas
// claude.ai/artifact/6Z1sCKGaQMnxDc8i4p6ZSU): a paying customer gone quiet,
// a cancellation, a first render that didn't land. Each fires once per
// person (retention_alerts / subscription_events hold what was sent).
//
// Pure and alias-free; the cron and the webhooks do the sending.
import type { AdminPush } from "../push/alert-rules";
import { planLabel, shortDate, type PersonPath } from "./model";

/** At most this many quiet/stalled pushes per morning run; the rest are summed up in one. */
export const MAX_PUSHES_PER_RUN = 4;

function personActions(userId: string): NonNullable<AdminPush["actions"]> {
  return [
    { action: "write", title: "Write to them", path: `#people/${userId}?write=1` },
    { action: "open", title: "Open", path: `#people/${userId}` },
  ];
}

export function quietPush(p: PersonPath): AdminPush {
  return {
    title: "Paying customer went quiet",
    body: `${p.name} (${planLabel(p.plan)}) hasn’t been back in ${p.quietDays ?? 0} days. Before that: ${p.renders} render${
      p.renders === 1 ? "" : "s"
    } over ${p.activeDays} active day${p.activeDays === 1 ? "" : "s"}.`,
    path: `#people/${p.id}`,
    actions: personActions(p.id),
  };
}

export function stalledPush(p: PersonPath): AdminPush {
  const how = p.firstAttempt?.refused ? "was refused" : "failed";
  return {
    title: "A first render didn’t land",
    body: `${p.name} joined ${shortDate(p.joinedAt)}. The first render ${how}, and nothing since.`,
    path: `#people/${p.id}`,
    actions: personActions(p.id),
  };
}

export function cancelPush(input: {
  userId: string;
  name: string;
  kind: "cancel_scheduled" | "ended";
  plan: string | null;
  endsAt: string | null;
  source: "stripe" | "play";
}): AdminPush {
  const plan = planLabel(input.plan);
  const where = input.source === "play" ? " on Google Play" : "";
  return input.kind === "ended"
    ? {
        title: "Subscription ended",
        body: `${input.name}’s ${plan} plan${where} ended; they’re on the free plan now.`,
        path: `#people/${input.userId}`,
        actions: personActions(input.userId),
      }
    : {
        title: "Subscription cancelled",
        body: `${input.name} cancelled ${plan}${where}.${input.endsAt ? ` Still active until ${shortDate(input.endsAt)}.` : ""}`,
        path: `#people/${input.userId}`,
        actions: personActions(input.userId),
      };
}

export function morePush(count: number): AdminPush {
  return {
    title: `${count} more people are going quiet`,
    body: "They're listed in Admin → Who comes back.",
    path: "#today",
  };
}
