// "Who comes back" (2026-10-03, operator: "Draft all three, both admins" on
// canvas claude.ai/artifact/6Z1sCKGaQMnxDc8i4p6ZSU, then "Put them in the
// right place"). The answers, computed from plain rows:
//
//   - sign-up weeks: everyone grouped by the week they joined, with four
//     steps each — joined, first render, came back the next week, paid;
//   - tools used: per tool, who opened it and who made something there;
//   - going quiet: a paying customer gone 7 days, a cancellation, a first
//     render that failed and was never followed up.
//
// Pure and alias-free (relative imports only), so every rule is unit-tested
// without Supabase. load.ts turns database rows into these inputs.
import { RETENTION_TOOLS, toolLabel, type ToolKey } from "./tools";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A paying customer this many days without a visit is "going quiet". */
export const QUIET_AFTER_DAYS = 7;
/** …and stops being listed after this many (they're gone; the list stays about the ones you can still reach). */
export const QUIET_LIST_DAYS = 60;
/** A failed or refused first render is "stalled" after this many days with nothing since. */
export const STALLED_AFTER_DAYS = 3;
/** Stalled people are listed while they joined within this many days. */
export const STALLED_LIST_DAYS = 30;
/** A cancellation or plan end stays listed this long. */
export const CANCEL_LIST_DAYS = 14;
/** A person's note mentions a cancellation for this long. */
export const CANCEL_NOTE_DAYS = 60;
/** Sign-up weeks shown one by one; older ones fold into "Earlier". */
export const WEEKS_SHOWN = 8;

export type PersonIn = {
  id: string;
  name: string;
  email: string | null;
  createdAt: string;
  plan: string | null;
  planStatus: string | null;
  lastSeenAt: string | null;
  role: string | null;
  optedOut: boolean;
};
/** One render. `failed` covers both kinds; `refused` = a safety or rules refusal. */
export type RenderIn = { userId: string; at: string; ok: boolean; failed: boolean; refused: boolean };
/** Something a person made in a tool (a render, a chat message, an edit, a set, a note…). */
export type MadeIn = { userId: string; at: string; tool: ToolKey };
/** A tool opened on a day (user_tool_days). */
export type OpenIn = { userId: string; day: string; tool: ToolKey };
export type SubEventIn = {
  userId: string;
  kind: "cancel_scheduled" | "cancel_undone" | "ended";
  plan: string | null;
  endsAt: string | null;
  at: string;
};
/** A moment money was paid (a credit pack); plans are read from the profile. */
export type PaidIn = { userId: string; at: string };

export type RetentionInput = {
  people: PersonIn[];
  renders: RenderIn[];
  made: MadeIn[];
  opens: OpenIn[];
  subEvents: SubEventIn[];
  paid: PaidIn[];
  /** Tools whose "made something" could be read; the others show a dash. */
  madeKnown: ReadonlySet<ToolKey>;
  now: number;
};

export function dayKey(iso: string | number | Date): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/** Monday (UTC) of the week a day falls in, as YYYY-MM-DD. */
export function weekStart(iso: string | number | Date): string {
  const d = new Date(dayKey(iso) + "T00:00:00Z");
  const offset = (d.getUTCDay() + 6) % 7; // Monday = 0
  return dayKey(d.getTime() - offset * DAY_MS);
}

function addDays(day: string, n: number): string {
  return dayKey(new Date(day + "T00:00:00Z").getTime() + n * DAY_MS);
}

function daysBetween(fromIso: string, to: number): number {
  return Math.floor((to - new Date(fromIso).getTime()) / DAY_MS);
}

export function isPayingPlan(plan: string | null, status: string | null): boolean {
  if (!plan || plan === "none") return false;
  return status === null || status === "active" || status === "trialing" || status === "past_due";
}

export function planLabel(plan: string | null): string {
  if (!plan || plan === "none") return "Free";
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "22 Sep" (UTC). Spelled out by hand: en-GB's Intl now says "Sept" on some machines and not others. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** -1 = tried and it didn't land (the render step only), 0 = not yet, 1 = done. */
export type Step = -1 | 0 | 1;

export type PersonPath = {
  id: string;
  name: string;
  email: string | null;
  joinedAt: string;
  plan: string | null;
  paying: boolean;
  optedOut: boolean;
  lastActiveAt: string | null;
  activeDays: number;
  renders: number;
  firstRender: { at: string; minutesAfterJoining: number } | null;
  /** The first render attempt failed or was refused and nothing worked after. */
  firstAttempt: { at: string; refused: boolean } | null;
  cameBack: "yes" | "no" | "too-early";
  paid: { at: string | null; plan: string | null } | null;
  cancel: { kind: "cancel_scheduled" | "ended"; at: string; endsAt: string | null; plan: string | null } | null;
  quietDays: number | null;
  stalled: boolean;
  steps: [Step, Step, Step, Step];
  note: string;
  tools: { tool: ToolKey; label: string; opened: boolean; made: number }[];
};

type Index = {
  activeDays: Map<string, Set<string>>;
  lastActive: Map<string, number>;
  rendersBy: Map<string, RenderIn[]>;
  madeBy: Map<string, MadeIn[]>;
  opensBy: Map<string, OpenIn[]>;
  subBy: Map<string, SubEventIn[]>;
  paidBy: Map<string, PaidIn[]>;
};

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function buildIndex(input: RetentionInput): Index {
  const activeDays = new Map<string, Set<string>>();
  const lastActive = new Map<string, number>();
  const mark = (userId: string, iso: string) => {
    const set = activeDays.get(userId) ?? new Set<string>();
    set.add(dayKey(iso));
    activeDays.set(userId, set);
    const t = new Date(iso).getTime();
    if (t > (lastActive.get(userId) ?? 0)) lastActive.set(userId, t);
  };
  for (const p of input.people) if (p.lastSeenAt) mark(p.id, p.lastSeenAt);
  for (const r of input.renders) mark(r.userId, r.at);
  for (const m of input.made) mark(m.userId, m.at);
  for (const o of input.opens) mark(o.userId, o.day + "T12:00:00Z");

  const rendersBy = new Map<string, RenderIn[]>();
  for (const r of [...input.renders].sort((a, b) => a.at.localeCompare(b.at))) push(rendersBy, r.userId, r);
  const madeBy = new Map<string, MadeIn[]>();
  for (const m of input.made) push(madeBy, m.userId, m);
  const opensBy = new Map<string, OpenIn[]>();
  for (const o of input.opens) push(opensBy, o.userId, o);
  const subBy = new Map<string, SubEventIn[]>();
  for (const s of [...input.subEvents].sort((a, b) => a.at.localeCompare(b.at))) push(subBy, s.userId, s);
  const paidBy = new Map<string, PaidIn[]>();
  for (const p of [...input.paid].sort((a, b) => a.at.localeCompare(b.at))) push(paidBy, p.userId, p);
  return { activeDays, lastActive, rendersBy, madeBy, opensBy, subBy, paidBy };
}

function pathFor(p: PersonIn, ix: Index, now: number): PersonPath {
  const renders = ix.rendersBy.get(p.id) ?? [];
  const okRenders = renders.filter((r) => r.ok);
  const first = okRenders[0] ?? null;
  const days = ix.activeDays.get(p.id) ?? new Set<string>();
  const last = ix.lastActive.get(p.id) ?? null;

  // Came back: any active day in the week after the one they joined.
  const ws = weekStart(p.createdAt);
  const nextFrom = addDays(ws, 7);
  const nextTo = addDays(ws, 14);
  let cameBack: PersonPath["cameBack"] = "no";
  if (dayKey(now) < nextFrom) cameBack = "too-early";
  else for (const d of days) if (d >= nextFrom && d < nextTo) cameBack = "yes";

  // The latest cancellation that wasn't taken back.
  const subs = ix.subBy.get(p.id) ?? [];
  let cancel: PersonPath["cancel"] = null;
  for (const s of subs) {
    if (s.kind === "cancel_undone") cancel = null;
    else cancel = { kind: s.kind, at: s.at, endsAt: s.endsAt, plan: s.plan };
  }

  const paying = isPayingPlan(p.plan, p.planStatus);
  const paidAt = ix.paidBy.get(p.id)?.[0]?.at ?? null;
  const paid: PersonPath["paid"] = paying
    ? { at: paidAt, plan: p.plan }
    : paidAt
      ? { at: paidAt, plan: null }
      : subs.length
        ? { at: null, plan: subs[subs.length - 1].plan }
        : null;

  const lastIso = last ? new Date(last).toISOString() : null;
  const quietDays = paying && lastIso ? daysBetween(lastIso, now) : null;

  // Stalled: nothing ever worked, the first attempt failed, and the days
  // since hold no visit after the day it failed.
  let firstAttempt: PersonPath["firstAttempt"] = null;
  let stalled = false;
  if (!first && renders.length) {
    const fail = renders.find((r) => r.failed);
    if (fail) {
      firstAttempt = { at: fail.at, refused: fail.refused };
      const failDay = dayKey(fail.at);
      const after = [...days].some((d) => d > failDay);
      stalled =
        !after &&
        daysBetween(fail.at, now) >= STALLED_AFTER_DAYS &&
        daysBetween(p.createdAt, now) <= STALLED_LIST_DAYS;
    }
  }

  const opens = ix.opensBy.get(p.id) ?? [];
  const made = ix.madeBy.get(p.id) ?? [];
  const tools = RETENTION_TOOLS.map((t) => ({
    tool: t.key,
    label: t.label,
    opened: opens.some((o) => o.tool === t.key) || made.some((m) => m.tool === t.key),
    made: made.filter((m) => m.tool === t.key).length,
  })).filter((t) => t.opened);

  const steps: PersonPath["steps"] = [
    1,
    first ? 1 : firstAttempt ? -1 : 0,
    cameBack === "yes" ? 1 : 0,
    paid ? 1 : 0,
  ];

  const path: PersonPath = {
    id: p.id,
    name: p.name,
    email: p.email,
    joinedAt: p.createdAt,
    plan: p.plan,
    paying,
    optedOut: p.optedOut,
    lastActiveAt: lastIso,
    activeDays: days.size,
    renders: okRenders.length,
    firstRender: first
      ? { at: first.at, minutesAfterJoining: Math.max(0, Math.round((new Date(first.at).getTime() - new Date(p.createdAt).getTime()) / 60000)) }
      : null,
    firstAttempt,
    cameBack,
    paid,
    cancel,
    quietDays,
    stalled,
    steps,
    note: "",
    tools,
  };
  path.note = noteFor(path, now);
  return path;
}

/** One short line on where a person is. */
export function noteFor(p: PersonPath, now: number): string {
  if (p.cancel && daysBetween(p.cancel.at, now) <= CANCEL_NOTE_DAYS) {
    return p.cancel.kind === "ended"
      ? `${planLabel(p.cancel.plan)} ended ${shortDate(p.cancel.at)}`
      : `Cancelled ${planLabel(p.cancel.plan)}${p.cancel.endsAt ? `, active until ${shortDate(p.cancel.endsAt)}` : ""}`;
  }
  if (p.paying && p.quietDays !== null && p.quietDays >= QUIET_AFTER_DAYS) {
    return `Paying, quiet for ${p.quietDays} days`;
  }
  if (p.paying) return `Paying · ${planLabel(p.plan)}`;
  if (p.firstAttempt) {
    return `First render ${p.firstAttempt.refused ? "refused" : "failed"}${p.stalled ? ", nothing since" : ""}`;
  }
  if (!p.firstRender) {
    const opened = p.tools[0];
    return opened ? `Opened ${opened.label}, made nothing` : "No render yet";
  }
  if (p.cameBack === "too-early") return `Joined this week · ${p.renders} render${p.renders === 1 ? "" : "s"}`;
  if (p.cameBack === "yes") return `Came back · ${p.activeDays} active days`;
  return p.activeDays <= 1 ? "One visit, then quiet" : `${p.activeDays} active days, not the week after`;
}

export type GoingQuiet = {
  id: string;
  kind: "paying" | "cancelled" | "stalled";
  name: string;
  email: string | null;
  optedOut: boolean;
  title: string;
  sub: string;
  /** When it happened, for ordering (newest first). */
  at: string;
};

export function goingQuietFor(p: PersonPath, now: number): GoingQuiet | null {
  const base = { id: p.id, name: p.name, email: p.email, optedOut: p.optedOut };
  const seen = p.lastActiveAt ? `last seen ${shortDate(p.lastActiveAt)}` : "never seen";
  if (p.cancel && daysBetween(p.cancel.at, now) <= CANCEL_LIST_DAYS) {
    const ended = p.cancel.kind === "ended";
    return {
      ...base,
      kind: "cancelled",
      title: ended ? `${p.name}’s ${planLabel(p.cancel.plan)} plan ended` : `${p.name} cancelled ${planLabel(p.cancel.plan)}`,
      sub: [
        !ended && p.cancel.endsAt ? `Still active until ${shortDate(p.cancel.endsAt)}` : null,
        `joined ${shortDate(p.joinedAt)}`,
        `${p.renders} render${p.renders === 1 ? "" : "s"}`,
        seen,
      ]
        .filter(Boolean)
        .join(" · "),
      at: p.cancel.at,
    };
  }
  if (p.paying && p.quietDays !== null && p.quietDays >= QUIET_AFTER_DAYS && p.quietDays <= QUIET_LIST_DAYS) {
    return {
      ...base,
      kind: "paying",
      title: `${p.name} hasn’t been back in ${p.quietDays} days`,
      sub: [planLabel(p.plan), `${p.renders} render${p.renders === 1 ? "" : "s"}`, `${p.activeDays} active days`, seen].join(" · "),
      at: p.lastActiveAt ?? p.joinedAt,
    };
  }
  if (p.stalled && p.firstAttempt) {
    return {
      ...base,
      kind: "stalled",
      title: `${p.name}’s first render ${p.firstAttempt.refused ? "was refused" : "failed"}, and nothing since`,
      sub: [`joined ${shortDate(p.joinedAt)}`, seen].join(" · "),
      at: p.firstAttempt.at,
    };
  }
  return null;
}

export type ToolUse = {
  tool: ToolKey;
  label: string;
  opened: number;
  /** null when this tool's "made" can't be read. */
  made: number | null;
  openedBefore: number;
};

export type SignupWeek = {
  /** Monday, YYYY-MM-DD; "earlier" for the folded remainder. */
  week: string;
  label: string;
  current: boolean;
  joined: number;
  rendered: number;
  cameBack: number | null;
  paid: number;
  people: PersonPath[];
};

export type Retention = {
  days: number;
  totalPeople: number;
  activeNow: number;
  activeReturning: number;
  activeNew: number;
  rendered: number;
  cameBack: number;
  cameBackOf: number;
  tools: ToolUse[];
  nobodyOpened: string[];
  openedNothingMade: { label: string; people: number }[];
  weeks: SignupWeek[];
  quiet: GoingQuiet[];
  paths: Map<string, PersonPath>;
};

/** Everything "Who comes back" shows, for the window of `days` ending now. */
export function computeRetention(input: RetentionInput, days = 7): Retention {
  const { now } = input;
  const people = input.people.filter((p) => p.role !== "admin");
  const ids = new Set(people.map((p) => p.id));
  const ix = buildIndex({
    ...input,
    people,
    renders: input.renders.filter((r) => ids.has(r.userId)),
    made: input.made.filter((m) => ids.has(m.userId)),
    opens: input.opens.filter((o) => ids.has(o.userId)),
    subEvents: input.subEvents.filter((s) => ids.has(s.userId)),
    paid: input.paid.filter((p) => ids.has(p.userId)),
  });

  const paths = new Map<string, PersonPath>();
  for (const p of people) paths.set(p.id, pathFor(p, ix, now));

  // The window: the last `days` days including today, and the one before it.
  const to = dayKey(now);
  const from = addDays(to, -(days - 1));
  const prevFrom = addDays(from, -days);
  const inWin = (d: string) => d >= from && d <= to;
  const inPrev = (d: string) => d >= prevFrom && d < from;

  let activeNow = 0;
  let activeNew = 0;
  for (const p of people) {
    const ds = ix.activeDays.get(p.id);
    if (!ds || ![...ds].some(inWin)) continue;
    activeNow++;
    if (dayKey(p.createdAt) >= from) activeNew++;
  }

  const tools: ToolUse[] = RETENTION_TOOLS.map((t) => {
    const opened = new Set<string>();
    const openedBefore = new Set<string>();
    const made = new Set<string>();
    for (const o of input.opens) {
      if (o.tool !== t.key || !ids.has(o.userId)) continue;
      if (inWin(o.day)) opened.add(o.userId);
      else if (inPrev(o.day)) openedBefore.add(o.userId);
    }
    for (const m of input.made) {
      if (m.tool !== t.key || !ids.has(m.userId)) continue;
      const d = dayKey(m.at);
      // Making something there means it was opened.
      if (inWin(d)) {
        made.add(m.userId);
        opened.add(m.userId);
      } else if (inPrev(d)) openedBefore.add(m.userId);
    }
    return {
      tool: t.key,
      label: t.label,
      opened: opened.size,
      made: input.madeKnown.has(t.key) ? made.size : null,
      openedBefore: openedBefore.size,
    };
  });

  // Most used first; the ones nobody opened sink to the bottom.
  tools.sort((a, b) => b.opened - a.opened || (b.made ?? 0) - (a.made ?? 0));
  const nobodyOpened = tools.filter((t) => t.opened === 0).map((t) => t.label);
  const openedNothingMade = tools
    .filter((t) => t.made === 0 && t.opened > 0)
    .map((t) => ({ label: t.label, people: t.opened }));

  // Sign-up weeks, newest first; everything older than WEEKS_SHOWN folds.
  const thisWeek = weekStart(now);
  const byWeek = new Map<string, PersonPath[]>();
  for (const p of people) push(byWeek, weekStart(p.createdAt), paths.get(p.id)!);
  const weekKeys = [...byWeek.keys()].sort().reverse();
  const shown = weekKeys.slice(0, WEEKS_SHOWN);
  const folded = weekKeys.slice(WEEKS_SHOWN).flatMap((k) => byWeek.get(k)!);

  const weekOf = (week: string, label: string, list: PersonPath[]): SignupWeek => {
    const current = week === thisWeek;
    // Furthest along first: paid, came back, rendered, tried; then most recently seen.
    const progress = (p: PersonPath) =>
      (p.paid ? 8 : 0) + (p.cameBack === "yes" ? 4 : 0) + (p.firstRender ? 2 : 0) + (p.firstAttempt ? 1 : 0);
    const sorted = [...list].sort(
      (a, b) => progress(b) - progress(a) || (b.lastActiveAt ?? "").localeCompare(a.lastActiveAt ?? ""),
    );
    return {
      week,
      label,
      current,
      joined: list.length,
      rendered: list.filter((p) => p.firstRender).length,
      cameBack: current ? null : list.filter((p) => p.cameBack === "yes").length,
      paid: list.filter((p) => p.paid).length,
      people: sorted,
    };
  };
  const weeks = shown.map((k) => weekOf(k, shortDate(k + "T00:00:00Z"), byWeek.get(k)!));
  if (folded.length) weeks.push(weekOf("earlier", `Before ${shortDate(shown[shown.length - 1] + "T00:00:00Z")}`, folded));

  // "Came back the week after": finished sign-up weeks only.
  let cameBack = 0;
  let cameBackOf = 0;
  for (const w of weeks) {
    if (w.current || w.cameBack === null) continue;
    cameBack += w.cameBack;
    cameBackOf += w.joined;
  }

  const quiet = [...paths.values()]
    .map((p) => goingQuietFor(p, now))
    .filter((q): q is GoingQuiet => q !== null)
    .sort((a, b) => {
      const order = { cancelled: 0, paying: 1, stalled: 2 } as const;
      return order[a.kind] - order[b.kind] || b.at.localeCompare(a.at);
    });

  return {
    days,
    totalPeople: people.length,
    activeNow,
    activeReturning: activeNow - activeNew,
    activeNew,
    rendered: [...paths.values()].filter((p) => p.firstRender).length,
    cameBack,
    cameBackOf,
    tools,
    nobodyOpened,
    openedNothingMade,
    weeks,
    quiet,
    paths,
  };
}

export { toolLabel };
