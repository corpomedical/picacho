"use client";

import { capPlugin } from "./bridge";

// The Android status and navigation bars, hidden while a picture is shown
// on its own in the full-screen viewer (media-viewer.tsx), the way a phone's
// own gallery does it: tap the picture, the bars and the controls go; tap
// again, they come back.
//
// Counted, like orientation.ts: two viewers must not fight over the bars.
// SystemBars ships inside Capacitor 8 itself, so every shell that loads
// this site has it; on the web every call is a no-op.

let hidden = 0;

function call(method: "hide" | "show") {
  try {
    void capPlugin("SystemBars")?.[method]?.()?.catch?.(() => {});
  } catch {
    // An older shell's plugin proxy can throw for an unknown method.
  }
}

export function hideSystemBars(): () => void {
  hidden += 1;
  if (hidden === 1) call("hide");
  let released = false;
  return () => {
    if (released) return;
    released = true;
    hidden -= 1;
    if (hidden === 0) call("show");
  };
}

let lightIcons = 0;

function paintForTheme() {
  const dark = document.documentElement.classList.contains("dark");
  // Same mapping as NativeChrome: LIGHT = dark icons, DARK = light icons.
  try {
    void capPlugin("SystemBars")?.setStyle?.({ style: dark ? "DARK" : "LIGHT" })?.catch?.(() => {});
  } catch {
    // no plugin, nothing to paint
  }
}

/**
 * White status-bar icons while a viewer's black ground sits under them —
 * the app's light theme paints them dark, and dark on black is invisible
 * (seen on the emulator, 2026-09-30). The release paints them for the
 * theme again.
 */
export function lightSystemBarIcons(): () => void {
  lightIcons += 1;
  if (lightIcons === 1) {
    try {
      void capPlugin("SystemBars")?.setStyle?.({ style: "DARK" })?.catch?.(() => {});
    } catch {
      // no plugin
    }
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lightIcons -= 1;
    if (lightIcons === 0) paintForTheme();
  };
}

/**
 * Bars back on, whatever state the last page left them in. A full page load
 * while they were hidden (a delete that redirects) runs no cleanup, and the
 * bars would otherwise stay gone until the app restarts. NativeChrome calls
 * this once per load.
 */
export function resetSystemBars(): void {
  hidden = 0;
  call("show");
}
