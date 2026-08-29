"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isNativeAppClient } from "@/lib/native/platform";
import { capPlugin } from "@/lib/native/bridge";

// Applies the native-app class, keeps the Android system bars in the app's
// own colors, and gives the hardware back button sane in-app behavior.
//
// All of it reaches Capacitor through the runtime global (see
// lib/native/bridge.ts) rather than npm imports — the @capacitor/* packages
// aren't a dependency of the web build and shouldn't become one. On the web
// every branch quietly no-ops.
//
// 1. `html.native-app` turns on the safe-area padding and overscroll rules in
//    globals.css. Set from the client because it depends on the Capacitor
//    runtime, and set on <html> rather than <body> so CSS can target either.
//
// 2. The splash screen is NOT hidden here any more. It used to be — a
//    requestAnimationFrame inside this effect — which on a phone meant
//    "after the JS bundles downloaded and React hydrated": seconds of
//    frozen launch icon on mobile networks, reported as "people think the
//    app crashed" (operator, 2026-08-29). The hide now lives in
//    SPLASH_HIDE_SCRIPT below, inlined into <head> by the root layout, so
//    it fires on the FIRST PAINTED FRAME — the real page, server-rendered,
//    skeletons streaming. (An animated wordmark intro used to take over
//    here; it was cut the same day — a second centered logo just read as
//    the splash icon lingering.)
//
// 3. Status bar color: Android paints its own default strip behind the
//    punch-hole/status area, which sat visibly grey against the paper page
//    (operator-reported, 2026-08-21). Painted to the app's background and
//    re-painted whenever the theme class flips.
//
// 4. Hardware back: with no listener Android just minimizes the app on the
//    first back press (operator: "if I try to go back the app minimizes").
//    In-app history goes back; out of history, land on the dashboard; on the
//    dashboard, minimize — a phone app's normal shape.
// Inlined into <head> by the root layout (nonce-stamped, native UAs only),
// so it runs at document start — long before the app bundles arrive. It
// waits for the first frame that actually painted content (body has an
// element, then two rAFs so the frame composited) and dismisses the native
// splash there; launchAutoHide is off in capacitor.config.ts precisely so
// this owns the moment. The 1.2s timer is a backstop, not the mechanism —
// if frames stall on a busy main thread the splash still may not outstay
// it. Plain ES5 on purpose: it ships verbatim inside a <script> tag.
export const SPLASH_HIDE_SCRIPT = `(function () {
  var cap = window.Capacitor;
  if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return;
  var done = false;
  function hide() {
    if (done) return;
    done = true;
    try { cap.Plugins.SplashScreen.hide(); } catch (e) {}
  }
  function onFirstPaint() {
    if (done) return;
    if (document.body && document.body.firstElementChild) {
      requestAnimationFrame(function () { requestAnimationFrame(hide); });
    } else {
      requestAnimationFrame(onFirstPaint);
    }
  }
  requestAnimationFrame(onFirstPaint);
  setTimeout(hide, 1200);
})();`;

export function NativeChrome() {
  const router = useRouter();

  useEffect(() => {
    if (!isNativeAppClient()) return;

    document.documentElement.classList.add("native-app");

    // --- Status bar ---
    const statusBar = capPlugin("StatusBar");
    const paintBars = () => {
      const dark = document.documentElement.classList.contains("dark");
      // Style.Light = light BACKGROUND (dark icons), Style.Dark the reverse.
      void statusBar?.setStyle?.({ style: dark ? "DARK" : "LIGHT" });
      // Frost: match the gradient's origin corner (--frost-top), not the old
      // paper constants — a mismatched strip reads as a webview seam.
      void statusBar?.setBackgroundColor?.({ color: dark ? "#1a1c24" : "#eef1f8" });
    };
    paintBars();
    // The theme toggle flips a class on <html>; watch it so the bar follows.
    const observer = new MutationObserver(paintBars);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    // --- Hardware back ---
    const app = capPlugin("App");
    let backHandle: { remove?: () => void } | undefined;
    const maybePromise = app?.addListener?.("backButton", (state: { canGoBack?: boolean }) => {
      const path = window.location.pathname;
      if (path === "/app" || path === "/login") {
        void app?.minimizeApp?.();
      } else if (state?.canGoBack) {
        window.history.back();
      } else {
        router.push("/app");
      }
    });
    // addListener returns a promise of a handle in current Capacitor.
    void Promise.resolve(maybePromise).then((h) => {
      backHandle = h as { remove?: () => void };
    });

    return () => {
      observer.disconnect();
      backHandle?.remove?.();
    };
  }, [router]);

  return null;
}
