// The one way publishing talks to a network: a fetch with a timeout that
// tells "the network answered" apart from "we never heard back".
//
// That difference is the whole idempotency story (spec §2.1): an answer, even
// an error, says what happened; NO answer (a dropped connection, a timeout)
// on the call that makes a post public means we cannot know whether it went
// out, so that post becomes 'unconfirmed' and is never sent again blindly.
//
// Keys never leave this module in a log line: nothing here logs.
//
// Alias-free (vitest has no '@/'); the fetch is injected so every adapter is
// tested against a scripted one.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The network's answer never arrived: a dropped connection, a reset, or our own timeout. */
export class NoAnswerError extends Error {
  constructor(readonly url: string, readonly cause?: unknown) {
    super(`no answer from ${new URL(url).host}`);
    this.name = "NoAnswerError";
  }
}

/** Default wait for one call; uploads pass their own. */
export const CALL_TIMEOUT_MS = 20_000;
export const UPLOAD_TIMEOUT_MS = 90_000;

export type Answer = { status: number; ok: boolean; body: unknown; text: string; headers: Headers };

/**
 * One call. Resolves with whatever the network answered (any status);
 * throws NoAnswerError only when no answer came back.
 */
export async function call(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit = {},
  timeoutMs: number = CALL_TIMEOUT_MS,
): Promise<Answer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: controller.signal, redirect: "manual" });
  } catch (err) {
    clearTimeout(timer);
    throw new NoAnswerError(url, err);
  }
  let text = "";
  try {
    text = await res.text();
  } catch (err) {
    clearTimeout(timer);
    // The status arrived but the body did not: for a publish call the post may
    // exist, so this is still "no full answer".
    throw new NoAnswerError(url, err);
  }
  clearTimeout(timer);
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { status: res.status, ok: res.status >= 200 && res.status < 300, body, text: text.slice(0, 2000), headers: res.headers };
}

/** A form body (application/x-www-form-urlencoded). Undefined and null values are left out. */
export function form(fields: Record<string, string | number | boolean | null | undefined>): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    out.set(k, String(v));
  }
  return out;
}

export function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`;
}

/** A URL with query parameters (undefined and null values left out). */
export function withQuery(base: string, params: Record<string, string | number | boolean | null | undefined>): string {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

// Small readers for untrusted JSON answers.

export function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function str(v: unknown, max = 512): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
}

export function num(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export function bool(v: unknown): boolean {
  return v === true;
}

/** A date `seconds` after `now`, or null when seconds is not a positive number. */
export function after(now: Date, seconds: unknown): Date | null {
  const s = num(seconds);
  return s !== null && s > 0 ? new Date(now.getTime() + s * 1000) : null;
}
