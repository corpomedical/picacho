// The numbers the Clippings tab shows, from the person's own clips only:
// their median, each format's median against it, the chart's places and
// the script anatomy bar. Pure (the door and the planner both use it).
// Alias-free (vitest has no '@/').

import type { ClipLine, ClipPart, ClipView } from "./types";

export function median(values: readonly number[]): number | null {
  const s = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (s.length === 0) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The clips that can stand on the chart: a view count. */
export function charted(clips: readonly ClipView[]): ClipView[] {
  return clips.filter((c) => typeof c.views === "number" && c.views >= 0);
}

/** The person's usual: the median views of their charted clips. */
export function usualViews(clips: readonly ClipView[]): number | null {
  return median(charted(clips).map((c) => c.views as number));
}

/** "3.5×": how many times their usual, one decimal, never "3.0". */
export function timesLabel(views: number, usual: number | null): string | null {
  if (!usual || usual <= 0) return null;
  const x = Math.round((views / usual) * 10) / 10;
  return `${x}×`;
}

export function times(views: number, usual: number | null): number | null {
  if (!usual || usual <= 0) return null;
  return views / usual;
}

/** 48200 → "48.2k", 1250000 → "1.3M", 950 → "950". */
export function compact(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`;
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`;
  return String(Math.round(n));
}

export type FormatRow = {
  format: string;
  posts: number;
  median: number;
  times: number | null;
  /** The format's best clip (the table row opens it). */
  bestId: string;
};

/** Every format with views, best median first. Clips without a format are left out. */
export function formatRows(clips: readonly ClipView[]): FormatRow[] {
  const usual = usualViews(clips);
  const by = new Map<string, ClipView[]>();
  for (const c of charted(clips)) {
    if (!c.format) continue;
    const list = by.get(c.format) ?? [];
    list.push(c);
    by.set(c.format, list);
  }
  const rows: FormatRow[] = [];
  for (const [format, list] of by) {
    const m = median(list.map((c) => c.views as number)) ?? 0;
    const best = list.reduce((b, c) => ((c.views as number) > (b.views as number) ? c : b), list[0]);
    rows.push({ format, posts: list.length, median: m, times: times(m, usual), bestId: best.id });
  }
  return rows.sort((a, b) => b.median - a.median || b.posts - a.posts || a.format.localeCompare(b.format));
}

/** The clip with the most views (the card opens on it). */
export function bestClip(clips: readonly ClipView[]): ClipView | null {
  const list = charted(clips);
  if (list.length === 0) return clips[0] ?? null;
  return list.reduce((b, c) => ((c.views as number) > (b.views as number) ? c : b), list[0]);
}

/** 1-based rank by views among the charted clips, or null. */
export function rankOf(clips: readonly ClipView[], id: string): number | null {
  const list = charted(clips).sort((a, b) => (b.views as number) - (a.views as number));
  const i = list.findIndex((c) => c.id === id);
  return i < 0 ? null : i + 1;
}

// ---------------------------------------------------------------------
// The chart: x by date, y by views on a log scale
// ---------------------------------------------------------------------

export type ChartScale = { minLog: number; maxLog: number; from: number; to: number };

/** The scale that holds every charted clip: whole decades of views, the dates they span. */
export function chartScale(clips: readonly ClipView[], nowMs: number): ChartScale {
  const list = charted(clips);
  const logs = list.map((c) => Math.log10(Math.max(1, c.views as number)));
  const lo = logs.length ? Math.min(...logs) : 2;
  const hi = logs.length ? Math.max(...logs) : 4;
  const minLog = Math.floor(lo * 2) / 2;
  const maxLog = Math.max(minLog + 1, Math.ceil(hi * 2) / 2 + 0.15);
  const dates = list.map((c) => (c.postedAt ? Date.parse(c.postedAt) : NaN)).filter((d) => Number.isFinite(d));
  const from = dates.length ? Math.min(...dates) : nowMs - 90 * 86_400_000;
  const to = dates.length ? Math.max(...dates, from + 86_400_000) : nowMs;
  return { minLog, maxLog, from, to };
}

/** 0..1 down from the top (1 = the fewest views). */
export function yShare(views: number, s: ChartScale): number {
  const v = Math.log10(Math.max(1, views));
  return 1 - (v - s.minLog) / (s.maxLog - s.minLog);
}

/** 0..1 across (0 = the oldest). A clip with no date sits at the newest end. */
export function xShare(postedAt: string | null, s: ChartScale): number {
  const d = postedAt ? Date.parse(postedAt) : NaN;
  if (!Number.isFinite(d) || s.to <= s.from) return 1;
  return Math.min(1, Math.max(0, (d - s.from) / (s.to - s.from)));
}

/** The gridlines: 1, 3, 10, 30… inside the scale. */
export function gridlines(s: ChartScale): { views: number; share: number }[] {
  const out: { views: number; share: number }[] = [];
  for (let e = Math.floor(s.minLog); e <= Math.ceil(s.maxLog); e++) {
    for (const k of [1, 3]) {
      const v = k * 10 ** e;
      const l = Math.log10(v);
      if (l >= s.minLog - 1e-9 && l <= s.maxLog + 1e-9) out.push({ views: v, share: yShare(v, s) });
    }
  }
  return out;
}

/** Month starts inside the dates (at most 6). */
export function monthTicks(s: ChartScale): { at: number; share: number }[] {
  // The first month is named at the left edge (its posts start there), then each month start after it.
  const out: { at: number; share: number }[] = [{ at: s.from, share: 0 }];
  const d = new Date(s.from);
  let m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).getTime();
  while (m <= s.to && out.length < 12) {
    const share = (m - s.from) / Math.max(1, s.to - s.from);
    if (share > 0.08) out.push({ at: m, share }); // not on top of the first month's name
    const n = new Date(m);
    m = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1)).getTime();
  }
  const step = Math.ceil(out.length / 6) || 1;
  return out.filter((_, i) => i % step === 0);
}

// ---------------------------------------------------------------------
// The script anatomy bar
// ---------------------------------------------------------------------

/** Each line's share of the video (its start to the next line's, the last to the end). */
export function anatomy(lines: readonly ClipLine[], durationS: number | null): { part: ClipPart; share: number }[] {
  if (lines.length === 0) return [];
  const last = lines[lines.length - 1].t;
  const end = Math.max(durationS ?? 0, last + 2);
  const total = Math.max(1, end - lines[0].t);
  return lines.map((l, i) => {
    const next = i + 1 < lines.length ? lines[i + 1].t : end;
    return { part: l.part, share: Math.max(0, next - l.t) / total };
  });
}

/** "0:05", "1:12". */
export function stamp(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
