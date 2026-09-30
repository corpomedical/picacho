import { describe, expect, it } from "vitest";
import { createVerify, generateKeyPairSync } from "node:crypto";
import {
  APNS_PRODUCTION_HOST,
  APNS_SANDBOX_HOST,
  apnsConfig,
  apnsPayload,
  deliverToIphone,
  isApnsDevice,
  providerToken,
  type ApnsAnswer,
  type ApnsConfig,
} from "./apns";

// Push to the iPhone app, straight to Apple (2026-09-30): which rows are the
// iPhone's, the signed provider token, the payload the app routes a tap
// from, and which host a token belongs to.

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const config: ApnsConfig = { keyId: "ABC123DEFG", teamId: "TEAM123456", privateKey: pem, topic: "ai.picacho.app" };
const APPLE_TOKEN = "a".repeat(32) + "0123456789abcdef0123456789ABCDEF";
const FCM_TOKEN = "dGVzdA:APA91bH-example_token-with.colons-and_underscores0123456789";

function decode(part: string) {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

describe("apnsConfig", () => {
  it("is off until all three values are set", () => {
    expect(apnsConfig({})).toBeNull();
    expect(apnsConfig({ APNS_KEY_ID: "K", APNS_TEAM_ID: "T" })).toBeNull();
    expect(apnsConfig({ APNS_KEY_ID: "K", APNS_PRIVATE_KEY: "P" })).toBeNull();
    expect(apnsConfig({ APNS_KEY_ID: " ", APNS_TEAM_ID: "T", APNS_PRIVATE_KEY: "P" })).toBeNull();
  });

  it("takes the .p8 pasted whole or with literal \\n, and defaults the topic to the app", () => {
    const oneLine = pem.trim().replace(/\n/g, "\\n");
    const parsed = apnsConfig({ APNS_KEY_ID: " ABC123DEFG ", APNS_TEAM_ID: "TEAM123456", APNS_PRIVATE_KEY: oneLine });
    expect(parsed).toEqual({ ...config, privateKey: pem.trim() });
    expect(apnsConfig({ APNS_KEY_ID: "K", APNS_TEAM_ID: "T", APNS_PRIVATE_KEY: pem, APNS_TOPIC: "x.y" })?.topic).toBe("x.y");
  });
});

describe("isApnsDevice", () => {
  it("is the iPhone app's row with an Apple token", () => {
    expect(isApnsDevice("ios", APPLE_TOKEN)).toBe(true);
  });

  it("never sends an FCM token to Apple, whatever the row says", () => {
    expect(isApnsDevice("android", FCM_TOKEN)).toBe(false);
    expect(isApnsDevice("ios", FCM_TOKEN)).toBe(false);
    expect(isApnsDevice("android", APPLE_TOKEN)).toBe(false);
    expect(isApnsDevice(null, APPLE_TOKEN)).toBe(false);
    expect(isApnsDevice("ios", null)).toBe(false);
    expect(isApnsDevice("ios", "abc")).toBe(false);
  });
});

describe("providerToken", () => {
  it("is an ES256 JWT with the key id and team that Apple can verify", () => {
    const now = Date.UTC(2026, 8, 30, 12);
    const jwt = providerToken(config, now);
    const [header, claims, signature] = jwt.split(".");
    expect(decode(header)).toEqual({ alg: "ES256", kid: "ABC123DEFG" });
    expect(decode(claims)).toEqual({ iss: "TEAM123456", iat: now / 1000 });
    const ok = createVerify("SHA256")
      .update(`${header}.${claims}`)
      .verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"));
    expect(ok).toBe(true);
    // raw r‖s, as JOSE requires, not DER
    expect(Buffer.from(signature, "base64url")).toHaveLength(64);
  });

  it("is kept for 50 minutes (Apple refuses a new one more often than every 20) and then renewed", () => {
    const start = Date.UTC(2026, 8, 30, 13);
    const first = providerToken(config, start);
    expect(providerToken(config, start + 49 * 60_000)).toBe(first);
    const renewed = providerToken(config, start + 51 * 60_000);
    expect(renewed).not.toBe(first);
    expect(decode(renewed.split(".")[1]).iat).toBe((start + 51 * 60_000) / 1000);
  });
});

describe("apnsPayload", () => {
  it("carries the words in aps.alert and the tap's path beside aps, where the app reads data.path", () => {
    expect(JSON.parse(apnsPayload("Your video is ready", "Tap to watch", "/app/history/123"))).toEqual({
      aps: { alert: { title: "Your video is ready", body: "Tap to watch" }, sound: "default" },
      path: "/app/history/123",
    });
  });
});

describe("deliverToIphone", () => {
  function fake(answers: Record<string, ApnsAnswer>) {
    const hosts: string[] = [];
    const send = async (host: string) => {
      hosts.push(host);
      return answers[host] ?? { status: 0 };
    };
    return { send, hosts };
  }

  it("sends to production first: an App Store or TestFlight build's token", async () => {
    const { send, hosts } = fake({ [APNS_PRODUCTION_HOST]: { status: 200 } });
    expect(await deliverToIphone(APPLE_TOKEN, "{}", config, send)).toBe("sent");
    expect(hosts).toEqual([APNS_PRODUCTION_HOST]);
  });

  it("tries the sandbox when production calls the token bad: a build run from Xcode", async () => {
    const { send, hosts } = fake({
      [APNS_PRODUCTION_HOST]: { status: 400, reason: "BadDeviceToken" },
      [APNS_SANDBOX_HOST]: { status: 200 },
    });
    expect(await deliverToIphone(APPLE_TOKEN, "{}", config, send)).toBe("sent");
    expect(hosts).toEqual([APNS_PRODUCTION_HOST, APNS_SANDBOX_HOST]);
  });

  it("says gone for a deleted app, or a token bad on both hosts, so the row is pruned", async () => {
    expect(await deliverToIphone(APPLE_TOKEN, "{}", config, fake({ [APNS_PRODUCTION_HOST]: { status: 410, reason: "Unregistered" } }).send)).toBe("gone");
    expect(
      await deliverToIphone(
        APPLE_TOKEN,
        "{}",
        config,
        fake({
          [APNS_PRODUCTION_HOST]: { status: 400, reason: "BadDeviceToken" },
          [APNS_SANDBOX_HOST]: { status: 410, reason: "Unregistered" },
        }).send,
      ),
    ).toBe("gone");
    expect(
      await deliverToIphone(
        APPLE_TOKEN,
        "{}",
        config,
        fake({
          [APNS_PRODUCTION_HOST]: { status: 400, reason: "BadDeviceToken" },
          [APNS_SANDBOX_HOST]: { status: 400, reason: "BadDeviceToken" },
        }).send,
      ),
    ).toBe("gone");
  });

  it("keeps the row on anything that is our side or the network, and never asks the sandbox then", async () => {
    for (const answer of [
      { status: 403, reason: "InvalidProviderToken" },
      { status: 400, reason: "DeviceTokenNotForTopic" },
      { status: 429, reason: "TooManyRequests" },
      { status: 500, reason: "InternalServerError" },
      { status: 0, reason: "timeout" },
    ]) {
      const { send, hosts } = fake({ [APNS_PRODUCTION_HOST]: answer });
      expect(await deliverToIphone(APPLE_TOKEN, "{}", config, send), answer.reason).toBe("failed");
      expect(hosts).toEqual([APNS_PRODUCTION_HOST]);
    }
  });
});
