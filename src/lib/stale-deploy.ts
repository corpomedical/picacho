// A server action that THROWS, rather than returning an error, most often
// means a deploy landed while the tab was open: the browser runs the old
// build, whose action ids the live server no longer has. No retry fixes
// that from the stale tab; only a reload does. Two signatures, because
// Next changed its own: the older "unexpected response" and Next 16's
// UnrecognizedActionError ("Server Action … was not found on the server").
export function isStaleDeployError(err: unknown): boolean {
  if (err instanceof Error && err.name === "UnrecognizedActionError") return true;
  const message = err instanceof Error ? err.message : String(err);
  return /unexpected response was received from the server|was not found on the server/i.test(message);
}

/** When this tab last reloaded onto a new deploy (sessionStorage), whoever reloaded it. */
export const STALE_RELOAD_KEY = "picacho-stale-build-reload";
/** A tab that reloaded this recently and still fails is not stale: another reload would only loop. */
export const STALE_RELOAD_GUARD_MS = 30_000;

/**
 * Reload onto the live deploy, after `delayMs` or at once, unless this tab
 * already did in the last STALE_RELOAD_GUARD_MS: then a reload has not
 * cured it, and one more would loop. A failure that only looks stale (a
 * timed-out function's page reads as "an unexpected response") would
 * otherwise reload a page that saves on its own over and over. `before`
 * runs just before the reload, to keep what the page could not save. Says
 * whether a reload is coming. The error reporter (app-error-reporter.tsx)
 * and the pages share the one guard.
 */
export function reloadForNewDeploy(opts: { delayMs?: number; before?: () => void } = {}): boolean {
  const now = Date.now();
  let last = 0;
  try {
    last = Number(window.sessionStorage.getItem(STALE_RELOAD_KEY)) || 0;
  } catch {
    /* blocked storage */
  }
  if (now - last <= STALE_RELOAD_GUARD_MS) return false;
  try {
    window.sessionStorage.setItem(STALE_RELOAD_KEY, String(now));
  } catch {
    /* blocked storage */
  }
  const reload = () => {
    opts.before?.();
    window.location.reload();
  };
  if (opts.delayMs) setTimeout(reload, opts.delayMs);
  else reload();
  return true;
}
