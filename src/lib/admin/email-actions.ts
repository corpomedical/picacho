"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/require-admin";
import { PLAN_LIMITS, PLAN_LABELS, type PlanId } from "@/lib/plans";
import { renderTemplate, type TemplateVars } from "@/lib/email/render";
import { sendEmail, sendBatch, unsubscribeUrl } from "@/lib/email/send";

// Announcement email management. Design rule: NOTHING in the product sends
// marketing email on its own — the only two paths that ever hand mail to
// Resend are sendTestEmail and sendEmailBlast below, both behind
// requireAdmin() and both explicit button presses. Supabase Auth's emails
// (confirmation, reset) are a separate system this never touches.
//
// email_templates / email_sends are service-role-only tables (RLS enabled
// with no policies + grants revoked — see supabase/pending-2026-08-19/
// email.sql), so every read/write here goes through the admin client AFTER
// requireAdmin() — verify the privilege first, then act with it, the same
// order require-admin.ts documents.

const KEY_RE = /^[a-z0-9-]{2,40}$/;
const SUBJECT_MAX = 200;
const BODY_MAX = 20_000;

// Per-blast recipient ceiling. Not a technical limit — sendBatch would pace
// through more — but a blunt-instrument guard on the blast being pointed at
// a list far bigger than this product currently has, which at today's scale
// could only mean a bug or a mistake. Raise it DELIBERATELY when the real
// list outgrows it, and look at sender-reputation tooling at the same time.
const BLAST_RECIPIENT_CAP = 5_000;

// PostgREST (and so supabase-js) caps a single select at 1000 rows and
// silently truncates past it — a blast that read one page would quietly
// email only the oldest 1000 accounts and report success. Page through the
// FULL audience instead, in a stable order so the offset window can't skip
// anyone (same trap the storage pagination in deleteUser documents).
const PAGE = 1000;

const fail = (msg: string) => redirect(`/admin/emails?error=${encodeURIComponent(msg)}`);
const succeed = (msg: string) => redirect(`/admin/emails?message=${encodeURIComponent(msg)}`);

// Guard against profiles.plan values the app's tables don't know (historic
// rows, hand-edited data): unknown plans render as the free tier's values
// rather than throwing mid-blast or printing "undefined credits".
function asPlanId(plan: string | null | undefined): PlanId {
  return plan && plan in PLAN_LIMITS ? (plan as PlanId) : "none";
}

function varsFor(profile: { username: string | null; email: string; plan: string | null }): TemplateVars {
  const planId = asPlanId(profile.plan);
  return {
    username: profile.username ?? "",
    email: profile.email,
    plan: PLAN_LABELS[planId],
    credits: String(PLAN_LIMITS[planId]),
  };
}

export async function saveEmailTemplate(formData: FormData) {
  const { admin, userId } = await requireAdmin();

  const key = ((formData.get("key") as string) ?? "").trim().toLowerCase();
  const subject = ((formData.get("subject") as string) ?? "").trim();
  const body = ((formData.get("body") as string) ?? "").trim();

  if (!KEY_RE.test(key)) {
    fail("Key must be 2-40 characters: lowercase letters, numbers and hyphens.");
  }
  if (!subject || subject.length > SUBJECT_MAX) {
    fail("Subject is required (200 characters max).");
  }
  if (!body || body.length > BODY_MAX) {
    fail("Body is required (20,000 characters max).");
  }

  // Upsert by key: saving an existing key edits it, a new key creates it —
  // one action for both, and the key doubles as the stable name email_sends
  // records, so "which template was that blast?" stays answerable.
  const { error } = await admin.from("email_templates").upsert(
    {
      key,
      subject,
      body,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    },
    { onConflict: "key" },
  );
  if (error) fail(`Couldn't save the template: ${error.message.slice(0, 160)}`);

  revalidatePath("/admin/emails");
  succeed("Template saved.");
}

export async function deleteEmailTemplate(formData: FormData) {
  const { admin } = await requireAdmin();
  const id = (formData.get("id") as string) ?? "";
  if (!id) fail("Template not found.");

  // Plain delete, no compensation needed: past blasts keep their audit rows
  // (email_sends carries the key and subject as plain columns, no FK — see
  // email.sql), so deleting a template never erases the record of what was
  // already sent with it.
  const { error } = await admin.from("email_templates").delete().eq("id", id);
  if (error) fail(`Couldn't delete the template: ${error.message.slice(0, 160)}`);

  revalidatePath("/admin/emails");
  succeed("Template deleted.");
}

// Renders the template with the ADMIN'S OWN profile variables and sends it
// to the ADMIN'S OWN email — both come from the verified session, neither
// from the form, so this action cannot be pointed at anyone else no matter
// what's posted at it. The [Test] subject prefix keeps a forwarded test from
// ever being mistaken for the real announcement.
export async function sendTestEmail(formData: FormData) {
  const { supabase, admin, userId } = await requireAdmin();
  const key = (formData.get("key") as string) ?? "";

  const { data: template } = await admin
    .from("email_templates")
    .select("subject, body")
    .eq("key", key)
    .single();
  if (!template) fail("Template not found.");

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, username, plan")
    .eq("id", userId)
    .single();
  if (!profile?.email) fail("Couldn't load your profile email.");

  const rendered = renderTemplate(
    template!.subject,
    template!.body,
    varsFor(profile!),
    // A real, working unsubscribe link for the admin's own account — the
    // test should exercise the exact footer a recipient gets, including the
    // link being clickable. (Clicking it really does opt the admin out.)
    await unsubscribeUrl(userId),
  );

  const { error } = await sendEmail({
    to: profile!.email,
    subject: `[Test] ${rendered.subject}`,
    html: rendered.html,
  });
  if (error) fail(`Couldn't send the test email: ${error.slice(0, 200)}`);

  succeed("Test email sent — check your inbox.");
}

export async function sendEmailBlast(formData: FormData) {
  const { admin, userId } = await requireAdmin();

  const key = (formData.get("key") as string) ?? "";
  const audience = ((formData.get("audience") as string) ?? "").trim();
  const confirm = ((formData.get("confirm") as string) ?? "").trim();

  // Audience grammar: "all" | "free" (plan none) | "plan:<id>" for real
  // plans. plan:none is rejected rather than aliased — "free" is the one
  // spelling, so email_sends.audience stays greppable.
  let planFilter: PlanId | null = null; // null = every plan
  if (audience === "all") {
    planFilter = null;
  } else if (audience === "free") {
    planFilter = "none";
  } else if (audience.startsWith("plan:")) {
    const id = audience.slice("plan:".length);
    if (!(id in PLAN_LIMITS) || id === "none") fail("Invalid audience.");
    planFilter = id as PlanId;
  } else {
    fail("Invalid audience.");
  }

  // HARD CONFIRMATION, verified server-side: the admin must have TYPED the
  // audience string into the form. A mis-click on a dropdown plus a reflexive
  // submit must never email every account we have — the UI asks for the
  // typing, but this check is the one that counts.
  if (confirm !== audience) {
    fail("Confirmation text doesn't match the audience — nothing was sent.");
  }

  const { data: template } = await admin
    .from("email_templates")
    .select("subject, body")
    .eq("key", key)
    .single();
  if (!template) fail("Template not found.");

  // Recipient emails come from public.profiles.email — the same column
  // /admin/users lists and searches. It's written once by the
  // handle_new_user trigger from auth.users.email at signup, so it's the
  // address the account was created with. Read with the service client:
  // suspended accounts and anyone who unsubscribed are excluded at the
  // query level, so an opted-out address can't even reach the render loop.
  //
  // Count first: the cap error should state the real size, and a too-big
  // audience shouldn't cost 6 pages of reads before being refused. Errors
  // here mean email.sql hasn't been applied (no marketing_opt_out column) —
  // fail closed with a pointer rather than blasting without the exclusion.
  let countQuery = admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("status", "active")
    .eq("marketing_opt_out", false);
  if (planFilter !== null) countQuery = countQuery.eq("plan", planFilter);
  const { count, error: countError } = await countQuery;
  if (countError) {
    fail(`Couldn't count the audience: ${countError.message.slice(0, 160)}`);
  }
  if (!count) {
    fail("No recipients match that audience (opted-out and suspended accounts are excluded).");
  }
  if (count! > BLAST_RECIPIENT_CAP) {
    fail(
      `That audience has ${count} recipients — over the ${BLAST_RECIPIENT_CAP.toLocaleString("en")} per-blast cap. Nothing was sent.`,
    );
  }

  type Recipient = { id: string; email: string; username: string | null; plan: string | null };
  const recipients: Recipient[] = [];
  for (let offset = 0; ; offset += PAGE) {
    let pageQuery = admin
      .from("profiles")
      .select("id, email, username, plan")
      .eq("status", "active")
      .eq("marketing_opt_out", false);
    if (planFilter !== null) pageQuery = pageQuery.eq("plan", planFilter);
    const { data, error } = await pageQuery
      // Stable order (created_at can tie; id can't) so the range windows
      // tile the audience exactly once — see the PAGE comment above.
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) fail(`Couldn't load the audience: ${error.message.slice(0, 160)}`);
    if (!data || data.length === 0) break;
    recipients.push(...(data as Recipient[]));
    // Belt and braces against the count racing signups.
    if (recipients.length > BLAST_RECIPIENT_CAP) {
      fail(
        `That audience has more than ${BLAST_RECIPIENT_CAP.toLocaleString("en")} recipients — over the per-blast cap. Nothing was sent.`,
      );
    }
    if (data.length < PAGE) break;
  }

  // Render PER RECIPIENT — the variables (and the signed unsubscribe link)
  // differ for every one of them, which is the whole point of templates.
  const messages: { to: string; subject: string; html: string }[] = [];
  for (const recipient of recipients) {
    if (!recipient.email) continue; // NOT NULL in schema, but never send to ""
    const rendered = renderTemplate(
      template!.subject,
      template!.body,
      varsFor(recipient),
      await unsubscribeUrl(recipient.id),
    );
    messages.push({ to: recipient.email, subject: rendered.subject, html: rendered.html });
  }

  const result = await sendBatch(messages);

  if (result.sent === 0) {
    // Nothing left the building — no audit row for a blast that never was;
    // the chunk errors are already in the server log via sendBatch.
    fail("The blast could not be sent — nothing went out. Check RESEND_API_KEY and the server log.");
  }

  // Audit row AFTER the send, recording what Resend actually accepted.
  // Best-effort: the mail is already out, so a failed audit write is a loud
  // log line, not a reason to tell the admin the blast failed.
  const { error: auditError } = await admin.from("email_sends").insert({
    template_key: key,
    subject: template!.subject,
    audience,
    recipient_count: result.sent,
    sent_by: userId,
  });
  if (auditError) {
    console.error("sendEmailBlast: audit insert failed", { key, audience, auditError });
  }

  revalidatePath("/admin/emails");
  if (result.failed > 0) {
    succeed(
      `Sent to ${result.sent} of ${result.sent + result.failed} recipients — some chunks failed; details are in the server log.`,
    );
  }
  succeed(`Sent to ${result.sent} recipient${result.sent === 1 ? "" : "s"}.`);
}
