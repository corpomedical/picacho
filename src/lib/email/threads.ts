// Emails sent and received (2026-10-03, operator: "I need to see emails
// sent and received. I sent the email but im not sure if it went through."
// → on each person and a Sent & replies list on Admin → Emails; replies come
// into Picacho with a copy to hello@picacho.ai).
//
// admin_emails holds every note written from the site, what Resend reported
// about it, and every reply, threaded. Service client only. Everything here
// fails soft: before supabase/pending/admin-emails.sql runs, notes still
// send and the lists are simply empty.
import type { SupabaseClient } from "@supabase/supabase-js";

export const EMAIL_COLUMNS =
  "id, user_id, admin_id, direction, from_email, to_email, subject, body, status, reply_to_id, delivered_at, opened_at, clicked_at, created_at";

export type EmailStatus = "sending" | "sent" | "delivered" | "delivery_delayed" | "bounced" | "complained" | "failed" | "received";

export type EmailRow = {
  id: string;
  user_id: string | null;
  admin_id: string | null;
  direction: "out" | "in";
  from_email: string;
  to_email: string;
  subject: string;
  body: string;
  status: EmailStatus;
  reply_to_id: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  created_at: string;
};

/** The domain replies come back to (Resend receiving), once it's set up; until then replies go to hello@. */
export function replyDomain(): string | null {
  const d = (process.env.EMAIL_REPLY_DOMAIN ?? "").trim().toLowerCase();
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) ? d : null;
}

/** Writes the note down before it's sent (its id is the reply address); null if it can't be recorded. */
export async function startNote(
  admin: SupabaseClient,
  note: { userId: string; adminId: string; from: string; to: string; subject: string; body: string },
): Promise<string | null> {
  try {
    const { data, error } = await admin
      .from("admin_emails")
      .insert({
        user_id: note.userId,
        admin_id: note.adminId,
        direction: "out",
        from_email: note.from.slice(0, 320),
        to_email: note.to.slice(0, 320),
        subject: note.subject.slice(0, 300),
        body: note.body.slice(0, 20000),
        status: "sending",
      })
      .select("id")
      .single();
    if (error) {
      console.warn("admin_emails: note not recorded —", error.message);
      return null;
    }
    return (data?.id as string) ?? null;
  } catch (err) {
    console.warn("admin_emails: note not recorded —", err instanceof Error ? err.message : err);
    return null;
  }
}

/** After the send: Resend's id and "sent", or "failed". */
export async function finishNote(admin: SupabaseClient, id: string, result: { resendId: string | null; failed: boolean }): Promise<void> {
  try {
    await admin
      .from("admin_emails")
      .update(result.failed ? { status: "failed" } : { status: "sent", resend_id: result.resendId })
      .eq("id", id);
  } catch {
    // The note went (or didn't) either way; the list just won't show it.
  }
}

// Later news never overwrites more final news: a "sent" arriving after
// "delivered" (webhooks come in any order) leaves "delivered".
const RANK: Record<EmailStatus, number> = {
  sending: 0,
  sent: 1,
  delivery_delayed: 2,
  delivered: 3,
  complained: 4,
  bounced: 5,
  failed: 5,
  received: 0,
};

const EVENT_STATUS: Record<string, EmailStatus | undefined> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delivery_delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
  "email.suppressed": "failed",
};

/** The status after an event, given the one stored (pure; tested). */
export function nextStatus(current: EmailStatus, eventType: string): EmailStatus {
  const next = EVENT_STATUS[eventType];
  if (!next) return current;
  return RANK[next] >= RANK[current] ? next : current;
}

/** Resend said something about a note we sent: delivered, opened, bounced… (other emails are ignored). */
export async function applyDeliveryEvent(admin: SupabaseClient, eventType: string, resendId: string, at: string): Promise<void> {
  const { data: row } = await admin.from("admin_emails").select("id, status, delivered_at, opened_at, clicked_at").eq("resend_id", resendId).maybeSingle();
  if (!row) return;
  const update: Record<string, string> = {};
  const status = nextStatus(row.status as EmailStatus, eventType);
  if (status !== row.status) update.status = status;
  if (eventType === "email.delivered" && !row.delivered_at) update.delivered_at = at;
  if (eventType === "email.opened" && !row.opened_at) update.opened_at = at;
  if (eventType === "email.clicked" && !row.clicked_at) update.clicked_at = at;
  if (Object.keys(update).length) await admin.from("admin_emails").update(update).eq("id", row.id);
}

/** One person's emails, oldest first (a conversation reads top to bottom). */
export async function loadThread(admin: SupabaseClient, userId: string, limit = 40): Promise<EmailRow[]> {
  try {
    const { data, error } = await admin
      .from("admin_emails")
      .select(EMAIL_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return [];
    return ((data ?? []) as EmailRow[]).reverse();
  } catch {
    return [];
  }
}

/** Everything sent and received, newest first, with each person's name. */
export async function loadRecentEmails(
  admin: SupabaseClient,
  limit = 50,
): Promise<{ rows: (EmailRow & { person: string | null })[]; ready: boolean }> {
  try {
    const { data, error } = await admin.from("admin_emails").select(EMAIL_COLUMNS).order("created_at", { ascending: false }).limit(limit);
    if (error) return { rows: [], ready: false };
    const rows = (data ?? []) as EmailRow[];
    const ids = [...new Set(rows.map((r) => r.user_id).filter((x): x is string => !!x))];
    const { data: people } = ids.length
      ? await admin.from("profiles").select("id, full_name, username, email").in("id", ids)
      : { data: [] as { id: string; full_name: string | null; username: string | null; email: string | null }[] };
    const names = new Map(
      (people ?? []).map((p) => [
        p.id as string,
        ((p.full_name as string | null)?.trim() || (p.username as string | null)?.trim() || ((p.email as string | null) ?? "").split("@")[0]) ?? null,
      ]),
    );
    return { rows: rows.map((r) => ({ ...r, person: r.user_id ? (names.get(r.user_id) ?? null) : null })), ready: true };
  } catch {
    return { rows: [], ready: false };
  }
}

/** A reply, written down under the note it answers; false if it was already recorded (a redelivered webhook). */
export async function recordReply(
  admin: SupabaseClient,
  reply: { resendId: string; userId: string | null; replyToId: string | null; from: string; to: string; subject: string; body: string; at: string },
): Promise<{ id: string } | null> {
  const { data, error } = await admin
    .from("admin_emails")
    .insert({
      user_id: reply.userId,
      direction: "in",
      from_email: reply.from.slice(0, 320),
      to_email: reply.to.slice(0, 320),
      subject: reply.subject.slice(0, 300),
      body: reply.body.slice(0, 20000),
      resend_id: reply.resendId,
      reply_to_id: reply.replyToId,
      status: "received",
      created_at: reply.at,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code !== "23505") console.warn("admin_emails: reply not recorded —", error.message);
    return null;
  }
  return { id: data.id as string };
}

/** The label a status shows as. */
export const STATUS_LABEL: Record<EmailStatus, string> = {
  sending: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  delivery_delayed: "Delayed",
  bounced: "Bounced",
  complained: "Marked as spam",
  failed: "Failed",
  received: "Reply",
};
