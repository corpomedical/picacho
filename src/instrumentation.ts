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
// else — which is where this one is, because the digest tells us so.
//
// What the digest is, read from next/dist/server/app-render/
// create-error-handler.js on 2026-09-09 rather than remembered: for a thrown
// STRING it is string-hash(the string); for anything else Next first turns
// it into an Error — a real Error passes through, a plain object becomes
// new Error(safeStringifyLite(object)) INSIDE Next's own code — and then
// takes string-hash(message + stack). The package is `string-hash`, not the
// djb2Hash in next/shared/lib/hash — they differ, and a 2026-09-08 brute
// force that hashed every string literal in src/ used the wrong one. Redone
// on 09-09 with both functions over 32,292 distinct literals from src/,
// @supabase/*, Next's server bundles and React: no match under either.
//
// Why the digest has been the same value across a fortnight of deploys:
// an Error thrown in OUR code carries frames from our compiled chunks,
// whose names change every build. A stable digest means no user frames at
// all — a thrown string (no stack), or a plain object whose wrapper Error
// was created inside Next, so its frames are Next's own files, unchanged
// while Next stayed at 16.3.0 (it did, the whole window). Every `throw` in
// our server code rethrows an Error, .throwOnError() is unused, and
// supabase-js returns errors rather than throwing them; so the value comes
// from a library or a promise rejected with a non-Error reason. The log
// line below prints `name` and `message` — for the wrapped case, message IS
// the stringified object — which is the fact this whole file exists to get.
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
