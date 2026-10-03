// The admin's actions as plain functions (2026-09-28 admin redesign): one
// engine behind both the website admin's buttons (the server actions in
// actions.ts / email-actions.ts, which turn a result into a redirect) and the
// phone admin app (picacho-admin, through /api/admin/act). Each takes the
// service client and the acting admin's id — the caller has already proven
// the admin (requireAdmin or requireAdminFromRequest) — and answers ok or an
// error line the admin error banner knows. Every change writes its line to
// the activity log.
//
// Not "use server": these must never be callable over the wire on their own.
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAdminAction, isMissingAuditTable } from "@/lib/admin/audit";
import { advanceGeneration } from "@/lib/generations/job-runner";
import { VIDEO_MODELS } from "@/lib/generations/providers/video-models";
import { IMAGE_MODELS } from "@/lib/generations/providers/image-models";
import { PLAN_LABELS, PLAN_LIMITS, type PlanId } from "@/lib/plans";
import { renderTemplate } from "@/lib/email/render";
import { sendEmail, unsubscribeUrl } from "@/lib/email/send";
import { renderNote } from "@/lib/email/signature";
import { finishNote, replyDomain, startNote } from "@/lib/email/threads";
import { replyAddress } from "@/lib/email/inbound";
import { NOTE_MESSAGE_MAX, NOTE_SUBJECT_MAX } from "@/lib/admin/note-limits";
import { getOrigin } from "@/lib/origin";

export type OpResult = { ok: true; message?: string } | { ok: false; error: string };

const ok = (message?: string): OpResult => ({ ok: true, message });
const no = (error: string): OpResult => ({ ok: false, error });

export const RUN_ACTIVITY_SQL = "Run supabase/applied/2026-09-29/admin-activity.sql in Supabase first, then try again.";

// ---- credits ---------------------------------------------------------------

// Give or take bonus credits, with a reason. Adds to the balance through the
// same atomic RPCs renders and refunds use (add_bonus_credits /
// spend_bonus_credits), so a render spending at the same moment can't be
// overwritten. The reason is required: it is what the activity log shows.
export async function opAdjustCredits(
  admin: SupabaseClient,
  actor: string,
  input: { userId: string; direction: "give" | "take"; amount: number; reason: string },
): Promise<OpResult> {
  const { userId, direction, amount } = input;
  const reason = (input.reason ?? "").trim();
  if (!Number.isInteger(amount) || amount < 1 || amount > 10_000) return no("Credits must be a whole number from 1 to 10,000.");
  if (!reason || reason.length > 500) return no("Write why (500 characters max) — it goes in the activity log.");

  const { data: before } = await admin.from("profiles").select("bonus_credits").eq("id", userId).maybeSingle();
  if (!before) return no("That person wasn't found.");

  if (direction === "give") {
    const { error } = await admin.rpc("add_bonus_credits", { p_user_id: userId, p_amount: amount });
    if (error) {
      console.error("opAdjustCredits: add failed", error);
      return no("Couldn't change their credits — nothing was changed. Details are in the server log.");
    }
  } else {
    const { data: spent, error } = await admin.rpc("spend_bonus_credits", { p_user_id: userId, p_amount: amount });
    if (error) {
      console.error("opAdjustCredits: take failed", error);
      return no("Couldn't change their credits — nothing was changed. Details are in the server log.");
    }
    if (spent !== true) return no("They have fewer bonus credits than that — nothing was taken.");
  }

  const { data: after } = await admin.from("profiles").select("bonus_credits").eq("id", userId).maybeSingle();
  await logAdminAction(admin, actor, {
    action: direction === "give" ? "credits.give" : "credits.take",
    targetType: "user",
    targetId: userId,
    subjectUserId: userId,
    before: before.bonus_credits ?? 0,
    after: after?.bonus_credits ?? null,
    reason,
    amount,
  });
  return ok(direction === "give" ? `Gave ${amount} credits.` : `Took ${amount} credits.`);
}

// Refund one render by hand: everything it took comes back as bonus
// credits, once. The whole move is one transaction in admin_refund_render
// (supabase/applied/2026-09-29/admin-activity.sql), which also writes the log line; its
// unique index is what makes a second press, or a second admin, fail
// instead of paying twice.
export async function opRefundRender(
  admin: SupabaseClient,
  actor: string,
  input: { generationId: string; reason?: string },
): Promise<OpResult> {
  if (!input.generationId) return no("Missing generation id.");
  const reason = (input.reason ?? "").trim() || "Refunded from the admin";
  const { data, error } = await admin.rpc("admin_refund_render", {
    p_generation_id: input.generationId,
    p_admin_id: actor,
    p_reason: reason.slice(0, 500),
  });
  if (error) {
    console.error("opRefundRender: failed", error);
    if (/already refunded|admin_actions_one_refund_per_render|duplicate key/.test(error.message)) {
      return no("This render was already refunded by hand — nothing was given twice.");
    }
    if (/nothing to refund/.test(error.message)) {
      return no("This render took no credits (or already gave them back) — nothing to refund.");
    }
    if (isMissingAuditTable(error)) return no(RUN_ACTIVITY_SQL);
    return no("Couldn't refund the render — nothing was changed. Details are in the server log.");
  }
  return ok(typeof data === "number" ? `Refunded ${data} credits.` : "Refunded.");
}

// ---- notes -----------------------------------------------------------------

// Private admin notes on a person. Only admins read them (service role; the
// table has no policies), and they go with the account when it is deleted.
export async function opAddNote(admin: SupabaseClient, actor: string, input: { userId: string; body: string }): Promise<OpResult> {
  const body = (input.body ?? "").trim();
  if (!body || body.length > 2000) return no("A note needs some text (2,000 characters max).");
  const { error } = await admin.from("admin_user_notes").insert({ user_id: input.userId, admin_id: actor, body });
  if (error) {
    console.error("opAddNote: insert failed", error);
    return no(isMissingAuditTable(error) ? RUN_ACTIVITY_SQL : "Couldn't save the note. Details are in the server log.");
  }
  await logAdminAction(admin, actor, { action: "user.note", targetType: "note", targetId: input.userId, subjectUserId: input.userId });
  return ok("Note saved.");
}

// ---- renders ---------------------------------------------------------------

async function renderRow(admin: SupabaseClient, generationId: string) {
  const { data } = await admin
    .from("generations")
    .select("id, user_id, status")
    .eq("id", generationId)
    .maybeSingle<{ id: string; user_id: string; status: string }>();
  return data;
}

// "Check now" drives the render one step through the SAME state machine the
// poller, the webhook and the reaper use (advanceGeneration): a render whose
// webhook was dropped is collected, a finished stage moves on, a dead job
// fails by the refund rules. It never cancels a render that is still working.
export async function opCheckRender(admin: SupabaseClient, actor: string, input: { generationId: string }): Promise<OpResult> {
  const row = await renderRow(admin, input.generationId);
  if (!row) return no("Generation not found.");

  let result = "no provider job";
  try {
    result = (await advanceGeneration(row.id, row.user_id)).state;
  } catch (err) {
    console.error("opCheckRender: advanceGeneration failed", err);
    return no("Couldn't reach the render's provider — nothing was changed. Details are in the server log.");
  }
  const { data: after } = await admin.from("generations").select("status").eq("id", row.id).maybeSingle();
  await logAdminAction(admin, actor, {
    action: "render.check",
    targetType: "render",
    targetId: row.id,
    subjectUserId: row.user_id,
    before: row.status,
    after: `${after?.status ?? row.status} (${result})`,
  });
  return ok(`Checked: ${after?.status ?? row.status}.`);
}

// Stop a render for someone, as their own Stop button would: the cooperative
// cancel flag, then one step of advanceGeneration so the provider is told
// now rather than on the next poll. With refund, whatever the render still
// holds afterwards comes back as bonus credits (admin_refund_render, once);
// a stop that already gave the credits back by the refund rules leaves
// nothing to refund, and that is said, not treated as an error.
export async function opStopRender(
  admin: SupabaseClient,
  actor: string,
  input: { generationId: string; refund: boolean },
): Promise<OpResult> {
  const row = await renderRow(admin, input.generationId);
  if (!row) return no("Generation not found.");
  if (row.status !== "generating") return no("That render isn't running any more — nothing was stopped.");

  const { error } = await admin.from("generations").update({ cancel_requested: true }).eq("id", row.id).eq("status", "generating");
  if (error) {
    console.error("opStopRender: cancel flag failed", error);
    return no("Couldn't stop the render — nothing was changed. Details are in the server log.");
  }
  try {
    await advanceGeneration(row.id, row.user_id);
  } catch (err) {
    // The flag and the reaper remain as backstops, as for the person's own Stop.
    console.error("opStopRender: advanceGeneration failed", err);
  }
  await logAdminAction(admin, actor, {
    action: "render.stop",
    targetType: "render",
    targetId: row.id,
    subjectUserId: row.user_id,
    before: "generating",
    after: "stop requested",
  });

  if (!input.refund) return ok("Stop sent.");
  const { data, error: refundError } = await admin.rpc("admin_refund_render", {
    p_generation_id: row.id,
    p_admin_id: actor,
    p_reason: "Stopped from the admin",
  });
  if (refundError) {
    if (/nothing to refund|already refunded/.test(refundError.message)) return ok("Stopped; its credits were already back.");
    console.error("opStopRender: refund failed", refundError);
    return no(
      isMissingAuditTable(refundError)
        ? RUN_ACTIVITY_SQL
        : "The render was stopped, but its credits couldn't be refunded — refund it from the person's page. Details are in the server log.",
    );
  }
  return ok(typeof data === "number" ? `Stopped and refunded ${data} credits.` : "Stopped and refunded.");
}

// ---- queues ----------------------------------------------------------------

export async function opSetReportStatus(
  admin: SupabaseClient,
  actor: string,
  input: { reportId: string; status: string },
): Promise<OpResult> {
  if (input.status !== "open" && input.status !== "resolved") return no("Invalid status.");
  const { error } = await admin
    .from("generation_reports")
    .update({ status: input.status, resolved_at: input.status === "resolved" ? new Date().toISOString() : null })
    .eq("id", input.reportId);
  if (error) {
    console.error("opSetReportStatus: status update failed", error);
    return no("Couldn't update it — nothing was changed. Details are in the server log.");
  }
  await logAdminAction(admin, actor, {
    action: "report.status",
    targetType: "report",
    targetId: input.reportId,
    before: input.status === "resolved" ? "open" : "resolved",
    after: input.status,
  });
  return ok(input.status === "resolved" ? "Resolved." : "Reopened.");
}

export async function opSetFeedbackStatus(
  admin: SupabaseClient,
  actor: string,
  input: { feedbackId: string; status: string },
): Promise<OpResult> {
  if (input.status !== "open" && input.status !== "resolved") return no("Invalid status.");
  const { error } = await admin
    .from("feedback")
    .update({ status: input.status, resolved_at: input.status === "resolved" ? new Date().toISOString() : null })
    .eq("id", input.feedbackId);
  if (error) {
    console.error("opSetFeedbackStatus: status update failed", error);
    return no("Couldn't update it — nothing was changed. Details are in the server log.");
  }
  await logAdminAction(admin, actor, {
    action: "feedback.status",
    targetType: "feedback",
    targetId: input.feedbackId,
    before: input.status === "resolved" ? "open" : "resolved",
    after: input.status,
  });
  return ok(input.status === "resolved" ? "Resolved." : "Reopened.");
}

// Turn a model the circuit breaker switched off back on. trip_count is kept:
// it drives the backoff ladder (see restoreModel in actions.ts).
export async function opRestoreModel(admin: SupabaseClient, actor: string, input: { modelId: string }): Promise<OpResult> {
  const known = VIDEO_MODELS.some((m) => m.id === input.modelId) || IMAGE_MODELS.some((m) => m.id === input.modelId);
  if (!known) return no("Unknown model");
  const { error } = await admin
    .from("model_health")
    .update({ tripped_at: null, retry_after: null, consecutive_failures: 0, failing_user_ids: [], updated_at: new Date().toISOString() })
    .eq("model_id", input.modelId);
  if (error) {
    console.error("opRestoreModel: model_health update failed — nothing changed", error);
    return no("Couldn't update it — nothing was changed. Details are in the server log.");
  }
  await logAdminAction(admin, actor, { action: "model.restore", targetType: "model", targetId: input.modelId, before: "suspended", after: "running" });
  return ok("Turned back on.");
}

// ---- accounts --------------------------------------------------------------

// Suspend or reinstate. Two layers must agree: the auth-layer ban (Supabase
// rejects login and token refresh) and profiles.status (middleware and the
// generation gate block sessions that already exist). Ban first, then the
// flag; a failed flag rolls the ban back so both tell the same story — the
// full reasoning is on setUserStatus in actions.ts, which calls this.
export async function opSetUserStatus(
  admin: SupabaseClient,
  actor: string,
  input: { userId: string; status: string },
): Promise<OpResult> {
  const { userId, status } = input;
  if (status !== "active" && status !== "suspended") return no("Invalid status.");
  if (userId === actor && status === "suspended") return no("You can't suspend your own account.");

  const { error: banError } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: status === "suspended" ? "876000h" : "none",
  });
  if (banError) {
    console.error("setUserStatus: login ban update failed — nothing changed", banError);
    return no(banError.message);
  }
  const { error } = await admin.from("profiles").update({ status }).eq("id", userId);
  if (error) {
    const { error: rollbackError } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: status === "suspended" ? "none" : "876000h",
    });
    console.error("setUserStatus: profile status update failed after the login ban changed", { error, rollbackError });
    return no(
      rollbackError
        ? `Couldn't update the profile status (${error.message}) AND couldn't roll back the login ban (${rollbackError.message}) — the account's login ban does not match its listed status. Retry to reconcile.`
        : `Couldn't update the profile status (${error.message}) — the login ban was rolled back, nothing changed.`,
    );
  }
  await logAdminAction(admin, actor, {
    action: status === "suspended" ? "user.suspend" : "user.reinstate",
    targetType: "user",
    targetId: userId,
    subjectUserId: userId,
    before: status === "suspended" ? "active" : "suspended",
    after: status,
  });
  return ok(status === "suspended" ? "Suspended." : "Reinstated.");
}

// ---- email -----------------------------------------------------------------

const TEMPLATE_KEY_RE = /^[a-z0-9-]{2,40}$/;

// One email to one person: a password-reset link, or any saved template
// rendered with THEIR details. A template respects their marketing opt-out
// unless the admin marks it a service notice — the same rule, and the same
// reason, as the email blast's flag in email-actions.ts.
export async function opEmailPerson(
  admin: SupabaseClient,
  actor: string,
  input: { userId: string; what: string; serviceNotice: boolean },
): Promise<OpResult> {
  const what = (input.what ?? "").trim();
  const { data: person } = await admin
    .from("profiles")
    .select("id, email, username, plan, marketing_opt_out")
    .eq("id", input.userId)
    .maybeSingle();
  if (!person?.email) return no("That person has no email address on file.");

  if (what === "password-reset") {
    const origin = await getOrigin();
    const { error } = await admin.auth.resetPasswordForEmail(person.email as string, {
      redirectTo: `${origin}/auth/callback?next=/reset-password`,
    });
    if (error) {
      console.error("opEmailPerson: reset link failed", error);
      return no("Couldn't send the email. Details are in the server log.");
    }
  } else {
    const key = what.startsWith("template:") ? what.slice("template:".length) : "";
    if (!TEMPLATE_KEY_RE.test(key)) return no("Pick an email to send.");
    if (person.marketing_opt_out && !input.serviceNotice) {
      return no('They opted out of marketing email. Tick "service notice" only if this is about their account (billing, security, terms).');
    }
    const { data: template } = await admin.from("email_templates").select("subject, body").eq("key", key).maybeSingle();
    if (!template) return no("Template not found.");
    const planId: PlanId = person.plan && person.plan in PLAN_LIMITS ? (person.plan as PlanId) : "none";
    const unsubscribe = await unsubscribeUrl(person.id as string);
    const rendered = renderTemplate(
      template.subject as string,
      template.body as string,
      {
        username: (person.username as string | null) ?? "",
        email: person.email as string,
        plan: PLAN_LABELS[planId],
        credits: String(PLAN_LIMITS[planId]),
      },
      unsubscribe,
    );
    const { error } = await sendEmail({ to: person.email as string, subject: rendered.subject, html: rendered.html, unsubscribeUrl: unsubscribe });
    if (error) return no("Couldn't send the email. Details are in the server log.");
  }

  await logAdminAction(admin, actor, {
    action: "email.user",
    targetType: "email",
    targetId: what,
    subjectUserId: input.userId,
    after: input.serviceNotice ? `${what} (service notice)` : what,
  });
  return ok("Email sent.");
}


/**
 * A personal note to one person, from Picacho <hello@picacho.ai> with the
 * hello@ signature (2026-10-03: the operator asked for a pop-up that writes
 * from hello@ with the signature, instead of opening a mail app). The
 * website's Write to them and the phone app's both land here.
 * Not for someone who opted out of marketing email: a "we miss you" is what
 * they said no to (account matters go through Email → Service notice).
 */
export async function opWritePerson(
  admin: SupabaseClient,
  actor: string,
  input: { userId: string; subject: string; message: string },
): Promise<OpResult> {
  const subject = (input.subject ?? "").replace(/\s+/g, " ").trim();
  const message = (input.message ?? "").replace(/\r\n/g, "\n").trim();
  if (!subject) return no("Add a subject.");
  if (subject.length > NOTE_SUBJECT_MAX) return no(`Keep the subject under ${NOTE_SUBJECT_MAX} characters.`);
  if (!message) return no("Write a message first.");
  if (message.length > NOTE_MESSAGE_MAX) return no(`Keep the message under ${NOTE_MESSAGE_MAX.toLocaleString("en")} characters.`);

  const { data: person } = await admin
    .from("profiles")
    .select("id, email, marketing_opt_out")
    .eq("id", input.userId)
    .maybeSingle();
  if (!person?.email) return no("That person has no email address on file.");
  if (person.marketing_opt_out) {
    return no("They opted out of marketing email. For something about their account, use Email → Service notice.");
  }

  const unsubscribe = await unsubscribeUrl(person.id as string);
  const { html, text } = renderNote(message, unsubscribe);
  // Written down first (emails sent and received, 2026-10-03): its id is the
  // reply address, so their answer comes back into Picacho under this note.
  const noteId = await startNote(admin, {
    userId: person.id as string,
    adminId: actor,
    from: process.env.EMAIL_FROM || "Picacho <hello@picacho.ai>",
    to: person.email as string,
    subject,
    body: message,
  });
  const domain = replyDomain();
  const sent = await sendEmail({
    to: person.email as string,
    subject,
    html,
    text,
    unsubscribeUrl: unsubscribe,
    ...(noteId && domain ? { replyTo: replyAddress(noteId, domain) } : {}),
  });
  if (noteId) await finishNote(admin, noteId, { resendId: sent.id ?? null, failed: !!sent.error });
  if (sent.error) return no("Couldn't send the email. Details are in the server log.");

  await logAdminAction(admin, actor, {
    action: "email.note",
    targetType: "email",
    targetId: subject.slice(0, 80),
    subjectUserId: input.userId,
    after: subject,
  });
  return ok(`Sent to ${person.email as string}.`);
}

// ---- models and switches (the phone app's Controls tab, 2026-10-02) --------

/** Offer a model on a customer menu, or take it off (same rule as Admin → Models). */
export async function opSetOffered(
  admin: SupabaseClient,
  actor: string,
  input: { menu: string; item: string; offer: boolean },
): Promise<OpResult> {
  const { menuDef, isOffered } = await import("@/lib/models/registry");
  const { menuItems, offLock } = await import("@/lib/models/menus");
  const { readModelDefaults, readStoredControls, saveStoredControls } = await import("@/lib/models/controls-store");
  const menu = menuDef(input.menu);
  const item = menu ? menuItems(menu.key).find((i) => i.id === input.item) : undefined;
  if (!menu || !item) return no("That isn't on a model menu.");
  let controls;
  try {
    controls = await readStoredControls(admin);
  } catch (err) {
    console.error("opSetOffered: read failed", err);
    return no("Couldn't read the model menus. Nothing changed.");
  }
  if (isOffered(controls, menu.key, item.id) === input.offer) return ok(input.offer ? "Already on." : "Already off.");
  if (!input.offer) {
    const lock = offLock(menu.key, item.id, controls, await readModelDefaults(admin));
    if (lock) return no(`${item.label} stays on: ${lock}`);
  }
  const off = new Set(controls.off[menu.key] ?? []);
  if (input.offer) off.delete(item.id);
  else off.add(item.id);
  const error = await saveStoredControls(admin, { ...controls, off: { ...controls.off, [menu.key]: [...off] } });
  if (error) {
    console.error("opSetOffered: save failed", error);
    return no("Couldn't save it. Nothing changed; details are in the server log.");
  }
  await logAdminAction(admin, actor, {
    action: "model.offer",
    targetType: "model",
    targetId: `${menu.key}:${item.id}`,
    before: input.offer ? "off" : "offered",
    after: input.offer ? "offered" : "off",
  });
  return ok(input.offer ? `${item.label} is back on the menu.` : `${item.label} is off the menu.`);
}

/** Take a video or picture model out of service now (Admin → Models' Suspend). */
export async function opSuspendModel(admin: SupabaseClient, actor: string, input: { modelId: string }): Promise<OpResult> {
  const kind = VIDEO_MODELS.some((m) => m.id === input.modelId) ? "video" : IMAGE_MODELS.some((m) => m.id === input.modelId) ? "image" : null;
  if (!kind) return no("Unknown model");
  const now = new Date().toISOString();
  const { error } = await admin.from("model_health").upsert({
    model_id: input.modelId,
    kind,
    tripped_at: now,
    retry_after: null,
    consecutive_failures: 0,
    last_error: "Suspended manually from the admin app.",
    updated_at: now,
  });
  if (error) {
    console.error("opSuspendModel: model_health upsert failed — nothing changed", error);
    return no("Couldn't update it — nothing was changed. Details are in the server log.");
  }
  await logAdminAction(admin, actor, { action: "model.suspend", targetType: "model", targetId: input.modelId, before: "running", after: "suspended" });
  return ok("Suspended. Renders that ask for it move to the cheapest model in service.");
}

/** Turn a feature switch on or off (Admin → Feature flags). */
export async function opSetFlag(admin: SupabaseClient, actor: string, input: { key: string; enabled: boolean }): Promise<OpResult> {
  if (!/^[a-z0-9_]{2,60}$/.test(input.key)) return no("Unknown switch.");
  const { data: row } = await admin.from("feature_flags").select("enabled").eq("key", input.key).maybeSingle<{ enabled: boolean }>();
  if (!row) return no("Unknown switch.");
  if (row.enabled === input.enabled) return ok(input.enabled ? "Already on." : "Already off.");
  const { error } = await admin.from("feature_flags").update({ enabled: input.enabled, updated_at: new Date().toISOString() }).eq("key", input.key);
  if (error) {
    console.error("opSetFlag: flag update failed — nothing changed", error);
    return no("Couldn't switch it — nothing was changed. Details are in the server log.");
  }
  await logAdminAction(admin, actor, { action: "flag.toggle", targetType: "flag", targetId: input.key, before: row.enabled ? "on" : "off", after: input.enabled ? "on" : "off" });
  return ok(input.enabled ? "Switched on." : "Switched off.");
}
