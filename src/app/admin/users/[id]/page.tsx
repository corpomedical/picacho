import { reportSurface, REPORT_SURFACE_LABELS } from "@/lib/stripe/failure";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import {
  setApiAccess,
  setBonusCredits,
  setGenerationFeatured,
  setUserPlan,
  setUserRole,
  setUserStatus,
} from "@/lib/admin/actions";
import { getMonthlyUsage } from "@/lib/generations/actions";
import { getUserEconomics } from "@/lib/admin/economics";
import { UserEconomicsCard } from "@/components/admin/user-economics-card";
import { PLAN_LIMITS, type PlanId } from "@/lib/plans";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/ui/submit-button";
import { AdminErrorBanner } from "@/components/admin-error-banner";
import { DeleteUserButton } from "@/components/delete-user-button";
import { LocalDate } from "@/components/local-date";
import { getUserActivity, formatDuration } from "@/lib/admin/activity";

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

export default async function AdminUserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error: actionError } = await searchParams;
  const supabase = await createClient();

  const { data: user } = await supabase.from("profiles").select("*").eq("id", id).single();
  if (!user) notFound();

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
        "id, prompt_input, status, attempts, created_at, featured_at, content_type, video_model_id, model_id, credits_used, match_score, refunded_at",
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
  const [{ data: reports }, { data: refunds }, { data: referrer }, providerLookup] =
    await Promise.all([
      supabase
        .from("generation_reports")
        .select("id, created_at, reason, details, source, status, generation_id")
        .eq("user_id", id)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("generations")
        .select("id, created_at, refunded_at, credits_used, purchased_credits_used, prompt_input, video_model_id, model_id, content_type")
        .eq("user_id", id)
        .not("refunded_at", "is", null)
        .order("refunded_at", { ascending: false })
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
  const providers: string[] =
    (providerLookup?.app_metadata?.providers as string[] | undefined) ??
    (providerLookup?.app_metadata?.provider ? [providerLookup.app_metadata.provider as string] : []);
  const refundedCreditsTotal = (refunds ?? []).reduce(
    (sum, g) => sum + (g.credits_used ?? 0) + (g.purchased_credits_used ?? 0),
    0,
  );

  // Sign-in / session facts from auth.users + auth.sessions.
  const activity = (await getUserActivity([user])).get(user.id) ?? null;

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
  const monthlyLimit = PLAN_LIMITS[plan] + bonusCredits;
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

          <div className="mt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
              Bonus credits (this month)
            </p>
            <form action={setBonusCredits} className="mt-2 flex gap-2">
              <input type="hidden" name="user_id" value={user.id} />
              {/* The value this page RENDERED — the action refuses to write
                  over a different one, so a referral credit landing while
                  the tab sat open can't be silently erased. */}
              <input type="hidden" name="expected_bonus_credits" value={bonusCredits} />
              <input
                type="number"
                name="bonus_credits"
                min={0}
                key={bonusCredits}
                defaultValue={bonusCredits}
                className="w-full flex-1 rounded-[10px] border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400"
              />
              <SubmitButton variant="secondary" size="sm">Save</SubmitButton>
            </form>
            <p className="mt-1.5 text-xs text-neutral-400">
              Extra generations on top of their plan — a goodwill grant, not a plan change. Stacks
              with whatever tier they&apos;re on; doesn&apos;t reset on its own, so set it back to 0
              when it shouldn&apos;t carry into next month.
            </p>
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

          {/* Every refund, with the credits that went back. */}
          <Card>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-900">
                Refunds ({refunds?.length ?? 0})
              </h2>
              {refundedCreditsTotal > 0 && (
                <span className="text-xs text-neutral-400">
                  {refundedCreditsTotal} credit{refundedCreditsTotal === 1 ? "" : "s"} returned in total
                </span>
              )}
            </div>
            {!refunds || refunds.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-500">No refunded generations.</p>
            ) : (
              <ul className="mt-3 divide-y divide-neutral-100">
                {refunds.map((g) => (
                  <li key={g.id} className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                    <Link href={`/app/history/${g.id}`} className="min-w-0 flex-1 hover:opacity-70">
                      <p className="truncate text-xs text-neutral-700">{g.prompt_input}</p>
                      <p className="mt-0.5 text-xs text-neutral-400">
                        {g.content_type} on {g.video_model_id ?? g.model_id ?? "?"} · refunded{" "}
                        {g.refunded_at ? timeAgo(g.refunded_at) : "—"}
                      </p>
                    </Link>
                    <span className="flex-shrink-0 text-xs font-medium text-neutral-700">
                      +{(g.credits_used ?? 0) + (g.purchased_credits_used ?? 0)} cr back
                    </span>
                  </li>
                ))}
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
                        {g.refunded_at && <> · refunded</>} · {timeAgo(g.created_at)}
                      </p>
                    </Link>
                    {/* Public-gallery toggle (/gallery). Only rendered on
                        succeeded rows of ADMIN-owned accounts — the v1
                        content-rights rule (customer content is never
                        publishable without consent; see setGenerationFeatured,
                        which enforces the same rule server-side either way). */}
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
