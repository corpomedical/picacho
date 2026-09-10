"use client";

import { useEffect } from "react";
import { isNativeAppClient } from "@/lib/native/platform";
import { saveWebPushSubscription } from "@/lib/push/actions";

// The browser twin of NativePush's re-register-on-launch (2026-09-11).
//
// Sign-out deletes every web-push device of the account, for the same
// reason it deletes the native tokens: on a shared computer the next person
// must not keep receiving the previous account's notifications. That would
// silently switch push off on the person's OTHER browsers too — so, like
// the native shell, any browser that already holds a subscription and has
// permission re-registers itself for whoever is signed in the next time the
// app opens. Never prompts, never subscribes a browser that did not opt in.
// Once per full page load (the app layout persists across client
// navigations): a once-per-tab-session flag outlived a sign-out and sign-in
// in the same tab and left push dead while Settings said it was on
// (2026-09-11 review). The upsert is idempotent and one request.
export function WebPushSync() {
  useEffect(() => {
    if (isNativeAppClient()) return;
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    navigator.serviceWorker
      .getRegistration("/push-sw.js")
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => {
        if (!sub) return;
        const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
        return saveWebPushSubscription({
          endpoint: json.endpoint ?? "",
          p256dh: json.keys?.p256dh ?? "",
          auth: json.keys?.auth ?? "",
        });
      })
      .catch(() => undefined);
  }, []);
  return null;
}
