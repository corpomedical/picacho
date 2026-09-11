import { describe, expect, it } from "vitest";
import { hasSavedOutfit, lookStoragePath } from "./look";

// A shot's look reference must be a finished picture in the person's own
// folder — the only check on what a still's row points at.

describe("lookStoragePath", () => {
  const user = "a3102bc1-2355-444a-8ade-caafd7980218";

  it("reads the path of the person's own finished picture", () => {
    expect(lookStoragePath(`/api/media/generated-images/${user}/abc-123.png?v=sig`, user)).toBe(`${user}/abc-123.png`);
    expect(lookStoragePath(`/api/media/generated-images/${user}/a%20b.png`, user)).toBe(`${user}/a b.png`);
  });

  it("refuses anyone else's folder, other buckets and anything that walks out of the folder", () => {
    expect(lookStoragePath(`/api/media/generated-images/someone-else/abc.png?v=x`, user)).toBeNull();
    expect(lookStoragePath(`/api/media/chat-attachments/${user}/frame.jpg?v=x`, user)).toBeNull();
    expect(lookStoragePath(`/api/media/generated-images/${user}/../other/abc.png`, user)).toBeNull();
    expect(lookStoragePath(`/api/media/generated-images/${user}/%2E%2E/other/abc.png`, user)).toBeNull();
    expect(lookStoragePath(`/api/media/generated-images/${user}//abc.png`, user)).toBeNull();
    expect(lookStoragePath(`https://example.com/api/media/generated-images/${user}/abc.png`, user)).toBeNull();
  });

  it("knows when a character's saved outfit rides, by the rule runGeneration uses", () => {
    expect(hasSavedOutfit([`${user}/outfit.png`], user)).toBe(true);
    expect(hasSavedOutfit(["someone-else/outfit.png"], user)).toBe(false);
    expect(hasSavedOutfit([], user)).toBe(false);
    expect(hasSavedOutfit(null, user)).toBe(false);
    expect(hasSavedOutfit([`${user}/outfit.png`], "")).toBe(false);
  });

  it("refuses what is not a picture URL at all", () => {
    expect(lookStoragePath(null, user)).toBeNull();
    expect(lookStoragePath(42, user)).toBeNull();
    expect(lookStoragePath(`/api/media/generated-images/${user}/abc.png`, "")).toBeNull();
    expect(lookStoragePath(`/api/media/generated-images/${user}/%E0%A4%A.png`, user)).toBeNull();
  });
});
