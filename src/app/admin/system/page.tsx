import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { fetchAll } from "@/lib/admin/fetch-all";
import { failureRates, type FinishedRender } from "@/lib/admin/failure-rate";
import { FailureSection } from "./failure-section";
import { videoProviderFor } from "@/lib/generations/providers/video-provider";
import { seedanceLaneChoice } from "@/lib/generations/providers/lane-setting";
import { cn } from "@/lib/cn";

export default async function AdminSystemPage() {
  // "seedance-2" is the 2.0 id; both Seedance ids share one lane flag and one
  // picker, so either answers the question this card asks. Resolved through
  // the same function the submit path uses, with the operator's own choice.
  const seedanceLane = videoProviderFor("seedance-2", await seedanceLaneChoice());
  const supabase = await createClient();
  // Both reads page past PostgREST's silent 1,000-row cap (fetch-all.ts): the
  // single read this replaced would have quietly stopped counting there. The
  // logs are read only for failures that were not stops, to tell a render
  // that broke from one a content rule refused (lib/admin/failure-rate.ts).
  let rates: ReturnType<typeof failureRates> | null = null;
  let total = 0;
  let avgAttempts = 0;
  try {
    const [renders, failedLogs] = await Promise.all([
      fetchAll<FinishedRender & { attempts: number | null }>((from, to) =>
        supabase
          .from("generations")
          .select("id, status, created_at, cancel_requested, attempts")
          .in("status", ["succeeded", "failed"])
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      ),
      fetchAll<{ id: string; pipeline_log: unknown }>(
        (from, to) =>
          supabase
            .from("generations")
            .select("id, pipeline_log")
            .eq("status", "failed")
            .not("cancel_requested", "is", true)
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
        200,
      ),
    ]);
    rates = failureRates(renders, new Map(failedLogs.map((r) => [r.id, r.pipeline_log])), new Date());
    total = renders.length;
    avgAttempts =
      total > 0 ? Math.round((renders.reduce((s, r) => s + (r.attempts ?? 0), 0) / total) * 10) / 10 : 0;
  } catch (err) {
    console.error("[admin/system] reading renders failed:", err);
  }

  return (
    <div>
      <div>
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">System</p>
        <h1 className="mt-1 font-numeral text-3xl text-atelier-ink">System health</h1>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-neutral-500">Generations logged</p>
          <p className="mt-1 text-2xl font-semibold text-neutral-900">{total}</p>
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

      <FailureSection rates={rates} />
    </div>
  );
}
