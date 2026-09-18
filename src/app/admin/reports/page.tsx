import Link from "next/link";
import { toMediaUrl, isRenderableUrl } from "@/lib/media/url";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/ui/submit-button";
import { AdminErrorBanner } from "@/components/admin-error-banner";
import { setGenerationReportStatus } from "@/lib/admin/actions";
import { fetchIn } from "@/lib/admin/fetch-all";
import { reportSurface, REPORT_SURFACE_LABELS } from "@/lib/stripe/failure";

// Used both for the per-report "Error details" dropdown and the archive
// section toggle below — a plain rotate-on-open chevron, no separate state
// needed since <details>/<summary> already tracks open/closed itself.
function ChevronIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

// How many of each list the page draws. Open reports are counted exactly
// whatever this is; worked ones are history, and the newest are enough.
const OPEN_SHOWN = 200;
const RESOLVED_SHOWN = 100;
const REPORT_COLUMNS = "id, generation_id, user_id, reason, details, status, created_at, source";

const REASON_LABELS: Record<string, string> = {
  wrong_result: "Wrong result",
  inappropriate: "Inappropriate",
  technical_error: "Technical error",
  other: "Other",
};

type ReportRow = {
  id: string;
  generation_id: string | null;
  user_id: string;
  reason: string;
  details: string | null;
  status: string;
  created_at: string;
  source: string;
};

type GenerationSummary = {
  id: string;
  prompt_input: string;
  content_type: string;
  result_url: string | null;
};

// One report — the generation's thumbnail (image results only; a video's
// result_url isn't a usable <img> src) plus enough context to judge and act
// on it without leaving this page: who reported it, when, why, what they
// typed, and a link straight to the full generation for the pipeline log.
function ReportCard({
  report,
  generation,
  email,
}: {
  report: ReportRow;
  generation: GenerationSummary | undefined;
  email: string | undefined;
}) {
  const isNextStatus = report.status === "open" ? "resolved" : "open";
  // Stored result_urls may be long-expired signed URLs — normalize (see
  // lib/media/url.ts) so the thumbnail still renders.
  const displayUrl = toMediaUrl(generation?.result_url ?? null);
  return (
    <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-4">
        {displayUrl && isRenderableUrl(displayUrl) && generation?.content_type === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={displayUrl}
            alt=""
            className="h-16 w-16 flex-shrink-0 rounded-[10px] bg-neutral-100 object-cover"
          />
        ) : (
          <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-[10px] bg-neutral-100 text-[10px] text-neutral-400">
            {generation?.content_type === "video" ? "video" : "—"}
          </div>
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={report.status === "open" ? "warning" : "success"}>
              {(() => {
                // Money-path failures share this table with app crashes; the
                // marker at the front of details (lib/stripe/failure.ts) is
                // what tells an operator "someone could not pay" from
                // "something threw".
                const surface = reportSurface(report.details);
                return surface ? REPORT_SURFACE_LABELS[surface] : (REASON_LABELS[report.reason] ?? report.reason);
              })()}
            </Badge>
            {report.source === "auto" && <Badge tone="neutral">Auto-detected</Badge>}
            <p className="break-all text-xs text-neutral-400">
              {email ?? "Unknown user"} · {new Date(report.created_at).toLocaleString()}
            </p>
          </div>
          {report.generation_id ? (
            generation ? (
              <Link
                href={`/app/history/${generation.id}`}
                className="mt-1 block truncate text-sm font-medium text-neutral-900 hover:underline"
              >
                {generation.prompt_input}
              </Link>
            ) : (
              <p className="mt-1 text-sm text-neutral-400">Generation no longer exists.</p>
            )
          ) : (
            <p className="mt-1 text-sm text-neutral-400">
              {reportSurface(report.details)
                ? "A payment step failed for this account — the Stripe error code is in the details."
                : "Not tied to a specific generation."}
            </p>
          )}
          {report.details && (
            <details className="group mt-2">
              <summary className="flex cursor-pointer select-none items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-900 [&::-webkit-details-marker]:hidden">
                <ChevronIcon className="h-3 w-3 transition-transform group-open:rotate-90" />
                Error details
              </summary>
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-[10px] bg-neutral-900 p-3 font-mono text-xs leading-relaxed text-neutral-100">
                {report.details}
              </pre>
            </details>
          )}
        </div>
      </div>
      <form action={setGenerationReportStatus} className="flex-shrink-0">
        <input type="hidden" name="report_id" value={report.id} />
        <input type="hidden" name="status" value={isNextStatus} />
        <SubmitButton variant="secondary" size="sm" pendingLabel="Updating…">
          {report.status === "open" ? "Mark resolved" : "Reopen"}
        </SubmitButton>
      </form>
    </Card>
  );
}

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error: actionError } = await searchParams;
  const supabase = await createClient();

  // Open and worked reports are read apart. They were one read of the newest
  // 200 of both, split here — so once 200 newer reports existed (the site
  // files one itself for every failed render and every browser error), an
  // older OPEN report fell off this page while the badge, which counts every
  // open one, still showed it (found checking Reports, 2026-09-18). The open
  // read carries its own exact count, so the heading and the badge are one
  // number.
  const [
    { data: openRows, count: openCount, error: openError },
    { data: resolvedRows, error: resolvedError },
  ] = await Promise.all([
    supabase
      .from("generation_reports")
      .select(REPORT_COLUMNS, { count: "exact" })
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(OPEN_SHOWN),
    supabase
      .from("generation_reports")
      .select(REPORT_COLUMNS)
      .neq("status", "open")
      .order("created_at", { ascending: false })
      .limit(RESOLVED_SHOWN),
  ]);
  const error = openError ?? resolvedError;
  const openReports = (openRows ?? []) as ReportRow[];
  const resolvedReports = (resolvedRows ?? []) as ReportRow[];
  const openTotal = openCount ?? openReports.length;
  const shown = [...openReports, ...resolvedReports];

  const [generations, users] = await Promise.all([
    fetchIn<GenerationSummary>(
      shown.map((r) => r.generation_id).filter((id): id is string => Boolean(id)),
      (slice) => supabase.from("generations").select("id, prompt_input, content_type, result_url").in("id", slice),
    ),
    fetchIn<{ id: string; email: string }>(
      shown.map((r) => r.user_id),
      (slice) => supabase.from("profiles").select("id, email").in("id", slice),
    ),
  ]);

  const generationById = new Map(generations.map((g) => [g.id, g]));
  const emailById = new Map(users.map((u) => [u.id, u.email]));

  return (
    <div>
      <AdminErrorBanner error={actionError} />
      <div>
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">Trust &amp; Safety</p>
        <h1 className="mt-1 font-numeral text-3xl text-atelier-ink">Reports</h1>
      </div>
      <p className="mt-1 text-sm text-neutral-500">
        Problems users flagged directly on a result via the report button next to Copy/Like/Dislike,
        plus ones the site caught on its own (failed generations, client-side errors — tagged
        &quot;Auto-detected&quot;) so nothing depends on someone remembering to report it. Also queryable
        straight from the database (generation_reports) for a faster fix loop.
      </p>

      <div className="mt-6">
        <h2 className="text-sm font-semibold text-neutral-900">Open ({openTotal})</h2>
        {openTotal > openReports.length && (
          <p className="mt-1 text-xs text-neutral-500">
            Showing the newest {openReports.length} of {openTotal}. Resolve these and the older ones take their place.
          </p>
        )}
        <div className="mt-3 space-y-3">
          {error ? (
            <Card className="text-center">
              <p className="text-sm text-red-600">Couldn&apos;t load: {error.message}</p>
            </Card>
          ) : openReports.length === 0 ? (
            <Card className="text-center">
              <p className="text-sm text-neutral-500">No open reports. All clear.</p>
            </Card>
          ) : (
            openReports.map((r) => (
              <ReportCard
                key={r.id}
                report={r}
                generation={r.generation_id ? generationById.get(r.generation_id) : undefined}
                email={emailById.get(r.user_id)}
              />
            ))
          )}
        </div>
      </div>

      {resolvedReports.length > 0 && (
        <details className="group mt-8">
          <summary className="flex cursor-pointer select-none items-center gap-1.5 text-sm font-semibold text-neutral-900 [&::-webkit-details-marker]:hidden">
            <ChevronIcon className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
            Archived — Revised &amp; Resolved ({resolvedReports.length})
          </summary>
          <div className="mt-3 space-y-3 opacity-70">
            {resolvedReports.map((r) => (
              <ReportCard
                key={r.id}
                report={r}
                generation={r.generation_id ? generationById.get(r.generation_id) : undefined}
                email={emailById.get(r.user_id)}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
