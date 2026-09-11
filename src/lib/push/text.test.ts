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
