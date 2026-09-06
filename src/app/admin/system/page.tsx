import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { videoProviderFor } from "@/lib/generations/providers/video-provider";
import { seedanceLaneChoice } from "@/lib/generations/providers/lane-setting";
import { cn } from "@/lib/cn";

export default async function AdminSystemPage() {
  // "seedance-2" is the 2.0 id; both Seedance ids share one lane flag and one
  // picker, so either answers the question this card asks. Resolved through
  // the same function the submit path uses, with the operator's own choice.
  const seedanceLane = videoProviderFor("seedance-2", await seedanceLaneChoice());
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
        {/* Was a dead placeholder reading "No provider connected yet" — untrue
            since the day real providers were wired, and the kind of stale card
            that teaches an operator to stop believing the panel. Replaced with
            the one piece of routing that actually moves: which provider a
            Seedance render goes to, resolved by the pipeline's own function.
            The full readout, including both switches and what the lane has
            billed, lives in Admin > AI providers. */}
        <Card>
          <p className="text-sm text-neutral-500">Seedance render lane</p>
          <p
            className={cn(
              "mt-1 text-2xl font-semibold",
              seedanceLane === "byteplus" ? "text-emerald-700" : "text-neutral-900",
            )}
          >
            {seedanceLane === "byteplus" ? "BytePlus" : "fal.ai"}
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            Every other model runs on fal ·{" "}
            <a href="/admin/providers" className="underline">
              details
            </a>
          </p>
        </Card>
      </div>
    </div>
  );
}
