import { createAdminClient } from "@/lib/supabase/server";
import { pushChannels, type NotifyOptions } from "@/lib/push/channels";
import { resolvePushText } from "@/lib/push/text";
import { apnsConfig, apnsPayload, deliverToIphone, isApnsDevice } from "@/lib/push/apns";

// Sending a push notification when a generation finishes.
//
// Delivery to the Android app goes through Firebase Cloud Messaging. The
// iPhone app (2026-09-30) registers Apple's own device tokens, which FCM
// can't address without Firebase's SDK inside the app, so those go straight
// to Apple's push service instead (apns.ts). Browsers get web push.
//
// Deliberately fails silently. This is called from the job runner's finish
// path, which is also what saves the result: a notification problem must never
// prevent a completed video from being recorded. A person who doesn't get a
// notification still finds their video in History; a person whose video was
// lost because the push failed has lost real money.

const FCM_ENDPOINT = "https://fcm.googleapis.com/v1/projects";

// Callers hand over a MESSAGE KEY, not text (2026-09-05): a push arrives
// while no screen is open to translate it, so the words are resolved here,
// per device, from the locale the device registered with (push_tokens.locale
// — re-written on every app launch, so it follows a language switch). A
// device from before the locale column, or one whose value is unreadable,
// gets English, exactly what it got before. The words themselves are
// text.ts's resolvePushText.
//
// setReady and setFailed (2026-09-11) come only from the Sets finisher
// (lib/sets/finisher.ts), sent web-only: see channels.ts.
//
// Press Tour (2026-09-26): adReady / adFailed / adFailedRefunded (credits
// went back) come from the campaign engine
// (lib/press-tour/campaign-runtime.ts); postPublished / postFailed /
// reconnectNeeded are for the posts worker's hooks, with params.network the
// network's own name.
export type PushMessage = {
  key:
    | "videoReady"
    | "videoFailed"
    | "videoFailedRefunded"
    | "layersReady"
    | "lowCredits"
    | "setReady"
    | "setFailed"
    | "adReady"
    | "adFailed"
    | "adFailedRefunded"
    | "postPublished"
    | "postFailed"
    | "reconnectNeeded";
  params?: Record<string, string | number>;
};

type Notification = {
  message: PushMessage;
  // Deep link, so tapping the notification opens the generation rather than
  // dumping the person on the home screen to find it themselves.
  path: string;
  // Browsers only: a notification with the same tag replaces this one rather
  // than stacking beside it. Sets use it (lib/sets/leaving.ts), because a
  // Sets tab in the background shows its own notification for a build it
  // collected itself.
  tag?: string;
};

// Google requires a short-lived OAuth token minted from the service account,
// not a static key — the old legacy server key was retired. Cached in module
// scope for just under its hour lifetime, since minting one per notification
// would add a round trip to every send.
let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string | null> {
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  try {
    const account = JSON.parse(raw) as { client_email: string; private_key: string };
    const now = Math.floor(Date.now() / 1000);
    const claim = {
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    };

    const { createSign } = await import("node:crypto");
    const b64 = (obj: unknown) =>
      Buffer.from(JSON.stringify(obj)).toString("base64url");
    const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claim)}`;
    const signature = createSign("RSA-SHA256")
      .update(unsigned)
      .sign(account.private_key, "base64url");

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${unsigned}.${signature}`,
      }),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;

    cachedToken = {
      value: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
    return cachedToken.value;
  } catch {
    return null;
  }
}

// The person's own switch for this message (Settings → Notifications,
// 2026-09-11). FAIL OPEN in both directions that matter: before the
// operator runs the pending SQL the columns do not exist and the select
// errors — every message keeps flowing, exactly as before the feature; a
// column that reads false is the person's explicit "don't".
async function allowedByPrefs(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  key: PushMessage["key"],
): Promise<boolean> {
  try {
    const { PREF_FOR_KEY } = await import("@/lib/push/prefs");
    const pref = PREF_FOR_KEY[key];
    const { data, error } = await admin.from("profiles").select(pref).eq("id", userId).maybeSingle();
    if (error || !data) return true;
    return (data as Record<string, unknown>)[pref] !== false;
  } catch {
    return true;
  }
}

// The browser twin of the FCM fan-out below: web-push devices the person
// enabled in Settings → Notifications. Silent when VAPID is unconfigured
// or the pending SQL has not created the table yet.
async function notifyWebDevices(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  notification: Notification,
): Promise<void> {
  try {
    const { data: devices, error } = await admin
      .from("user_push_subscriptions")
      .select("endpoint, p256dh, auth, locale")
      .eq("user_id", userId)
      .limit(10);
    if (error || !devices?.length) return;
    const { sendToWebPushDevice } = await import("@/lib/push/web-push");
    await Promise.all(
      devices.map((d) => {
        const text = resolvePushText(notification.message, d.locale as string | null);
        const payload = Buffer.from(
          JSON.stringify({
            title: text.title,
            body: text.body,
            path: notification.path,
            ...(notification.tag ? { tag: notification.tag } : {}),
          }),
        );
        return sendToWebPushDevice(
          { endpoint: d.endpoint as string, p256dh: d.p256dh as string, auth: d.auth as string },
          payload,
          "user_push_subscriptions",
        );
      }),
    );
  } catch {
    // Never let a notification problem surface into the calling path.
  }
}

export async function notifyUser(
  userId: string,
  notification: Notification,
  options: NotifyOptions = {},
): Promise<void> {
  const admin = createAdminClient();
  if (!(await allowedByPrefs(admin, userId, notification.message.key))) return;
  const channels = pushChannels(options);

  // Browser devices go first and do not depend on FCM being configured —
  // web push runs on the VAPID keys the admin channel already uses.
  if (channels.web) await notifyWebDevices(admin, userId, notification);

  // A web-only message never reaches the phone app (channels.ts).
  if (!channels.fcm) return;

  const { data: devices } = await admin
    .from("push_tokens")
    .select("token, locale, platform")
    .eq("user_id", userId)
    .limit(10);

  if (!devices?.length) return;

  // The iPhone app's devices go straight to Apple (apns.ts, 2026-09-30);
  // every other row is the Android app's and goes through FCM, as before.
  const iphones = devices.filter((device) => isApnsDevice(device.platform, device.token));
  const androids = devices.filter((device) => !isApnsDevice(device.platform, device.token));

  const apns = iphones.length ? apnsConfig() : null;
  const projectId = process.env.FCM_PROJECT_ID;
  const token = androids.length ? await accessToken() : null;
  // Either may not be configured yet — see MOBILE_APP.md and IOS_APP.md.
  // Silent, because the web app runs perfectly well without push and this is
  // called on every completion.

  await Promise.all([
    ...iphones.map(async (device) => {
      if (!apns) return;
      try {
        const text = resolvePushText(notification.message, device.locale as string | null);
        const outcome = await deliverToIphone(
          device.token as string,
          apnsPayload(text.title, text.body, notification.path),
          apns,
        );
        // Deleted app or notifications switched off for good: same pruning
        // as FCM's 404/410 below.
        if (outcome === "gone") await admin.from("push_tokens").delete().eq("token", device.token);
      } catch {
        // One device failing must not stop the others.
      }
    }),
    ...androids.map(async (device) => {
      if (!projectId || !token) return;
      try {
        const text = resolvePushText(notification.message, device.locale as string | null);
        const res = await fetch(`${FCM_ENDPOINT}/${projectId}/messages:send`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token: device.token,
              notification: { title: text.title, body: text.body },
              // Read by the app to route the tap. Kept in data rather than the
              // notification payload because only data survives to the handler
              // when the app opens from a cold start.
              data: { path: notification.path },
            },
          }),
        });

        // 404 or 410 means the app was uninstalled or the token rotated.
        // Pruning matters: both stores eventually throttle senders who keep
        // pushing to dead tokens.
        if (res.status === 404 || res.status === 410) {
          await admin.from("push_tokens").delete().eq("token", device.token);
        }
      } catch {
        // One device failing must not stop the others.
      }
    }),
  ]);
}
