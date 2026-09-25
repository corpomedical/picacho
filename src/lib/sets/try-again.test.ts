import { describe, expect, it } from "vitest";
import { SET_BUILD_FAILED, SET_BUILD_FAILED_RETRY, SET_BUILD_LOST, SET_BUILD_REFUSED, SET_PHOTO_BUILD_FAILED } from "./messages";
import { SET_RESERVED_BRIEF } from "./set-config";
import { tryAgainWords } from "./try-again";

// Which failed builds get "Try again" (Helios Cut 3, step 5): a build from
// words that the same words can build again.

const failed = (over: Partial<Parameters<typeof tryAgainWords>[0]> = {}) => ({
  status: "failed" as const,
  fromPhoto: false,
  brief: "A rainy market street at night with one noodle stall",
  failure: SET_BUILD_FAILED as string | null,
  ...over,
});

describe("tryAgainWords", () => {
  it("gives a failed build from words its words back", () => {
    for (const failure of [SET_BUILD_FAILED, SET_BUILD_FAILED_RETRY, SET_BUILD_LOST, null]) {
      expect(tryAgainWords(failed({ failure })), String(failure)).toBe("A rainy market street at night with one noodle stall");
    }
    expect(tryAgainWords(failed({ brief: "  a beach at dawn  " }))).toBe("a beach at dawn");
  });

  it("never offers it for a refusal: the same words would be refused again", () => {
    expect(tryAgainWords(failed({ failure: SET_BUILD_REFUSED }))).toBeNull();
  });

  it("never for a photo build, or a set with no words of its own", () => {
    expect(tryAgainWords(failed({ fromPhoto: true, failure: SET_PHOTO_BUILD_FAILED }))).toBeNull();
    expect(tryAgainWords(failed({ fromPhoto: true, brief: "night, lamps on" }))).toBeNull();
    expect(tryAgainWords(failed({ brief: SET_RESERVED_BRIEF }))).toBeNull();
    expect(tryAgainWords(failed({ brief: "" }))).toBeNull();
    expect(tryAgainWords(failed({ brief: "   " }))).toBeNull();
  });

  it("never for a set that did not fail", () => {
    expect(tryAgainWords(failed({ status: "ready" as never, failure: null }))).toBeNull();
    expect(tryAgainWords(failed({ status: "building" as never, failure: null }))).toBeNull();
  });
});
