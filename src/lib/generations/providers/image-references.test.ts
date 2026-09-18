import { describe, expect, it } from "vitest";
import { buildImageReferences } from "./image-references";

// Incident replay: the first bug report from an outside user (2026-08-29) —
// an attached background photo was silently dropped because no character
// was selected. Each case below is a real send shape.

describe("buildImageReferences", () => {
  it("NO CHARACTER + attachment: the attachment is the reference set", () => {
    // The reported case. Was returning null — the model never saw the photo.
    expect(buildImageReferences({ identity: null, prop: "https://x/bg.png" })).toEqual([
      "https://x/bg.png",
    ]);
    expect(buildImageReferences({ identity: undefined, prop: "https://x/bg.png" })).toEqual([
      "https://x/bg.png",
    ]);
    expect(buildImageReferences({ identity: "", prop: "https://x/bg.png" })).toEqual([
      "https://x/bg.png",
    ]);
  });

  it("character + attachment: identity leads, extras follow in order", () => {
    expect(
      buildImageReferences({ identity: "id.png", outfit: "fit.png", prop: "bg.png" }),
    ).toEqual(["id.png", "fit.png", "bg.png"]);
  });

  it("character alone is passed through untouched (single string)", () => {
    expect(buildImageReferences({ identity: "id.png" })).toBe("id.png");
  });

  it("nothing at all stays nothing — a pure text-to-image send", () => {
    expect(buildImageReferences({ identity: null })).toBeNull();
  });

  it("multi-character arrays are never merged — order is meaning", () => {
    const cast = ["a.png", "b.png"];
    expect(buildImageReferences({ identity: cast, prop: "bg.png" })).toBe(cast);
    expect(buildImageReferences({ identity: cast })).toBe(cast);
    expect(buildImageReferences({ identity: cast, prop: "sketch.jpg", look: "earlier.png" })).toBe(cast);
  });

  it("a set shot: the person, then the sketch, then the earlier still for the look", () => {
    expect(buildImageReferences({ identity: "id.png", prop: "sketch.jpg", look: "earlier.png" })).toEqual([
      "id.png",
      "sketch.jpg",
      "earlier.png",
    ]);
    expect(buildImageReferences({ identity: "id.png", prop: "sketch.jpg", look: null })).toEqual(["id.png", "sketch.jpg"]);
  });

  it("the expression set rides right after the person, before anything that is not the person (2026-09-19)", () => {
    expect(
      buildImageReferences({ identity: "photo1", expressionSet: ["laugh", "teeth"], outfit: "outfit", look: "look" }),
    ).toEqual(["photo1", "laugh", "teeth", "outfit", "look"]);
    expect(buildImageReferences({ identity: "photo1", expressionSet: ["smile"] })).toEqual(["photo1", "smile"]);
    // Nothing picked: the single identity photo passes through as before.
    expect(buildImageReferences({ identity: "photo1", expressionSet: [] })).toBe("photo1");
  });

  it("the expression set never joins a multi-character array, and never rides without the person", () => {
    expect(buildImageReferences({ identity: ["a", "b"], expressionSet: ["smile"] })).toEqual(["a", "b"]);
    expect(buildImageReferences({ identity: null, expressionSet: ["smile"], prop: "attached" })).toEqual(["attached"]);
    expect(buildImageReferences({ identity: null, expressionSet: ["smile"] })).toBeNull();
  });
});

