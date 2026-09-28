import Link from "next/link";
import { cn } from "@/lib/cn";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  checkRender,
  refundRender,
  restoreModel,
  setFeedbackStatus,
  setGenerationReportStatus,
  stopRender,
} from "@/lib/admin/actions";
import { money, type InboxAction, type InboxGroup, type InboxItem, type TodayNumbers } from "@/lib/admin/today";

// Admin → Today (2026-09-28 admin redesign, part 2): the top of the admin
// home. Today's numbers, then "Needs you" — everything waiting on an admin,
// most urgent first, each with the buttons that settle it. Data from
// loadToday (lib/admin/today.ts); nothing below it on the page moved.

const FORM_ACTIONS = {
  resolveReport: setGenerationReportStatus,
  resolveFeedback: setFeedbackStatus,
  refundRender,
  checkRender,
  stopRender,
  restoreModel,
} as const;

const GROUPS: { id: InboxGroup | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "renders", label: "Renders" },
  { id: "money", label: "Money" },
  { id: "people", label: "People" },
  { id: "safety", label: "Reports" },
  { id: "system", label: "System" },
];

const TONE_CHIP: Record<InboxItem["tone"], string> = {
  urgent: "bg-[#fbe4e1] text-[#8f1d15] dark:bg-[#3a1d1a] dark:text-[#f3b1a8]",
  warn: "bg-[#fbeedd] text-[#7a4a0c] dark:bg-[#3a2c18] dark:text-[#f0c98f]",
  info: "bg-[#e3ecf6] text-[#1f4770] dark:bg-[#1c2a3a] dark:text-[#a9c6e8]",
};

export function ActionButton({ action }: { action: InboxAction }) {
  const cls = cn(
    "inline-flex h-8 items-center whitespace-nowrap rounded-lg px-3 text-[12.5px] font-medium transition-colors",
    action.primary
      ? "bg-atelier-ink text-atelier-paper hover:opacity-90"
      : "border border-atelier-rule bg-atelier-surface text-atelier-ink hover:border-atelier-ink/30",
  );
  if (action.type === "link") {
    return action.external || action.href.startsWith("mailto:") ? (
      <a href={action.href} className={cls} target={action.external ? "_blank" : undefined} rel="noopener noreferrer">
        {action.label}
      </a>
    ) : (
      <Link href={action.href} className={cls}>
        {action.label}
      </Link>
    );
  }
  return (
    <form action={FORM_ACTIONS[action.action]}>
      {Object.entries(action.fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <SubmitButton
        size="sm"
        variant={action.primary ? "primary" : "secondary"}
        pendingLabel="…"
        className="h-8 whitespace-nowrap px-3 text-[12.5px]"
      >
        {action.label}
      </SubmitButton>
    </form>
  );
}

export function TodayPanel({
  items,
  numbers,
  running,
  filter,
}: {
  items: InboxItem[];
  numbers: TodayNumbers;
  running: number;
  filter: InboxGroup | "all";
}) {
  const shown = filter === "all" ? items : items.filter((i) => i.group === filter);
  const topUps = Object.entries(numbers.topUps.byCurrency)
    .map(([c, cents]) => money(cents, c))
    .join(" + ");
  const finishedPct = numbers.renders > 0 ? Math.round((numbers.finished / numbers.renders) * 100) : null;

  const tiles = [
    { label: "Sign-ups today", value: String(numbers.signups), note: "since midnight UTC", tone: "muted" },
    {
      label: "Renders today",
      value: String(numbers.renders),
      note:
        finishedPct === null
          ? "none yet"
          : `${finishedPct}% finished · ${numbers.failed} failed · ${running} running`,
      tone: "muted",
    },
    {
      label: "Top-ups today",
      value: topUps || "0",
      note: `${numbers.topUps.count} purchase${numbers.topUps.count === 1 ? "" : "s"}`,
      tone: "muted",
    },
    {
      label: "fal balance",
      value: numbers.falBalanceUsd === null ? "—" : `$${numbers.falBalanceUsd.toFixed(0)}`,
      note:
        numbers.falBalanceUsd === null
          ? "unknown (see AI providers)"
          : numbers.falLevel === "critical"
            ? "can't pay for the priciest render"
            : numbers.falLevel === "low"
              ? "low: under ten of the priciest renders"
              : "fine",
      tone: numbers.falLevel ? "bad" : "muted",
    },
  ];

  return (
    <section aria-label="Today" className="mt-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl border border-atelier-rule bg-atelier-surface px-4 py-3.5">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-atelier-muted">{t.label}</p>
            <p className="mt-1.5 font-numeral text-[28px] leading-none tabular-nums text-atelier-ink">{t.value}</p>
            <p className={cn("mt-1.5 text-xs", t.tone === "bad" ? "text-[#b3261e] dark:text-[#f3b1a8]" : "text-atelier-muted")}>
              {t.note}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-atelier-rule bg-atelier-surface">
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pt-4 sm:px-5">
          <h2 className="mr-auto text-[15px] font-semibold text-atelier-ink">
            Needs you <span className="font-normal text-atelier-muted">· {items.length} waiting</span>
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {GROUPS.map((g) => {
              const count = g.id === "all" ? items.length : items.filter((i) => i.group === g.id).length;
              if (g.id !== "all" && count === 0) return null;
              return (
                <Link
                  key={g.id}
                  href={g.id === "all" ? "/admin" : `/admin?need=${g.id}`}
                  scroll={false}
                  className={cn(
                    "inline-flex h-7 items-center rounded-full px-2.5 text-xs font-medium",
                    filter === g.id
                      ? "bg-atelier-ink text-atelier-paper"
                      : "border border-atelier-rule text-atelier-ink hover:border-atelier-ink/30",
                  )}
                >
                  {g.label}
                  {g.id !== "all" && <span className="ml-1 opacity-60">{count}</span>}
                </Link>
              );
            })}
          </div>
        </div>
        {shown.length === 0 ? (
          <p className="border-t border-atelier-rule px-5 py-6 text-sm text-atelier-muted">
            Nothing is waiting on you{filter === "all" ? "" : " here"}. Stuck renders, failed payments, reports, feedback, a
            low fal balance and switched-off models show up here the moment they happen.
          </p>
        ) : (
          <ul>
            {shown.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-2.5 border-t border-atelier-rule px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span
                    className={cn(
                      "mt-0.5 w-[74px] flex-shrink-0 rounded-md py-1 text-center text-[10px] font-bold uppercase tracking-[0.08em]",
                      TONE_CHIP[item.tone],
                    )}
                  >
                    {item.kind}
                  </span>
                  <div className="min-w-0">
                    <p className="break-words text-[13.5px] font-medium text-atelier-ink">{item.title}</p>
                    <p className="mt-0.5 break-words text-xs text-atelier-muted">{item.sub}</p>
                  </div>
                </div>
                <div className="flex flex-shrink-0 flex-wrap gap-1.5 pl-[86px] sm:pl-0">
                  {item.actions.map((a) => (
                    <ActionButton key={a.label} action={a} />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
