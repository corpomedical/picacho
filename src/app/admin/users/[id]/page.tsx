import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { setUserStatus, setUserRole, setUserPlan, setBonusCredits } from "@/lib/admin/actions";
import { getMonthlyUsage } from "@/lib/generations/actions";
import { PLAN_LIMITS, type PlanId } from "@/lib/plans";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
      .select("id, prompt_input, status, attempts, created_at")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
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

  // Sign-in / session facts from auth.users + auth.sessions.
  const activity = (await getUserActivity([user])).get(user.id) ?? null;

  const plan = (user.plan ?? "none") as PlanId;
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

      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <p className="text-sm font-medium text-neutral-900">{user.email}</p>
          {user.username && <p className="mt-0.5 text-xs text-neutral-500">@{user.username}</p>}
          {user.company && <p className="mt-0.5 text-xs text-neutral-500">{user.company}</p>}
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
            <Button variant="secondary" size="sm" type="submit" className="w-full">
              {user.status === "active" ? "Suspend account" : "Reinstate account"}
            </Button>
          </form>

          <div className="mt-6 border-t border-neutral-100 pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Role</p>
            <form action={setUserRole} className="mt-2 flex gap-2">
              <input type="hidden" name="user_id" value={user.id} />
              <select
                name="role"
                defaultValue={user.role}
                className="flex-1 rounded-[10px] border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400"
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
              <Button type="submit" variant="secondary" size="sm">
                Save
              </Button>
            </form>
          </div>

          <div className="mt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Plan (manual override)</p>
            <form action={setUserPlan} className="mt-2 flex gap-2">
              <input type="hidden" name="user_id" value={user.id} />
              <select
                name="plan"
                defaultValue={user.plan}
                className="flex-1 rounded-[10px] border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400"
              >
                {Object.keys(PLAN_LIMITS).map((plan) => (
                  <option key={plan} value={plan}>
                    {plan}
                  </option>
                ))}
              </select>
              <Button type="submit" variant="secondary" size="sm">
                Save
              </Button>
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
              <input
                type="number"
                name="bonus_credits"
                min={0}
                defaultValue={bonusCredits}
                className="w-full flex-1 rounded-[10px] border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400"
              />
              <Button type="submit" variant="secondary" size="sm">
                Save
              </Button>
            </form>
            <p className="mt-1.5 text-xs text-neutral-400">
              Extra generations on top of their plan — a goodwill grant, not a plan change. Stacks
              with whatever tier they&apos;re on; doesn&apos;t reset on its own, so set it back to 0
              when it shouldn&apos;t carry into next month.
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

        <div className="space-y-6 lg:col-span-2">
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
                  <li key={g.id}>
                    <Link
                      href={`/app/history/${g.id}`}
                      className="flex items-center justify-between gap-4 text-sm hover:opacity-70"
                    >
                      <span className="min-w-0 truncate text-neutral-700">{g.prompt_input}</span>
                      <Badge
                        tone={g.status === "succeeded" ? "success" : "danger"}
                        className="flex-shrink-0"
                      >
                        {g.status}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
