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
