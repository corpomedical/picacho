import { describe, expect, it } from "vitest";
import { STUDIO_RECIPES, STUDIO_VARIATIONS, getStudioRecipe } from "./recipes";

// Structural pins, same contract as cinema-presets and templates: recipe
// QUALITY is proven by each card's validation render (public/studio/); the
// tests pin what must never drift silently — ids, thumbnails on disk, the
// reference contract, and prompts that actually instruct the model about
// the attached image (the neutral reference lane's whole deal).

describe("studio recipes", () => {
  it("ids are unique and kebab-case", () => {
    const ids = STUDIO_RECIPES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("every recipe card has its validation render checked in", async () => {
    const fs = await import("node:fs");
    for (const r of STUDIO_RECIPES) {
      expect(fs.existsSync(`public/studio/${r.id}.jpg`), `missing proof for ${r.id}`).toBe(true);
    }
  });

  it("every prompt tells the model how to use the attached image", () => {
    for (const r of STUDIO_RECIPES) {
      const p = r.prompt("Aterra Bottle");
      expect(p).toContain("Aterra Bottle");
      expect(/attached (photo|image)/.test(p), `${r.id} must reference the attachment`).toBe(true);
      expect(/exactly/.test(p), `${r.id} must pin fidelity`).toBe(true);
    }
  });

  it("character recipes and product-only recipes both exist", () => {
    expect(STUDIO_RECIPES.some((r) => r.needsCharacter)).toBe(true);
    expect(STUDIO_RECIPES.some((r) => !r.needsCharacter)).toBe(true);
  });

  it("the contact sheet is four takes, first one unmodified", () => {
    expect(STUDIO_VARIATIONS).toHaveLength(4);
    expect(STUDIO_VARIATIONS[0]).toBe("");
    expect(getStudioRecipe("product-hero")?.reference).toBe("product");
    expect(getStudioRecipe("logo-apparel")?.reference).toBe("logo");
    expect(getStudioRecipe("nonsense")).toBeNull();
  });
});
