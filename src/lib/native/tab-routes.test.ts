import { describe, expect, it } from "vitest";
import { nativeTabFor, NATIVE_TAB_HREF, GENERATE_VIDEO_HREF, RECAST_HREF } from "./tab-routes";

describe("the app bar's lit tab", () => {
  it("lights each tab on its own page and the pages below it", () => {
    expect(nativeTabFor("/app/character")).toBe("characters");
    expect(nativeTabFor("/app/character/new")).toBe("characters");
    expect(nativeTabFor("/app/media")).toBe("media");
    expect(nativeTabFor("/app/community")).toBe("community");
    expect(nativeTabFor("/app/more")).toBe("more");
    expect(nativeTabFor("/app/generate")).toBe("generate");
  });

  it("lights Home on the dashboard alone", () => {
    expect(nativeTabFor("/app")).toBe("home");
    expect(nativeTabFor("/app/")).toBe("home");
  });

  it("keeps Media lit on the image and video pages", () => {
    expect(nativeTabFor("/app/images")).toBe("media");
    expect(nativeTabFor("/app/videos")).toBe("media");
  });

  it("keeps History lit on a take, and on the Angle Stage opened from one", () => {
    expect(nativeTabFor("/app/history")).toBe("history");
    expect(nativeTabFor("/app/history/3f0c")).toBe("history");
    expect(nativeTabFor("/app/stage/abc")).toBe("history");
  });

  it("keeps the lamp lit on Recast, one of its two choices", () => {
    expect(nativeTabFor(RECAST_HREF)).toBe("generate");
    expect(nativeTabFor(GENERATE_VIDEO_HREF)).toBe("generate");
  });

  it("keeps More lit on everything the bar has no room for", () => {
    for (const p of ["/app/settings", "/app/templates", "/app/upscale", "/app/layers", "/app/projects/9", "/app/notes", "/app/tutorial", "/app/sets/abc"]) {
      expect(nativeTabFor(p)).toBe("more");
    }
  });

  it("matches whole path segments only", () => {
    expect(nativeTabFor("/app/characterx")).toBeNull();
    expect(nativeTabFor("/app/generated")).toBeNull();
    expect(nativeTabFor("/")).toBeNull();
    expect(nativeTabFor(null)).toBeNull();
  });

  it("links every plain tab to a page it lights", () => {
    for (const [tab, href] of Object.entries(NATIVE_TAB_HREF)) {
      expect(nativeTabFor(href)).toBe(tab);
    }
  });
});
