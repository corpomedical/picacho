// One place where every server error names itself.
//
// Five automatic reports have arrived from the admin queue carrying nothing
// but "Minified React error #419" and a digest — 2026-08-23, 08-31, 09-02 and
// twice on 09-07, the last two from accounts on their first day. #419 means a
// Suspense boundary died server-side and the client re-rendered, so all the
// client can ever report is that something failed, never what.
//
// The pieces added so far each cover one path: read-guard.ts names a failing
// workspace read, and the generate page names its chrome flags. Both are
// try/catch inside the render, and neither can see a throw from anywhere
// else — which is where this one is, because the digest tells us so. Next
// computes it as djb2(message + stack), and ours has been the SAME value
// across a fortnight of deploys; a real Error's stack shifts every build, so
// whatever throws has an empty stack. That is the shape of a plain object —
// a Supabase/PostgREST error, say — not of read-guard's `new Error`.
//
// onRequestError is the only hook that sees all of them: it fires for errors
// during streaming, in Server Actions and in route handlers alike, and is
// handed the same digest the client reports. Logging both together is what
// finally joins one of these reports to its cause.
//
// Deliberately console only. Writing to the database from the global error
// handler is the kind of clever that turns one failure into two — the write
// can fail, and it can fail for the same reason the request did.
import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  try {
    const err = error as { message?: unknown; name?: unknown; digest?: unknown; stack?: unknown };
    // Everything a report cannot say. digest is the join key: it is the exact
    // value the client's #419 carries, so a log line and a queue entry can be
    // matched to each other.
    console.error("[server-error]", {
      digest: typeof err?.digest === "string" ? err.digest : undefined,
      name: typeof err?.name === "string" ? err.name : typeof error,
      message: typeof err?.message === "string" ? err.message : String(error),
      route: context.routePath,
      routeType: context.routeType,
      // 'react-server-components' vs 'server-rendering' says which half of the
      // render died, which narrows a #419 to a component or to the data pass.
      renderSource: context.renderSource,
      method: request.method,
      path: request.path,
      // Present on a real Error, absent on the plain-object throws that
      // produce a build-stable digest — so its absence is itself the clue.
      stack: typeof err?.stack === "string" ? err.stack.split("\n").slice(0, 6).join("\n") : null,
    });
  } catch {
    // An error reporter that throws is worse than one that misses. Never let
    // this add a second failure to the one being reported.
  }
};
