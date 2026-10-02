import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LocalDate } from "@/components/local-date";
import { planLabel, shortDate, QUIET_AFTER_DAYS, type PersonPath } from "@/lib/retention/model";
import { writeHref } from "@/lib/retention/inbox";
import { madeText } from "@/lib/retention/tools";
import { cn } from "@/lib/cn";

// Admin → a person → Path (2026-10-03, Who comes back; the canvas's
// "Website · a person's page" board): the four steps with their dates, one
// badge when they're slipping away, and the tools they use.

function after(minutes: number): string {
  if (minutes < 60) return `${minutes} min after joining`;
  const h = Math.round(minutes / 60);
  if (h < 48) return `${h} h after joining`;
  return `${Math.round(h / 24)} days after joining`;
}

function Check() {
  return (
    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

function Step({ done, failed, label, children, sub }: { done: boolean; failed?: boolean; label: string; children: React.ReactNode; sub: string }) {
  return (
    <div className="relative flex flex-col gap-[3px] pt-[30px]">
      <span
        className={cn(
          // cn() is a plain join, so the fill is chosen here rather than overridden.
          "absolute left-0 top-0 flex h-5 w-5 items-center justify-center rounded-full border-2",
          done
            ? "border-[var(--apple-blue)] bg-[var(--apple-blue)]"
            : failed
              ? "border-[var(--apple-red)] bg-atelier-surface"
              : "border-neutral-400 bg-atelier-surface",
        )}
      >
        {done && <Check />}
      </span>
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="text-sm font-medium text-neutral-900">{children}</p>
      <p className="text-xs text-neutral-400">{sub}</p>
    </div>
  );
}

export function PersonPathCard({ path }: { path: PersonPath }) {
  const quiet = path.paying && path.quietDays !== null && path.quietDays >= QUIET_AFTER_DAYS;
  const badge = path.cancel
    ? { tone: "danger" as const, text: path.cancel.kind === "ended" ? "Plan ended" : "Cancelled" }
    : quiet
      ? { tone: "warning" as const, text: `Quiet for ${path.quietDays} days` }
      : path.stalled
        ? { tone: "warning" as const, text: "Stalled" }
        : null;
  const kind = path.cancel ? "cancelled" : quiet ? "paying" : "stalled";
  const write = badge ? writeHref({ kind, email: path.email, optedOut: path.optedOut }) : null;
  // The line between the circles is blue as far as the steps run unbroken.
  const unbroken = path.steps.findIndex((s) => s !== 1);
  const reached = (unbroken === -1 ? path.steps.length : unbroken) - 1;

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="text-sm font-semibold text-neutral-900">Path</h2>
        {badge && <Badge tone={badge.tone}>{badge.text}</Badge>}
        {write && (
          <a
            href={write}
            data-ui="button"
            data-variant="primary"
            className="ml-auto inline-flex h-8 items-center rounded-full px-3.5 text-[12.5px] font-medium no-underline"
          >
            Write to them
          </a>
        )}
      </div>

      <div className="relative mt-[18px] grid grid-cols-2 gap-4 sm:grid-cols-4">
        <span className="absolute left-2.5 right-[25%] top-[9px] hidden h-0.5 bg-neutral-200 sm:block" aria-hidden />
        {reached > 0 && (
          <span
            className="absolute left-2.5 top-[9px] hidden h-0.5 bg-[var(--apple-blue)] sm:block"
            style={{ width: `${reached * 25}%` }}
            aria-hidden
          />
        )}
        <Step done label="Joined" sub={`Week of ${shortDate(path.joinedAt)}`}>
          <LocalDate date={path.joinedAt} mode="datetime" />
        </Step>
        <Step
          done={!!path.firstRender}
          failed={!path.firstRender && !!path.firstAttempt}
          label="First render"
          sub={
            path.firstRender
              ? after(path.firstRender.minutesAfterJoining)
              : path.firstAttempt
                ? `${path.firstAttempt.refused ? "Refused" : "Failed"}${path.stalled ? " · nothing since" : ""}`
                : "Nothing made yet"
          }
        >
          {path.firstRender ? (
            <LocalDate date={path.firstRender.at} mode="datetime" />
          ) : path.firstAttempt ? (
            <LocalDate date={path.firstAttempt.at} mode="datetime" />
          ) : (
            "Not yet"
          )}
        </Step>
        <Step
          done={path.cameBack === "yes"}
          label="Came back the next week"
          sub={path.lastActiveAt ? `Last seen ${shortDate(path.lastActiveAt)}` : "Never seen"}
        >
          {path.cameBack === "yes" ? "Yes" : path.cameBack === "too-early" ? "Too early" : "No"}
        </Step>
        <Step
          done={!!path.paid}
          label="Paid"
          sub={path.paid ? (path.paid.plan ? planLabel(path.paid.plan) : "Bought credits") : "Free plan"}
        >
          {path.paid ? (path.paid.at ? shortDate(path.paid.at) : "Yes") : "Not yet"}
        </Step>
      </div>

      <div className="mt-[18px] border-t border-neutral-100 pt-3.5">
        <p className="text-xs text-neutral-500">Tools they use</p>
        {path.tools.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-400">None opened yet.</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {path.tools.map((t) => (
              <span
                key={t.tool}
                className={cn(
                  "inline-block rounded-full bg-[var(--apple-fill)] px-2.5 py-1 text-[12.5px] font-medium",
                  t.made ? "text-neutral-900" : "text-neutral-500",
                )}
              >
                {t.label} · {t.made ? madeText(t.tool, t.made) : "opened, made nothing"}
              </span>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
