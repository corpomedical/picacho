"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isNativeAppClient } from "@/lib/native/platform";
import { registerPushToken } from "@/lib/push/actions";

// Asks for notification permission, registers the device, and routes taps.
//
// Only does anything inside the iOS/Android shell. On the web every branch
// below no-ops, so this is safe to mount in the root layout.
//
// Reached through Capacitor's runtime global rather than an npm import, for
// the same reason as the splash screen (see native-chrome.tsx): the
// @capacitor/* packages aren't dependencies of the web build and shouldn't
// become them.
type PushPlugin = {
  requestPermissions: () => Promise<{ receive: string }>;
  register: () => Promise<void>;
  addListener: (
    event: string,
    handler: (payload: unknown) => void,
  ) => Promise<{ remove: () => Promise<void> }>;
};

export function NativePush() {
  const router = useRouter();

  useEffect(() => {
    if (!isNativeAppClient()) return;

    const cap = (
      window as unknown as {
        Capacitor?: {
          getPlatform?: () => string;
          Plugins?: { PushNotifications?: PushPlugin };
        };
      }
    ).Capacitor;

    const push = cap?.Plugins?.PushNotifications;
    if (!push) return;

    const platform = cap?.getPlatform?.() === "android" ? "android" : "ios";
    const listeners: { remove: () => Promise<void> }[] = [];
    let cancelled = false;

    (async () => {
      try {
        // Asked here rather than at first launch, deliberately. A permission
        // prompt on the very first screen, before anyone knows what the app
        // does, is the reliable way to get it denied — and iOS only lets you
        // ask once. By the time this mounts the person is signed in and has
        // seen the product.
        const permission = await push.requestPermissions();
        if (permission.receive !== "granted" || cancelled) return;

        listeners.push(
          await push.addListener("registration", (payload) => {
            const token = (payload as { value?: string })?.value;
            if (token) void registerPushToken(token, platform);
          }),
        );

        // Tapping a notification should open the thing it's about. The path
        // travels in `data` rather than the notification body because only
        // data survives when the app opens from a cold start.
        listeners.push(
          await push.addListener("pushNotificationActionPerformed", (payload) => {
            const path = (payload as { notification?: { data?: { path?: string } } })?.notification
              ?.data?.path;
            // Same allowlist reasoning as the checkout return path: this value
            // arrives from outside, so it may only ever be an in-app route.
            if (path && /^\/app\/[a-z0-9/-]*$/i.test(path)) router.push(path);
          }),
        );

        await push.register();
      } catch {
        // Notifications are an enhancement. A failure here must never break
        // the app around it.
      }
    })();

    return () => {
      cancelled = true;
      listeners.forEach((l) => void l.remove());
    };
  }, [router]);

  return null;
}
