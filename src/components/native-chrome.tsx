"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isNativeAppClient } from "@/lib/native/platform";
import { capPlugin } from "@/lib/native/bridge";
import { popBackCloser } from "@/lib/native/back-stack";

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
//    it fires on the FIRST PAINTED FRAME — which in the app is the
//    NativeIntro brand hold (wordmark + pulsing dots, the HBO Max pattern):
//    motion takes over from the static icon the instant paint exists.
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
      // This one still works everywhere: the plugin implements it with
      // WindowInsetsControllerCompat.setAppearanceLightStatusBars, which
      // edge-to-edge did not deprecate.
      void statusBar?.setStyle?.({ style: dark ? "DARK" : "LIGHT" });
      // setBackgroundColor is a NO-OP on Android 15+ and kept only for 14 and
      // below. Not an oversight — the plugin refuses it by design: with
      // targetSdk 36 its own shouldSetStatusBarColor() returns false on any
      // API above 34 (StatusBar.java), because Android 15 enforced
      // edge-to-edge and deprecated Window.setStatusBarColor outright.
      //
      // The strip behind the status bar is painted by CSS instead, and always
      // was on modern devices: html.native-app carries background-color
      // var(--frost-top) (globals.css) while body holds the safe-area
      // padding, so the app's own surface shows through a transparent system
      // bar. That is the edge-to-edge-correct mechanism and it is what the
      // operator's 2026-08-21 "unify the color" fix is actually riding on.
      //
      // Play's release dashboard flags "deprecated APIs for edge-to-edge" on
      // this build. None of it is ours.
      //
      // RE-AUDITED 2026-09-04, against the shipped versionCode 12 APK rather
      // than from memory, because the list that stood here was wrong: it named
      // five surviving callers, three of which are not in the binary at all
      // (androidx.activity.EdgeToEdgeApi23/26/29 never appear in mapping.txt,
      // and there is not one com.google.android.material class left), and the
      // next paragraph then said two of them had been removed — the block
      // contradicted itself.
      //
      // Dexdumped, the release DEX holds exactly FOUR references to the four
      // bar-colour APIs, in TWO library classes, and none in ai.picacho.app:
      //
      //   com.capacitorjs.plugins.statusbar.StatusBar
      //     .getStatusBarColorDeprecated  -> Window.getStatusBarColor
      //     .setStatusBarColorDeprecated  -> Window.setStatusBarColor
      //   androidx.core.splashscreen.SplashScreen$Impl31
      //     .applyAppSystemUiTheme        -> Window.setStatusBarColor
      //                                   -> Window.setNavigationBarColor
      //
      // Three things follow, and they are why this is recorded rather than
      // fixed:
      //
      // 1. PLAY'S OWN SUGGESTED FIX WOULD MAKE IT WORSE. Its other
      //    recommendation says to call enableEdgeToEdge(). Read in
      //    activity-1.11.0's sources, EdgeToEdgeApi23/26/29 assign
      //    window.statusBarColor and window.navigationBarColor, and the
      //    highest implementation is Api30 — there is no API-35 subclass that
      //    skips the assignment. Calling it would add SIX new deprecated call
      //    sites to a binary that currently has none of its own.
      // 2. THERE IS NOTHING TO UPGRADE TO. @capacitor/status-bar's latest is
      //    8.0.3, which is what is installed; androidx.core:core-splashscreen's
      //    latest is 1.2.0, which is what variables.gradle pins.
      // 3. DELETING THE CALL BELOW WOULD CHANGE NOTHING. StatusBar.java's
      //    constructor calls getStatusBarColorDeprecated() unconditionally, so
      //    the bytecode Play scans is present whether or not any JS reaches it.
      //
      // The app is already inset-correct on Android 15 without any of it:
      // Capacitor 8 core registers a built-in SystemBars plugin (Bridge.java)
      // that installs a window-insets listener and hands real insets to the
      // WebView, which is what the env(safe-area-inset-*) padding in
      // globals.css consumes. It is a recommendation with no deadline.
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
      // An open overlay (lightbox, community viewer, search dialog) consumes
      // the press — back used to navigate away UNDERNEATH it, the opposite
      // of what every Android app does. See lib/native/back-stack.ts.
      if (popBackCloser()) return;
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
