// Small shared helpers for the Astra Sets eval runner. Pure or local-only:
// nothing here reads the environment or touches the network.

import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

/** scripts/astra-sets-eval/ with a trailing slash. */
export const EVAL_DIR = fileURLToPath(new URL("../", import.meta.url));
/** The repository root with a trailing slash. */
export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** JSON with object keys sorted at every depth, so a hash ignores key order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Runs fn over items with at most `limit` in flight. `stopped()` is asked
 * before each new item starts: once it says true, nothing new starts and the
 * unstarted items come back as undefined.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  stopped: () => boolean = () => false,
): Promise<(R | undefined)[]> {
  const out: (R | undefined)[] = new Array(items.length).fill(undefined);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      if (stopped()) return;
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

/** A counting semaphore for work that is not a simple list. */
export class Semaphore {
  private free: number;
  private waiting: (() => void)[] = [];
  constructor(n: number) {
    this.free = n;
  }
  async use<T>(fn: () => Promise<T>): Promise<T> {
    if (this.free > 0) this.free -= 1;
    else await new Promise<void>((r) => this.waiting.push(r));
    try {
      return await fn();
    } finally {
      const w = this.waiting.shift();
      if (w) w();
      else this.free += 1;
    }
  }
}

/** YYYYMMDD-HHMMSS in UTC. */
export function stamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}

export function newRunId(part: string, dry: boolean): string {
  return `${part}-${stamp()}-${randomBytes(2).toString("hex")}${dry ? "-DRYRUN" : ""}`;
}

export const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;
export const round6 = (n: number): number => Math.round(n * 1_000_000) / 1_000_000;

export function usd(n: number | null | undefined, digits = 4): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "unpriced";
  return `$${n.toFixed(digits)}`;
}

export function pct(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`;
}

/** A harness, usage or budget problem: the run stops with exit code 2. */
export class HarnessError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode = 2) {
    super(message);
    this.name = "HarnessError";
    this.exitCode = exitCode;
  }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}
