"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import { cn } from "@/lib/cn";

// The download toast stack (operator, 2026-08-24: downloads gave zero
// feedback — "you feel nothing happening until you find 5 videos
// downloaded"). Mounted once in the app layout; download helpers announce
// start/finish over window events (see download-button.tsx), each becoming
// a small dismissible card in the corner: spinner + "Downloading video…",
// flipping to a check + "Saved" that auto-clears.

type Toast = {
  id: string;
  kind: "image" | "video";
  state: "downloading" | "done" | "failed";
};

export function DownloadToasts() {
  const { t } = useLocale();
  const g = t.generate;
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    function onStart(e: Event) {
      const { id, kind } = (e as CustomEvent<{ id: string; kind: "image" | "video" }>).detail;
      setToasts((prev) => [...prev.slice(-3), { id, kind, state: "downloading" }]);
    }
    function onDone(e: Event) {
      const { id, ok } = (e as CustomEvent<{ id: string; ok: boolean }>).detail;
      setToasts((prev) => prev.map((x) => (x.id === id ? { ...x, state: ok ? "done" : "failed" } : x)));
      timers.push(
        setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 2600),
      );
    }
    window.addEventListener("picacho:download-start", onStart);
    const onDismiss = (e: Event) => {
      const { id } = (e as CustomEvent<{ id: string }>).detail;
      setToasts((prev) => prev.filter((x) => x.id !== id));
    };
    window.addEventListener("picacho:download-done", onDone);
    window.addEventListener("picacho:download-dismiss", onDismiss);
    return () => {
      window.removeEventListener("picacho:download-start", onStart);
      window.removeEventListener("picacho:download-done", onDone);
      window.removeEventListener("picacho:download-dismiss", onDismiss);
      timers.forEach(clearTimeout);
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed right-4 z-[120] flex w-64 flex-col gap-2"
      style={{ top: "calc(env(safe-area-inset-top) + 16px)" }}
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex items-center gap-2.5 rounded-[12px] bg-atelier-surface/95 px-3 py-2.5 shadow-[0_0_0_1px_var(--frost-ring),0_16px_40px_-16px_rgba(20,22,30,0.35)] backdrop-blur-xl"
        >
          {toast.state === "downloading" ? (
            <span className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-atelier-ink/15 border-t-atelier-accent" />
          ) : toast.state === "done" ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 flex-shrink-0 text-emerald-600">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-4 w-4 flex-shrink-0 text-red-500">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          )}
          <span className={cn("min-w-0 flex-1 truncate text-xs", toast.state === "downloading" ? "text-atelier-ink" : "text-atelier-muted")}>
            {toast.state === "downloading"
              ? toast.kind === "video"
                ? g.downloadingVideo
                : g.downloadingImage
              : toast.state === "done"
                ? g.downloadDone
                : g.downloadFailed}
          </span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setToasts((prev) => prev.filter((x) => x.id !== toast.id))}
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3 w-3">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
