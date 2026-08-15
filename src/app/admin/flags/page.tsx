import { createClient } from "@/lib/supabase/server";
import { toggleFeatureFlag } from "@/lib/admin/actions";
import { SubmitButton } from "@/components/ui/submit-button";
import { Badge } from "@/components/ui/badge";
import { AdminErrorBanner } from "@/components/admin-error-banner";

export default async function AdminFlagsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error: actionError } = await searchParams;
  const supabase = await createClient();
  const { data: flags } = await supabase
    .from("feature_flags")
    .select("*")
    .order("key", { ascending: true });

  return (
    <div>
      <AdminErrorBanner error={actionError} />
      <h1 className="text-lg font-semibold text-neutral-900">Feature flags</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Toggle app behavior without a redeploy.
      </p>

      <div className="mt-6 overflow-hidden rounded-[18px] border border-neutral-100 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03),0_12px_28px_-12px_rgba(0,0,0,0.06)]">
        {!flags || flags.length === 0 ? (
          <p className="p-6 text-sm text-neutral-500">No flags yet.</p>
        ) : (
          <div className="divide-y divide-neutral-100">
            {flags.map((flag) => (
              <div key={flag.key} className="flex items-center justify-between gap-4 p-5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-neutral-900">{flag.key}</p>
                  <p className="mt-0.5 text-xs text-neutral-500">{flag.description}</p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-3">
                  <Badge tone={flag.enabled ? "success" : "neutral"}>
                    {flag.enabled ? "on" : "off"}
                  </Badge>
                  <form action={toggleFeatureFlag}>
                    <input type="hidden" name="key" value={flag.key} />
                    <input type="hidden" name="enabled" value={String(flag.enabled)} />
                    <SubmitButton variant="secondary" size="sm" pendingLabel="Updating…" confirmedLabel="Done">
                      Turn {flag.enabled ? "off" : "on"}
                    </SubmitButton>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
