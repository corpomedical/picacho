// Going-quiet people as Today's "Needs you" rows (2026-10-03, Who comes
// back): the Overview's inbox and the phone app's Today both read them from
// loadToday. Fails soft — a problem here leaves the rest of Today intact.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InboxItem } from "@/lib/admin/today";
import { loadRetention } from "./load";
import type { GoingQuiet } from "./model";

const SUBJECTS: Record<GoingQuiet["kind"], string> = {
  paying: "Checking in from Picacho",
  cancelled: "A quick question from Picacho",
  stalled: "Your first Picacho render",
};

/**
 * A personal email from the admin's own mail app (the Feedback rows' Reply
 * works the same way). None for someone who opted out of marketing email:
 * a "we miss you" note is exactly what they said no to.
 */
export function writeHref(q: Pick<GoingQuiet, "kind" | "email" | "optedOut">): string | null {
  if (!q.email || q.optedOut) return null;
  return `mailto:${q.email}?subject=${encodeURIComponent(SUBJECTS[q.kind])}`;
}

export const QUIET_KIND_LABEL: Record<GoingQuiet["kind"], string> = {
  paying: "Paying",
  cancelled: "Cancelled",
  stalled: "Stalled",
};

const TONE: Record<GoingQuiet["kind"], InboxItem["tone"]> = { cancelled: "urgent", paying: "warn", stalled: "info" };

export function inboxItemFor(q: GoingQuiet): InboxItem {
  const write = writeHref(q);
  return {
    id: `retention-${q.kind}-${q.id}`,
    group: "people",
    kind: QUIET_KIND_LABEL[q.kind],
    tone: TONE[q.kind],
    title: q.title,
    sub: q.optedOut ? `${q.sub} · opted out of marketing email` : q.sub,
    at: q.at,
    actions: [
      ...(write ? [{ type: "link" as const, label: "Write to them", href: write, primary: true }] : []),
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
