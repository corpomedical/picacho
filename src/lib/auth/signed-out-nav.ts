// The one predicate behind middleware's edge-level bounce of signed-out /app
// navigations to /login.
//
// Extracted as a pure function on purpose: it is auth-adjacent control flow,
// and the repo's convention for anything in that class (see
// generations/send-plan.ts, generations/refund-rules.ts) is a pure resolver
// with tests, so its exact boundaries are written down and cannot drift
// silently. Everything request-shaped is passed in.
//
// Why the bounce exists: /app's auth guard sits behind the root layout's
// Suspense boundary, so a session-less request returns HTTP 200 carrying a
// streamed "NEXT_REDIRECT;replace;/login" directive (~20KB) instead of a
// redirect. The phone then had to download that HTML, download the entire JS
// bundle and hydrate React before it could even ASK for /login — a whole
// download-and-hydrate cycle spent inside the Android app's frozen launch
// icon on every first install and every signed-out open.
//
// The three conditions are each load-bearing:
//
//  - GET only. A server action POSTs to its own /app route; rewriting that
//    into a redirect would re-POST the action body at /login. Non-GET falls
//    through untouched.
//  - /app paths only. Marketing, auth callbacks and API routes are none of
//    this function's business.
//  - NO Supabase cookie AT ALL. Deliberately the narrowest possible test:
//    it is never a judgement about whether a token is valid, fresh or
//    expired. Any request carrying an sb-* cookie falls through and is
//    authenticated exactly as before, so this can neither log anyone out nor
//    shortcut a real session — the worst it can do to a signed-in user is
//    nothing.
export function isSignedOutAppNavigation(
  method: string,
  pathname: string,
  cookieNames: readonly string[],
): boolean {
  if (method !== "GET") return false;
  if (pathname !== "/app" && !pathname.startsWith("/app/")) return false;
  return !cookieNames.some((name) => name.startsWith("sb-"));
}
