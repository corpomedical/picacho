import { describe, expect, it } from "vitest";
import {
  ANOTHER_SHOT_SUFFIX,
  buildAnotherShotPrompt,
  trimUnfilledAnotherShotScaffold,
  isAnotherShotEligible,
} from "./another-shot";
import { isRenderableUrl } from "../media/url";

// Incident-replay style, same as send-plan.test.ts: each case pins a way
// this prefill could lie or misfire. The operator's bar for this feature
// was explicit ("it must work 1000% no mistakes"), so every deterministic
// piece is pinned here.

describe("buildAnotherShotPrompt", () => {
  it("appends the scaffold to the original prompt", () => {
    expect(buildAnotherShotPrompt("Eva walks through the corridor")).toBe(
      "Eva walks through the corridor" + ANOTHER_SHOT_SUFFIX,
    );
  });

  it("trims whitespace from the original before appending", () => {
    expect(buildAnotherShotPrompt("  Eva at the cafe \n")).toBe(
      "Eva at the cafe" + ANOTHER_SHOT_SUFFIX,
    );
  });

  it("with an empty original, starts directly at the scaffold (no leading blank lines)", () => {
    const built = buildAnotherShotPrompt("");
    expect(built).toBe(ANOTHER_SHOT_SUFFIX.trimStart());
    expect(built.startsWith("\n")).toBe(false);
  });
});

describe("trimUnfilledAnotherShotScaffold", () => {
  it("removes an untouched scaffold so the model never sees a dangling question", () => {
    const built = buildAnotherShotPrompt("Eva walks through the corridor");
    expect(trimUnfilledAnotherShotScaffold(built)).toBe("Eva walks through the corridor");
  });

  it("removes it even with stray trailing whitespace after the colon", () => {
    const built = buildAnotherShotPrompt("Eva at the cafe") + "   \n ";
    expect(trimUnfilledAnotherShotScaffold(built)).toBe("Eva at the cafe");
  });

  it("keeps a filled-in scaffold byte-for-byte", () => {
    const filled = buildAnotherShotPrompt("Eva at the cafe") + "low angle from behind her";
    expect(trimUnfilledAnotherShotScaffold(filled)).toBe(filled);
  });

  it("leaves ordinary prompts untouched", () => {
    expect(trimUnfilledAnotherShotScaffold("A dog on the beach")).toBe("A dog on the beach");
    expect(trimUnfilledAnotherShotScaffold("")).toBe("");
  });

  it("an unfilled scaffold over an empty original trims to empty (submit guard then blocks the send)", () => {
    expect(trimUnfilledAnotherShotScaffold(buildAnotherShotPrompt(""))).toBe("");
  });
});

describe("isAnotherShotEligible", () => {
  const eligible = {
    content_type: "image",
    status: "succeeded",
    result_url: "/api/media/generated-images/u/x.png?v=abc",
  };

  it("accepts a finished image with a media-route result", () => {
    expect(isAnotherShotEligible(eligible)).toBe(true);
  });

  it("accepts an absolute http result (older rows)", () => {
    expect(isAnotherShotEligible({ ...eligible, result_url: "https://x.supabase.co/f.png" })).toBe(true);
  });

  it("rejects videos — Continue this clip owns that surface", () => {
    expect(isAnotherShotEligible({ ...eligible, content_type: "video" })).toBe(false);
  });

  it("rejects unfinished or failed generations", () => {
    expect(isAnotherShotEligible({ ...eligible, status: "failed" })).toBe(false);
    expect(isAnotherShotEligible({ ...eligible, status: "drafted" })).toBe(false);
  });

  it("rejects rows with nothing renderable", () => {
    expect(isAnotherShotEligible({ ...eligible, result_url: null })).toBe(false);
    expect(isAnotherShotEligible({ ...eligible, result_url: "data:image/png;base64,x" })).toBe(false);
  });

  it("matches isRenderableUrl's verdict (the server-only original it mirrors)", () => {
    for (const url of [
      "/api/media/generated-images/u/x.png?v=abc",
      "https://x.supabase.co/f.png",
      "http://old.example/f.png",
      "data:image/png;base64,x",
      "",
      null,
    ]) {
      expect(isAnotherShotEligible({ content_type: "image", status: "succeeded", result_url: url })).toBe(
        Boolean(isRenderableUrl(url)),
      );
    }
  });
});
