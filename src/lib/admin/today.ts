// Admin → Today and Admin → Render queue (2026-09-28 admin redesign, parts
// 2 and 3). One place that answers "what needs me right now?": renders that
// look stuck, renewals that failed, open reports and feedback, a fal balance
// that can't last, models the circuit breaker switched off. Every item
// carries the buttons that settle it, so the admin acts from the list
// instead of hunting for the right page.
//
// Reads only, through the service client (the caller has passed requireAdmin).
import type { SupabaseClient } from "@supabase/supabase-js";
import { getFalBalance } from "@/lib/generations/providers/fal-ledger";
import { falBalanceAlert } from "@/lib/push/alert-rules";
import { VIDEO_MODELS, maxSingleRenderCostUsd } from "@/lib/generations/providers/video-models";
import { IMAGE_MODELS } from "@/lib/generations/providers/image-models";
import { PLAN_LABELS } from "@/lib/plans";
import { loadPayments, OPEN_DISPUTE_STATUSES } from "@/lib/admin/payments";

/** A render that has run this long without finishing is listed as stuck. */
export const STUCK_AFTER_MIN = 20;
/** A render with no provider job row this long after it started lost its job (the reaper's "orphan"). */
export const ORPHAN_AFTER_MIN = 10;

export type QueueRow = {
  id: string;
  userId: string;
  email: string | null;
  contentType: string;
  model: string;
  prompt: string;
  createdAt: string;
  minutes: number;
  stage: string | null;
  lastPolledAt: string | null;
  creditsHeld: number;
  cancelRequested: boolean;
  state: "running" | "stuck";
};

type GenRow = {
  id: string;
  user_id: string;
  content_type: string | null;
  video_model_id: string | null;
  model_id: string | null;
  prompt_input: string | null;
  created_at: string;
  credits_used: number | null;
  purchased_credits_used: number | null;
  bonus_credits_used: number | null;
  cancel_requested: boolean | null;
};

export function creditsHeld(row: Pick<GenRow, "credits_used" | "purchased_credits_used" | "bonus_credits_used">): number {
  return (row.credits_used ?? 0) + (row.purchased_credits_used ?? 0) + (row.bonus_credits_used ?? 0);
}

/** Stuck: running past STUCK_AFTER_MIN, or no provider job past ORPHAN_AFTER_MIN. */
export function queueState(minutes: number, hasJob: boolean): "running" | "stuck" {
  if (minutes >= STUCK_AFTER_MIN) return "stuck";
  if (!hasJob && minutes >= ORPHAN_AFTER_MIN) return "stuck";
  return "running";
}

/** An engine's display name ("Kling O3"), or its id when the catalogue no longer lists it. */
export function modelName(id: string | null): string {
  if (!id) return "—";
  const all: readonly { id: string; name?: string }[] = [...VIDEO_MODELS, ...IMAGE_MODELS];
  return all.find((m) => m.id === id)?.name ?? id;
}

function planName(plan: string | null): string {
  return (plan && (PLAN_LABELS as Record<string, string>)[plan]) || "Plan";
}

async function emailMap(admin: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data } = await admin.from("profiles").select("id, email").in("id", unique);
  return new Map((data ?? []).map((p) => [p.id as string, (p.email as string) ?? ""]));
}

/** Every render in flight, oldest first (so the stuck ones lead). */
export async function loadRenderQueue(admin: SupabaseClient, now = Date.now()): Promise<QueueRow[]> {
  const { data: gens } = await admin
    .from("generations")
    .select(
      "id, user_id, content_type, video_model_id, model_id, prompt_input, created_at, credits_used, purchased_credits_used, bonus_credits_used, cancel_requested",
    )
    .eq("status", "generating")
    .order("created_at", { ascending: true })
    .limit(100);
  const rows = (gens ?? []) as GenRow[];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const [{ data: jobs }, emails] = await Promise.all([
    admin.from("generation_jobs").select("generation_id, stage, last_polled_at").in("generation_id", ids),
    emailMap(admin, rows.map((r) => r.user_id)),
  ]);
  const jobById = new Map((jobs ?? []).map((j) => [j.generation_id as string, j as { stage: string; last_polled_at: string }]));

  return rows.map((r) => {
    const minutes = Math.max(0, Math.floor((now - new Date(r.created_at).getTime()) / 60_000));
    const job = jobById.get(r.id);
    return {
      id: r.id,
      userId: r.user_id,
      email: emails.get(r.user_id) ?? null,
      contentType: r.content_type ?? "render",
      model: modelName(r.video_model_id ?? r.model_id),
      prompt: r.prompt_input ?? "",
      createdAt: r.created_at,
      minutes,
      stage: job?.stage ?? null,
      lastPolledAt: job?.last_polled_at ?? null,
      creditsHeld: creditsHeld(r),
      cancelRequested: r.cancel_requested === true,
      state: queueState(minutes, !!job),
    };
  });
}

export type InboxGroup = "renders" | "money" | "people" | "safety" | "system";
export type InboxAction =
  | { type: "link"; label: string; href: string; primary?: boolean; external?: boolean }
  | {
      type: "form";
      label: string;
      action: "resolveReport" | "resolveFeedback" | "refundRender" | "checkRender" | "stopRender" | "restoreModel";
      fields: Record<string, string>;
      primary?: boolean;
    };
export type InboxItem = {
  id: string;
  group: InboxGroup;
  kind: string;
  tone: "urgent" | "warn" | "info";
  title: string;
  sub: string;
  at: string | null;
  actions: InboxAction[];
};

const TONE_ORDER = { urgent: 0, warn: 1, info: 2 } as const;

export function sortInbox(items: InboxItem[]): InboxItem[] {
  return [...items].sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || (b.at ?? "").localeCompare(a.at ?? ""));
}

function ago(iso: string | null, now: number): string {
  if (!iso) return "";
  const min = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

function short(text: string, n = 90): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

export type TodayNumbers = {
  signups: number;
  renders: number;
  finished: number;
  failed: number;
  topUps: { count: number; byCurrency: Record<string, number> };
  falBalanceUsd: number | null;
  falLevel: "critical" | "low" | null;
};

export async function loadToday(
  admin: SupabaseClient,
  now = Date.now(),
): Promise<{ items: InboxItem[]; numbers: TodayNumbers; queue: QueueRow[] }> {
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const since = startOfDay.toISOString();

  const [queue, pastDue, reports, feedback, models, fal, signups, rendersToday, finishedToday, failedToday, topUps, stripeSide] =
    await Promise.all([
      loadRenderQueue(admin, now),
      admin.from("profiles").select("id, email, plan, current_period_end").eq("plan_status", "past_due").limit(10),
      admin
        .from("generation_reports")
        .select("id, created_at, reason, details, source, user_id, generation_id")
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(6),
      admin
        .from("feedback")
        .select("id, created_at, message, user_id")
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(5),
      admin.from("model_health").select("model_id, kind, tripped_at, last_error").not("tripped_at", "is", null),
      getFalBalance(),
      admin.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", since),
      admin.from("generations").select("id", { count: "exact", head: true }).gte("created_at", since),
      admin.from("generations").select("id", { count: "exact", head: true }).gte("created_at", since).eq("status", "succeeded"),
      admin.from("generations").select("id", { count: "exact", head: true }).gte("created_at", since).eq("status", "failed"),
      admin.from("credit_purchases").select("amount_cents, currency").gte("created_at", since).is("refunded_at", null),
      // Disputes waiting on an answer (Stripe). One charge only: the list
      // below needs the disputes, the Payments page has the charges.
      loadPayments(admin, { limit: 1 }),
    ]);

  const reportRows = (reports.data ?? []) as {
    id: string;
    created_at: string;
    reason: string;
    details: string | null;
    source: string | null;
    user_id: string | null;
    generation_id: string | null;
  }[];
  const feedbackRows = (feedback.data ?? []) as { id: string; created_at: string; message: string; user_id: string | null }[];

  // Emails and the reported renders' credits, in one round each.
  const reportGenIds = reportRows.map((r) => r.generation_id).filter((id): id is string => !!id);
  const [emails, { data: reportGens }, { data: handRefunds }] = await Promise.all([
    emailMap(admin, [...reportRows.map((r) => r.user_id), ...feedbackRows.map((f) => f.user_id)].filter((id): id is string => !!id)),
    reportGenIds.length
      ? admin
          .from("generations")
          .select("id, status, credits_used, purchased_credits_used, bonus_credits_used, video_model_id, model_id")
          .in("id", reportGenIds)
      : Promise.resolve({ data: [] as GenRow[] }),
    reportGenIds.length
      ? admin.from("admin_actions").select("target_id").eq("action", "render.refund").in("target_id", reportGenIds)
      : Promise.resolve({ data: [] as { target_id: string }[] }),
  ]);
  const genById = new Map(((reportGens ?? []) as (GenRow & { status: string })[]).map((g) => [g.id, g]));
  const refundedByHand = new Set((handRefunds ?? []).map((r) => r.target_id as string));

  const items: InboxItem[] = [];

  for (const q of queue.filter((r) => r.state === "stuck")) {
    items.push({
      id: `render-${q.id}`,
      group: "renders",
      kind: "Render",
      tone: "urgent",
      title: `${q.model} ${q.contentType} running for ${q.minutes} min`,
      sub: [q.email ?? "unknown account", q.stage ? `stage ${q.stage}` : "no provider job", q.creditsHeld ? `${q.creditsHeld} credits held` : null]
        .filter(Boolean)
        .join(" · "),
      at: q.createdAt,
      actions: [
        { type: "form", label: "Check now", action: "checkRender", fields: { generation_id: q.id, redirect_to: "/admin" }, primary: true },
        { type: "form", label: "Stop + refund", action: "stopRender", fields: { generation_id: q.id, refund: "1", redirect_to: "/admin" } },
      ],
    });
  }

  for (const p of (pastDue.data ?? []) as { id: string; email: string | null; plan: string | null; current_period_end: string | null }[]) {
    items.push({
      id: `pay-${p.id}`,
      group: "money",
      kind: "Payment",
      tone: "warn",
      title: `${planName(p.plan)} renewal failed — payment past due`,
      sub: `${p.email ?? "unknown account"} · Stripe keeps retrying; their plan's credits are paused meanwhile`,
      at: p.current_period_end,
      actions: [
        ...(p.email
          ? [
              {
                type: "link" as const,
                label: "Email them",
                href: `mailto:${p.email}?subject=${encodeURIComponent("Your Picacho payment")}`,
                primary: true,
              },
            ]
          : []),
        { type: "link", label: "See person", href: `/admin/users/${p.id}` },
      ],
    });
  }

  for (const r of reportRows) {
    const gen = r.generation_id ? genById.get(r.generation_id) : undefined;
    const held = gen ? creditsHeld(gen) : 0;
    const canRefund = !!gen && held > 0 && !refundedByHand.has(gen.id) && !!r.user_id;
    const who = r.user_id ? emails.get(r.user_id) ?? "unknown account" : "no account";
    items.push({
      id: `report-${r.id}`,
      group: "safety",
      kind: "Report",
      tone: r.source === "auto" ? "info" : "warn",
      title: r.details ? `“${short(r.details)}”` : r.reason.replace(/_/g, " "),
      sub: [who, r.reason.replace(/_/g, " "), r.source === "auto" ? "auto-filed" : "filed by them", ago(r.created_at, now)].join(" · "),
      at: r.created_at,
      actions: [
        ...(canRefund
          ? [
              {
                type: "form" as const,
                label: `Refund ${held} cr`,
                action: "refundRender" as const,
                fields: { generation_id: gen!.id, user_id: r.user_id!, reason: `Report: ${r.reason}`, redirect_to: "/admin" },
                primary: true,
              },
            ]
          : []),
        ...(r.user_id ? [{ type: "link" as const, label: "See person", href: `/admin/users/${r.user_id}` }] : []),
        { type: "form", label: "Resolve", action: "resolveReport", fields: { report_id: r.id, status: "resolved", redirect_to: "/admin" } },
      ],
    });
  }

  for (const f of feedbackRows) {
    const email = f.user_id ? emails.get(f.user_id) : undefined;
    items.push({
      id: `feedback-${f.id}`,
      group: "people",
      kind: "Feedback",
      tone: "info",
      title: `“${short(f.message)}”`,
      sub: [email ?? "unknown account", ago(f.created_at, now)].join(" · "),
      at: f.created_at,
      actions: [
        ...(email
          ? [
              {
                type: "link" as const,
                label: "Reply",
                href: `mailto:${email}?subject=${encodeURIComponent("Re: your Picacho feedback")}`,
                primary: true,
              },
            ]
          : []),
        { type: "form", label: "Resolve", action: "resolveFeedback", fields: { feedback_id: f.id, status: "resolved", redirect_to: "/admin" } },
      ],
    });
  }

  for (const d of stripeSide.disputes.filter((x) => OPEN_DISPUTE_STATUSES.has(x.status))) {
    items.push({
      id: `dispute-${d.id}`,
      group: "money",
      kind: "Dispute",
      tone: "urgent",
      title: `Card dispute on a ${money(d.amountCents, d.currency)} payment`,
      sub: [d.email ?? "no Picacho account matched", d.reason, d.dueBy ? `answer by ${d.dueBy.slice(0, 10)}` : null].filter(Boolean).join(" · "),
      at: d.created,
      actions: [
        { type: "link", label: "Open in Stripe", href: d.stripeUrl, primary: true, external: true },
        ...(d.userId ? [{ type: "link" as const, label: "See person", href: `/admin/users/${d.userId}` }] : []),
      ],
    });
  }

  let falLevel: TodayNumbers["falLevel"] = null;
  if (fal.ok) {
    const verdict = falBalanceAlert({ balanceUsd: fal.balanceUsd, worstRenderUsd: maxSingleRenderCostUsd() });
    if (verdict) {
      falLevel = verdict.level;
      items.push({
        id: "fal-balance",
        group: "system",
        kind: "Provider",
        tone: verdict.level === "critical" ? "urgent" : "warn",
        title: verdict.push.title.replace(/^🚨\s*/, ""),
        sub: verdict.push.body,
        at: null,
        actions: [
          { type: "link", label: "Top up at fal", href: "https://fal.ai/dashboard/billing", primary: true, external: true },
          { type: "link", label: "AI providers", href: "/admin/providers" },
        ],
      });
    }
  }

  for (const m of (models.data ?? []) as { model_id: string; kind: string; tripped_at: string; last_error: string | null }[]) {
    items.push({
      id: `model-${m.model_id}`,
      group: "system",
      kind: "Model",
      tone: "warn",
      title: `${m.model_id} is switched off`,
      sub: [m.last_error ? short(m.last_error, 110) : "circuit breaker", ago(m.tripped_at, now)].filter(Boolean).join(" · "),
      at: m.tripped_at,
      actions: [
        { type: "form", label: "Turn back on", action: "restoreModel", fields: { model_id: m.model_id }, primary: true },
        { type: "link", label: "AI providers", href: "/admin/providers" },
      ],
    });
  }

  const byCurrency: Record<string, number> = {};
  for (const t of (topUps.data ?? []) as { amount_cents: number; currency: string }[]) {
    const c = (t.currency ?? "usd").toLowerCase();
    byCurrency[c] = (byCurrency[c] ?? 0) + (t.amount_cents ?? 0);
  }

  return {
    items: sortInbox(items),
    queue,
    numbers: {
      signups: signups.count ?? 0,
      renders: rendersToday.count ?? 0,
      finished: finishedToday.count ?? 0,
      failed: failedToday.count ?? 0,
      topUps: { count: (topUps.data ?? []).length, byCurrency },
      falBalanceUsd: fal.ok ? fal.balanceUsd : null,
      falLevel,
    },
  };
}

export function money(cents: number, currency: string): string {
  const symbol = currency === "eur" ? "€" : currency === "usd" ? "$" : currency === "gbp" ? "£" : "";
  const amount = (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
  return symbol ? `${symbol}${amount}` : `${amount} ${currency.toUpperCase()}`;
}
