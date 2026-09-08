"use client";

import { useSyncExternalStore } from "react";
import { isNativeAppClient } from "@/lib/native/platform";

// "Am I rendering inside the Capacitor shell?" for Client Components.
//
// useSyncExternalStore rather than useState+useEffect on purpose. The server
// snapshot is always false, so the HTML the shell receives is the same HTML
// the web receives and hydration cannot mismatch; the client snapshot reads
// the injected Capacitor global (or the user-agent marker) and the first
// client render after hydration switches. That is the same two-step the
// composer's banners do by hand with setNative(isNativeAppClient()) in an
// effect — this is the shape without the effect, and without the
// set-state-in-effect warning that pattern carries.
//
// What it is FOR: the reader-mode rule in lib/native/platform.ts. Every
// pointer at a way to buy — "Get more usage", "Need credits? Buy a pack" —
// has to disappear inside the app, and on 2026-09-08 five of them did not:
// the composer's usage strip and the upscale and layers dialogs all linked
// the shell to the usage tab with purchase wording. The Server Component
// pages already gate with isNativeApp(); this is the client half.
const subscribe = () => () => {};

export function useIsNativeApp(): boolean {
  return useSyncExternalStore(subscribe, isNativeAppClient, () => false);
}
