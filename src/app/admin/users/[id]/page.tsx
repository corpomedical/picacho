import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { setUserStatus, setUserRole, setUserPlan } from "@/lib/admin/actions";
import { PLAN_LIMITS } from "@/lib/plans";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AdminErrorBanner } from "@/components/admin-error-banner";

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

  const [{ data: characters }, { data: generations }] = await Promise.all([
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
  ]);

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
          <p className="mt-1 text-xs text-neutral-500">
            Joined {new Date(user.created_at).toLocaleDateString()}
          </p>
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
        </Card>

        <div className="space-y-6 lg:col-span-2">
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
            <h2 className="text-sm font-semibold text-neutral-900">Recent generations</h2>
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
