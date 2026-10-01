"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ALY_POINT_EVENT, findControl, pressRefusal, type AlyPointDetail } from "@/lib/producer/screen";
import styles from "./producer-lamp.module.css";

// Aly takes them there and points (operator, 2026-09-29: "Give her the power
// to help the user as you do, and switch between pages" → "Guide + drive").
//
// open_page reaches the browser as ALY_POINT_EVENT, raised by the lamp or by
// her chat page. Mounted once in the app's layout, so it outlives the page it
// navigates away from. It opens the page, waits for the named control to
// appear (a page can take a few seconds to paint), brings it into view and
// rings it with her light for a while. The ring is on top of the page with
// pointer-events off, and a tap on the control itself puts it away.
//
// press_button (2026-10-01, operator: "I asked she takes control so the user
// works hands free" → "Press buttons on the page") comes the same way with
// press: true. The control is found among the page's pressable ones, rung for
// a moment so they see what she's about to press, then pressed — only when
// pressRefusal (screen.ts) allows it. What happened is kept for her next
// message (takeLastPress), so she hears whether it worked.

const FIND_FOR_MS = 6000;
const RING_FOR_MS = 14000;
const PRESS_AFTER_MS = 800;
const PAD = 6;

// The page an open_page is still on its way to: a press in the same answer
// waits for it, so it never lands on the page being left.
let navigating: { path: string; at: number } | null = null;
const NAV_WAIT_MS = 8000;

export type PressReport = { words: string; outcome: "pressed" | "refused" | "not found"; why?: string };
let lastPress: PressReport | null = null;

/** What her last press_button did, once: the lamp sends it with the next message. */
export function takeLastPress(): PressReport | null {
  const r = lastPress;
  lastPress = null;
  return r;
}

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
      if (!detail) return;
      const press = detail.press === true;
      const href = typeof detail.href === "string" && detail.href.startsWith("/") && !detail.href.startsWith("//") ? detail.href : null;
      if (!href && !press) return;
      const mine = ++job.current;
      setRing(null);

      const here = `${window.location.pathname}${window.location.search}`;
      let target = here;
      if (href) {
        target = href.split("#")[0];
        heading.current = target.split("?")[0];
        if (target !== here) {
          navigating = { path: heading.current, at: Date.now() };
          router.push(href);
        } else if (href.includes("#")) window.location.hash = href.split("#")[1];
      } else if (navigating && Date.now() - navigating.at < NAV_WAIT_MS) {
        target = navigating.path;
      }

      const words = detail.words?.trim();
      if (!words) return;
      const report = (r: PressReport) => {
        if (press) lastPress = r;
      };
      const started = Date.now();
      let el: HTMLElement | null = null;
      let frame = 0;
      let shownAt = 0;
      let pressed = false;
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
        if (arrived && navigating?.path === window.location.pathname) navigating = null;
        if (!el || !el.isConnected) {
          el = arrived ? findControl(words, document, press) : null;
          if (el) {
            shownAt = now;
            el.addEventListener("click", done, { once: true });
            bringIntoView(el);
          } else if (now - started > (press ? FIND_FOR_MS + NAV_WAIT_MS : FIND_FOR_MS)) {
            report({ words, outcome: "not found" });
            return done();
          }
        }
        if (el && press && !pressed && now - shownAt > PRESS_AFTER_MS) {
          // Pressed once, after they've seen where: then the ring goes.
          const why = pressRefusal(el, window.location.origin);
          if (why) {
            report({ words, outcome: "refused", why });
          } else {
            report({ words, outcome: "pressed" });
            el.click();
          }
          pressed = true;
          // A refused one keeps its light on, so they see what's theirs to press.
          if (!why) return done();
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
