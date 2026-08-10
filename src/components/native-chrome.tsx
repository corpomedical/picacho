"use client";

import { useEffect } from "react";
import { isNativeAppClient } from "@/lib/native/platform";

// Applies the native-app class and hides the splash screen once the page has
// actually painted.
//
// Two jobs, both about not looking like a webview:
//
// 1. `html.native-app` turns on the safe-area padding and overscroll rules in
//    globals.css. Set from the client because it depends on the Capacitor
//    runtime, and set on <html> rather than <body> so CSS can target either.
//
// 2. Dismissing the splash on first paint. Capacitor's default is a fixed
//    timeout, which means the splash either lingers after the app is ready
//    (feeling slow) or disappears before it is (showing a blank screen).
//    launchAutoHide is off in capacitor.config.ts precisely so this can hide
//    it at the right moment instead.
//
// Renders nothing. Safe on the web, where both branches no-op.
export function NativeChrome() {
  useEffect(() => {
    if (!isNativeAppClient()) return;

    document.documentElement.classList.add("native-app");

    // Reached through Capacitor's runtime global rather than an npm import.
    //
    // The @capacitor/* packages aren't a dependency of the web build and
    // shouldn't become one — the website would be downloading a shim it can
    // never use, and Vercel would be installing native tooling to render
    // HTML. The shell injects this global itself, so on a phone it's there,
    // and everywhere else the optional chaining below quietly does nothing.
    const splash = (
      window as unknown as {
        Capacitor?: { Plugins?: { SplashScreen?: { hide?: () => Promise<void> } } };
      }
    ).Capacitor?.Plugins?.SplashScreen;

    // One frame after paint, so the first screen is genuinely on-screen
    // rather than merely committed.
    const raf = requestAnimationFrame(() => {
      void splash?.hide?.();
    });

    return () => cancelAnimationFrame(raf);
  }, []);

  return null;
}
