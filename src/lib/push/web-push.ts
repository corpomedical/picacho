import { createAdminClient } from "@/lib/supabase/server";
import { encryptWebPush, loadVapidKeys, vapidAuthHeader } from "@/lib/push/web-push-crypto";

// Web Push (RFC 8030) to the ADMIN devices registered by the picacho-admin
// PWA — payments, signups, failures and problem reports, delivered even when
// the console is closed. The protocol work (RFC 8291 encryption, RFC 8292
// VAPID) lives in web-push-crypto.ts, verified against RFC 8291 §5's
// complete test vector by scripts/test-web-push-vector.mjs.
//
// Deliberately fails silently, exactly like send.ts's notifyUser: every call
// site is a money- or signup-critical path (Stripe webhook, signup action,
// report insert) where a notification hiccup must never break the real work.
//
// Env: VAPID_PUBLIC_KEY (65-byte uncompressed P-256 point, base64url),
// VAPID_PRIVATE_KEY (32-byte scalar, base64url), optional VAPID_SUBJECT.
// The public key is also baked into picacho-admin/config.js — the pair must
// match or push services reject the send.

const TTL_SECONDS = 24 * 3600;

type AdminPushMessage = {
  title: string;
  body: string;
  // Where the admin PWA should land when the notification is tapped —
  // a hash route inside the console ("#money", "#content").
  path?: string;
};

export async function notifyAdmins(message: AdminPushMessage): Promise<void> {
  try {
    const keys = loadVapidKeys(process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    // Not configured yet — silent, same contract as notifyUser.
    if (!keys) return;
    const subject = process.env.VAPID_SUBJECT || "mailto:hello@picacho.ai";

    const admin = createAdminClient();
    const { data: devices } = await admin
      .from("admin_push_subscriptions")
      .select("endpoint, p256dh, auth")
      .limit(20);
    if (!devices?.length) return;

    const payload = Buffer.from(
      JSON.stringify({ title: message.title, body: message.body, path: message.path ?? "" }),
    );

    await Promise.all(
      devices.map(async (device) => {
        try {
          const body = encryptWebPush(device.p256dh, device.auth, payload);
          const res = await fetch(device.endpoint, {
            method: "POST",
            headers: {
              authorization: vapidAuthHeader(new URL(device.endpoint).origin, keys, subject),
              "content-encoding": "aes128gcm",
              "content-type": "application/octet-stream",
              ttl: String(TTL_SECONDS),
              urgency: "high",
            },
            body: new Uint8Array(body),
            signal: AbortSignal.timeout(10_000),
          });

          if (res.status === 404 || res.status === 410) {
            // Device unsubscribed or the subscription rotated — prune, or the
            // push service eventually throttles us for hammering dead endpoints.
            await admin.from("admin_push_subscriptions").delete().eq("endpoint", device.endpoint);
          } else if (res.ok) {
            await admin
              .from("admin_push_subscriptions")
              .update({ last_used_at: new Date().toISOString() })
              .eq("endpoint", device.endpoint);
          }
        } catch {
          // One device failing must not stop the others.
        }
      }),
    );
  } catch {
    // Never let a notification problem surface into the calling path.
  }
}
