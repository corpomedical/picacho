"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

// A grid <video> that never shows the WebView's built-in placeholder
// (2026-08-27, operator: "the default play image when the content hasn't
// loaded — I want to get rid of that ugly image"). Android's WebView paints
// its own gray play graphic over an empty <video> until the first frame
// decodes — on a slow connection that ugly frame IS the tile for seconds.
// Here the video stays invisible until it actually has a frame
// (onLoadedData), and until then the tile shows its own quiet ground: the
// parent's stage color plus a soft play disc, the same visual language as
// every loaded video tile. Parent must be position:relative with a
// background (every grid tile already is).
export function QuietVideo({
  className,
  ...props
}: React.VideoHTMLAttributes<HTMLVideoElement>) {
  const [ready, setReady] = useState(false);
  return (
    <>
      {!ready && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f5f1e9]/10">
            <svg viewBox="0 0 24 24" fill="#f5f1e9" fillOpacity={0.5} className="ml-0.5 h-4 w-4">
              <path d="M8 5v14l11-7Z" />
            </svg>
          </span>
        </span>
      )}
      <video
        {...props}
        onLoadedData={() => setReady(true)}
        className={cn(className, "transition-opacity duration-300", ready ? "opacity-100" : "opacity-0")}
      />
    </>
  );
}
