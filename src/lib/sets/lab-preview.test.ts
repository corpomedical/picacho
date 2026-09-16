import { describe, expect, it } from "vitest";
import { LAB_PREVIEW_LENS, LAB_PREVIEW_SHADER, LAB_PREVIEW_STOCK, labPreviewCodes } from "./lab-preview";
import { RIG_LENSES, RIG_STOCKS, labLooksOf } from "./rig";

// The stage's preview of the lab: every look the lab makes has one, and it
// draws nothing for the render the model already gives us.

describe("labPreviewCodes", () => {
  it("draws nothing for a clean render, or for a rig that chose neither", () => {
    expect(labPreviewCodes({ stock: null, lens: null })).toEqual({ stock: 0, lens: 0 });
    expect(labPreviewCodes({ stock: "digital", lens: "clean" })).toEqual({ stock: 0, lens: 0 });
  });

  it("names each look the shader draws", () => {
    expect(labPreviewCodes({ stock: "film16", lens: "halation" })).toEqual({ stock: 2, lens: 3 });
    expect(labPreviewCodes({ stock: "homevideo", lens: "anamorphic" })).toEqual({ stock: 3, lens: 1 });
  });

  it("previews exactly what the lab develops, look for look", () => {
    for (const stock of RIG_STOCKS) {
      for (const lens of RIG_LENSES) {
        const looks = labLooksOf({ stock: stock.id, lens: lens.id, palette: null });
        const codes = labPreviewCodes({ stock: stock.id, lens: lens.id });
        expect(codes.stock > 0, `${stock.id} on the stage`).toBe(Boolean(looks?.stock));
        expect(codes.lens > 0, `${lens.id} on the stage`).toBe(Boolean(looks?.lens));
      }
    }
  });

  it("has a number for every stock and lens the rig offers — a new look cannot preview as nothing by accident", () => {
    for (const l of RIG_STOCKS) expect(LAB_PREVIEW_STOCK[l.id], l.id).toBeTypeOf("number");
    for (const l of RIG_LENSES) expect(LAB_PREVIEW_LENS[l.id], l.id).toBeTypeOf("number");
  });
});

describe("the pass itself", () => {
  it("takes the picture, its pixel size and scale, the frame lines and the two looks, and nothing else", () => {
    expect(Object.keys(LAB_PREVIEW_SHADER.uniforms).sort()).toEqual(["tDiffuse", "uFrame", "uLens", "uScale", "uStock", "uTexel"]);
  });

  it("stops at the frame lines: the stage round the picture is left as it is", () => {
    expect(LAB_PREVIEW_SHADER.fragmentShader).toContain("uv.x < uFrame.x");
  });

  it("draws texture, never tone: the lab's lifted blacks and warmth belong to the finished photograph", () => {
    expect(LAB_PREVIEW_SHADER.fragmentShader).not.toContain("tone(");
  });

  it("leaves colour to the palettes: no grade of its own on the whole frame", () => {
    // Silver Print previews as a CSS grade over the canvas (rig.ts); doing it
    // here as well would double the contrast.
    expect(LAB_PREVIEW_SHADER.fragmentShader).not.toContain("silver");
  });
});
