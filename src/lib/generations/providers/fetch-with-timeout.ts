// The one error class every timeout from fetchWithTimeout carries, so callers
// that must tell "the wire gave out" apart from "the provider answered" (see
// isTransportError in job-runner.ts) can match on err.name instead of
// pattern-matching the human-readable message. The message-regex coupling this
// replaces broke silently the moment anyone reworded the message — a retry
// policy should never hang off prose. name (not just instanceof) is the
// contract: it survives any boundary that clones or re-instantiates errors.
export class FetchTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchTimeoutError";
  }
}

// Every AI provider call in this app used a plain fetch() with no timeout,
// which meant a slow/hanging request (routine for video generation, which
// can take minutes) had no way to fail fast with a clear message — it would
// just hang until the platform's own limit killed it, if any. This wraps
// fetch with a hard timeout so failures are fast and legible instead.
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new FetchTimeoutError(
        `Request timed out after ${Math.round(timeoutMs / 1000)}s — try again.`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
