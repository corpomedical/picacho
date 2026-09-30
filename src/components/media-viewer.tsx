"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "@/lib/i18n/provider";
import { useBackCloser } from "@/lib/native/back-stack";
import { useLandscapeWhileOpen } from "@/lib/native/orientation";
import { hideSystemBars, lightSystemBarIcons } from "@/lib/native/system-bars";
import { isNativeAppClient } from "@/lib/native/platform";
import { useModalFocus } from "@/lib/use-modal-focus";
import { MediaActionBar } from "@/components/media-action-bar";
import { QuietVideo } from "@/components/quiet-video";
import { cn } from "@/lib/cn";

// The one full-screen viewer for a finished picture or video (operator,
// 2026-09-30: "Android app can't full screen images").
//
// Not the browser's Fullscreen API. The Play builds of the Android app
// cannot use it at all: R8 stripped the WebView chrome client's
// onHideCustomView, and without both halves Android's WebView reports
// full screen as unsupported (android/app/proguard-rules.pro). This is a
// plain fixed layer instead, which every shell ever shipped can draw:
//   - black, edge to edge, portalled to <body> so no transformed ancestor
//     (a chat bubble, the Stage) can trap it;
//   - pictures pinch and double-tap to zoom, pan when zoomed, and swipe down
//     to close; a tap hides the controls and the phone's own bars, like the
//     phone's gallery;
//   - the phone may turn sideways while it is open (orientation.ts);
//   - Android back, Escape and the close button all close it;
//   - the action bar under it is the Library's: share, copy, download (to
//     the phone's gallery), and for the owner report and delete.

type Kind = "image" | "video";

export type MediaViewerProps = {
  /** The full file: what plays, and what Download saves. */
  url: string;
  /** Pictures only: a lighter copy to show (e.g. thumbUrl(url, 1600)). */
  displayUrl?: string;
  contentType: Kind;
  alt?: string;
  poster?: string;
  /** Videos: carry on from where the inline player was. */
  startAt?: number;
  generationId?: string;
  ownerActions?: boolean;
  redirectAfterDelete?: string;
  onDeleted?: () => void;
  onClose: () => void;
};

const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;
const DISMISS_DISTANCE = 110;

function CloseIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function ExpandIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
    </svg>
  );
}

export function MediaViewer({
  url,
  displayUrl,
  contentType,
  alt,
  poster,
  startAt,
  generationId,
  ownerActions = false,
  redirectAfterDelete,
  onDeleted,
  onClose,
}: MediaViewerProps) {
  const { t } = useLocale();
  const label = alt || t.generate.fullScreen;
  const rootRef = useRef<HTMLDivElement>(null);
  // Controls (close + action bar) showing. A tap on a picture hides them,
  // and the phone's bars with them.
  const [chrome, setChrome] = useState(true);
  const native = isNativeAppClient();

  useBackCloser(true, onClose);
  useLandscapeWhileOpen(true);
  // Light status-bar icons over the black, as long as the viewer is open.
  useEffect(() => lightSystemBarIcons(), []);

  useEffect(() => {
    if (chrome || contentType !== "image") return;
    return hideSystemBars();
  }, [chrome, contentType]);

  // Callers pass inline arrows; read through a ref so the effect below runs
  // once per opening, not on every render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, []);
  // aria-modal's focus contract: in, trapped, and handed back on close.
  useModalFocus(true, rootRef);

  // Swipe-down progress fades the black, so the page shows it is going away.
  const setDismissProgress = (p: number) => {
    const el = rootRef.current;
    if (el) el.style.backgroundColor = `rgba(0,0,0,${1 - Math.min(0.7, p * 0.7)})`;
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      data-media-viewer
      className="fixed inset-0 z-[95] overscroll-contain bg-black"
      onClick={contentType === "video" ? onClose : undefined}
    >
      {contentType === "image" ? (
        <ZoomStage
          src={displayUrl ?? url}
          alt={label}
          onTap={() => setChrome((v) => !v)}
          onDismissProgress={setDismissProgress}
          onDismiss={onClose}
        />
      ) : (
        <div
          // Room above for the close button and below for the action bar,
          // so neither sits on the player's own controls. A phone on its
          // side has little height to give: there the close button may sit
          // beside the (wide) picture instead.
          className={cn(
            "absolute inset-0 flex items-center justify-center",
            "pt-[calc(env(safe-area-inset-top)+3.5rem)] pb-[calc(env(safe-area-inset-bottom)+5rem)]",
            "[@media(orientation:landscape)_and_(max-height:520px)]:pt-2 [@media(orientation:landscape)_and_(max-height:520px)]:pb-[calc(env(safe-area-inset-bottom)+5rem)]",
          )}
        >
          <QuietVideo
            pending="spinner"
            src={url}
            poster={poster}
            controls
            autoPlay
            playsInline
            // The WebView's own menu offers a Download that goes nowhere in
            // the app; the action bar below saves for real.
            controlsList={native ? "nodownload" : undefined}
            aria-label={label}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (startAt && startAt > 0 && startAt < v.duration) {
                v.currentTime = startAt;
                // The Android WebView drops autoplay when a video seeks
                // before its first frame (measured on the emulator,
                // 2026-09-30: paused at the resume point); ask again.
                void v.play().catch(() => {});
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full"
          />
        </div>
      )}

      <div
        className={cn(
          "pointer-events-none absolute inset-0 transition-opacity duration-200",
          chrome ? "opacity-100" : "opacity-0",
        )}
      >
        <button
          type="button"
          aria-label={t.common.close}
          title={t.common.close}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          tabIndex={chrome ? 0 : -1}
          // Top-LEFT, where Android's own galleries put their way back —
          // and clear of the download toasts, which stack top-right.
          className={cn(
            "absolute left-4 flex h-10 w-10 items-center justify-center rounded-full bg-onmedia/15 text-onmedia backdrop-blur-sm transition-colors hover:bg-onmedia/25",
            chrome && "pointer-events-auto",
          )}
          style={{ top: "calc(env(safe-area-inset-top) + 0.75rem)" }}
        >
          <CloseIcon className="h-[18px] w-[18px]" />
        </button>
        <div
          className="absolute inset-x-0 flex justify-center"
          style={{ bottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <MediaActionBar
            url={url}
            contentType={contentType}
            generationId={generationId}
            ownerActions={ownerActions}
            redirectAfterDelete={redirectAfterDelete}
            onDeleted={onDeleted}
            className={chrome ? "pointer-events-auto" : undefined}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

// A picture that zooms and pans under the fingers. The transform is written
// straight to the element from the pointer handlers — a React render per
// finger move would stutter on the phones this is for.
function ZoomStage({
  src,
  alt,
  onTap,
  onDismissProgress,
  onDismiss,
}: {
  src: string;
  alt: string;
  onTap: () => void;
  onDismissProgress: (p: number) => void;
  onDismiss: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  // s = scale, x/y = offset of the picture's centre from the box's centre.
  const view = useRef({ s: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<
    | { kind: "pan" | "drag"; startX: number; startY: number; x0: number; y0: number; t0: number; moved: boolean }
    | { kind: "pinch"; d0: number; mx0: number; my0: number; s0: number; x0: number; y0: number }
    | null
  >(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (tapTimer.current) clearTimeout(tapTimer.current);
    },
    [],
  );

  function apply(animated: boolean) {
    const img = imgRef.current;
    if (!img) return;
    const { s, x, y } = view.current;
    img.style.transition = animated ? "transform 200ms ease-out" : "none";
    img.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${s})`;
  }

  // Box-relative point, measured from the box's centre.
  function local(clientX: number, clientY: number) {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: clientX - r.left - r.width / 2, y: clientY - r.top - r.height / 2 };
  }

  // How far the picture may travel at scale s: its fitted size, scaled,
  // minus the box — so an edge can come to the box's edge and no further.
  function clamp(s: number, x: number, y: number) {
    const box = boxRef.current;
    const img = imgRef.current;
    if (!box || !img || !img.naturalWidth) return { x: 0, y: 0 };
    const w = box.clientWidth;
    const h = box.clientHeight;
    const fit = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    const maxX = Math.max(0, (img.naturalWidth * fit * s - w) / 2);
    const maxY = Math.max(0, (img.naturalHeight * fit * s - h) / 2);
    return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) };
  }

  // Zoom to `s`, keeping the point p (box-centre coordinates) under itself.
  function zoomAt(s: number, px: number, py: number, animated: boolean) {
    const v = view.current;
    const next = Math.max(1, Math.min(MAX_SCALE, s));
    const k = next / v.s;
    const c = clamp(next, px - k * (px - v.x), py - k * (py - v.y));
    view.current = { s: next, x: next === 1 ? 0 : c.x, y: next === 1 ? 0 : c.y };
    apply(animated);
  }

  // Wheel and trackpad pinch on a computer. Not a React onWheel: that one
  // is passive and can't stop the page from scrolling.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e.clientX, e.clientY);
      zoomAt(view.current.s * Math.exp(-e.deltaY * 0.0025), p.x, p.y, false);
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
    // zoomAt/local read only refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const v = view.current;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const m = local((a.x + b.x) / 2, (a.y + b.y) / 2);
      gesture.current = { kind: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx0: m.x, my0: m.y, s0: v.s, x0: v.x, y0: v.y };
      onDismissProgress(0);
    } else if (pointers.current.size === 1) {
      gesture.current = {
        kind: v.s > 1.01 ? "pan" : "drag",
        startX: e.clientX,
        startY: e.clientY,
        x0: v.x,
        y0: v.y,
        t0: performance.now(),
        moved: false,
      };
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const m = local((a.x + b.x) / 2, (a.y + b.y) / 2);
      // Allowed a little under 1 while the fingers are down; it springs back.
      const s = Math.max(0.6, Math.min(MAX_SCALE * 1.2, g.s0 * (Math.hypot(a.x - b.x, a.y - b.y) / g.d0)));
      const k = s / g.s0;
      view.current = { s, x: m.x - k * (g.mx0 - g.x0), y: m.y - k * (g.my0 - g.y0) };
      apply(false);
      return;
    }
    if (g.kind === "pinch") return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (!g.moved && Math.hypot(dx, dy) > 8) g.moved = true;
    if (!g.moved) return;
    if (g.kind === "pan") {
      const c = clamp(view.current.s, g.x0 + dx, g.y0 + dy);
      view.current = { ...view.current, x: c.x, y: c.y };
      apply(false);
    } else {
      // Not zoomed: the picture follows the finger down (a little sideways),
      // and far enough closes the viewer.
      const down = Math.max(0, dy);
      view.current = { s: 1, x: dx * 0.25, y: down };
      apply(false);
      onDismissProgress(down / (DISMISS_DISTANCE * 3));
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (!g) return;

    if (g.kind === "pinch") {
      if (pointers.current.size === 1) {
        // One finger left: carry on as a pan from here — never as the
        // swipe that closes, which a pinch should not turn into.
        const [p] = [...pointers.current.values()];
        const v = view.current;
        gesture.current = { kind: "pan", startX: p.x, startY: p.y, x0: v.x, y0: v.y, t0: performance.now(), moved: true };
      } else {
        gesture.current = null;
      }
      const v = view.current;
      if (v.s < 1) view.current = { s: 1, x: 0, y: 0 };
      else if (v.s > MAX_SCALE) {
        const m = local(e.clientX, e.clientY);
        zoomAt(MAX_SCALE, m.x, m.y, true);
        return;
      } else view.current = { ...v, ...clamp(v.s, v.x, v.y) };
      apply(true);
      return;
    }

    if (pointers.current.size > 0) return;
    gesture.current = null;

    if (g.kind === "drag" && g.moved) {
      if (e.clientY - g.startY > DISMISS_DISTANCE) {
        onDismiss();
        return;
      }
      view.current = { s: 1, x: 0, y: 0 };
      apply(true);
      onDismissProgress(0);
      return;
    }
    if (g.moved || e.type === "pointercancel") return;

    // A tap. Two quick ones zoom in (or back out); one alone toggles the
    // controls, after waiting long enough to know it wasn't the first of two.
    const now = performance.now();
    const prev = lastTap.current;
    if (prev && now - prev.t < 300 && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 30) {
      lastTap.current = null;
      if (tapTimer.current) clearTimeout(tapTimer.current);
      const p = local(e.clientX, e.clientY);
      if (view.current.s > 1.05) {
        view.current = { s: 1, x: 0, y: 0 };
        apply(true);
      } else {
        zoomAt(DOUBLE_TAP_SCALE, p.x, p.y, true);
      }
      return;
    }
    lastTap.current = { t: now, x: e.clientX, y: e.clientY };
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => {
      lastTap.current = null;
      onTap();
    }, 300);
  }

  return (
    <div
      ref={boxRef}
      className="absolute inset-0 touch-none select-none overflow-hidden"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        draggable={false}
        className="h-full w-full object-contain will-change-transform"
      />
    </div>
  );
}

/**
 * The expand control that opens a result in MediaViewer. Server pages can
 * render it with plain props. A video opened from beside an inline player
 * carries on from that player's time, and the inline one pauses.
 */
export function ExpandMediaButton({
  variant = "overlay",
  className,
  ...viewer
}: Omit<MediaViewerProps, "onClose" | "startAt"> & {
  /** "overlay" = charcoal circle in the frame's top-right corner (pairs with
      DownloadButton's bottom-right); "ghost" = the Stage's 30px square.
      A className replaces both. */
  variant?: "overlay" | "ghost";
  className?: string;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState<{ startAt?: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  function openViewer() {
    let startAt: number | undefined;
    if (viewer.contentType === "video") {
      const inline = buttonRef.current?.parentElement?.querySelector("video");
      if (inline) {
        startAt = inline.currentTime || undefined;
        inline.pause();
      }
    }
    setOpen({ startAt });
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          openViewer();
        }}
        aria-label={t.generate.fullScreen}
        title={t.generate.fullScreen}
        className={
          className ??
          (variant === "ghost"
            ? "flex h-[30px] w-[30px] items-center justify-center rounded-[8px] bg-onmedia/10 text-onmedia/85 transition-colors hover:bg-onmedia/20"
            : "absolute right-3 top-3 z-[1] flex h-9 w-9 items-center justify-center rounded-full bg-black/70 text-onmedia shadow-sm backdrop-blur-sm transition-colors hover:bg-black/85")
        }
      >
        <ExpandIcon className={variant === "ghost" && !className ? "h-[15px] w-[15px]" : "h-4 w-4"} />
      </button>
      {open && <MediaViewer {...viewer} startAt={open.startAt} onClose={() => setOpen(null)} />}
    </>
  );
}
