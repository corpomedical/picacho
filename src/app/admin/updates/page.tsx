import type { SVGProps } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RELEASES } from "@/lib/changelog";

// Access is already gated by admin/layout.tsx (redirects non-admins), so this
// page just renders the changelog. Each release is a native <details> so the
// dropdown works with zero client JS — expand to see everything that shipped
// in that build.

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default function AdminUpdatesPage() {
  return (
    <div>
      <div className="mb-6">
        <div>
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">Product</p>
        <h1 className="mt-1 font-numeral text-3xl text-atelier-ink">Updates</h1>
      </div>
        <p className="mt-1 text-sm text-neutral-500">
          Every release, newest first. Open one to see exactly what shipped.
        </p>
      </div>

      <div className="space-y-3">
        {RELEASES.map((release, i) => (
          <Card key={release.build} className="p-0">
            <details className="group" open={i === 0}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="neutral">v{release.version}</Badge>
                    <span className="text-xs font-medium text-neutral-400">
                      Build {release.build}
                    </span>
                    {i === 0 && <Badge tone="success">Latest</Badge>}
                  </div>
                  <p className="mt-1.5 text-sm font-medium text-neutral-900">{release.title}</p>
                  <p className="mt-0.5 text-xs text-neutral-400">{formatDate(release.date)}</p>
                </div>
                <ChevronDownIcon className="h-5 w-5 flex-shrink-0 text-neutral-400 transition-transform duration-200 group-open:rotate-180" />
              </summary>

              <ul className="space-y-2 border-t border-neutral-100 px-5 py-4">
                {release.items.map((item, idx) => (
                  <li key={idx} className="flex gap-2.5 text-sm leading-relaxed text-neutral-600">
                    <span className="mt-[7px] h-1 w-1 flex-shrink-0 rounded-full bg-neutral-300" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </details>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ChevronDownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
