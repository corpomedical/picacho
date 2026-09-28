import { describe, expect, it } from "vitest";
import { firstName, lightHref, lookToApply, resolveAppMode, shellRedirect, studioHref } from "./mode";

describe("Picacho Light mode", () => {
  it("keeps everyone in the full studio, unasked, before the SQL runs", () => {
    expect(resolveAppMode({ error: { message: "column profiles.app_mode does not exist" }, mode: undefined })).toEqual({
      mode: "advanced",
      needsChoice: false,
    });
  });

  it("asks only an account that has not chosen", () => {
    expect(resolveAppMode({ error: null, mode: null })).toEqual({ mode: "advanced", needsChoice: true });
    expect(resolveAppMode({ error: null, mode: "advanced" })).toEqual({ mode: "advanced", needsChoice: false });
    expect(resolveAppMode({ error: null, mode: "light" })).toEqual({ mode: "light", needsChoice: false });
  });

  it("sends a new account to the welcome step, but never traps it away from Settings", () => {
    expect(shellRedirect("/app", "advanced", true)).toBe("/app/welcome");
    expect(shellRedirect("/app/generate", "advanced", true)).toBe("/app/welcome");
    expect(shellRedirect("/app/welcome", "advanced", true)).toBeNull();
    expect(shellRedirect("/app/settings", "advanced", true)).toBeNull();
  });

  it("opens the chat for a Light account's /app and leaves the studio alone", () => {
    expect(shellRedirect("/app", "light", false)).toBe("/app/light");
    expect(shellRedirect("/app/settings", "light", false)).toBeNull();
    expect(shellRedirect("/app", "advanced", false)).toBeNull();
  });

  it("greets by first name, or not at all", () => {
    expect(firstName("Ahmad K")).toBe("Ahmad");
    expect(firstName("  ")).toBeNull();
    expect(firstName(null)).toBeNull();
  });

  it("gives a device the account's look, and a changed one once, but never flips it on first sight", () => {
    // Nothing saved on the account: leave every device alone.
    expect(lookToApply(null, null, null)).toBeNull();
    // A device that never picked takes the account's look.
    expect(lookToApply("dark", null, null)).toBe("dark");
    // The first time a device that already picked sees it: remember only.
    expect(lookToApply("dark", "light", null)).toBeNull();
    // Same account look as last time: the device's own pick wins.
    expect(lookToApply("dark", "light", "dark")).toBeNull();
    // An admin (or another device) changed it: it applies once.
    expect(lookToApply("light", "dark", "dark")).toBe("light");
    expect(lookToApply("system", "dark", "light")).toBe("system");
  });

  it("keeps Light's links in Light: the composer and a take's page open in the chat", () => {
    // Aly's prepared send: the same fields, filled into the Light box.
    expect(lightHref("/app/generate?type=image&character=c1&prompt=a+still")).toBe(
      "/app/light?type=image&character=c1&prompt=a+still",
    );
    expect(lightHref("/app/generate")).toBe("/app/light");
    // A gallery tile opens the take in the chat, not the studio's take page.
    expect(lightHref("/app/history/abc-123")).toBe("/app/light?take=abc-123");
    // Everything else is left alone.
    expect(lightHref("/app/settings?tab=preferences")).toBe("/app/settings?tab=preferences");
    expect(lightHref("/app/history")).toBe("/app/history");
    expect(lightHref("https://example.com/x")).toBe("https://example.com/x");
  });

  it("sends a Light account's composer and take links to the chat, unless the link asks for the studio", () => {
    // A notification, an email, a bookmark or Aly's card.
    expect(shellRedirect("/app/generate", "light", false, "?type=video&prompt=a+dog")).toBe("/app/light?type=video&prompt=a+dog");
    expect(shellRedirect("/app/generate", "light", false, "")).toBe("/app/light");
    expect(shellRedirect("/app/history/t1", "light", false, "")).toBe("/app/light?take=t1");
    // "Open in full studio" and the take page's own studio actions.
    expect(shellRedirect("/app/history/t1", "light", false, "?studio=1")).toBeNull();
    expect(shellRedirect("/app/generate", "light", false, "?continue=t1&studio=1")).toBeNull();
    expect(studioHref("/app/history/t1")).toBe("/app/history/t1?studio=1");
    expect(studioHref("/app/generate?continue=t1")).toBe("/app/generate?continue=t1&studio=1");
    // The history list, Settings and the rest stay where they are.
    expect(shellRedirect("/app/history", "light", false, "")).toBeNull();
    expect(shellRedirect("/app/images", "light", false, "")).toBeNull();
    // The studio is never touched.
    expect(shellRedirect("/app/generate", "advanced", false, "?prompt=x")).toBeNull();
    expect(shellRedirect("/app/history/t1", "advanced", false, "")).toBeNull();
  });
});
