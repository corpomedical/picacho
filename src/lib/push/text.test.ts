import { describe, expect, it } from "vitest";
import { resolvePushText } from "./text";
import { PREF_FOR_KEY } from "./prefs";
import type { PushMessage } from "./send";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import it_ from "../i18n/messages/it";

// What a push says, per device language (2026-09-11: the set finisher's two
// messages joined the render ones).

const LANGS = [
  ["en", en],
  ["es", es],
  ["pt", pt],
  ["it", it_],
] as const;

describe("a finished set's notification", () => {
  it("names the set and says where to tap, in every language", () => {
    expect(resolvePushText({ key: "setReady", params: { title: "Night market" } }, "en")).toEqual({
      title: "Your set is ready",
      body: "Night market — tap to open it.",
    });
    for (const [loc, t] of LANGS) {
      const r = resolvePushText({ key: "setReady", params: { title: "Night market" } }, loc);
      expect(r.title, loc).toBe(t.push.setReadyTitle);
      expect(r.body, loc).toContain("Night market");
      expect(r.body, loc).not.toContain("{title}");
    }
  });

  it("without a title still says it is ready, with no gap where the name would go", () => {
    for (const [loc, t] of LANGS) {
      for (const message of [{ key: "setReady" }, { key: "setReady", params: { title: "   " } }] as PushMessage[]) {
        expect(resolvePushText(message, loc), loc).toEqual({ title: t.push.setReadyTitle, body: t.push.setReadyBodyUntitled });
      }
      expect(t.push.setReadyBodyUntitled, loc).not.toMatch(/^\s*[—-]|\{title\}/);
    }
  });

  it("a failed one says the build is back in the allowance — true, because failed builds are not counted", () => {
    expect(resolvePushText({ key: "setFailed" }, "en")).toEqual({
      title: "Your set couldn't be built",
      body: "Tap to see what happened. The build is back in your allowance.",
    });
  });

  it("is translated, not copied from English, and every set body keeps its {title} slot", () => {
    const keys = ["setReadyTitle", "setReadyBody", "setReadyBodyUntitled", "setFailedTitle", "setFailedBody"] as const;
    for (const [loc, t] of LANGS) {
      for (const k of keys) expect(t.push[k].trim().length, `${loc} push.${k}`).toBeGreaterThan(0);
      expect(t.push.setReadyBody, loc).toContain("{title}");
      if (loc !== "en") for (const k of keys) expect(t.push[k], `${loc} push.${k}`).not.toBe(en.push[k]);
    }
  });

  it("falls back to English for a device with no locale it can read", () => {
    for (const locale of [null, undefined, "", "fr"]) {
      expect(resolvePushText({ key: "setFailed" }, locale)).toEqual(resolvePushText({ key: "setFailed" }, "en"));
    }
  });
});

describe("every push key", () => {
  it("resolves to a title and a body in every language", () => {
    for (const key of Object.keys(PREF_FOR_KEY) as PushMessage["key"][]) {
      for (const [loc] of LANGS) {
        const r = resolvePushText({ key, params: { n: 3, title: "Night market" } }, loc);
        expect(r.title.trim().length, `${loc} ${key}`).toBeGreaterThan(0);
        expect(r.body.trim().length, `${loc} ${key}`).toBeGreaterThan(0);
        expect(`${r.title} ${r.body}`, `${loc} ${key}`).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it("leaves the render messages exactly as they were", () => {
    expect(resolvePushText({ key: "videoReady" }, "en")).toEqual({ title: "Your video is ready", body: "Tap to watch it." });
    expect(resolvePushText({ key: "videoFailedRefunded" }, "en")).toEqual({
      title: "That generation did not finish",
      body: "Tap to see what happened — the credits it used were released.",
    });
    expect(resolvePushText({ key: "layersReady", params: { n: 4 } }, "en").body).toBe("4 layers — tap to open the stack.");
    expect(resolvePushText({ key: "lowCredits", params: { n: 1 } }, "en").body).toBe("1 credit left.");
    expect(resolvePushText({ key: "lowCredits", params: { n: 3 } }, "es").body).toBe("Te quedan 3 créditos.");
  });
});

describe("Press Tour's notifications (2026-09-26)", () => {
  it("says the ad is ready, or that it couldn't be finished, in the device's language", () => {
    expect(resolvePushText({ key: "adReady" }, "en")).toEqual({ title: "Your ad is ready", body: "Tap to watch it and save it." });
    // "What came back" only when something did (PT-R3-04): adFailed promises nothing, adFailedRefunded says it.
    expect(resolvePushText({ key: "adFailed" }, "en")).toEqual({ title: "Your ad couldn't be finished", body: "Tap to see what happened." });
    expect(resolvePushText({ key: "adFailedRefunded" }, "en")).toEqual({ title: "Your ad couldn't be finished", body: "Tap to see what happened and what came back." });
    for (const [loc, t] of LANGS) {
      expect(resolvePushText({ key: "adReady" }, loc), loc).toEqual({ title: t.push.adReadyTitle, body: t.push.adReadyBody });
      expect(resolvePushText({ key: "adFailed" }, loc), loc).toEqual({ title: t.push.adFailedTitle, body: t.push.adFailedBody });
      expect(resolvePushText({ key: "adFailedRefunded" }, loc), loc).toEqual({ title: t.push.adFailedTitle, body: t.push.adFailedRefundedBody });
      expect(t.push.adFailedBody, loc).not.toBe(t.push.adFailedRefundedBody);
    }
  });

  it("names the network a post went to, keeps its name as it is, and still reads without one", () => {
    for (const [loc] of LANGS) {
      for (const key of ["postPublished", "postFailed", "reconnectNeeded"] as const) {
        const named = resolvePushText({ key, params: { network: "TikTok" } }, loc);
        expect(named.body, `${loc} ${key}`).toContain("TikTok");
        expect(named.body, `${loc} ${key}`).not.toContain("{network}");
        const bare = resolvePushText({ key }, loc);
        expect(bare.body, `${loc} ${key}`).not.toContain("{network}");
        expect(bare.body.trim().length, `${loc} ${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("is translated, not copied from English, and matches the engine's English", async () => {
    const { AD_READY_PUSH, AD_FAILED_PUSH, AD_FAILED_REFUNDED_PUSH } = await import("../press-tour/film-messages");
    expect({ title: en.push.adReadyTitle, body: en.push.adReadyBody }).toEqual(AD_READY_PUSH);
    expect({ title: en.push.adFailedTitle, body: en.push.adFailedBody }).toEqual(AD_FAILED_PUSH);
    expect({ title: en.push.adFailedTitle, body: en.push.adFailedRefundedBody }).toEqual(AD_FAILED_REFUNDED_PUSH);
    const keys = [
      "adReadyTitle",
      "adReadyBody",
      "adFailedTitle",
      "adFailedBody",
      "adFailedRefundedBody",
      "postPublishedTitle",
      "postPublishedBody",
      "postPublishedBodyAny",
      "postFailedTitle",
      "postFailedBody",
      "postFailedBodyAny",
      "reconnectNeededTitle",
      "reconnectNeededBody",
      "reconnectNeededBodyAny",
    ] as const;
    for (const [loc, t] of LANGS) {
      for (const k of keys) {
        expect(t.push[k].trim().length, `${loc} push.${k}`).toBeGreaterThan(0);
        if (loc !== "en") expect(t.push[k], `${loc} push.${k}`).not.toBe(en.push[k]);
      }
    }
  });
});
