import type { ProviderFunds } from "@/lib/admin/provider-funds";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function Amount({ p }: { p: ProviderFunds }) {
  const r = p.reading;
  if (r.kind === "live") {
    const value = r.unit === "USD" ? `$${r.amount.toFixed(2)}` : `${whole.format(r.amount)} credits`;
    const detail = [r.of !== undefined ? `of ${whole.format(r.of)}` : null, r.note].filter(Boolean).join(" · ");
    return (
      <div className="text-right">
        <p className={cn("text-lg font-semibold tabular-nums", r.low ? "text-amber-700" : "text-neutral-900")}>{value}</p>
        {(detail || r.low) && (
          <p className={cn("text-xs", r.low ? "text-amber-700" : "text-neutral-400")}>{r.low ? `Running low${detail ? ` · ${detail}` : ""}` : detail}</p>
        )}
      </div>
    );
  }
  if (r.kind === "error") {
    return (
      <div className="text-right">
        <Badge tone="warning">unavailable</Badge>
        <p className="mt-1 max-w-64 text-xs text-neutral-400">{r.reason}</p>
      </div>
    );
  }
  if (r.kind === "not-connected") return <p className="text-xs text-neutral-400">Not set up</p>;
  return <p className="max-w-40 text-right text-xs text-neutral-400">Balance on their site</p>;
}

/** Every paid provider: what is left, and the link to top up. */
export function ProviderFundsCard({ providers, className }: { providers: ProviderFunds[]; className?: string }) {
  return (
    <Card className={className}>
      <h2 className="text-sm font-semibold text-neutral-900">AI provider funds</h2>
      <p className="mt-0.5 text-[11px] text-neutral-400">
        Live where the provider lets us read it; OpenAI, Anthropic, Google, BytePlus and Modal only show it on their own site.
      </p>
      <div className="mt-3 divide-y divide-neutral-100">
        {providers.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
            <div className="min-w-0">
              <p className="text-sm text-neutral-900">{p.name}</p>
              <p className="mt-0.5 text-xs text-neutral-400">{p.usedFor}</p>
            </div>
            <div className="ml-auto flex items-center gap-4">
              <Amount p={p} />
              <a
                href={p.refillUrl}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-xs text-neutral-500 underline hover:text-neutral-900"
              >
                Top up →
              </a>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
