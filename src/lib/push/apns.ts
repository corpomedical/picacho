import { createSign } from "node:crypto";
import { connect } from "node:http2";

// Push to the iPhone app, straight to Apple (2026-09-30).
//
// The Android app's tokens go through Firebase Cloud Messaging (send.ts).
// The iPhone app registers a different kind of token: @capacitor/push-
// notifications hands the page Apple's own device token (64 hex characters),
// which FCM cannot address without the Firebase SDK inside the app. Rather
// than ship Google's SDK in the iPhone binary, the server speaks to Apple's
// push service (APNs) itself: one signed request per device, over HTTP/2,
// which is the only protocol APNs accepts.
//
// Configured by three Vercel variables, from Apple Developer → Keys → "+"
// with Apple Push Notifications service ticked (IOS_APP.md walks it):
//   APNS_KEY_ID       the key's 10-character ID
//   APNS_TEAM_ID      the team's 10-character ID (Membership details)
//   APNS_PRIVATE_KEY  the whole .p8 file, BEGIN/END lines included
// and optionally APNS_TOPIC, the app's bundle ID (ai.picacho.app). Without
// them nothing is sent and nothing fails, exactly like FCM without its keys.
//
// Alias-free and pure where it can be (the vitest "@/" gotcha, channels.ts),
// so apns.test.ts can load it.

export const APNS_PRODUCTION_HOST = "api.push.apple.com";
export const APNS_SANDBOX_HOST = "api.sandbox.push.apple.com";

export type ApnsConfig = { keyId: string; teamId: string; privateKey: string; topic: string };

export function apnsConfig(env: Record<string, string | undefined> = process.env): ApnsConfig | null {
  const keyId = env.APNS_KEY_ID?.trim();
  const teamId = env.APNS_TEAM_ID?.trim();
  // Pasted into Vercel whole, or on one line with literal \n between lines.
  const privateKey = env.APNS_PRIVATE_KEY?.trim().replace(/\\n/g, "\n");
  if (!keyId || !teamId || !privateKey) return null;
  return { keyId, teamId, privateKey, topic: env.APNS_TOPIC?.trim() || "ai.picacho.app" };
}

// Which push_tokens rows are the iPhone app's. The platform column says so
// (native-push.tsx), and the token has to look like Apple's — hex, no
// colons — so an Android FCM token can never be sent here by a mislabelled
// row, whatever the column says.
export function isApnsDevice(platform: unknown, token: unknown): boolean {
  return platform === "ios" && typeof token === "string" && /^[0-9a-f]{64,200}$/i.test(token);
}

// The provider token: a JWT signed ES256 with the .p8 key. Apple accepts one
// for an hour and answers TooManyProviderTokenUpdates to a server that makes
// a new one more often than every 20 minutes, so it is kept for 50.
let cachedToken: { value: string; madeAt: number; keyId: string } | null = null;

export function providerToken(config: ApnsConfig, now = Date.now()): string {
  if (cachedToken && cachedToken.keyId === config.keyId && now - cachedToken.madeAt < 50 * 60_000) {
    return cachedToken.value;
  }
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${b64({ alg: "ES256", kid: config.keyId })}.${b64({ iss: config.teamId, iat: Math.floor(now / 1000) })}`;
  // JOSE wants the raw r‖s signature, not DER.
  const signature = createSign("SHA256")
    .update(unsigned)
    .sign({ key: config.privateKey, dsaEncoding: "ieee-p1363" })
    .toString("base64url");
  const value = `${unsigned}.${signature}`;
  cachedToken = { value, madeAt: now, keyId: config.keyId };
  return value;
}

// What the phone shows, and the path the app opens on a tap. The path rides
// beside "aps", where @capacitor/push-notifications hands it to the page as
// notification.data.path — the same place FCM's data.path arrives on
// Android, so native-push.tsx routes both the same way.
export function apnsPayload(title: string, body: string, path: string): string {
  return JSON.stringify({ aps: { alert: { title, body }, sound: "default" }, path });
}

export type ApnsAnswer = { status: number; reason?: string };
export type ApnsSend = (host: string, deviceToken: string, payload: string, config: ApnsConfig) => Promise<ApnsAnswer>;

// One request over HTTP/2. Never throws: a network failure is status 0.
export const sendToApns: ApnsSend = (host, deviceToken, payload, config) =>
  new Promise((resolve) => {
    let authorization: string;
    try {
      authorization = `bearer ${providerToken(config)}`;
    } catch {
      // A key that doesn't parse (a truncated paste into Vercel).
      resolve({ status: 0, reason: "key" });
      return;
    }
    const client = connect(`https://${host}`);
    const timer = setTimeout(() => {
      client.destroy();
      finish({ status: 0, reason: "timeout" });
    }, 10_000);
    let settled = false;
    function finish(answer: ApnsAnswer) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.close();
      resolve(answer);
    }
    client.on("error", () => finish({ status: 0, reason: "connection" }));
    const request = client.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      authorization,
      "apns-topic": config.topic,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    });
    let status = 0;
    let body = "";
    request.on("response", (headers) => {
      status = Number(headers[":status"]) || 0;
    });
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      let reason: string | undefined;
      try {
        reason = body ? (JSON.parse(body) as { reason?: string }).reason : undefined;
      } catch {
        // not JSON; the status says enough
      }
      finish({ status, reason });
    });
    request.on("error", () => finish({ status: 0, reason: "request" }));
    request.end(payload);
  });

// Where a token is valid depends on how the app was signed: a build run from
// Xcode registers with Apple's sandbox, TestFlight and the App Store with
// production. Nothing on the phone tells the page which, so production is
// tried first and a BadDeviceToken there tries the sandbox.
//
// "gone": Apple says the token is dead (410: the app was deleted or
// notifications turned off for good; or bad on both hosts) — the caller
// deletes the row. "failed": anything else, kept for next time.
export async function deliverToIphone(
  deviceToken: string,
  payload: string,
  config: ApnsConfig,
  send: ApnsSend = sendToApns,
): Promise<"sent" | "gone" | "failed"> {
  const production = await send(APNS_PRODUCTION_HOST, deviceToken, payload, config);
  if (production.status === 200) return "sent";
  if (production.status === 410) return "gone";
  if (production.status !== 400 || production.reason !== "BadDeviceToken") return "failed";

  const sandbox = await send(APNS_SANDBOX_HOST, deviceToken, payload, config);
  if (sandbox.status === 200) return "sent";
  if (sandbox.status === 410 || (sandbox.status === 400 && sandbox.reason === "BadDeviceToken")) return "gone";
  return "failed";
}
