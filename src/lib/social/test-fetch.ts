// A scripted fetch for the adapter tests: each route answers the calls that
// match it (in order), every call is recorded, and a call no route expects
// fails the test loudly. "no-answer" throws like a dropped connection.
// Test-only; not used by the app. Alias-free.

import type { FetchLike } from "./http";

export type RecordedCall = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: BodyInit | null | undefined;
  /** The body as text when it is text-like (JSON, a form), else null. */
  text: string | null;
};

export type Route = {
  method?: string;
  url: string | RegExp;
  /** How many calls this route answers (default: every one). */
  times?: number;
  reply: (call: RecordedCall) => Response | "no-answer" | Promise<Response | "no-answer">;
};

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function headerRecord(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  new Headers(h).forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}

export function scriptedFetch(routes: Route[]): { fetch: FetchLike; calls: RecordedCall[]; left: () => Route[] } {
  const calls: RecordedCall[] = [];
  const used = routes.map(() => 0);
  const fetchImpl: FetchLike = async (input, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body;
    const text = typeof body === "string" ? body : body instanceof URLSearchParams ? body.toString() : null;
    const call: RecordedCall = { url: input, method, headers: headerRecord(init?.headers), body, text };
    calls.push(call);
    const i = routes.findIndex(
      (r, idx) =>
        (r.method ?? method) === method &&
        (typeof r.url === "string" ? input === r.url || input.startsWith(`${r.url}?`) : r.url.test(input)) &&
        used[idx] < (r.times ?? Infinity),
    );
    if (i < 0) throw new Error(`unexpected call: ${method} ${input}`);
    used[i]++;
    const answer = await routes[i].reply(call);
    if (answer === "no-answer") throw new TypeError("fetch failed");
    return answer;
  };
  return { fetch: fetchImpl, calls, left: () => routes.filter((r, idx) => r.times !== undefined && used[idx] < r.times) };
}

/** The form fields of a recorded call's body. */
export function formOf(call: RecordedCall): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(call.text ?? "").entries());
}

/** The JSON of a recorded call's body. */
export function jsonOf(call: RecordedCall): Record<string, unknown> {
  return JSON.parse(call.text ?? "{}") as Record<string, unknown>;
}
