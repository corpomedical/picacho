import { describe, expect, it } from "vitest";
import { isCurrentSetThumb, setThumbPath } from "./set-config";

// A set's card is taken again when it predates the set's current lift
// (exposure.ts): the path carries the version, and any other path is stale.

describe("set thumbnails", () => {
  const user = "11111111-1111-4111-8111-111111111111";
  const set = "22222222-2222-4222-8222-222222222222";

  it("keeps a card taken at the current version", () => {
    expect(isCurrentSetThumb(setThumbPath(user, set), user, set)).toBe(true);
  });

  it("retakes a card from before the lift, one lifted by exposure alone, and a missing one", () => {
    expect(isCurrentSetThumb(`${user}/sets/${set}.jpg`, user, set)).toBe(false);
    expect(isCurrentSetThumb(`${user}/sets/${set}.v2.jpg`, user, set)).toBe(false);
    expect(isCurrentSetThumb(null, user, set)).toBe(false);
    expect(isCurrentSetThumb(undefined, user, set)).toBe(false);
  });

  it("stays under the person's own sets folder, which deletion sweeps", () => {
    expect(setThumbPath(user, set).startsWith(`${user}/sets/`)).toBe(true);
  });
});
