"use client";

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
export async function downloadResult(url: string, filename: string) {
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
  } catch {
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
  return true;
}

export function DownloadButton({
  url,
  contentType,
}: {
  url: string;
  contentType: "image" | "video";
}) {
  const { t } = useLocale();
  // The filename is built at click-time, not render-time — Date.now() (for
  // uniqueness) is an impure call, and React's rules disallow impure calls
  // during render since it can produce different output on a re-render.
  function handleClick() {
    const filename = `picacho-${contentType}-${Date.now()}.${contentType === "video" ? "mp4" : "png"}`;
    if (isNativeAppClient()) {
      void downloadResultNative(url, filename)
        .then((handled) => {
          if (!handled) return downloadResult(url, filename).then(() => undefined);
        })
        .catch(() => downloadResult(url, filename));
      return;
    }
    void downloadResult(url, filename);
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={t.generate.download}
      title={t.generate.download}
      // Fixed warm-charcoal scrim + warm-white glyph: this floats ON media
      // (the Darkroom stage), which is the same charcoal in both themes — so
      // theme-mapped colors (text-white flips dark in dark mode) are wrong
      // here and constants are right.
      className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-[#17150f]/70 text-[#f5f1e9] shadow-sm backdrop-blur-sm transition-colors hover:bg-[#17150f]/85"
    >
      <DownloadIcon className="h-4 w-4" />
    </button>
  );
}
