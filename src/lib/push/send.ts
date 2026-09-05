import { createAdminClient } from "@/lib/supabase/server";
import { getMessages } from "@/lib/i18n/messages";
import { formatMsg } from "@/lib/i18n/format";
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n/locales";

// Sending a push notification when a generation finishes.
//
// Delivery goes through Firebase Cloud Messaging for both platforms — FCM
// forwards to APNs for iOS, so there's one integration rather than two, and
// no Apple certificate handling on our side beyond uploading the APNs key to
// Firebase once.
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
// gets English, exactly what it got before.
export type PushMessage = {
  key: "videoReady" | "videoFailed" | "videoFailedRefunded" | "layersReady";
  params?: Record<string, string | number>;
};

type Notification = {
  message: PushMessage;
  // Deep link, so tapping the notification opens the generation rather than
  // dumping the person on the home screen to find it themselves.
  path: string;
};

function resolvePushText(
  message: PushMessage,
  locale: string | null | undefined,
): { title: string; body: string } {
  const t = getMessages(isLocale(locale) ? locale : DEFAULT_LOCALE).push;
  const params = message.params ?? {};
  switch (message.key) {
    case "videoReady":
      return { title: t.videoReadyTitle, body: t.videoReadyBody };
    case "videoFailed":
      return { title: t.videoFailedTitle, body: t.videoFailedBody };
    case "videoFailedRefunded":
      return { title: t.videoFailedTitle, body: t.videoFailedRefundedBody };
    case "layersReady":
      return { title: t.layersReadyTitle, body: formatMsg(t.layersReadyBody, params) };
  }
}

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

export async function notifyUser(userId: string, notification: Notification): Promise<void> {
  const projectId = process.env.FCM_PROJECT_ID;
  const token = await accessToken();
  // Not configured yet — see MOBILE_APP.md. Silent, because the web app runs
  // perfectly well without push and this is called on every completion.
  if (!projectId || !token) return;

  const admin = createAdminClient();
  const { data: devices } = await admin
    .from("push_tokens")
    .select("token, locale")
    .eq("user_id", userId)
    .limit(10);

  if (!devices?.length) return;

  await Promise.all(
    devices.map(async (device) => {
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
  );
}
