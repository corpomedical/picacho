// The admin activity log (2026-09-28, operator: "Redesign of the admin app
// with real functionality and features that every admin needs"). Until now
// the only record of an admin changing someone's plan, credits, role or
// account was a console.log on bonus credits, so "who gave this person 500
// credits, and why?" had no answer. Every admin action now writes one line
// to admin_actions (supabase/applied/2026-09-29/admin-activity.sql): who, when, what,
// to whom, before → after, and the reason when one was asked for.
//
// Not "use server": nothing here should be callable over the wire. The
// actions in actions.ts / promo-actions.ts / email-actions.ts call
// logAdminAction after their change has succeeded.
import type { SupabaseClient } from "@supabase/supabase-js";

export type AdminActionInput = {
  action: AdminActionKind;
  targetType: "user" | "render" | "flag" | "setting" | "model" | "voice" | "report" | "feedback" | "post" | "promo" | "email" | "note";
  targetId?: string | null;
  /** The person the change was about, so their page can list it. */
  subjectUserId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  amount?: number | null;
};

// Every action the log knows, with the words the Activity page shows and
// the filter chip it sits under. Adding an action = one line here.
export const ADMIN_ACTIONS = {
  "credits.give": { label: "Gave credits", group: "credits" },
  "credits.take": { label: "Took credits", group: "credits" },
  "credits.set": { label: "Set bonus credits", group: "credits" },
  "render.refund": { label: "Refunded a render", group: "credits" },
  "render.check": { label: "Checked a render", group: "renders" },
  "render.stop": { label: "Stopped a render", group: "renders" },
  "user.plan": { label: "Changed plan", group: "plans" },
  "user.role": { label: "Changed role", group: "access" },
  "user.suspend": { label: "Suspended", group: "access" },
  "user.reinstate": { label: "Reinstated", group: "access" },
  "user.delete": { label: "Deleted an account", group: "access" },
  "user.api_access": { label: "Changed API access", group: "access" },
  "user.producer_access": { label: "Changed assistant access", group: "access" },
  "user.app_choices": { label: "Changed version or look", group: "access" },
  "user.note": { label: "Added a note", group: "access" },
  "render.feature": { label: "Featured a render", group: "safety" },
  "render.unfeature": { label: "Unfeatured a render", group: "safety" },
  "post.hide": { label: "Hid a post", group: "safety" },
  "post.show": { label: "Showed a post again", group: "safety" },
  "report.status": { label: "Changed a report", group: "safety" },
  "feedback.status": { label: "Changed feedback", group: "safety" },
  "moderation.clear": { label: "Cleared failed renders", group: "safety" },
  "flag.toggle": { label: "Switched a flag", group: "system" },
  "setting.update": { label: "Changed a setting", group: "system" },
  "model.video": { label: "Changed the video model", group: "system" },
  "model.image": { label: "Changed the image model", group: "system" },
  "model.seedance_lane": { label: "Changed the Seedance lane", group: "system" },
  "model.suspend": { label: "Suspended a model", group: "system" },
  "model.restore": { label: "Restored a model", group: "system" },
  "model.job": { label: "Switched a behind-the-scenes model", group: "system" },
  "model.offer": { label: "Changed a customer model menu", group: "system" },
  "voice.add": { label: "Added a voice", group: "system" },
  "voice.default": { label: "Made a voice the default", group: "system" },
  "voice.delete": { label: "Removed a voice", group: "system" },
  "promo.create": { label: "Made a promo code", group: "money" },
  "promo.active": { label: "Switched a promo code", group: "money" },
  "promo.update": { label: "Edited a promo code", group: "money" },
  "promo.delete": { label: "Deleted a promo code", group: "money" },
  "email.template_save": { label: "Saved an email template", group: "emails" },
  "email.template_delete": { label: "Deleted an email template", group: "emails" },
  "email.blast": { label: "Sent an email blast", group: "emails" },
  "email.user": { label: "Emailed a person", group: "emails" },
  "export.users": { label: "Exported the users list", group: "access" },
  "export.payments": { label: "Exported payments", group: "money" },
} as const;

export type AdminActionKind = keyof typeof ADMIN_ACTIONS;
export type AdminActionGroup = (typeof ADMIN_ACTIONS)[AdminActionKind]["group"];

export const ADMIN_ACTION_GROUPS: { id: AdminActionGroup; label: string }[] = [
  { id: "credits", label: "Credits" },
  { id: "renders", label: "Renders" },
  { id: "plans", label: "Plans" },
  { id: "access", label: "Accounts" },
  { id: "safety", label: "Safety" },
  { id: "money", label: "Promo codes" },
  { id: "emails", label: "Emails" },
  { id: "system", label: "Flags & settings" },
];

export function actionsInGroup(group: string): AdminActionKind[] {
  return (Object.keys(ADMIN_ACTIONS) as AdminActionKind[]).filter((k) => ADMIN_ACTIONS[k].group === group);
}

export function actionLabel(action: string): string {
  return (ADMIN_ACTIONS as Record<string, { label: string }>)[action]?.label ?? action;
}

/** A before/after value as one short line: strings as they are, the rest as JSON. */
export function auditValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 500 ? `${text.slice(0, 497)}...` : text;
}

/**
 * Writes one line to the activity log. Never throws and never blocks the
 * action it records: the change has already happened by the time this runs,
 * and an admin whose click worked must not see an error because the log
 * table is missing (before admin-activity.sql runs) or briefly unreachable.
 * A failed write is logged loudly instead, with the whole line, so the
 * record survives in the server log.
 */
export async function logAdminAction(
  admin: SupabaseClient,
  adminId: string | null,
  input: AdminActionInput,
): Promise<boolean> {
  const row = {
    admin_id: adminId,
    action: input.action,
    target_type: input.targetType,
    target_id: input.targetId ? String(input.targetId).slice(0, 200) : null,
    subject_user_id: input.subjectUserId ?? null,
    before_value: auditValue(input.before),
    after_value: auditValue(input.after),
    reason: input.reason ? input.reason.slice(0, 500) : null,
    amount: input.amount ?? null,
  };
  try {
    const { error } = await admin.from("admin_actions").insert(row);
    if (error) {
      console.error("admin audit: write failed", { error: error.message, row });
      return false;
    }
    return true;
  } catch (err) {
    console.error("admin audit: write failed", { error: err instanceof Error ? err.message : String(err), row });
    return false;
  }
}

export type AdminActionRow = {
  id: number;
  created_at: string;
  admin_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  subject_user_id: string | null;
  before_value: string | null;
  after_value: string | null;
  reason: string | null;
  amount: number | null;
};

export const ADMIN_ACTION_COLUMNS =
  "id, created_at, admin_id, action, target_type, target_id, subject_user_id, before_value, after_value, reason, amount";

/** True when the error means admin-activity.sql hasn't run yet. */
export function isMissingAuditTable(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" || // table missing (Postgres)
    error.code === "PGRST205" || // table missing (PostgREST schema cache)
    error.code === "PGRST202" || // function missing
    /admin_actions|admin_user_notes|admin_refund_render/.test(error.message ?? "")
  );
}

/** Emails for the ids a page of log lines names (admins and the people acted on). */
export async function emailsForIds(admin: SupabaseClient, ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const { data } = await admin.from("profiles").select("id, email").in("id", unique);
  for (const p of data ?? []) map.set(p.id as string, (p.email as string) ?? "");
  return map;
}

/** One CSV cell, quoted when it has to be, and never read as a formula by a spreadsheet. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
