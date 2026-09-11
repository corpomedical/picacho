// The only statistics the bars use, written down so the report can say
// exactly what it computed.
//
//   median   the middle value; with an even count, the mean of the two middle
//            values
//   p95      NEAREST RANK: sorted[ceil(0.95 × n) − 1]. With n = 90 that is the
//            86th value; with n = 10 it is the maximum.

export function sorted(xs: readonly number[]): number[] {
  return [...xs].filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
}

export function median(xs: readonly number[]): number | null {
  const s = sorted(xs);
  if (s.length === 0) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Nearest-rank quantile, q in (0, 1]. */
export function nearestRank(xs: readonly number[], q: number): number | null {
  const s = sorted(xs);
  if (s.length === 0) return null;
  // The small epsilon keeps a product like 0.95 × 20 = 19.000000000000004
  // on rank 19, where the arithmetic means it.
  const rank = Math.min(s.length, Math.max(1, Math.ceil(q * s.length - 1e-9)));
  return s[rank - 1];
}

export const p95 = (xs: readonly number[]): number | null => nearestRank(xs, 0.95);

export function mean(xs: readonly number[]): number | null {
  const s = xs.filter((x) => Number.isFinite(x));
  return s.length === 0 ? null : s.reduce((a, b) => a + b, 0) / s.length;
}

export function max(xs: readonly number[]): number | null {
  const s = sorted(xs);
  return s.length === 0 ? null : s[s.length - 1];
}
