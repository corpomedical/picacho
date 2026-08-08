"use client";

import { useLocale } from "@/lib/i18n/provider";

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
async function downloadResult(url: string, filename: string) {
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
    void downloadResult(url, filename);
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={t.generate.download}
      title={t.generate.download}
      className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
    >
      <DownloadIcon className="h-4 w-4" />
    </button>
  );
}
