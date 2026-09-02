import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";

export default async function AdminSystemPage() {
  const supabase = await createClient();
  const { data: generations } = await supabase
    .from("generations")
    .select("status, attempts")
    .in("status", ["succeeded", "failed"]);

  const rows = generations ?? [];
  const total = rows.length;
  const failed = rows.filter((r) => r.status === "failed").length;
  const errorRate = total > 0 ? Math.round((failed / total) * 100) : 0;
  const avgAttempts =
    total > 0 ? Math.round((rows.reduce((s, r) => s + (r.attempts ?? 0), 0) / total) * 10) / 10 : 0;

  return (
    <div>
      <div>
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">System</p>
        <h1 className="mt-1 font-numeral text-3xl text-atelier-ink">System health</h1>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-sm text-neutral-500">Generations logged</p>
          <p className="mt-1 text-2xl font-semibold text-neutral-900">{total}</p>
        </Card>
        <Card>
          <p className="text-sm text-neutral-500">Error rate</p>
          <p className="mt-1 text-2xl font-semibold text-neutral-900">{errorRate}%</p>
          <p className="mt-1 text-xs text-neutral-400">Failed after every retry</p>
        </Card>
        <Card>
          <p className="text-sm text-neutral-500">Avg. retries per generation</p>
          <p className="mt-1 text-2xl font-semibold text-neutral-900">{avgAttempts}</p>
        </Card>
        <Card>
          <p className="text-sm text-neutral-500">Model uptime / fallback usage</p>
          <p className="mt-1 text-2xl font-semibold text-neutral-300">—</p>
          <p className="mt-1 text-xs text-neutral-400">No provider connected yet</p>
        </Card>
      </div>
    </div>
  );
}
