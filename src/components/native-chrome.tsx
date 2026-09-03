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
      // this build. None of it is ours: our res/ and manifest contain no
      // statusBarColor, navigationBarColor, windowLightStatusBar or
      // fitsSystemWindows. An earlier note here blamed @capacitor/status-bar
      // alone; that was only the part visible from node_modules. Read out of
      // the actual release DEX on 2026-09-03 (dexdump + the R8 mapping, which
      // is the only way to see it — these are Gradle deps, not npm packages),
      // every surviving caller of Window.set/getStatusBarColor and
      // set/getNavigationBarColor is a library:
      //
      //   androidx.activity.EdgeToEdgeApi23/26/29     (activity 1.11.0)
      //   androidx.core.splashscreen.SplashScreen$Impl31 (core-splashscreen 1.2.0)
      //   com.google.android.material.internal.EdgeToEdgeUtils
      //   com.google.android.material.bottomsheet.BottomSheetDialog (material 1.13.0)
      //   com.capacitorjs.plugins.statusbar.StatusBar  (status-bar 8.0.3)
      //   io.ionic.libs...IONCAMRImageEditorActivity   (via @capacitor/camera)
      //
      // All are current versions, and each guards the call by API level at
      // runtime — Play's scan reads the bytecode, not the guard. R8 does not
      // remove them. So there is no version bump that clears this today; the
      // last three could only go by dropping plugins (the camera one is
      // never called from here — see AndroidManifest, capture rides the web
      // <input capture> bridge — so that one is a real option), and the first
      // two cannot go at all. It is a recommendation with no deadline, unlike
      // the obfuscation item. Revisit when AndroidX and Material ship
      // releases without the legacy paths.
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
