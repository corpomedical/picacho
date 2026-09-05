"use client";

import { useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import { isNativeAppClient } from "@/lib/native/platform";
import { capPlugin } from "@/lib/native/bridge";

// Shared by the live Generate composer and the History detail page — both
// show a generated image/video and both need the same "download it" button
// sitting in the bottom-right corner, overlaid on the media itself (like
// ChatGPT's image results), not a separate button below it.

function DownloadIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3v12m0 0-4-4m4 4 4-4M4 21h16" />
    </svg>
  );
}

// Fetches the result as a blob and downloads it via a throwaway anchor tag
// instead of a plain `<a href download>` — Supabase's signed URLs don't send
// Content-Disposition: attachment, so a bare download attribute on a
// cross-origin link just opens the file in a new tab in most browsers
// instead of actually saving it. Falls back to that same "open in a new tab"
// behavior only if the fetch itself fails for some reason.
// Download progress toasts (see download-toasts.tsx, mounted in the app
// layout): downloads gave NO feedback while the blob fetched — a big video
// takes seconds, people clicked five times and got five files (operator,
// 2026-08-24). Every path here announces start and finish over these
// events; the toast stack renders them in the corner.
export function announceDownload(kind: "image" | "video"): string {
  const id = `dl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  window.dispatchEvent(new CustomEvent("picacho:download-start", { detail: { id, kind } }));
  return id;
}
export function announceDownloadDone(id: string, ok: boolean) {
  window.dispatchEvent(new CustomEvent("picacho:download-done", { detail: { id, ok } }));
}
// Quietly retract a toast — for the one outcome that is neither success nor
// failure: the person closed the share sheet themselves.
export function announceDownloadDismiss(id: string) {
  window.dispatchEvent(new CustomEvent("picacho:download-dismiss", { detail: { id } }));
}

export async function downloadResult(url: string, filename: string) {
  const kind = filename.endsWith(".mp4") ? "video" : "image";
  const toastId = announceDownload(kind);
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
    announceDownloadDone(toastId, true);
  } catch {
    announceDownloadDone(toastId, false);
    window.open(url, "_blank");
  }
}

// The Android WebView has no download manager: the anchor trick above is
// simply swallowed (operator-reported, 2026-08-21 — "Download does not work
// on Android app"). In the shell the file goes through the native layer
// instead: fetch → base64 → Filesystem cache file → the system share sheet,
// where "save to device / Photos / Drive / WhatsApp" are all one tap. The
// plugins arrive with the versionCode-4 build; on an older shell without
// them this quietly falls back to the web path.
export async function downloadResultNative(url: string, filename: string): Promise<boolean> {
  const fs = capPlugin("Filesystem");
  const share = capPlugin("Share");
  if (!fs?.writeFile || !share?.share) return false;
  const toastId = announceDownload(filename.endsWith(".mp4") ? "video" : "image");
  try {
    const res = await fetch(url);
    const blob = await res.blob();
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const s = String(reader.result);
      resolve(s.slice(s.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
  const written = await fs.writeFile({ path: filename, data: base64, directory: "CACHE" });
    await share.share({ title: filename, files: [written.uri] });
    announceDownloadDone(toastId, true);
    return true;
  } catch (err) {
    // Closing the share sheet is a decision, not a failure — and definitely
    // not a reason to fall back to the web download path, which re-fetched
    // the whole file only to be swallowed by the WebView and then toast
    // "downloaded" for a file that went nowhere (2026-08-31 inspection).
    // The plugin rejects with "Share canceled" for that case; report it
    // handled, retract the toast, done.
    const message = err instanceof Error ? err.message : String(err);
    if (/cancel/i.test(message)) {
      announceDownloadDismiss(toastId);
      return true;
    }
    announceDownloadDone(toastId, false);
    throw err;
  }
}

export function DownloadButton({
  url,
  contentType,
  variant = "overlay",
}: {
  url: string;
  contentType: "image" | "video";
  /** "overlay" = the self-positioning charcoal circle on result frames;
      "ghost" = the Stage's 30px square ghost (parent positions it). */
  variant?: "overlay" | "ghost";
}) {
  const { t } = useLocale();
  // One download at a time per button: with no feedback, people clicked
  // until five copies arrived (the toast stack is the feedback; this is
  // the guard).
  const [busy, setBusy] = useState(false);
  // The filename is built at click-time, not render-time — Date.now() (for
  // uniqueness) is an impure call, and React's rules disallow impure calls
  // during render since it can produce different output on a re-render.
  async function handleClick() {
    if (busy) return;
    setBusy(true);
    const filename = `picacho-${contentType}-${Date.now()}.${contentType === "video" ? "mp4" : "png"}`;
    try {
      if (isNativeAppClient()) {
        const handled = await downloadResultNative(url, filename).catch(() => false);
        if (!handled) await downloadResult(url, filename);
      } else {
        await downloadResult(url, filename);
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      disabled={busy}
      onClick={handleClick}
      aria-label={t.generate.download}
      title={t.generate.download}
      // Black scrim + onmedia glyph: this floats ON media, so theme-mapped
      // colors (text-white flips dark in dark mode) are wrong here — see the
      // --color-onmedia note in globals.css.
      className={
        variant === "ghost"
          ? "flex h-[30px] w-[30px] items-center justify-center rounded-[8px] bg-onmedia/10 text-onmedia/85 transition-colors hover:bg-onmedia/20"
          : "absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/70 text-onmedia shadow-sm backdrop-blur-sm transition-colors hover:bg-black/85"
      }
    >
      <DownloadIcon className={variant === "ghost" ? "h-[15px] w-[15px]" : "h-4 w-4"} />
    </button>
  );
}
