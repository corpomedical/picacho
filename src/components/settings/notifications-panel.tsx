"use client";

import { useEffect, useState } from "react";
import { SettingsStatus } from "@/components/settings/settings-status";
import { Switch } from "@/components/ui/switch";
import { useLocale } from "@/lib/i18n/provider";
import { localizeServerText } from "@/lib/i18n/server-text";
import { removeWebPushSubscription, saveWebPushSubscription, setNotificationPref } from "@/lib/push/actions";
import type { NotificationPref } from "@/lib/push/prefs";

// Settings → Notifications (2026-09-11). Two halves:
//
//   WHERE — this browser, via Web Push. Hidden inside the native shell (the
//   app registers its own FCM token on launch) and wherever the server has
//   no VAPID key or the browser has no Push API: a button that cannot work
//   is worse than no button.
//
//   WHAT — three outcome switches that govern every channel at once: a
//   render finishing, a render failing, credits running low.

type Status = { state: "idle" | "saved" | "error"; message?: string | null };

function urlBase64ToBytes(base64: string): Uint8Array {
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function NotificationsPanel({
  initial,
  vapidPublicKey,
  nativeApp,
}: {
  initial: Record<NotificationPref, boolean>;
  vapidPublicKey: string | null;
  nativeApp: boolean;
}) {
  const { t } = useLocale();
  const s = t.settings;

  // A server message the catalog knows is shown in the reader's language;
  // anything else collapses to one localized line rather than leaking English.
  const say = (serverText: string, fallback: string) => {
    const localized = localizeServerText(serverText, t);
    return localized === serverText ? fallback : localized;
  };

  // ---- WHERE: this browser -------------------------------------------------
  const [support, setSupport] = useState<"checking" | "unsupported" | "ready">("checking");
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushStatus, setPushStatus] = useState<Status>({ state: "idle" });

  useEffect(() => {
    if (nativeApp || !vapidPublicKey) return;
    let cancelled = false;
    (async () => {
      const supported =
        typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!supported) {
        if (!cancelled) setSupport("unsupported");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.register("/push-sw.js");
        const sub = await reg.pushManager.getSubscription();
        // "On for this device" must be true on the server as well: a
        // sign-out anywhere deletes the account's browser rows, and the
        // browser alone still reports a subscription. Re-saving is an
        // idempotent upsert (2026-09-11 review).
        if (sub && Notification.permission === "granted") {
          const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
          await saveWebPushSubscription({
            endpoint: json.endpoint ?? "",
            p256dh: json.keys?.p256dh ?? "",
            auth: json.keys?.auth ?? "",
          }).catch(() => undefined);
        }
        if (cancelled) return;
        setPermission(Notification.permission);
        setSubscribed(Boolean(sub));
        setSupport("ready");
      } catch {
        if (!cancelled) setSupport("unsupported");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nativeApp, vapidPublicKey]);

  async function enablePush() {
    if (!vapidPublicKey) return;
    setPushBusy(true);
    setPushStatus({ state: "idle" });
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") {
        setPushStatus({ state: "error", message: s.browserPushDenied });
        return;
      }
      const reg = await navigator.serviceWorker.register("/push-sw.js");
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToBytes(vapidPublicKey) as BufferSource,
        }));
      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const saved = await saveWebPushSubscription({
        endpoint: json.endpoint ?? "",
        p256dh: json.keys?.p256dh ?? "",
        auth: json.keys?.auth ?? "",
      });
      if (saved.error) {
        await sub.unsubscribe().catch(() => undefined);
        setPushStatus({ state: "error", message: say(saved.error, s.browserPushFailed) });
        return;
      }
      setSubscribed(true);
      setPushStatus({ state: "saved", message: s.browserPushOn });
    } catch {
      setPushStatus({ state: "error", message: s.browserPushFailed });
    } finally {
      setPushBusy(false);
    }
  }

  async function disablePush() {
    setPushBusy(true);
    setPushStatus({ state: "idle" });
    try {
      const reg = await navigator.serviceWorker.getRegistration("/push-sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await removeWebPushSubscription(sub.endpoint);
        await sub.unsubscribe().catch(() => undefined);
      }
      setSubscribed(false);
      setPushStatus({ state: "saved", message: t.common.saved });
    } catch {
      setPushStatus({ state: "error", message: s.browserPushFailed });
    } finally {
      setPushBusy(false);
    }
  }

  const showBrowserBlock = !nativeApp && Boolean(vapidPublicKey);

  // ---- WHAT: the three switches -------------------------------------------
  const [prefs, setPrefs] = useState(initial);
  const [pending, setPending] = useState<NotificationPref | null>(null);
  const [prefStatus, setPrefStatus] = useState<Partial<Record<NotificationPref, Status>>>({});

  async function flip(pref: NotificationPref) {
    const next = !prefs[pref];
    setPrefs((p) => ({ ...p, [pref]: next }));
    setPending(pref);
    setPrefStatus((st) => ({ ...st, [pref]: { state: "idle" } }));
    const result = await setNotificationPref(pref, next);
    setPending(null);
    if (result.error) {
      // Roll back AND say so — the flip didn't actually save.
      setPrefs((p) => ({ ...p, [pref]: !next }));
      setPrefStatus((st) => ({ ...st, [pref]: { state: "error", message: say(result.error!, s.notifySaveFailed) } }));
      return;
    }
    setPrefStatus((st) => ({ ...st, [pref]: { state: "saved", message: t.common.saved } }));
  }

  const rows: { pref: NotificationPref; label: string; help: string }[] = [
    { pref: "notify_render_ready", label: s.notifyRenderReadyLabel, help: s.notifyRenderReadyHelp },
    { pref: "notify_render_failed", label: s.notifyRenderFailedLabel, help: s.notifyRenderFailedHelp },
    { pref: "notify_low_credits", label: s.notifyLowCreditsLabel, help: s.notifyLowCreditsHelp },
  ];

  return (
    <div className="space-y-5">
      {showBrowserBlock && (
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-atelier-ink">{s.browserPushLabel}</p>
            <p className="mt-0.5 text-xs text-atelier-muted">
              {support === "unsupported"
                ? s.browserPushUnsupported
                : permission === "denied" && !subscribed
                  ? s.browserPushDenied
                  : s.browserPushHelp}
            </p>
            <SettingsStatus state={pushStatus.state} message={pushStatus.message} className="mt-1" />
          </div>
          {support === "ready" && (permission !== "denied" || subscribed) && (
            <button
              type="button"
              onClick={subscribed ? disablePush : enablePush}
              disabled={pushBusy}
              className="flex-shrink-0 rounded-control border border-atelier-rule px-3 py-1.5 text-sm font-medium text-atelier-ink transition-colors hover:bg-atelier-ink/5 disabled:opacity-50"
            >
              {subscribed ? s.browserPushDisable : s.browserPushEnable}
            </button>
          )}
        </div>
      )}

      <div className={showBrowserBlock ? "border-t border-atelier-rule/60 pt-5" : undefined}>
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">{s.notifyEventsTitle}</p>
        <div className="mt-3 space-y-4">
          {rows.map((row) => (
            <div key={row.pref} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-atelier-ink">{row.label}</p>
                <p className="mt-0.5 text-xs text-atelier-muted">{row.help}</p>
                <SettingsStatus
                  state={prefStatus[row.pref]?.state ?? "idle"}
                  message={prefStatus[row.pref]?.message}
                  className="mt-1"
                />
              </div>
              <Switch
                checked={prefs[row.pref]}
                onChange={() => flip(row.pref)}
                disabled={pending === row.pref}
                ariaLabel={row.label}
                labelOn={t.common.toggleOn}
                labelOff={t.common.toggleOff}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
