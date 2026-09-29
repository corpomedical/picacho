"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ALY_POINT_EVENT, findControl, type AlyPointDetail } from "@/lib/producer/screen";
import styles from "./producer-lamp.module.css";

// Aly takes them there and points (operator, 2026-09-29: "Give her the power
// to help the user as you do, and switch between pages" → "Guide + drive").
//
// open_page reaches the browser as ALY_POINT_EVENT, raised by the lamp or by
// her chat page. Mounted once in the app's layout, so it outlives the page it
// navigates away from. It opens the page, waits for the named control to
// appear (a page can take a few seconds to paint), brings it into view and
// rings it with her light for a while. It never presses anything: the ring is
// on top of the page with pointer-events off, and a tap on the control itself
// is what puts the ring away.

const FIND_FOR_MS = 6000;
const RING_FOR_MS = 14000;
const PAD = 6;

type Ring = { left: number; top: number; width: number; height: number };

export function AlyPointer() {
  const router = useRouter();
  const pathname = usePathname();
  const [ring, setRing] = useState<Ring | null>(null);
  const job = useRef(0);
  // The page Aly is taking them to: arriving there keeps her ring going.
  const heading = useRef<string | null>(null);

  useEffect(() => {
    const onPoint = (e: Event) => {
      const detail = (e as CustomEvent<AlyPointDetail>).detail;
      if (!detail || typeof detail.href !== "string" || !detail.href.startsWith("/") || detail.href.startsWith("//")) return;
      const mine = ++job.current;
      setRing(null);

      const here = `${window.location.pathname}${window.location.search}`;
      const [target] = detail.href.split("#");
      heading.current = target.split("?")[0];
      if (target !== here) router.push(detail.href);
      else if (detail.href.includes("#")) window.location.hash = detail.href.split("#")[1];

      const words = detail.words?.trim();
      if (!words) return;
      const started = Date.now();
      let el: HTMLElement | null = null;
      let frame = 0;
      let shownAt = 0;
      const done = () => {
        if (job.current === mine) setRing(null);
        el?.removeEventListener("click", done);
        cancelAnimationFrame(frame);
      };
      const tick = () => {
        if (job.current !== mine) return;
        const now = Date.now();
        // Wait for the new page: the old one may still be showing the same words.
        const arrived = target === here || window.location.pathname === target.split("?")[0];
        if (!el || !el.isConnected) {
          el = arrived ? findControl(words) : null;
          if (el) {
            shownAt = now;
            el.addEventListener("click", done, { once: true });
            bringIntoView(el);
          } else if (now - started > FIND_FOR_MS) {
            return done();
          }
        }
        if (el) {
          if (now - shownAt > RING_FOR_MS) return done();
          const r = el.getBoundingClientRect();
          setRing((prev) => {
            const next = { left: r.left - PAD, top: r.top - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
            return prev && prev.left === next.left && prev.top === next.top && prev.width === next.width && prev.height === next.height
              ? prev
              : next;
          });
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };
    window.addEventListener(ALY_POINT_EVENT, onPoint);
    return () => window.removeEventListener(ALY_POINT_EVENT, onPoint);
  }, [router]);

  // Going somewhere else by themselves puts the ring away.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    if (pathname === heading.current) return;
    job.current += 1;
    setRing((r) => (r ? null : r));
  }, [pathname]);

  if (!ring) return null;
  return <span aria-hidden="true" className={styles.pointRing} style={ring} />;
}

/**
 * Scrolls the control into the top part of the screen: her subtitles cover
 * the lower half, and a control in the middle would sit under her words.
 */
function bringIntoView(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  const top = Math.max(72, window.innerHeight * 0.18);
  if (r.top >= top - 8 && r.bottom <= window.innerHeight * 0.48) return;
  let box: HTMLElement | null = el.parentElement;
  while (box && box !== document.body) {
    const oy = window.getComputedStyle(box).overflowY;
    if ((oy === "auto" || oy === "scroll") && box.scrollHeight > box.clientHeight) break;
    box = box.parentElement;
  }
  const by = r.top - top;
  if (box && box !== document.body) box.scrollBy({ top: by, behavior: "smooth" });
  else window.scrollBy({ top: by, behavior: "smooth" });
}

/** Ask the pointer to open a page and ring a control on it (the lamp and the chat page call this). */
export function alyPoint(detail: AlyPointDetail) {
  window.dispatchEvent(new CustomEvent<AlyPointDetail>(ALY_POINT_EVENT, { detail }));
}
