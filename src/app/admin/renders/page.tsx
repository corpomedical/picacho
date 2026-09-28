import Link from "next/link";
import { requireAdmin } from "@/lib/admin/require-admin";
import { loadRenderQueue, ORPHAN_AFTER_MIN, STUCK_AFTER_MIN } from "@/lib/admin/today";
import { ActionButton } from "@/components/admin/today-panel";
import { AdminErrorBanner } from "@/components/admin-error-banner";
import { AutoRefresh } from "@/components/auto-refresh";
import { cn } from "@/lib/cn";

// Admin → Render queue (2026-09-28 admin redesign, part 3): every render in
// flight right now, oldest first, with Check now (one step of the same state
// machine the poller and the webhook drive), Stop, and Stop + refund.

export default async function AdminRendersPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; error?: string }>;
}) {
  const { admin } = await requireAdmin();
  const { show, error: actionError } = await searchParams;
  const queue = await loadRenderQueue(admin);
  const stuck = queue.filter((q) => q.state === "stuck");
  const rows = show === "stuck" ? stuck : queue;

  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const [{ count: finishedToday }, { count: failedToday }] = await Promise.all([
    admin.from("generations").select("id", { count: "exact", head: true }).gte("created_at", since.toISOString()).eq("status", "succeeded"),
    admin.from("generations").select("id", { count: "exact", head: true }).gte("created_at", since.toISOString()).eq("status", "failed"),
  ]);

  const chip = (active: boolean) =>
    cn(
      "inline-flex h-8 items-center rounded-full px-3 text-[12.5px] font-medium",
      active ? "bg-atelier-ink text-atelier-paper" : "border border-atelier-rule bg-atelier-surface text-atelier-ink hover:border-atelier-ink/30",
    );

  return (
    <div>
      <AdminErrorBanner error={actionError} />
      <AutoRefresh intervalMs={15_000} />
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">Operations</p>
      <h1 className="mt-1 font-numeral text-3xl text-atelier-ink">Render queue</h1>
      <p className="mt-1 text-sm text-atelier-muted">
        Every render in flight right now, oldest first. Updates by itself every 15 seconds. A render counts as stuck
        after {STUCK_AFTER_MIN} minutes, or after {ORPHAN_AFTER_MIN} with no provider job.
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        <Link href="/admin/renders" className={chip(show !== "stuck")}>
          Running {queue.length}
        </Link>
        <Link href="/admin/renders?show=stuck" className={chip(show === "stuck")}>
          Stuck {stuck.length}
        </Link>
        <span className={chip(false)}>Finished today {finishedToday ?? 0}</span>
        <Link href="/admin/moderation" className={chip(false)}>
          Failed today {failedToday ?? 0}
        </Link>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-atelier-rule bg-atelier-surface">
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-atelier-muted">
            {show === "stuck" ? "Nothing is stuck." : "No renders are running right now."}
          </p>
        ) : (
          <>
            <div className="hidden grid-cols-[84px_minmax(0,1.5fr)_minmax(0,1fr)_70px_60px_290px] gap-3 px-5 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-atelier-muted lg:grid">
              <span>State</span>
              <span>Who · what</span>
              <span>Engine · stage</span>
              <span className="text-right">Running</span>
              <span className="text-right">Credits</span>
              <span />
            </div>
            <ul>
              {rows.map((q) => (
                <li
                  key={q.id}
                  className="grid gap-2 border-t border-atelier-rule px-4 py-3 text-[13px] text-atelier-ink sm:px-5 lg:grid-cols-[84px_minmax(0,1.5fr)_minmax(0,1fr)_70px_60px_290px] lg:items-center lg:gap-3"
                >
                  <span
                    className={cn(
                      "justify-self-start rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-[0.06em]",
                      q.state === "stuck"
                        ? "bg-[#fbe4e1] text-[#8f1d15] dark:bg-[#3a1d1a] dark:text-[#f3b1a8]"
                        : "bg-[#e3ecf6] text-[#1f4770] dark:bg-[#1c2a3a] dark:text-[#a9c6e8]",
                    )}
                  >
                    {q.cancelRequested ? "Stopping" : q.state === "stuck" ? "Stuck" : "Running"}
                  </span>
                  <span className="min-w-0">
                    <Link href={`/admin/users/${q.userId}`} className="font-semibold hover:underline">
                      {q.email ?? "unknown account"}
                    </Link>{" "}
                    <span className="text-atelier-muted">· {q.contentType}</span>
                    <span className="mt-0.5 block truncate text-xs text-atelier-muted">{q.prompt}</span>
                  </span>
                  <span className="min-w-0 text-atelier-muted">
                    {q.model}
                    {q.stage ? ` · ${q.stage}` : " · no provider job"}
                  </span>
                  <span className={cn("tabular-nums lg:text-right", q.state === "stuck" && "font-semibold text-[#b3261e] dark:text-[#f3b1a8]")}>
                    {q.minutes} min
                  </span>
                  <span className="tabular-nums lg:text-right">{q.creditsHeld} cr</span>
                  <span className="flex flex-wrap gap-1.5 lg:justify-end">
                    <ActionButton
                      action={{ type: "form", label: "Check now", action: "checkRender", fields: { generation_id: q.id }, primary: q.state === "stuck" }}
                    />
                    {!q.cancelRequested && (
                      <>
                        <ActionButton action={{ type: "form", label: "Stop", action: "stopRender", fields: { generation_id: q.id } }} />
                        <ActionButton
                          action={{ type: "form", label: "Stop + refund", action: "stopRender", fields: { generation_id: q.id, refund: "1" } }}
                        />
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <p className="mt-3 text-xs text-atelier-muted">
        Check now collects a render whose finished-message was lost, moves a finished stage on, or fails a dead job by the
        refund rules; it never cancels a render that is still working. Stop works like the person&apos;s own Stop button.
        Stop + refund also gives back whatever the render still holds, as bonus credits, once. Every press is written to
        the activity log.
      </p>
    </div>
  );
}
