"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/generations/reports";

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

export function AppErrorReporter() {
  useEffect(() => {
    function handle(message: string, context: string) {
      if (reportCount >= MAX_REPORTS_PER_LOAD) return;
      const key = `${message}::${context}`;
      if (seenMessages.has(key)) return;
      seenMessages.add(key);
      reportCount += 1;
      void reportClientError(message, context);
    }

    function onError(event: ErrorEvent) {
      const message = event.error instanceof Error ? event.error.message : event.message;
      const stack = event.error instanceof Error ? event.error.stack : undefined;
      handle(
        message || "Unknown client error",
        `page: ${window.location.pathname}\n${stack ?? `${event.filename}:${event.lineno}:${event.colno}`}`,
      );
    }

    function onRejection(event: PromiseRejectionEvent) {
      const reason = event.reason;
      const message =
        reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "Unhandled promise rejection";
      const stack = reason instanceof Error ? reason.stack : undefined;
      handle(message, `page: ${window.location.pathname}\n${stack ?? String(reason)}`);
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
