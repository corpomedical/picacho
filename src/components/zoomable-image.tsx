"use client";

import { useState } from "react";
import { MediaViewer } from "@/components/media-viewer";

// A result image that expands to a fullscreen viewer on tap — the thing
// every phone user tries first and the app previously didn't do at all
// (operator-reported, 2026-08-21: "clicking on a generated picture, the
// picture does not expand"). Web gets it too; there it's simply a bonus.
//
// The viewer is the shared one (media-viewer.tsx, 2026-09-30): black edge to
// edge, pinch and double-tap zoom, swipe down or Android back to close, and
// the action bar whose Download saves to the phone's gallery.
export function ZoomableImage({
  src,
  alt = "",
  className,
  downloadUrl,
  generationId,
  ownerActions = false,
  redirectAfterDelete,
}: {
  src: string;
  alt?: string;
  className?: string;
  // When set, the expanded view's action bar points at the ORIGINAL asset,
  // not whatever thumb/proxy `src` may be.
  downloadUrl?: string;
  // With ownerActions, the expanded bar also offers report + delete (the
  // server actions re-verify ownership regardless). redirectAfterDelete is a
  // plain string because server pages can't pass a client callback.
  generationId?: string;
  ownerActions?: boolean;
  redirectAfterDelete?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className={className}
        onClick={() => setOpen(true)}
        style={{ cursor: "zoom-in" }}
      />
      {open && (
        <MediaViewer
          url={downloadUrl ?? src}
          displayUrl={src}
          contentType="image"
          alt={alt || undefined}
          generationId={generationId}
          ownerActions={ownerActions}
          redirectAfterDelete={redirectAfterDelete}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
