// The phone admin app's shapes for Who comes back (2026-10-03): what the
// People list, the person screen and the This week screen receive. Plain
// JSON, nothing the phone has to compute.
import { planLabel, shortDate, type PersonPath, type Retention } from "./model";
import { writeHref } from "./inbox";
import { QUIET_AFTER_DAYS } from "./model";
import { madeText } from "./tools";

export type PeopleFilter = "recent" | "new" | "quiet" | "paying";

export function parseFilter(raw: string | null): PeopleFilter {
  return raw === "new" || raw === "quiet" || raw === "paying" ? raw : "recent";
}

/** Joined within this many days counts as New. */
export const NEW_DAYS = 14;

export function pathSummary(p: PersonPath) {
  const quiet = p.paying && p.quietDays !== null && p.quietDays >= QUIET_AFTER_DAYS;
  const kind = p.cancel ? "cancelled" : quiet ? "paying" : p.stalled ? "stalled" : null;
  return {
    steps: p.steps,
    note: p.note,
    banner: kind
      ? {
          kind,
          title: p.cancel ? (p.cancel.kind === "ended" ? "Plan ended" : "Cancelled") : quiet ? `Quiet for ${p.quietDays} days` : "Stalled",
          sub: p.cancel
            ? p.cancel.endsAt && p.cancel.kind !== "ended"
              ? `${planLabel(p.cancel.plan)} · active until ${shortDate(p.cancel.endsAt)}`
              : `${planLabel(p.cancel.plan)} · ${shortDate(p.cancel.at)}`
            : quiet
              ? `Paying · ${p.renders} renders over ${p.activeDays} active days`
              : `First render ${p.firstAttempt?.refused ? "refused" : "failed"} · nothing since`,
          write: writeHref({ kind, email: p.email, optedOut: p.optedOut }),
        }
      : null,
    path: [
      { label: "Joined", done: 1, sub: `${shortDate(p.joinedAt)}`, value: shortDate(p.joinedAt) },
      {
        label: "First render",
        done: p.steps[1],
        sub: p.firstRender
          ? `${p.firstRender.minutesAfterJoining < 60 ? `${p.firstRender.minutesAfterJoining} min` : `${Math.round(p.firstRender.minutesAfterJoining / 60)} h`} after joining`
          : p.firstAttempt
            ? p.firstAttempt.refused
              ? "Refused"
              : "Failed"
            : "Nothing made yet",
        value: p.firstRender ? shortDate(p.firstRender.at) : "Not yet",
      },
      {
        label: "Came back the next week",
        done: p.steps[2],
        sub: p.lastActiveAt ? `Last seen ${shortDate(p.lastActiveAt)}` : "Never seen",
        value: p.cameBack === "yes" ? "Yes" : p.cameBack === "too-early" ? "Too early" : "No",
      },
      {
        label: "Paid",
        done: p.steps[3],
        sub: p.paid ? (p.paid.plan ? planLabel(p.paid.plan) : "Bought credits") : "Free plan",
        value: p.paid ? (p.paid.at ? shortDate(p.paid.at) : "Yes") : "Not yet",
      },
    ],
    tools: p.tools.map((t) => ({ label: t.label, made: t.made, line: t.made ? madeText(t.tool, t.made) : "opened, nothing made" })),
  };
}

export function weekPayload(r: Retention) {
  return {
    days: r.days,
    totalPeople: r.totalPeople,
    active: r.activeNow,
    activeReturning: r.activeReturning,
    activeNew: r.activeNew,
    rendered: r.rendered,
    quiet: r.quiet.length,
    tools: r.tools.map((t) => ({ label: t.label, opened: t.opened, made: t.made })),
    nobodyOpened: r.nobodyOpened,
    weeks: r.weeks.map((w) => ({
      week: w.week,
      label: w.label,
      current: w.current,
      joined: w.joined,
      rendered: w.rendered,
      cameBack: w.cameBack,
      paid: w.paid,
      people: w.people.map((p) => ({ id: p.id, name: p.name, steps: p.steps, note: p.note })),
    })),
  };
}
