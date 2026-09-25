import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import type { FailureRates, FailureWindow } from "@/lib/admin/failure-rate";

// Admin > System's render failure rate (2026-09-25), its own file so the page
// file keeps to the exports Next allows and the section can be drawn on its
// own. The numbers come from lib/admin/failure-rate.ts; null means the read
// failed and the section says so rather than showing a false zero.
export function FailureSection({ rates }: { rates: FailureRates | null }) {
  return (
    <>
      {/* Render failures (2026-09-25). One all-time "Error rate" stood here
          and read 20% while nothing was breaking: it could never move after
          a fix, it counted Stop as a failure, and it put a refusal in the
          same bucket as a breakage. See lib/admin/failure-rate.ts. */}
      <h2 className="mt-10 text-base font-semibold text-neutral-900">Render failures</h2>
      <p className="mt-1 max-w-2xl text-sm text-neutral-500">
        Renders that failed after every retry. <span className="font-medium text-neutral-700">Broke</span>: a
        provider error, a timeout or our own bug, the number to get to zero.{" "}
        <span className="font-medium text-neutral-700">Refused</span>: a content rule said no (a provider&apos;s
        safety or likeness filter, our own checks, or the account&apos;s brand rules), and the credit came back.
        Renders someone stopped on purpose are not failures and are left out. Each one, with its reason, is in{" "}
        <a href="/admin/moderation" className="underline">
          Moderation
        </a>
        .
      </p>
      {rates ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <FailureCard title="Last 7 days" w={rates.week} />
          <FailureCard title="Last 30 days" w={rates.month} />
          <FailureCard title="All time" w={rates.all} />
        </div>
      ) : (
        <Card className="mt-4">
          <p className="text-sm text-neutral-500">Couldn&apos;t read the renders just now. Reload to try again.</p>
        </Card>
      )}
    </>
  );
}

function FailureCard({ title, w }: { title: string; w: FailureWindow }) {
  return (
    <Card>
      <p className="text-sm text-neutral-500">{title}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold",
          w.broke > 0 ? "text-red-700" : "text-neutral-900",
        )}
      >
        {w.rate === null ? "—" : `${w.rate}%`}
      </p>
      <p className="mt-1 text-xs text-neutral-500">
        {w.failed} failed of {w.finished} renders
      </p>
      <p className="mt-1 text-xs text-neutral-400">
        {w.broke} broke · {w.refused} refused
        {w.stopped > 0 ? ` · ${w.stopped} stopped, not counted` : ""}
      </p>
    </Card>
  );
}
