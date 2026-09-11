import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pushChannels } from "./channels";

// Which devices a push reaches (2026-09-11): browsers always, the phone app
// unless the message is web-only — Sets, while they are on the web only.

describe("pushChannels", () => {
  it("reaches browsers and the phone app by default, exactly as before", () => {
    expect(pushChannels()).toEqual({ web: true, fcm: true });
    expect(pushChannels({})).toEqual({ web: true, fcm: true });
    expect(pushChannels({ webOnly: false })).toEqual({ web: true, fcm: true });
  });

  it("keeps a web-only message off the phone app, and still on browsers", () => {
    expect(pushChannels({ webOnly: true })).toEqual({ web: true, fcm: false });
  });
});

describe("notifyUser follows it (send.ts, read as source: it cannot load here)", () => {
  const send = readFileSync(join(__dirname, "send.ts"), "utf8");
  const body = send.slice(send.indexOf("export async function notifyUser("));

  it("asks the person's switches first, then the channels, and stops before the phone fan-out", () => {
    const prefs = body.indexOf("allowedByPrefs(admin, userId, notification.message.key)");
    const decide = body.indexOf("const channels = pushChannels(options);");
    const web = body.indexOf("if (channels.web) await notifyWebDevices(admin, userId, notification);");
    const stop = body.indexOf("if (!channels.fcm) return;");
    const fcm = body.indexOf("process.env.FCM_PROJECT_ID");
    for (const [name, at] of Object.entries({ prefs, decide, web, stop, fcm })) expect(at, name).toBeGreaterThan(-1);
    expect(prefs).toBeLessThan(decide);
    expect(decide).toBeLessThan(web);
    expect(web).toBeLessThan(stop);
    expect(stop).toBeLessThan(fcm);
  });

  it("keeps every existing caller's call as it was: the options are optional", () => {
    expect(body).toMatch(/options: NotifyOptions = \{\}/);
  });
});
