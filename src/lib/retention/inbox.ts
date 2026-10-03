// Going-quiet people as Today's "Needs you" rows (2026-10-03, Who comes
// back): the Overview's inbox and the phone app's Today both read them from
// loadToday. Fails soft — a problem here leaves the rest of Today intact.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InboxItem } from "@/lib/admin/today";
import { loadRetention } from "./load";
import type { GoingQuiet } from "./model";

export type WriteDraft = { to: string; subject: string; message: string };

/**
 * The note "Write to them" opens with, in the team's voice (emails are signed
 * "The Picacho team", never as the founder). The admin edits it before
 * sending. None for someone with no email or who opted out of marketing
 * email: a "we miss you" note is exactly what they said no to.
 */
export function writeDraft(q: Pick<GoingQuiet, "kind" | "email" | "optedOut" | "name">): WriteDraft | null {
  if (!q.email || q.optedOut) return null;
  const first = q.name.trim().split(/\s+/)[0] || "there";
  if (q.kind === "paying") {
    return {
      to: q.email,
      subject: "Checking in from Picacho",
      message: `Hi ${first},\n\nWe noticed you haven't been on Picacho for a few days and wanted to check that everything is working for you.\n\nIs anything getting in the way, or is there something you'd like Picacho to do that it doesn't yet? Just reply to this email. It comes straight to us.`,
    };
  }
  if (q.kind === "cancelled") {
    return {
      to: q.email,
      subject: "A quick question from Picacho",
      message: `Hi ${first},\n\nSorry to see you cancel your plan. Would you tell us what made you decide? One line is plenty, and it goes straight to the people who build Picacho.\n\nThank you for trying it.`,
    };
  }
  return {
    to: q.email,
    subject: "Your first Picacho render",
    message: `Hi ${first},\n\nYour first render on Picacho didn't come through, and we're sorry about that.\n\nIf you tell us what you were trying to make, we'll help you get it working. Just reply to this email.`,
  };
}

/** A plain note to anyone (a person's Emails card), when no going-quiet draft fits. */
export function noteDraft(p: { name: string; email: string | null; optedOut: boolean }): WriteDraft | null {
  if (!p.email || p.optedOut) return null;
  const first = p.name.trim().split(/\s+/)[0] || "there";
  return { to: p.email, subject: "Hello from Picacho", message: `Hi ${first},\n\n` };
}

export const QUIET_KIND_LABEL: Record<GoingQuiet["kind"], string> = {
  paying: "Paying",
  cancelled: "Cancelled",
  stalled: "Stalled",
};

const TONE: Record<GoingQuiet["kind"], InboxItem["tone"]> = { cancelled: "urgent", paying: "warn", stalled: "info" };

export function inboxItemFor(q: GoingQuiet): InboxItem {
  const write = writeDraft(q);
  return {
    id: `retention-${q.kind}-${q.id}`,
    group: "people",
    kind: QUIET_KIND_LABEL[q.kind],
    tone: TONE[q.kind],
    title: q.title,
    sub: q.optedOut ? `${q.sub} · opted out of marketing email` : q.sub,
    at: q.at,
    actions: [
      ...(write ? [{ type: "write" as const, label: "Write to them", userId: q.id, name: q.name, ...write, primary: true }] : []),
      { type: "link" as const, label: "Open", href: `/admin/users/${q.id}` },
    ],
  };
}

export async function loadRetentionInbox(admin: SupabaseClient, now = Date.now()): Promise<InboxItem[]> {
  try {
    return (await loadRetention(admin, 7, now)).quiet.map(inboxItemFor);
  } catch (err) {
    console.warn("retention: inbox unread —", err instanceof Error ? err.message : err);
    return [];
  }
}
