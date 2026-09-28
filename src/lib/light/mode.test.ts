import { describe, expect, it } from "vitest";
import { firstName, lookToApply, resolveAppMode, shellRedirect } from "./mode";

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
});
