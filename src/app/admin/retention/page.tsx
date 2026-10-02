import Link from "next/link";
import { requireAdmin } from "@/lib/admin/require-admin";
import { loadRetention } from "@/lib/retention/load";
import { inboxItemFor } from "@/lib/retention/inbox";
import { planLabel, shortDate, type PersonPath } from "@/lib/retention/model";
import { HowItWorks } from "@/components/admin/how-it-works";
import { ActionButton, TONE_CHIP } from "@/components/admin/today-panel";
import { SignupWeeks, type WeekRow } from "@/components/admin/signup-weeks";
import { cn } from "@/lib/cn";

// Admin → People → Who comes back (2026-10-03). Operator, after a reel on
// retention: "Analize, should we apply this to Picacho?" → "Draft all
// three, both admins" (canvas claude.ai/artifact/6Z1sCKGaQMnxDc8i4p6ZSU,
// board "Website · new page: Who comes back") → "Put them in the right
// place". Built row for row from that board: four tiles, Going quiet,
// Tools used, Sign-up weeks.
export const dynamic = "force-dynamic";

const RANGES = [7, 30] as const;

function seenLabel(iso: string | null, now: number): string {
  if (!iso) return "—";
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  if (day(Date.parse(iso)) === day(now)) return "Today";
  if (day(Date.parse(iso)) === day(now - 86_400_000)) return "Yesterday";
  return shortDate(iso);
}

function weekPerson(p: PersonPath, now: number) {
  return {
    id: p.id,
    name: p.name,
    steps: p.steps,
    note: p.note,
    seen: seenLabel(p.lastActiveAt, now),
    plan: p.paying ? planLabel(p.plan) : p.cancel ? "Cancelled" : "Free",
    paying: p.paying,
  };
}

export default async function WhoComesBackPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { admin } = await requireAdmin();
  const { days: rawDays } = await searchParams;
  const days = rawDays === "30" ? 30 : 7;
  // new Date(), not Date.now(): the render-purity lint allows it, as on the Stats page.
  const now = new Date().getTime();
  const r = await loadRetention(admin, days, now);

  const weeks: WeekRow[] = r.weeks.map((w) => ({
    week: w.week,
    label: w.label,
    current: w.current,
    joined: w.joined,
    rendered: w.rendered,
    cameBack: w.cameBack,
    paid: w.paid,
    people: w.people.map((p) => weekPerson(p, now)),
  }));
  const initialOpen = r.weeks.find((w) => !w.current)?.week ?? r.weeks[0]?.week ?? null;
  const maxOpened = Math.max(1, ...r.tools.map((t) => t.opened));
  const windowWord = days === 7 ? "this week" : "in 30 days";
  const quiet = r.quiet.map(inboxItemFor);

  const tiles = [
    {
      label: days === 7 ? "Active this week" : "Active in 30 days",
      value: String(r.activeNow),
      of: null,
      note: `${r.activeReturning} came back · ${r.activeNew} new`,
      warn: false,
    },
    {
      label: "Made a first render",
      value: String(r.rendered),
      of: r.totalPeople,
      note: `${r.totalPeople ? Math.round((r.rendered / r.totalPeople) * 100) : 0}% of everyone who joined`,
      warn: false,
    },
    {
      label: "Came back the week after",
      value: String(r.cameBack),
      of: r.cameBackOf,
      note: `${r.cameBackOf ? Math.round((r.cameBack / r.cameBackOf) * 100) : 0}% · finished weeks only`,
      warn: false,
    },
    { label: "Going quiet", value: String(r.quiet.length), of: null, note: r.quiet.length ? "need you · below" : "nobody right now", warn: r.quiet.length > 0 },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">People</p>
            <h1 className="mt-1 font-numeral text-3xl text-atelier-ink">Who comes back</h1>
          </div>
          <p className="mt-1 text-sm text-neutral-500">
            {r.totalPeople} people all-time · {r.activeNow} used Picacho {windowWord} · weeks start Monday · admins left out
          </p>
        </div>
        <div data-segmented role="group" aria-label="Range">
          {RANGES.map((d) => (
            <Link
              key={d}
              href={d === 7 ? "/admin/retention" : `/admin/retention?days=${d}`}
              aria-current={d === days ? "page" : undefined}
              className="px-3 py-[5px] text-[13px] text-atelier-ink no-underline"
            >
              Last {d} days
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl border border-atelier-rule bg-atelier-surface px-4 py-3.5">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-atelier-muted">{t.label}</p>
            <p className={cn("mt-1.5 font-numeral text-[28px] leading-none tabular-nums", t.warn ? "text-[var(--apple-orange-ink)]" : "text-atelier-ink")}>
              {t.value}
              {t.of !== null && <span className="text-[17px] text-atelier-muted"> of {t.of}</span>}
            </p>
            <p className="mt-1.5 text-xs text-atelier-muted">{t.note}</p>
          </div>
        ))}
      </div>

      <section className="mt-4 overflow-hidden rounded-2xl border border-atelier-rule bg-atelier-surface">
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pt-4 sm:px-5">
          <h2 className="mr-auto text-[15px] font-semibold text-atelier-ink">
            Going quiet <span className="font-normal text-atelier-muted">· {r.quiet.length} {r.quiet.length === 1 ? "person" : "people"}</span>
          </h2>
          <span className="text-xs text-atelier-muted">Your phone gets each one the day it happens</span>
        </div>
        {quiet.length === 0 ? (
          <p className="border-t border-atelier-rule px-5 py-6 text-sm text-atelier-muted">
            Nobody right now. A paying customer gone 7 days, a cancellation and a first render that didn&apos;t land show up here
            and on your phone.
          </p>
        ) : (
          <ul>
            {quiet.map((item) => (
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
      </section>

      <section className="mt-4 rounded-2xl border border-atelier-rule bg-atelier-surface px-4 pb-4 pt-[18px] sm:px-5">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="mr-auto text-[15px] font-semibold text-atelier-ink">
            Tools used{" "}
            <span className="font-normal text-atelier-muted">
              · last {days} days · {r.activeNow} active {r.activeNow === 1 ? "person" : "people"}
            </span>
          </h2>
          <span className="flex items-center gap-1.5 text-xs text-atelier-muted">
            <i className="inline-block h-1.5 w-2.5 rounded-full bg-[color-mix(in_srgb,var(--apple-blue)_28%,transparent)]" />
            Opened it
            <i className="ml-2.5 inline-block h-1.5 w-2.5 rounded-full bg-[var(--apple-blue)]" />
            Made something
          </span>
        </div>
        <div className="mt-2.5 overflow-x-auto">
          <div className="min-w-[640px]">
            <div className="grid grid-cols-[170px_minmax(0,1fr)_84px_110px_96px] gap-x-4 border-b border-atelier-rule py-1.5 text-xs font-semibold text-atelier-muted">
              <span>Tool</span>
              <span />
              <span className="text-right">Opened it</span>
              <span className="text-right">Made something</span>
              <span className="text-right">vs {days === 7 ? "last week" : "the 30 before"}</span>
            </div>
            {r.tools.map((t) => {
              const change = t.opened - t.openedBefore;
              const openW = t.opened ? Math.max(3, Math.round((t.opened / maxOpened) * 100)) : 0;
              const madeW = t.made ? Math.max(3, Math.round((t.made / maxOpened) * 100)) : 0;
              return (
                <div
                  key={t.tool}
                  className="grid grid-cols-[170px_minmax(0,1fr)_84px_110px_96px] items-center gap-x-4 border-b border-atelier-rule py-[7px] text-[13.5px]"
                >
                  <span className={t.opened ? "text-atelier-ink" : "text-atelier-muted"}>{t.label}</span>
                  <span className="relative h-1.5 overflow-hidden rounded-full bg-[var(--apple-fill)]">
                    <span
                      className="absolute inset-y-0 left-0 rounded-full bg-[color-mix(in_srgb,var(--apple-blue)_28%,transparent)]"
                      style={{ width: `${openW}%` }}
                    />
                    <span className="absolute inset-y-0 left-0 rounded-full bg-[var(--apple-blue)]" style={{ width: `${madeW}%` }} />
                  </span>
                  <span className="text-right font-medium tabular-nums text-atelier-ink">{t.opened}</span>
                  <span className="text-right font-medium tabular-nums text-atelier-ink">{t.made ?? "—"}</span>
                  <span
                    className={cn(
                      "text-right text-[12.5px] tabular-nums",
                      change > 0 ? "text-[var(--apple-green-ink)]" : change < 0 ? "text-[var(--apple-red-ink)]" : "text-atelier-muted",
                    )}
                  >
                    {change > 0 ? `+${change}` : change < 0 ? `−${-change}` : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[12.5px] text-atelier-muted">
          {r.nobodyOpened.length > 0 && (
            <span>
              <b className="font-semibold text-atelier-ink">Nobody opened:</b> {r.nobodyOpened.join(" · ")}
            </span>
          )}
          {r.openedNothingMade.length > 0 && (
            <span>
              <b className="font-semibold text-atelier-ink">Opened, made nothing:</b>{" "}
              {r.openedNothingMade.map((t) => `${t.label} (${t.people} ${t.people === 1 ? "person" : "people"})`).join(" · ")}
            </span>
          )}
        </div>
        <HowItWorks label="How this is counted">
          <p>
            Each person counts once per tool. Opened it: they visited the tool&apos;s page while signed in (recorded from
            3 October 2026; before that only what people made shows, and making something counts as opening). Made something:
            they started a render, sent a chat message, began an edit or a set, or wrote a note there. A render started from
            Aly or Light counts under Generate. A dash means that tool&apos;s results can&apos;t be told apart yet. Recorded on
            Picacho&apos;s own server for signed-in people only — no cookie, nothing sent to anyone else — and admins are left out.
          </p>
        </HowItWorks>
      </section>

      <section className="mt-4 overflow-hidden rounded-2xl border border-atelier-rule bg-atelier-surface">
        <div className="flex flex-wrap items-baseline gap-2 px-4 pb-2.5 pt-[18px] sm:px-5">
          <h2 className="mr-auto text-[15px] font-semibold text-atelier-ink">
            Sign-up weeks <span className="font-normal text-atelier-muted">· everyone grouped by the week they joined</span>
          </h2>
          <span className="text-xs text-atelier-muted">Click a week to see who</span>
        </div>
        <SignupWeeks weeks={weeks} initialOpen={initialOpen} />
        <p className="px-5 py-3 text-[12.5px] text-atelier-muted">
          A week is over on Sunday night; &ldquo;came back&rdquo; means they used Picacho in the week after the one they joined.
        </p>
      </section>
    </div>
  );
}
