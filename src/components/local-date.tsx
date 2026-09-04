"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

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
  labels,
}: {
  date: string | Date;
  /**
   * "since" is a RELATIVE duration — "2h", "4d" — and it exists here for the
   * same reason the other modes do. Computing it on the server means calling
   * Date.now() during render: impure (the lint rule that caught it is right),
   * and worse, baked into any cached HTML, so a project last worked on two
   * hours ago would keep claiming "2h" tomorrow. Measured against the
   * viewer's clock after mount, it is simply correct.
   */
  mode?: "date" | "datetime" | "since";
  /** Required for "since": the caller owns the translations. */
  labels?: { minutes: string; hours: string; days: string; weeks: string };
}) {
  const d = typeof date === "string" ? new Date(date) : date;
  const mounted = useMounted();

  // The clock is read in an EFFECT, never during render. Date.now() in a
  // render body is impure — two renders of the same component would disagree —
  // and the lint rule that says so is right. Held in state, the value is
  // stable for the life of the mount, which is the correct behaviour for
  // "last worked": it should not flicker between renders, and a page that
  // stays open overnight is a stale-by-a-day label, not a wrong one.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
  }, []);

  const iso = d.toISOString();

  if (mode === "since") {
    // Before mount there is no honest relative answer — the server does not
    // know when "now" is for this viewer — so the stable date shows until
    // hydration, exactly as the other modes do.
    const since = (() => {
      if (!mounted || !labels || now === null) return iso.slice(0, 10);
      const minutes = Math.max(1, Math.round((now - d.getTime()) / 60_000));
      if (minutes < 60) return labels.minutes.replace("{n}", String(minutes));
      const hours = Math.round(minutes / 60);
      if (hours < 24) return labels.hours.replace("{n}", String(hours));
      const days = Math.round(hours / 24);
      if (days < 14) return labels.days.replace("{n}", String(days));
      return labels.weeks.replace("{n}", String(Math.round(days / 7)));
    })();
    return (
      <time dateTime={iso} suppressHydrationWarning>
        {since}
      </time>
    );
  }
  const stable =
    mode === "date"
      ? iso.slice(0, 10)
      : iso.slice(0, 16).replace("T", " ") + " UTC";
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
