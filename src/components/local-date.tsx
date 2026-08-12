"use client";

import { useSyncExternalStore } from "react";

// Subscribe-to-nothing store: getSnapshot returns true on the client,
// getServerSnapshot returns false — so `mounted` is false during SSR and
// the hydration render, true immediately after. The idiomatic React 19 way
// to detect "am I past hydration" without a setState-in-effect.
const emptySubscribe = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

// Renders a timestamp in the *viewer's* locale and timezone without ever
// causing a hydration mismatch.
//
// Why this exists: `new Date(x).toLocaleString()` inline in JSX formats with
// whatever locale/timezone the rendering environment has. On the server
// that's the Vercel runtime (UTC, en-US); in the browser it's the visitor's.
// In a server component that means every date on the site silently displays
// in UTC — wrong for basically every user. In a client component it's worse:
// the SSR HTML and the hydration render disagree, which is React error #418,
// the crash auto-reported from /app/history on 2026-08-10.
//
// Pattern: server (and the client's first render, so hydration matches)
// output a stable ISO string; after mount we re-render with the browser's
// real locale. The <time dateTime> attribute keeps the machine-readable
// value regardless.
export function LocalDate({
  date,
  mode = "date",
}: {
  date: string | Date;
  mode?: "date" | "datetime";
}) {
  const d = typeof date === "string" ? new Date(date) : date;
  const mounted = useMounted();

  const iso = d.toISOString();
  const stable = mode === "date" ? iso.slice(0, 10) : iso.slice(0, 16).replace("T", " ") + " UTC";
  const text = mounted
    ? mode === "date"
      ? d.toLocaleDateString()
      : d.toLocaleString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
    : stable;

  return (
    <time dateTime={iso} suppressHydrationWarning>
      {text}
    </time>
  );
}
