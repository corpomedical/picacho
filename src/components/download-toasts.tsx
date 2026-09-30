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
  kind: "image" | "video" | "file";
  state: "downloading" | "done" | "failed";
  // Where a save in the Android or iPhone app landed (lib/native/save-media.ts).
  savedTo?: "gallery" | "downloads" | "photos" | "shared";
  // A failure the person can fix: the iPhone app isn't allowed into Photos.
  failure?: "photosDenied";
};

export function DownloadToasts() {
  const { t } = useLocale();
  const g = t.generate;
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    function onStart(e: Event) {
      const { id, kind } = (e as CustomEvent<{ id: string; kind: Toast["kind"] }>).detail;
      setToasts((prev) => [...prev.slice(-3), { id, kind, state: "downloading" }]);
    }
    function onDone(e: Event) {
      const { id, ok, savedTo, failure } = (
        e as CustomEvent<{ id: string; ok: boolean; savedTo?: Toast["savedTo"]; failure?: Toast["failure"] }>
      ).detail;
      setToasts((prev) => prev.map((x) => (x.id === id ? { ...x, state: ok ? "done" : "failed", savedTo, failure } : x)));
      // A sentence that says where to go takes longer to read than "Saved".
      timers.push(
        setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), failure ? 7000 : 2600),
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

  // No early return. The wrapper below is the aria-live region, and returning
  // null when the list is empty meant it was created in the same commit that
  // filled it on every single download — the mount-and-fill pattern that
  // announces nothing, which settings-status.tsx states as policy. The map
  // renders nothing when empty, so keeping it costs an empty div.

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
          <span
            className={cn(
              "min-w-0 flex-1 text-xs",
              toast.failure ? "text-atelier-ink" : "truncate",
              !toast.failure && (toast.state === "downloading" ? "text-atelier-ink" : "text-atelier-muted"),
            )}
          >
            {toast.state === "downloading"
              ? toast.kind === "video"
                ? g.downloadingVideo
                : toast.kind === "file"
                  ? g.downloadingFile
                  : g.downloadingImage
              : toast.state === "done"
                ? toast.savedTo === "gallery"
                  ? g.savedToGallery
                  : toast.savedTo === "downloads"
                    ? g.savedToDownloads
                    : toast.savedTo === "photos"
                      ? g.savedToPhotos
                      : g.downloadDone
                : toast.failure === "photosDenied"
                  ? g.photosDenied
                  : g.downloadFailed}
          </span>
          <button
            type="button"
            aria-label={t.common.dismiss}
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
