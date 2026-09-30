import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { studioCastInput } from "../../components/studio/studio-cast";

// Photo with your character gets the video window's Outfit and Look (2026-09-30, operator: "Pushed keep going").
// The still pipeline takes the look as its outfit reference — the render lane's "outfit" role, sent as pixels on
// the picture lanes that take extra photos (image-models.ts IMAGE_LANES_THAT_TAKE_EXTRA_PHOTOS) and outranking
// the character's saved outfit photo. A still is priced whole: its quote never counts references.

describe("a look on Photo with your character", () => {
  it("the still takes it as its outfit reference, only after the same ownership check, before anything is paid", () => {
    const src = readFileSync(new URL("./actions.ts", import.meta.url), "utf8");
    const check = src.indexOf("outfitLookPath = await copyStudioLook(access.supabase, { userId, lookId: input.galleryLookId, characterId");
    expect(check).toBeGreaterThan(src.indexOf("if (opts.beforePaid)"));
    expect(check).toBeLessThan(src.indexOf("runGeneration(fd)"));
    expect(src).toContain("if (!outfitLookPath) return { error: STUDIO_LOOK_GONE };");
    expect(src).toContain('...(outfitLookPath ? [{ url: mediaUrl("chat-attachments", outfitLookPath), role: "outfit" as const }] : []),');
  });

  it("the press says what they wear after the person's words, sets the saved outfit photo aside, and names the look", () => {
    const base = { viewFrameUri: "data:image/jpeg;base64,x", characterId: "c1", maxChars: 80, frame: { layout: {} }, pressId: "p" };
    const withWear = studioCastInput({ ...base, words: "She leans on the car, laughing at something off camera.", wear: "The character wears: a red jacket.", galleryLookId: "g1" });
    expect(withWear.direction.endsWith("The character wears: a red jacket.")).toBe(true);
    expect(withWear.direction.length).toBeLessThanOrEqual(80);
    expect(withWear).toMatchObject({ outfit: false, galleryLookId: "g1" });
    const plain = studioCastInput({ ...base, words: "She smiles." });
    expect(plain.direction).toBe("She smiles.");
    expect("outfit" in plain || "galleryLookId" in plain).toBe(false);
  });
});
