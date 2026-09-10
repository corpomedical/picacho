"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/generations/reports";
import { isStaleDeployError } from "@/lib/stale-deploy";

// Renders nothing — mounted once in the logged-in app shell (app/layout.tsx)
// so a real bug (a JS crash, a rejected promise nobody caught) gets filed as
// an auto report even when the user never notices anything to click "Report
// a problem" on, or the crash happens somewhere that button doesn't exist
// yet (a broken page, not a specific generation result). Complements
// autoReportFailedGeneration in reports.ts, which covers the other main
// class of "issue the user might not bother reporting": a generation that
// actually fails.
//
// Capped and deduplicated per page load — a render loop that keeps throwing
// the same error would otherwise file the same report dozens of times a
// second.
const MAX_REPORTS_PER_LOAD = 5;
let reportCount = 0;
const seenMessages = new Set<string>();

// Errors that mean "this tab is running a build the server no longer
// serves" — Next's client router throws these when a deploy replaced the
// bundle mid-session (2026-08-28: auto-filed from /app/templates during a
// push-heavy afternoon; the operator's own stale tab). Not a bug in the
// page — the fix IS a reload, so do that instead of filing a report. The
// sessionStorage guard stops a reload loop if a reload somehow doesn't
// clear it.
//
// A stale server action is recognised by the shared isStaleDeployError, the
// one the composer and Sets use: both of Next's wordings, the older
// "unexpected response" and Next 16's UnrecognizedActionError. This list
// used to be the only check, and its "Failed to find Server Action" is what
// Next 16 writes to the SERVER log, never to the browser — so a stale action
// thrown here was filed as a bug instead of reloading (2026-09-11). The list
// keeps the signatures the shared helper doesn't cover.
const STALE_BUILD_SIGNATURES = [
  "Failed to fetch RSC payload",
  "Failed to find Server Action",
];

export function AppErrorReporter() {
  useEffect(() => {
    function handle(message: string, context: string, err: unknown) {
      const stale =
        isStaleDeployError(err) ||
        isStaleDeployError(message) ||
        STALE_BUILD_SIGNATURES.some((sig) => message.includes(sig));
      if (stale) {
        const KEY = "picacho-stale-build-reload";
        let last = 0;
        try { last = Number(sessionStorage.getItem(KEY)) || 0; } catch { /* blocked storage */ }
        if (Date.now() - last > 30_000) {
          try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* blocked storage */ }
          window.location.reload();
          return;
        }
        // Reloaded under 30s ago and it's STILL throwing — that's a real
        // problem, not skew; fall through and file it.
      }
      if (reportCount >= MAX_REPORTS_PER_LOAD) return;
      const key = `${message}::${context}`;
      if (seenMessages.has(key)) return;
      seenMessages.add(key);
      reportCount += 1;
      void reportClientError(message, context);
    }

    // Next attaches a `digest` to errors that originated server-side (the
    // React #419 "switched to client rendering" class among them) — the
    // same digest the server prints beside the real, unminified error in
    // the function log. Carrying it into the report turns "minified
    // mystery" into a grep key (2026-09-02, from a first-session crash).
    function digestOf(err: unknown): string {
      const digest = (err as { digest?: unknown } | null)?.digest;
      return typeof digest === "string" && digest ? `\ndigest: ${digest}` : "";
    }

    // `||`, not `??`, and that one character is why five #419 reports arrived
    // with no location at all. An Error whose `stack` is the EMPTY STRING is
    // not null or undefined, so `??` handed the empty string straight through
    // and the filename:line:col fallback never ran — then reportClientError's
    // .trim() removed the leftover newline, leaving no trace that a stack had
    // been attempted. Every one of those reports was exactly 211 characters:
    // message, page, digest, and nothing else.
    //
    // An empty stack is not a curiosity here, it is the clue. Next derives the
    // digest as a hash of message + stack, and ours has been the SAME value
    // across a fortnight of deploys — which can only happen if the stack is
    // empty, since a real one carries build-specific frames. So the throw is
    // something that reaches the client without one, and the location is the
    // only thing left that can identify it.
    function whereFrom(err: unknown, fallback: string): string {
      const stack = err instanceof Error ? err.stack : undefined;
      const kind =
        err instanceof Error
          ? `${err.name}`
          : err === null
            ? "null"
            : `${typeof err}${typeof err === "object" ? ` (${Object.prototype.toString.call(err)})` : ""}`;
      return `thrown: ${kind}\n${stack || fallback}`;
    }

    function onError(event: ErrorEvent) {
      const message = event.error instanceof Error ? event.error.message : event.message;
      handle(
        message || "Unknown client error",
        `page: ${window.location.pathname}${digestOf(event.error)}\n${whereFrom(
          event.error,
          `${event.filename}:${event.lineno}:${event.colno}`,
        )}`,
        event.error,
      );
    }

    function onRejection(event: PromiseRejectionEvent) {
      const reason = event.reason;
      const message =
        reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "Unhandled promise rejection";
      // Same `??` -> `||` correction, and the same reason.
      handle(
        message,
        `page: ${window.location.pathname}${digestOf(reason)}\n${whereFrom(reason, String(reason))}`,
        reason,
      );
    }

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
