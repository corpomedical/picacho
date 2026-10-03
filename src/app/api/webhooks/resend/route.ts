import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { notifyAdmins } from "@/lib/push/web-push";
import { sendEmail } from "@/lib/email/send";
import { fetchWithTimeout } from "@/lib/generations/providers/fetch-with-timeout";
import { LEGAL_ENTITY } from "@/lib/legal-entity";
import { applyDeliveryEvent, recordReply, replyDomain } from "@/lib/email/threads";
import { bareAddress, noteIdFromRecipients, replyOnly, senderName, textFromHtml, verifyWebhook } from "@/lib/email/inbound";

// Resend's webhooks (2026-10-03, emails sent and received). Operator: "I
// need to see emails sent and received. I sent the email but im not sure if
// it went through." Two kinds of news arrive here:
//   - what happened to a note an admin sent: delivered, opened, clicked,
//     bounced, marked as spam, delayed, failed → its row in admin_emails;
//   - email.received: a reply to reply+<note id>@<EMAIL_REPLY_DOMAIN> →
//     written down under that note, the operator's phone told, and a copy
//     forwarded to hello@picacho.ai (his pick: in Picacho + a copy to hello@).
// Signed the Svix way with RESEND_WEBHOOK_SECRET; anything unsigned is
// refused. Answers 200 once it has what it needs, so Resend doesn't redeliver
// for a problem on our side that a retry wouldn't fix.
export const runtime = "nodejs";

const HELLO = `${LEGAL_ENTITY.emailUser}@${LEGAL_ENTITY.emailDomain}`;

type Received = { email_id?: string; from?: string; to?: string[] | string; subject?: string; created_at?: string };

async function fullReply(emailId: string): Promise<{ text: string } | null> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  try {
    const res = await fetchWithTimeout(
      `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`,
      { headers: { authorization: `Bearer ${key}` } },
      15_000,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { text?: string | null; html?: string | null };
    const text = (body.text ?? "").trim() || textFromHtml(body.html ?? "");
    return { text };
  } catch {
    return null;
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

async function onReceived(data: Received) {
  const admin = createAdminClient();
  const emailId = data.email_id ?? "";
  const from = data.from ?? "";
  const fromAddr = bareAddress(from);
  if (!emailId || !fromAddr) return;
  const to = Array.isArray(data.to) ? data.to : data.to ? [data.to] : [];
  const domain = replyDomain();

  // Which note it answers: the reply address first, else their latest note.
  const noteId = domain ? noteIdFromRecipients(to, domain) : null;
  type Parent = { id: string; user_id: string | null; subject: string };
  let parent: Parent | null = null;
  if (noteId) {
    const { data: row } = await admin.from("admin_emails").select("id, user_id, subject").eq("id", noteId).eq("direction", "out").maybeSingle();
    parent = (row as Parent | null) ?? null;
  }
  if (!parent) {
    const { data: rows } = await admin
      .from("admin_emails")
      .select("id, user_id, subject")
      .eq("direction", "out")
      .ilike("to_email", fromAddr)
      .order("created_at", { ascending: false })
      .limit(1);
    parent = ((rows ?? [])[0] as Parent | undefined) ?? null;
  }
  let userId = parent?.user_id ?? null;
  if (!userId) {
    const { data: who } = await admin.from("profiles").select("id").ilike("email", fromAddr).limit(1);
    userId = ((who ?? [])[0]?.id as string | undefined) ?? null;
  }

  const full = await fullReply(emailId);
  const text = full?.text ?? "";
  const subject = (data.subject ?? "").trim() || (parent ? `Re: ${parent.subject}` : "(no subject)");
  const saved = await recordReply(admin, {
    resendId: emailId,
    userId,
    replyToId: parent?.id ?? null,
    from: from || fromAddr,
    to: to[0] ?? "",
    subject,
    body: text,
    at: data.created_at ?? new Date().toISOString(),
  });
  if (!saved) return; // already recorded: a redelivered webhook

  let name = senderName(from);
  if (userId) {
    const { data: p } = await admin.from("profiles").select("full_name, username").eq("id", userId).maybeSingle();
    name = (p?.full_name as string | null)?.trim() || (p?.username as string | null)?.trim() || name;
  }
  const said = replyOnly(text).replace(/\s+/g, " ").trim();
  await notifyAdmins({
    title: `${name} replied`,
    body: said ? (said.length > 140 ? `${said.slice(0, 139)}…` : said) : subject,
    path: userId ? `#people/${userId}` : "#today",
    actions: userId ? [{ action: "open", title: "Open", path: `#people/${userId}` }] : [],
  });

  // A copy to hello@ (his pick), replying straight to them from the inbox.
  // Never for mail from our own domain, so nothing can loop.
  if (!fromAddr.toLowerCase().endsWith(`@${LEGAL_ENTITY.emailDomain}`) && !(domain && fromAddr.toLowerCase().endsWith(`@${domain}`))) {
    const body = text || "(Their message had no text. Open it in Admin to see it.)";
    await sendEmail({
      to: HELLO,
      subject: `Reply from ${name}: ${subject}`.slice(0, 250),
      replyTo: fromAddr,
      text: `${name} <${fromAddr}> replied:\n\n${body}`,
      html: `<!doctype html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#262626;"><p style="margin:0 0 12px;color:#737373;font-size:13px;">${esc(name)} &lt;${esc(fromAddr)}&gt; replied. It&#39;s also in Admin, under them.</p><div style="white-space:pre-wrap;">${esc(body)}</div></body></html>`,
    });
  }
}

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const raw = await request.text();
  const ok = verifyWebhook(
    secret,
    { id: request.headers.get("svix-id"), timestamp: request.headers.get("svix-timestamp"), signature: request.headers.get("svix-signature") },
    raw,
  );
  if (!ok) return NextResponse.json({ error: "bad signature" }, { status: 401 });

  let event: { type?: string; created_at?: string; data?: Record<string, unknown> };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  try {
    if (event.type === "email.received") {
      await onReceived((event.data ?? {}) as Received);
    } else if (typeof event.type === "string" && typeof event.data?.email_id === "string") {
      await applyDeliveryEvent(createAdminClient(), event.type, event.data.email_id, event.created_at ?? new Date().toISOString());
    }
  } catch (err) {
    // A database hiccup: let Resend try again later.
    console.error("resend webhook: failed", event.type, err);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
