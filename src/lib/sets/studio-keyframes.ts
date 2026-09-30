// Keyframe interpolation in Helios Studio (2026-09-30). Blender keeps an
// interpolation on each keyframe: it shapes the segment from that key to the
// next. Until now the Studio kept one per object, so Astra's "constant
// interpolation at 40 and 80" (live, on the shot camera) turned the WHOLE
// camera constant — it held its first key until frame 40, and a cut meant for
// 40 and 80 froze the shot from the start. A key may now carry its own
// `ip`; a key without one follows the object's (every scene saved before).
//
// Pure and relative-import only: the engine and the tests share it.

export const KEY_INTERPS = ["linear", "bezier", "constant"] as const;
export type KeyInterp = (typeof KEY_INTERPS)[number];

/** The interpolation of the segment that starts at key `a`: its own, else the object's (else bezier, Blender's default). */
export function segmentInterp(a: { ip?: unknown }, objectInterp: unknown): KeyInterp {
  if (typeof a.ip === "string" && (KEY_INTERPS as readonly string[]).includes(a.ip)) return a.ip as KeyInterp;
  return typeof objectInterp === "string" && (KEY_INTERPS as readonly string[]).includes(objectInterp) ? (objectInterp as KeyInterp) : "bezier";
}

/** How far along the segment a → b frame-time `t` is (0–1), shaped by the segment's interpolation. */
export function segmentU(a: { t: number; ip?: unknown }, b: { t: number }, t: number, objectInterp: unknown): number {
  const span = b.t - a.t;
  const u = span > 0 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 1;
  const ip = segmentInterp(a, objectInterp);
  return ip === "constant" ? (u >= 1 ? 1 : 0) : ip === "bezier" ? u * u * (3 - 2 * u) : u;
}

/** The two keys round frame-time `t` and how far between them (keys sorted by t); before the first or after the last, that key alone. */
export function keysAround<K extends { t: number; ip?: unknown }>(keys: readonly K[], t: number, objectInterp: unknown): { a: K; b: K; u: number } | null {
  if (!keys.length) return null;
  if (t <= keys[0].t) return { a: keys[0], b: keys[0], u: 0 };
  const last = keys[keys.length - 1];
  if (t >= last.t) return { a: last, b: last, u: 0 };
  let i = 0;
  while (keys[i + 1].t < t) i++;
  const a = keys[i], b = keys[i + 1];
  return { a, b, u: segmentU(a, b, t, objectInterp) };
}

/** What the timeline row says: the object's interpolation, or "mixed" when its keys don't all share one. */
export function rowInterp(keys: readonly { ip?: unknown }[], objectInterp: unknown): string {
  const all = new Set(keys.slice(0, -1).map((k) => segmentInterp(k, objectInterp)));
  return all.size > 1 ? "mixed" : all.size === 1 ? [...all][0] : segmentInterp({}, objectInterp);
}
