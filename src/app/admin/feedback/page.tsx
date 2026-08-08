import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AdminErrorBanner } from "@/components/admin-error-banner";
import { setFeedbackStatus } from "@/lib/admin/actions";

// Same rotate-on-open chevron as /admin/reports' archive toggle.
function ChevronIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

type FeedbackRow = {
  id: string;
  user_id: string;
  message: string;
  status: string;
  created_at: string;
};

// One piece of feedback — who sent it, when, and the message itself, plus a
// resolve/reopen toggle. No generation/reason context to show (unlike
// ReportCard on /admin/reports) since this isn't tied to a specific result.
function FeedbackCard({ item, email }: { item: FeedbackRow; email: string | undefined }) {
  const isNextStatus = item.status === "open" ? "resolved" : "open";
  return (
    <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={item.status === "open" ? "warning" : "success"}>
            {item.status === "open" ? "Open" : "Resolved"}
          </Badge>
          <p className="text-xs text-neutral-400">
            {email ?? "Unknown user"} · {new Date(item.created_at).toLocaleString()}
          </p>
        </div>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm text-neutral-900">{item.message}</p>
      </div>
      <form action={setFeedbackStatus} className="flex-shrink-0">
        <input type="hidden" name="feedback_id" value={item.id} />
        <input type="hidden" name="status" value={isNextStatus} />
        <Button variant="secondary" size="sm" type="submit">
          {item.status === "open" ? "Mark resolved" : "Reopen"}
        </Button>
      </form>
    </Card>
  );
}

export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error: actionError } = await searchParams;
  const supabase = await createClient();

  const { data: items, error } = await supabase
    .from("feedback")
    .select("id, user_id, message, status, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  const userIds = Array.from(new Set((items ?? []).map((i) => i.user_id)));
  const { data: users } = userIds.length
    ? await supabase.from("profiles").select("id, email").in("id", userIds)
    : { data: [] as { id: string; email: string }[] };
  const emailById = new Map((users ?? []).map((u) => [u.id, u.email]));

  const openItems = (items ?? []).filter((i) => i.status === "open");
  const resolvedItems = (items ?? []).filter((i) => i.status !== "open");

  return (
    <div>
      <AdminErrorBanner error={actionError} />
      <h1 className="text-lg font-semibold text-neutral-900">Feedback</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Open-ended feedback people send from the &quot;Give us your feedback&quot; link under the
        composer — not tied to a specific result (see /admin/reports for those). Also queryable
        directly from the database (feedback table).
      </p>

      <div className="mt-6">
        <h2 className="text-sm font-semibold text-neutral-900">Open ({openItems.length})</h2>
        <div className="mt-3 space-y-3">
          {error ? (
            <Card className="text-center">
              <p className="text-sm text-red-600">Couldn&apos;t load: {error.message}</p>
            </Card>
          ) : openItems.length === 0 ? (
            <Card className="text-center">
              <p className="text-sm text-neutral-500">No open feedback. All clear.</p>
            </Card>
          ) : (
            openItems.map((i) => <FeedbackCard key={i.id} item={i} email={emailById.get(i.user_id)} />)
          )}
        </div>
      </div>

      {resolvedItems.length > 0 && (
        <details className="group mt-8">
          <summary className="flex cursor-pointer select-none items-center gap-1.5 text-sm font-semibold text-neutral-900 [&::-webkit-details-marker]:hidden">
            <ChevronIcon className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
            Archived — Revised &amp; Resolved ({resolvedItems.length})
          </summary>
          <div className="mt-3 space-y-3 opacity-70">
            {resolvedItems.map((i) => (
              <FeedbackCard key={i.id} item={i} email={emailById.get(i.user_id)} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
