import Link from "next/link";
import { LocalDate } from "@/components/local-date";
import { replyOnly } from "@/lib/email/inbound";
import { STATUS_LABEL, type EmailRow } from "@/lib/email/threads";
import { cn } from "@/lib/cn";

// Emails sent and received (2026-10-03): one row per email — a note written
// from the site (↗) or a reply (↙) — with what Resend reported (Sent,
// Delivered, Opened, Bounced…). Tap a row for the whole message. Used on a
// person's page (their thread) and on Admin → Emails (everything).

function tone(row: EmailRow): { label: string; cls: string } {
  if (row.direction === "in") return { label: "Reply", cls: "bg-[color-mix(in_srgb,var(--apple-blue)_14%,transparent)] text-[var(--apple-blue)]" };
  if (row.opened_at && (row.status === "delivered" || row.status === "sent")) {
    return { label: "Opened", cls: "bg-[color-mix(in_srgb,var(--apple-green)_15%,transparent)] text-[var(--apple-green-ink)]" };
  }
  const label = STATUS_LABEL[row.status];
  if (row.status === "delivered") return { label, cls: "bg-[color-mix(in_srgb,var(--apple-green)_15%,transparent)] text-[var(--apple-green-ink)]" };
  if (row.status === "bounced" || row.status === "complained" || row.status === "failed") {
    return { label, cls: "bg-[color-mix(in_srgb,var(--apple-red)_13%,transparent)] text-[var(--apple-red-ink)]" };
  }
  if (row.status === "delivery_delayed") return { label, cls: "bg-[color-mix(in_srgb,#ff9500_16%,transparent)] text-[var(--apple-orange-ink)]" };
  return { label, cls: "bg-[var(--apple-fill)] text-atelier-muted" };
}

function Arrow({ out }: { out: boolean }) {
  return (
    <span
      className={cn(
        "mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full",
        out ? "bg-[var(--apple-blue)]" : "bg-[var(--apple-green)]",
      )}
      aria-label={out ? "Sent" : "Received"}
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {out ? <path d="M7 17 17 7M9 7h8v8" /> : <path d="M17 7 7 17M15 17H7V9" />}
      </svg>
    </span>
  );
}

export function EmailList({
  rows,
  showPerson = false,
  empty,
}: {
  rows: (EmailRow & { person?: string | null })[];
  showPerson?: boolean;
  empty: string;
}) {
  if (rows.length === 0) return <p className="px-5 py-6 text-sm text-atelier-muted">{empty}</p>;
  return (
    <ul>
      {rows.map((row) => {
        const out = row.direction === "out";
        const text = out ? row.body : replyOnly(row.body);
        const snippet = text.replace(/\s+/g, " ").trim();
        const t = tone(row);
        const who = showPerson && row.person ? row.person : null;
        return (
          <li key={row.id} className="border-t border-atelier-rule first:border-t-0">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-start gap-3 px-5 py-3 hover:bg-atelier-ink/[0.03] [&::-webkit-details-marker]:hidden">
                <Arrow out={out} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-atelier-ink">
                    {who && (
                      <>
                        {row.user_id ? (
                          <Link href={`/admin/users/${row.user_id}`} className="text-atelier-ink no-underline hover:underline">
                            {who}
                          </Link>
                        ) : (
                          who
                        )}
                        <span className="text-atelier-muted"> · </span>
                      </>
                    )}
                    {row.subject || "(no subject)"}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-atelier-muted">
                    {out ? `To ${row.to_email}` : `From ${row.from_email}`}
                    {snippet ? ` — ${snippet}` : ""}
                  </p>
                </div>
                <div className="flex flex-none flex-col items-end gap-1">
                  <span className={cn("rounded-full px-2 py-0.5 text-[11.5px] font-semibold", t.cls)}>{t.label}</span>
                  <span className="text-[11.5px] tabular-nums text-atelier-muted">
                    <LocalDate date={row.created_at} mode="datetime" />
                  </span>
                </div>
              </summary>
              <div className="px-5 pb-4 pl-[60px]">
                <div className="whitespace-pre-wrap rounded-[10px] bg-[var(--apple-fill)] px-4 py-3 text-[13.5px] leading-[1.55] text-atelier-ink">
                  {text || "(No text in this email.)"}
                </div>
                {out && (
                  <p className="mt-2 text-xs text-atelier-muted">
                    From {row.from_email}
                    {row.delivered_at ? " · delivered " : ""}
                    {row.delivered_at && <LocalDate date={row.delivered_at} mode="datetime" />}
                    {row.opened_at ? " · opened " : ""}
                    {row.opened_at && <LocalDate date={row.opened_at} mode="datetime" />}
                  </p>
                )}
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
