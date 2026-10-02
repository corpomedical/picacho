import { reportSurface, REPORT_SURFACE_LABELS } from "@/lib/stripe/failure";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import {
  addUserNote,
  adjustBonusCredits,
  refundRender,
  setApiAccess,
  setBonusCredits,
  setGenerationFeatured,
  setUserAppChoices,
  setUserPlan,
  setUserRole,
  setUserStatus,
} from "@/lib/admin/actions";
import { isProducerEnabled, isProducerOpenToElite, producerAccessState } from "@/lib/producer/enabled";
import { PRODUCER_UNIT_USD } from "@/lib/producer/prices";
import { ProducerAccessRow } from "@/components/admin/producer-access-row";
import { getMonthlyUsage } from "@/lib/generations/actions";
import { getUserEconomics } from "@/lib/admin/economics";
import { onlyRefunded, refundLimit, wasRefunded, type RefundLimit } from "@/lib/admin/refunds";
import { UserEconomicsCard } from "@/components/admin/user-economics-card";
import { PLAN_CHAT_UNIT_LIMITS, PLAN_LIMITS, type PlanId } from "@/lib/plans";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/ui/submit-button";
import { AdminErrorBanner, AdminSuccessBanner } from "@/components/admin-error-banner";
import { sendEmailToUser } from "@/lib/admin/email-actions";
import { DeleteUserButton } from "@/components/delete-user-button";
import { LocalDate } from "@/components/local-date";
import { getUserActivity, formatDuration } from "@/lib/admin/activity";
import { loadPersonPath } from "@/lib/retention/load";
import { PersonPathCard } from "@/components/admin/person-path-card";
import { ADMIN_LOOK_LABELS, ADMIN_MODE_LABELS, parseAppLook, parseAppMode } from "@/lib/light/mode";
import {
  ADMIN_ACTION_COLUMNS,
  actionLabel,
  emailsForIds,
  isMissingAuditTable,
  type AdminActionRow,
} from "@/lib/admin/audit";

function timeAgo(dateStr: string) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

// What the Refunds list says of each refund (lib/admin/refunds.ts).
const REFUND_LIMIT_LABELS: Record<RefundLimit, string> = {
  failures: "counted in daily limit",
  "face-check": "counted in face-check limit",
  none: "not in daily limit",
};

export default async function AdminUserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { id } = await params;
  const { error: actionError, message: actionMessage } = await searchParams;
  const supabase = await createClient();

  const { data: user } = await supabase.from("profiles").select("*").eq("id", id).single();
  if (!user) notFound();
  // Picacho Light's two choices (null before its SQL runs, or not chosen yet).
  const appMode = parseAppMode((user as { app_mode?: unknown }).app_mode);
  const appLook = parseAppLook((user as { app_look?: unknown }).app_look);

  // The assistant (the Producer) for this account: who has it and why
  // (lib/producer/enabled.ts producerAllowed). The grant's column arrives
  // with producer-access.sql; until then the row simply doesn't carry it.
  const [producerOn, producerOpenToElite] = await Promise.all([
    isProducerEnabled(supabase),
    isProducerOpenToElite(supabase),
  ]);

  const [
    { data: characters },
    { data: generations },
    { count: totalGenerations },
    { count: succeededCount },
    { count: failedCount },
    { count: projectsCount },
    { count: feedbackCount },
    { count: reportsCount },
    usedThisMonth,
  ] = await Promise.all([
    supabase
      .from("character_profiles")
      .select("id, name, created_at")
      .eq("user_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("generations")
      .select(
        "id, prompt_input, status, attempts, created_at, featured_at, content_type, video_model_id, model_id, credits_used, purchased_credits_used, bonus_credits_used, free_generation_used, match_score, refunded_at, identity_gated_at",
      )
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(15),
    supabase.from("generations").select("*", { count: "exact", head: true }).eq("user_id", id),
    supabase
      .from("generations")
      .select("*", { count: "exact", head: true })
      .eq("user_id", id)
      .eq("status", "succeeded"),
    supabase
      .from("generations")
      .select("*", { count: "exact", head: true })
      .eq("user_id", id)
      .eq("status", "failed"),
    supabase.from("projects").select("*", { count: "exact", head: true }).eq("user_id", id),
    supabase.from("feedback").select("*", { count: "exact", head: true }).eq("user_id", id),
    supabase
      .from("generation_reports")
      .select("*", { count: "exact", head: true })
      .eq("user_id", id),
    getMonthlyUsage(id),
  ]);

  // The dossier reads (2026-09-02, operator: "every single detail needed
  // for me to review, every refund, every error or crash"). All additive:
  // every report this user ever filed or auto-filed, every refunded
  // generation, who referred them, and which auth provider they came
  // through.
  const [{ data: reports }, { data: refunds, count: refundsCount }, { data: referrer }, providerLookup] =
    await Promise.all([
      supabase
        .from("generation_reports")
        .select("id, created_at, reason, details, source, status, generation_id")
        .eq("user_id", id)
        .order("created_at", { ascending: false })
        .limit(50),
      // Every render whose credits came back. Not "refunded_at is set":
      // that is only the daily limit's counter, and a forced refund (a
      // refusal, a provider rejection, a rules block) never stamps it —
      // lib/admin/refunds.ts has the whole rule.
      onlyRefunded(
        supabase
          .from("generations")
          .select(
            "id, created_at, refunded_at, identity_gated_at, prompt_input, video_model_id, model_id, content_type",
            { count: "exact" },
          )
          .eq("user_id", id),
      )
        .order("created_at", { ascending: false })
        .limit(50),
      // referred_by holds a referring USER's id (promo_rep holds a rep's
      // name) — resolve it to something a human can recognize and click.
      user.referred_by
        ? supabase.from("profiles").select("id, email, full_name").eq("id", user.referred_by).single()
        : Promise.resolve({ data: null }),
      // Auth provider lives in auth.users (app_metadata), not in profiles —
      // the one fact "where they came from" needs that PostgREST can't see.
      createAdminClient()
        .auth.admin.getUserById(id)
        .then((r) => r.data.user)
        .catch(() => null),
    ]);
  // The admin redesign's reads (2026-09-28): private notes, this person's
  // lines in the activity log, and which of the listed renders an admin
  // already refunded by hand. Service client: both tables are admin-only
  // with no policies (supabase/applied/2026-09-29/admin-activity.sql). Before that file
  // runs they answer an error, and the cards say so.
  const serviceClient = createAdminClient();
  const generationIds = (generations ?? []).map((g) => g.id as string);
  const [notesResult, changesResult, handRefundsResult, templatesResult] = await Promise.all([
    serviceClient
      .from("admin_user_notes")
      .select("id, created_at, admin_id, body")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    serviceClient
      .from("admin_actions")
      .select(ADMIN_ACTION_COLUMNS)
      .eq("subject_user_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
    generationIds.length
      ? serviceClient.from("admin_actions").select("target_id").eq("action", "render.refund").in("target_id", generationIds)
      : Promise.resolve({ data: [] as { target_id: string | null }[], error: null }),
    serviceClient.from("email_templates").select("key, subject").order("key"),
  ]);
  const templates = (templatesResult.data ?? []) as { key: string; subject: string }[];
  const auditReady = !isMissingAuditTable(changesResult.error) && !isMissingAuditTable(notesResult.error);
  const notes = (notesResult.data ?? []) as { id: string; created_at: string; admin_id: string | null; body: string }[];
  const changes = (changesResult.data ?? []) as AdminActionRow[];
  const handRefunded = new Set((handRefundsResult.data ?? []).map((r) => r.target_id));
  const adminEmails = await emailsForIds(serviceClient, [...notes.map((n) => n.admin_id), ...changes.map((c) => c.admin_id)]);

  const providers: string[] =
    (providerLookup?.app_metadata?.providers as string[] | undefined) ??
    (providerLookup?.app_metadata?.provider ? [providerLookup.app_metadata.provider as string] : []);

  // Sign-in / session facts from auth.users + auth.sessions.
  const activity = (await getUserActivity([user])).get(user.id) ?? null;
  // Who comes back (2026-10-03): their four steps and the tools they use.
  const path = await loadPersonPath(serviceClient, user.id);

  const plan = (user.plan ?? "none") as PlanId;

  // What this account is worth and what it costs to serve — see
  // lib/admin/economics.ts for how the cost side is estimated.
  const economics = await getUserEconomics(
    supabase,
    id,
    plan,
    (user.plan_status as string | null) ?? null,
  );
  const bonusCredits = user.bonus_credits ?? 0;
  // Plan allowance only: bonus is a depleting balance (2026-09-23), shown as
  // its own figure rather than inflating the monthly ceiling.
  const monthlyLimit = PLAN_LIMITS[plan];
  const successRate =
    (succeededCount ?? 0) + (failedCount ?? 0) > 0
      ? Math.round(((succeededCount ?? 0) / ((succeededCount ?? 0) + (failedCount ?? 0))) * 100)
      : null;

  return (
    <div>
      <Link href="/admin/users" className="text-sm text-neutral-500 hover:text-neutral-900">
        ← Users
      </Link>

      <div className="mt-4">
        <AdminErrorBanner error={actionError} />
        <AdminSuccessBanner message={actionMessage} />
      </div>

      {/* min-w-0 on BOTH tracks. A grid item's default min-width is `auto`,
          which means it refuses to shrink below its widest content — and the
          money table below carries min-w-[640px]. On a phone that sized the
          whole column to 640px, so the PAGE scrolled sideways while the
          table's own overflow-x-auto never engaged: measured at a 375px
          viewport, document.scrollWidth was 722. With min-w-0 the track
          shrinks to the viewport and the table scrolls inside its card,
          which is what the wrapper was always for. Reported 2026-09-04:
          "the user section has over flow tables the page scrolls left and
          right." */}
      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-1">
          {/* Full name leads when we have it; the email is the identifier
              either way. */}
          {user.full_name ? (
            <>
              <p className="text-base font-semibold text-neutral-900">{user.full_name}</p>
              <p className="mt-0.5 text-sm break-words text-neutral-600">{user.email}</p>
            </>
          ) : (
            <p className="text-sm font-medium break-words text-neutral-900">{user.email}</p>
          )}
          {user.username && <p className="mt-0.5 text-xs text-neutral-500">@{user.username}</p>}
          {user.company && <p className="mt-0.5 text-xs text-neutral-500">{user.company}</p>}
          {user.gender && <p className="mt-0.5 text-xs text-neutral-400">{user.gender}</p>}
          <dl className="mt-2 space-y-0.5 text-xs text-neutral-400">
            <div className="flex gap-1.5">
              <dt>Joined:</dt>
              <dd>{new Date(user.created_at).toLocaleDateString()}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt>Last active:</dt>
              <dd>
                {activity?.online
                  ? "Online now"
                  : user.last_seen_at
                    ? timeAgo(user.last_seen_at)
                    : "Never"}
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt>Signed up via:</dt>
              <dd>{providers.length > 0 ? providers.join(", ") : "unknown"}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt>Came from:</dt>
              {/* break-all, not break-words: what lands here is a raw uuid or
                  a referrer address, and an opaque identifier has no word to
                  keep whole. */}
              <dd className="break-all">
                {/* Two different things that used to share one column: a
                    referring USER's id (resolved to their account), and a
                    promo rep's NAME. "Direct" = no referral recorded. */}
                {user.promo_rep ? (
                  <>rep {user.promo_rep}</>
                ) : referrer ? (
                  <Link href={`/admin/users/${referrer.id}`} className="underline hover:text-neutral-700">
                    {referrer.full_name || referrer.email}
                  </Link>
                ) : user.referred_by ? (
                  <span className="font-mono">{user.referred_by}</span>
                ) : (
                  "direct"
                )}
                {user.promo_code && <span className="font-mono"> ({user.promo_code})</span>}
              </dd>
            </div>
            {user.plan_source && (
              <div className="flex gap-1.5">
                <dt>Billing via:</dt>
                <dd>{user.plan_source}</dd>
              </div>
            )}
            {user.marketing_opt_out && (
              <div className="flex gap-1.5">
                <dt>Marketing:</dt>
                <dd>opted out</dd>
              </div>
            )}
            <div className="flex gap-1.5">
              <dt>Terms accepted:</dt>
              <dd>
                {user.terms_accepted_at
                  ? new Date(user.terms_accepted_at).toLocaleDateString()
                  : "Not recorded"}
              </dd>
            </div>
          </dl>
          <div className="mt-3">
            <Badge tone={user.status === "active" ? "success" : "danger"}>{user.status}</Badge>
          </div>

          <form action={setUserStatus} className="mt-4">
            <input type="hidden" name="user_id" value={user.id} />
            <input type="hidden" name="redirect_to" value={`/admin/users/${user.id}`} />
            <input
              type="hidden"
              name="status"
              value={user.status === "active" ? "suspended" : "active"}
            />
            <SubmitButton variant="secondary" size="sm" className="w-full" pendingLabel="Updating…">
              {user.status === "active" ? "Suspend account" : "Reinstate account"}
            </SubmitButton>
          </form>

          <div className="mt-6 border-t border-neutral-100 pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Role</p>
            <form action={setUserRole} className="mt-2 flex gap-2">
              <input type="hidden" name="user_id" value={user.id} />
              <select
                name="role"
                aria-label="Role"
                key={user.role}
                defaultValue={user.role}
                className="flex-1 rounded-[10px] border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400"
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
              <SubmitButton variant="secondary" size="sm">Save</SubmitButton>
            </form>
          </div>

          <div className="mt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Plan (manual override)</p>
            <form action={setUserPlan} className="mt-2 flex gap-2">
              <input type="hidden" name="user_id" value={user.id} />
              <select
                name="plan"
                aria-label="Plan (manual override)"
                key={user.plan}
                defaultValue={user.plan}
                className="flex-1 rounded-[10px] border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400"
              >
                {Object.keys(PLAN_LIMITS).map((plan) => (
                  <option key={plan} value={plan}>
                    {plan}
                  </option>
                ))}
              </select>
              <SubmitButton variant="secondary" size="sm">Save</SubmitButton>
            </form>
            <p className="mt-1.5 text-xs text-neutral-400">
              For comping accounts. If this user has a real Stripe subscription, the next billing
              event will overwrite this back to whatever they&apos;re actually paying for.
            </p>
          </div>

          <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-3">
            {/* Give or take (2026-09-28 admin redesign): adds to the balance
                through the same atomic RPCs renders use, and asks why — the
                reason is what the activity log shows next to the change. */}
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
              Give or take credits
            </p>
            <p className="mt-1 text-sm text-neutral-700">
              Bonus balance now: <span className="font-semibold text-atelier-accent">{bonusCredits}</span>
            </p>
            <form action={adjustBonusCredits} className="mt-2 flex flex-col gap-2">
              <input type="hidden" name="user_id" value={user.id} />
              <div className="flex gap-2">
                <select
                  name="direction"
                  aria-label="Give or take"
                  defaultValue="give"
                  className="rounded-[10px] border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400"
                >
                  <option value="give">Give</option>
                  <option value="take">Take away</option>
                </select>
                <input
                  type="number"
                  name="amount"
                  aria-label="How many credits"
                  min={1}
                  max={10000}
                  required
                  placeholder="How many"
                  className="w-full min-w-0 flex-1 rounded-[10px] border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400"
                />
              </div>
              <input
                type="text"
                name="reason"
                aria-label="Why"
                required
                maxLength={500}
                placeholder="Why? (only admins see this)"
                className="w-full rounded-[10px] border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400"
              />
              <SubmitButton size="sm" className="w-full" pendingLabel="Saving…">
                Save
              </SubmitButton>
            </form>
            <p className="mt-1.5 text-xs text-neutral-400">
              Adds to (or takes from) their bonus balance: spent once the plan&apos;s monthly credits run out,
              before bought ones, and kept until spent.
            </p>
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-neutral-500 hover:text-neutral-800">
                Set an exact balance instead
              </summary>
              <div className="mt-2">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
              Bonus credits (replaces {bonusCredits})
            </p>
            <form action={setBonusCredits} className="mt-2 flex gap-2">
              <input type="hidden" name="user_id" value={user.id} />
              {/* The value this page RENDERED — the action refuses to write
                  over a different one, so a render spending the balance, or a
                  refund putting some back, while the tab sat open can't be
                  silently overwritten. */}
              <input type="hidden" name="expected_bonus_credits" value={bonusCredits} />
              <input
                type="number"
                name="bonus_credits"
                aria-label="Bonus credits"
                min={0}
                key={bonusCredits}
                defaultValue={bonusCredits}
                className="w-full flex-1 rounded-[10px] border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400"
              />
              <SubmitButton variant="secondary" size="sm">Save</SubmitButton>
            </form>
            <p className="mt-1.5 text-xs text-neutral-400">
              A goodwill grant, not a plan change. Save replaces their balance, it doesn&apos;t add
              to it: to give 5 credits back, type {bonusCredits + 5}. Spent once the plan&apos;s
              monthly credits run out, before bought ones, and kept until spent — it doesn&apos;t
              reset at the end of the month.
            </p>
              </div>
            </details>
          </div>

          <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-3">
            {/* One email to this person (2026-09-28 admin redesign):
                a reset link, or a saved template with their details. */}
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Send an email</p>
            <form action={sendEmailToUser} className="mt-2 flex flex-col gap-2">
              <input type="hidden" name="user_id" value={user.id} />
              <select
                name="what"
                aria-label="Which email"
                defaultValue="password-reset"
                className="w-full rounded-[10px] border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400"
              >
                <option value="password-reset">Password reset link</option>
                {templates.map((t) => (
                  <option key={t.key} value={`template:${t.key}`}>
                    Template: {t.subject}
                  </option>
                ))}
              </select>
              <label className="flex items-start gap-2 text-xs text-neutral-500">
                <input type="checkbox" name="service_notice" className="mt-0.5" />
                <span>
                  Service notice (about their account: billing, security, terms). Only this reaches someone who opted out
                  of marketing{user.marketing_opt_out ? " — and they did" : ""}.
                </span>
              </label>
              <SubmitButton variant="secondary" size="sm" className="w-full" pendingLabel="Sending…">
                Send to {user.email}
              </SubmitButton>
            </form>
          </div>

          <div className="mt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
              API access
            </p>
            <form action={setApiAccess} className="mt-2 flex items-center gap-2">
              <input type="hidden" name="user_id" value={user.id} />
              <input type="hidden" name="api_access" value={String(!user.api_access)} />
              <Badge tone={user.plan === "elite" || user.api_access ? "success" : "neutral"}>
                {user.plan === "elite"
                  ? "included with Elite"
                  : user.api_access
                    ? "granted"
                    : "off"}
              </Badge>
              <SubmitButton variant="secondary" size="sm">
                {user.api_access ? "Revoke grant" : "Grant access"}
              </SubmitButton>
            </form>
            <p className="mt-1.5 text-xs text-neutral-400">
              Elite includes the API already — this grant is for everyone else: a pilot, a partner, a
              migration. Their existing keys stop working the moment it&apos;s revoked.
            </p>
          </div>

          <ProducerAccessRow
            userId={user.id}
            state={producerAccessState(user, producerOpenToElite)}
            granted={user.producer_access === true}
            grantReady={"producer_access" in user}
            producerOn={producerOn}
            eliteUnits={PLAN_CHAT_UNIT_LIMITS.elite}
            eliteUnitsUsd={PLAN_CHAT_UNIT_LIMITS.elite * PRODUCER_UNIT_USD}
          />

          {/* Picacho Light: the version and look this person picked (welcome
              step or Settings), and the admin's way to change them. */}
          <div className="mt-6 border-t border-neutral-100 pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
              Version and look
            </p>
            {"app_mode" in user ? (
              <>
                <p className="mt-2 text-sm text-neutral-700">
                  {appMode ? ADMIN_MODE_LABELS[appMode] : "Not chosen yet"} ·{" "}
                  {appLook ? `${ADMIN_LOOK_LABELS[appLook]} look` : "look set on each device"}
                </p>
                <form action={setUserAppChoices} className="mt-2 flex flex-col gap-2">
                  <input type="hidden" name="user_id" value={user.id} />
                  <select
                    name="app_mode"
                    aria-label="Version"
                    key={`mode-${appMode ?? "unset"}`}
                    defaultValue={appMode ?? "unset"}
                    className="w-full rounded-[10px] border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400"
                  >
                    <option value="light">{ADMIN_MODE_LABELS.light}</option>
                    <option value="advanced">{ADMIN_MODE_LABELS.advanced}</option>
                    <option value="unset">Not chosen (ask again)</option>
                  </select>
                  <select
                    name="app_look"
                    aria-label="Look"
                    key={`look-${appLook ?? "unset"}`}
                    defaultValue={appLook ?? "unset"}
                    className="w-full rounded-[10px] border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400"
                  >
                    <option value="light">{ADMIN_LOOK_LABELS.light}</option>
                    <option value="dark">{ADMIN_LOOK_LABELS.dark}</option>
                    <option value="system">{ADMIN_LOOK_LABELS.system}</option>
                    <option value="unset">Each device decides</option>
                  </select>
                  <SubmitButton variant="secondary" size="sm" className="w-full">Save</SubmitButton>
                </form>
                <p className="mt-1.5 text-xs text-neutral-400">
                  The version changes on their next page. A new look reaches each of their devices
                  the next time they open the app. &quot;Not chosen&quot; shows them the sign-up
                  choice again.
                </p>
              </>
            ) : (
              <p className="mt-2 text-xs text-neutral-400">
                Shows once supabase/pending/picacho-light.sql has run in Supabase.
              </p>
            )}
          </div>

          <div className="mt-6 border-t border-neutral-100 pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Billing</p>
            <div className="mt-2 flex items-center gap-2">
              <Badge
                tone={
                  user.plan_status === "active"
                    ? "success"
                    : user.plan_status === "past_due"
                      ? "warning"
                      : user.plan_status === "canceled"
                        ? "danger"
                        : "neutral"
                }
              >
                {user.plan_status ?? "inactive"}
              </Badge>
            </div>
            {user.stripe_customer_id ? (
              <dl className="mt-2 space-y-1 text-xs text-neutral-500">
                <div className="flex gap-1.5">
                  <dt className="text-neutral-400">Customer:</dt>
                  <dd className="font-mono">{user.stripe_customer_id}</dd>
                </div>
                <div>
                  <a
                    href={`https://dashboard.stripe.com/customers/${user.stripe_customer_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-atelier-accent hover:underline"
                  >
                    Open in Stripe ↗
                  </a>
                </div>
                {user.stripe_subscription_id && (
                  <div className="flex gap-1.5">
                    <dt className="text-neutral-400">Subscription:</dt>
                    <dd className="font-mono">{user.stripe_subscription_id}</dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="mt-2 text-xs text-neutral-400">No Stripe customer yet.</p>
            )}
          </div>

          <div className="mt-6 border-t border-red-100 pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-red-500">Danger zone</p>
            <p className="mt-2 text-xs leading-relaxed text-neutral-400">
              Suspending blocks sign-in and generation immediately and is fully reversible. Deleting
              permanently removes the account and all its data — characters, generations, projects,
              and billing records — and can&apos;t be undone. To just stop access, suspend instead.
            </p>
            <div className="mt-3">
              <DeleteUserButton userId={user.id} email={user.email} />
            </div>
          </div>
        </Card>

        <div className="min-w-0 space-y-6 lg:col-span-2">
          {path && <PersonPathCard path={path} />}

          {/* Sign-in activity. Its own card rather than more lines in the
              identity block: these are the facts you actually come to this
              page to check when someone reports a problem. */}
          <Card>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-900">Activity</h2>
              {activity?.online ? (
                <Badge tone="success">Online now</Badge>
              ) : (
                <Badge tone="neutral">Offline</Badge>
              )}
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <dt className="text-xs text-neutral-500">Last login</dt>
                <dd className="mt-1 text-sm font-medium text-neutral-900">
                  {activity?.lastSignInAt ? (
                    <LocalDate date={activity.lastSignInAt} mode="datetime" />
                  ) : (
                    "Never"
                  )}
                </dd>
                {activity?.lastSignInAt && (
                  <p className="mt-0.5 text-xs text-neutral-400">
                    {timeAgo(activity.lastSignInAt)}
                  </p>
                )}
              </div>

              <div>
                <dt className="text-xs text-neutral-500">Last seen</dt>
                <dd className="mt-1 text-sm font-medium text-neutral-900">
                  {activity?.lastSeenAt ? (
                    <LocalDate date={activity.lastSeenAt} mode="datetime" />
                  ) : (
                    "Never"
                  )}
                </dd>
                {activity?.lastSeenAt && (
                  <p className="mt-0.5 text-xs text-neutral-400">{timeAgo(activity.lastSeenAt)}</p>
                )}
              </div>

              <div>
                <dt className="text-xs text-neutral-500">Session</dt>
                <dd className="mt-1 text-sm font-medium text-neutral-900">
                  {activity?.sessionSeconds === null
                    ? "Not measured yet"
                    : formatDuration(activity?.sessionSeconds ?? null)}
                </dd>
                <p className="mt-0.5 text-xs text-neutral-400">
                  {activity?.sessionSeconds === null
                    ? "Starts counting on their next visit"
                    : activity?.online
                      ? "Time on site, this visit so far"
                      : "Time on site, their last visit"}
                </p>
              </div>

              <div>
                <dt className="text-xs text-neutral-500">Total time on site</dt>
                <dd className="mt-1 text-sm font-medium text-neutral-900">
                  {activity?.totalActiveSeconds === null
                    ? "—"
                    : formatDuration(activity?.totalActiveSeconds ?? null)}
                </dd>
                <p className="mt-0.5 text-xs text-neutral-400">
                  {(activity?.activeSessions ?? 0) === 1
                    ? "1 signed-in device"
                    : `${activity?.activeSessions ?? 0} signed-in devices`}
                </p>
              </div>
            </dl>
          </Card>

          <div className="grid gap-6 md:grid-cols-2">
            <Card className="min-w-0">
              <h2 className="text-sm font-semibold text-neutral-900">Admin notes</h2>
              <p className="mt-0.5 text-xs text-neutral-400">Only admins see these.</p>
              {auditReady ? (
                <>
                  {notes.length > 0 && (
                    <ul className="mt-3 space-y-2">
                      {notes.map((n) => (
                        <li key={n.id} className="rounded-lg bg-[#fbf6ee] px-3 py-2 text-sm leading-relaxed text-neutral-800 dark:bg-white/5 dark:text-neutral-200">
                          <p className="whitespace-pre-wrap break-words">{n.body}</p>
                          <p className="mt-1 text-xs text-neutral-400">
                            {(n.admin_id && adminEmails.get(n.admin_id)) || "an admin"} · {timeAgo(n.created_at)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                  <form action={addUserNote} className="mt-3 flex flex-col gap-2">
                    <input type="hidden" name="user_id" value={user.id} />
                    <textarea
                      name="body"
                      aria-label="New note"
                      required
                      maxLength={2000}
                      rows={2}
                      placeholder="Add a note: a deal you made, what they asked for…"
                      className="w-full resize-y rounded-[10px] border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400"
                    />
                    <SubmitButton variant="secondary" size="sm" className="self-start" pendingLabel="Saving…">
                      Add note
                    </SubmitButton>
                  </form>
                </>
              ) : (
                <p className="mt-3 text-xs text-neutral-500">
                  Notes start once supabase/applied/2026-09-29/admin-activity.sql has run in Supabase.
                </p>
              )}
            </Card>

            <Card className="min-w-0">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-neutral-900">Admin changes</h2>
                <Link href={`/admin/activity?user=${user.id}`} className="text-xs text-neutral-400 hover:text-neutral-900">
                  Full log →
                </Link>
              </div>
              {!auditReady ? (
                <p className="mt-3 text-xs text-neutral-500">
                  Recorded once supabase/applied/2026-09-29/admin-activity.sql has run in Supabase.
                </p>
              ) : changes.length === 0 ? (
                <p className="mt-3 text-sm text-neutral-500">No admin has changed anything on this account yet.</p>
              ) : (
                <ul className="mt-3 divide-y divide-neutral-100">
                  {changes.map((c) => (
                    <li key={c.id} className="py-2 text-xs first:pt-0 last:pb-0">
                      <p className="text-neutral-800">
                        <span className="font-semibold">{actionLabel(c.action)}</span>
                        {c.amount !== null && <span className="text-atelier-accent"> {c.amount}</span>}
                        {(c.before_value !== null || c.after_value !== null) && (
                          <span className="font-mono text-neutral-500">
                            {" "}
                            {c.before_value ?? "—"} → {c.after_value ?? "—"}
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-neutral-400">
                        {(c.admin_id && adminEmails.get(c.admin_id)) || "an admin"} · {timeAgo(c.created_at)}
                        {c.reason && <> · {c.reason}</>}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card>
            <h2 className="text-sm font-semibold text-neutral-900">Usage</h2>
            <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs text-neutral-500">This month</p>
                <p className="mt-1 text-lg font-semibold text-neutral-900">
                  {usedThisMonth}
                  {monthlyLimit > 0 && (
                    <span className="text-sm font-normal text-neutral-400"> / {monthlyLimit}</span>
                  )}
                </p>
                {bonusCredits > 0 && (
                  <p className="mt-0.5 text-xs text-neutral-400">+{bonusCredits} bonus</p>
                )}
              </div>
              <div>
                <p className="text-xs text-neutral-500">All-time generations</p>
                <p className="mt-1 text-lg font-semibold text-neutral-900">
                  {totalGenerations ?? 0}
                </p>
              </div>
              <div>
                <p className="text-xs text-neutral-500">Success rate</p>
                <p className="mt-1 text-lg font-semibold text-neutral-900">
                  {successRate === null ? "—" : `${successRate}%`}
                </p>
              </div>
              <div>
                <p className="text-xs text-neutral-500">Projects / characters</p>
                <p className="mt-1 text-lg font-semibold text-neutral-900">
                  {projectsCount ?? 0} / {characters?.length ?? 0}
                </p>
              </div>
            </div>
            <div className="mt-4 flex gap-4 border-t border-neutral-100 pt-3 text-xs text-neutral-500">
              <Link href="/admin/feedback" className="hover:text-neutral-900">
                {feedbackCount ?? 0} feedback submitted
              </Link>
              <Link href="/admin/reports" className="hover:text-neutral-900">
                {reportsCount ?? 0} problem reports filed
              </Link>
            </div>
          </Card>

          {/* Every error and crash this account ever hit — the full report
              list inline, not a count behind a link. Reasons: user-filed
              reports, auto-filed generation failures, and client crashes
              (generation_id null = a crash/JS error, not a render). */}
          <Card>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-900">
                Errors &amp; reports ({reports?.length ?? 0})
              </h2>
              {(reports?.length ?? 0) > 0 && (
                <Link href="/admin/reports" className="text-xs text-neutral-400 hover:text-neutral-900">
                  Open reports queue →
                </Link>
              )}
            </div>
            {!reports || reports.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-500">
                Clean record — no errors, crashes or reports from this account.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-neutral-100">
                {reports.map((r) => (
                  <li key={r.id} className="py-2.5 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-medium text-neutral-700">
                        {r.generation_id === null && r.reason === "technical_error"
                          ? (REPORT_SURFACE_LABELS[reportSurface(r.details)!] ?? "App crash / client error")
                          : r.reason.replace(/_/g, " ")}
                        <span className="ml-2 font-normal text-neutral-400">
                          {r.source === "auto" ? "auto-filed" : "filed by the user"} ·{" "}
                          {timeAgo(r.created_at)}
                        </span>
                      </p>
                      <Badge
                        tone={r.status === "open" ? "warning" : "neutral"}
                        className="flex-shrink-0"
                      >
                        {r.status}
                      </Badge>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-neutral-500">
                      {r.details}
                    </p>
                    {r.generation_id && (
                      <Link
                        href={`/app/history/${r.generation_id}`}
                        className="mt-1 inline-block text-xs text-neutral-400 underline hover:text-neutral-700"
                      >
                        View the render
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Every refund. How many credits one gave back is recorded
              nowhere: a refund zeroes the render's spend fields, which is
              all the old "+N cr back" and its total added up, so both read
              0. Each row says instead which daily limit it counted toward,
              the one question the amount can't answer anyway (playbook
              §3.1). A forced refund has no refund time, so it shows when
              the render was sent. */}
          <Card>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-900">
                Refunds ({refundsCount ?? refunds?.length ?? 0})
              </h2>
              {(refundsCount ?? 0) > (refunds?.length ?? 0) && (
                <span className="text-xs text-neutral-400">
                  {refunds?.length ?? 0} of {refundsCount}
                </span>
              )}
            </div>
            {!refunds || refunds.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-500">No refunded generations.</p>
            ) : (
              <ul className="mt-3 divide-y divide-neutral-100">
                {refunds.map((g) => {
                  const refundedAt = g.refunded_at ?? g.identity_gated_at;
                  return (
                    <li key={g.id} className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                      <Link href={`/app/history/${g.id}`} className="min-w-0 flex-1 hover:opacity-70">
                        <p className="truncate text-xs text-neutral-700">{g.prompt_input}</p>
                        <p className="mt-0.5 text-xs text-neutral-400">
                          {g.content_type} on {g.video_model_id ?? g.model_id ?? "?"} ·{" "}
                          {refundedAt ? <>refunded {timeAgo(refundedAt)}</> : <>sent {timeAgo(g.created_at)}</>}
                        </p>
                      </Link>
                      <span className="flex-shrink-0 text-xs font-medium text-neutral-700">
                        {REFUND_LIMIT_LABELS[refundLimit(g)]}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-neutral-900">
              Characters ({characters?.length ?? 0})
            </h2>
            {!characters || characters.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-500">None yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {characters.map((c) => (
                  <li key={c.id} className="text-sm text-neutral-700">
                    {c.name}
                    <span className="ml-2 text-xs text-neutral-400">
                      {new Date(c.created_at).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-900">Recent generations</h2>
              {(totalGenerations ?? 0) > (generations?.length ?? 0) && (
                <span className="text-xs text-neutral-400">
                  {generations?.length ?? 0} of {totalGenerations}
                </span>
              )}
            </div>
            {!generations || generations.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-500">None yet.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {generations.map((g) => (
                  <li key={g.id} className="flex items-center justify-between gap-4">
                    <Link
                      href={`/app/history/${g.id}`}
                      className="min-w-0 flex-1 hover:opacity-70"
                    >
                      <div className="flex items-center justify-between gap-4 text-sm">
                        <span className="min-w-0 truncate text-neutral-700">{g.prompt_input}</span>
                        <Badge
                          tone={g.status === "succeeded" ? "success" : "danger"}
                          className="flex-shrink-0"
                        >
                          {g.status}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-neutral-400">
                        {g.content_type} · {g.video_model_id ?? g.model_id ?? "—"} ·{" "}
                        {g.credits_used ?? 0} cr
                        {typeof g.match_score === "number" && <> · match {g.match_score}%</>}
                        {(g.attempts ?? 0) > 1 && <> · {g.attempts} attempts</>}
                        {wasRefunded(g) && <> · refunded</>} · {timeAgo(g.created_at)}
                      </p>
                    </Link>
                    {/* Public-gallery toggle (/gallery). Only rendered on
                        succeeded rows of ADMIN-owned accounts — the v1
                        content-rights rule (customer content is never
                        publishable without consent; see setGenerationFeatured,
                        which enforces the same rule server-side either way). */}
                    {/* Refund by hand (2026-09-28): anything the render still
                        holds comes back as bonus credits, once
                        (admin_refund_render). A render already refunded,
                        automatically or by hand, shows no button. */}
                    {auditReady &&
                      !wasRefunded(g) &&
                      (g.credits_used ?? 0) + (g.purchased_credits_used ?? 0) + (g.bonus_credits_used ?? 0) > 0 &&
                      (handRefunded.has(g.id) ? (
                        <span className="flex-shrink-0 text-xs text-neutral-400">refunded by hand</span>
                      ) : (
                        <form action={refundRender} className="flex-shrink-0">
                          <input type="hidden" name="generation_id" value={g.id} />
                          <input type="hidden" name="user_id" value={user.id} />
                          <SubmitButton variant="secondary" size="sm" pendingLabel="Refunding…">
                            Refund {(g.credits_used ?? 0) + (g.purchased_credits_used ?? 0) + (g.bonus_credits_used ?? 0)} cr
                          </SubmitButton>
                        </form>
                      ))}
                    {user.role === "admin" && g.status === "succeeded" && (
                      <form action={setGenerationFeatured} className="flex-shrink-0">
                        <input type="hidden" name="generation_id" value={g.id} />
                        <input type="hidden" name="featured" value={String(!g.featured_at)} />
                        <input type="hidden" name="redirect_to" value={`/admin/users/${user.id}`} />
                        <SubmitButton variant="secondary" size="sm" pendingLabel="Saving…">
                          {g.featured_at ? "Unfeature" : "Feature"}
                        </SubmitButton>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Full width under both columns: the money table needs the room,
              and it is the summary everything above is evidence for. */}
          <UserEconomicsCard economics={economics} />
        </div>
      </div>
    </div>
  );
}
