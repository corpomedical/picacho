"use client";

import { useEffect } from "react";
import { capPlugin } from "./bridge";

// The app is portrait-only; a picture or video opened full screen may turn
// sideways. The Android shell locks the activity to portrait in its manifest
// and exposes PicachoOrientation (OrientationPlugin.java) to lift the lock.
//
// Counted, not a flag: one viewer can open over another (a lightbox from the
// community pager), and closing the inner one must not lock the screen while
// the outer one is still showing. On the web and on shells older than
// versionCode 18 the plugin is absent and every call is a no-op.

let open = 0;

function call(method: "allowLandscape" | "lockPortrait") {
  try {
    void capPlugin("PicachoOrientation")?.[method]?.()?.catch?.(() => {});
  } catch {
    // An older shell's plugin proxy can throw for an unknown plugin.
  }
}

export function allowLandscape(): () => void {
  open += 1;
  if (open === 1) call("allowLandscape");
  let released = false;
  return () => {
    if (released) return;
    released = true;
    open -= 1;
    if (open === 0) call("lockPortrait");
  };
}

// Landscape allowed while `open`, portrait again on close/unmount.
export function useLandscapeWhileOpen(isOpen: boolean): void {
  useEffect(() => {
    if (!isOpen) return;
    return allowLandscape();
  }, [isOpen]);
}
