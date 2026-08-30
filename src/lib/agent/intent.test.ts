import { describe, expect, it } from "vitest";
import { classifyMessage } from "./intent";

const asks = (t: string) => classifyMessage(t).intent === "ask";
const renders = (t: string) => classifyMessage(t).intent === "render";

// The asymmetry is the design, so it is what gets tested hardest: reading a
// question as a shot spends a credit on something nobody asked for, and
// reading a shot as a question costs a fraction of a cent and one tap.

describe("things that must render", () => {
  it("reads a plain shot description as a shot", () => {
    expect(renders("Eva walking through a quiet market at dawn")).toBe(true);
    expect(renders("Adam looks up as the ship passes overhead")).toBe(true);
    expect(renders("close-up on her eyes, wide with fear")).toBe(true);
    expect(renders("Blodie sits courtside at a Lakers game")).toBe(true);
  });

  it("does not mistake 'show me' for a question", () => {
    // One of the most natural ways to ask for a picture. Putting a tap in
    // front of it would be a tax on the common case.
    expect(renders("show me Eva in a market")).toBe(true);
    expect(renders("show her from a low angle")).toBe(true);
  });

  it("keeps rendering a two-word prompt", () => {
    expect(renders("Eva smiling")).toBe(true);
    expect(renders("wide shot")).toBe(true);
  });

  it("still renders when a sentence merely contains a question word", () => {
    // "where" mid-sentence is scenery, not an enquiry.
    expect(renders("a market where the light comes through the awnings")).toBe(true);
    expect(renders("the moment when the match strikes")).toBe(true);
  });
});

describe("things that must be answered, not rendered", () => {
  it("treats anything with a question mark as a question", () => {
    expect(asks("why did this one only score 61%?")).toBe(true);
    expect(asks("Eva in a market?")).toBe(true);
  });

  it("treats a question opener as a question with no punctuation at all", () => {
    expect(asks("why did my last take score so low")).toBe(true);
    expect(asks("which model should I use for six seconds")).toBe(true);
    expect(asks("how much would that cost")).toBe(true);
    expect(asks("explain the seedance fence")).toBe(true);
    expect(asks("compare veo and kling for Adam")).toBe(true);
  });

  it("treats a message addressed to a person as a question", () => {
    expect(asks("do you think the pose is the problem")).toBe(true);
    expect(asks("tell me what went wrong with the last one")).toBe(true);
  });

  it("never renders small talk", () => {
    // "thanks" is a well-formed two-word prompt. Rendering it would be a
    // credit spent on nothing, which is the failure this list exists for.
    for (const t of ["hi", "hello", "thanks", "thank you", "ok", "cool", "perfect", "bye"]) {
      expect(asks(t)).toBe(true);
    }
    expect(asks("Thanks!")).toBe(true);
  });
});

describe("the Render this chip", () => {
  it("recovers the shot from a politely wrapped instruction", () => {
    expect(classifyMessage("can you make Eva walk through a market")).toEqual({
      intent: "ask",
      renderablePrompt: "make Eva walk through a market",
    });
    expect(classifyMessage("could you please show Adam on the bridge").renderablePrompt).toBe(
      "show Adam on the bridge",
    );
  });

  it("offers nothing when what remains is not an instruction to produce anything", () => {
    // "can you explain the scoring" must not offer to RENDER "explain the
    // scoring" — a chip that spends a credit on nonsense.
    expect(classifyMessage("can you explain the scoring").renderablePrompt).toBe(null);
    expect(classifyMessage("do you think that will work").renderablePrompt).toBe(null);
    expect(classifyMessage("why did it fail").renderablePrompt).toBe(null);
  });

  it("offers nothing when the person was also asking something", () => {
    expect(
      classifyMessage("can you make Eva walk through a market, or is Veo better?")
        .renderablePrompt,
    ).toBe(null);
  });

  it("hands back the person's own words, unedited", () => {
    // The chip fills the composer. What lands there has to be recognisably
    // what they typed, not a sentence put in their mouth.
    const out = classifyMessage("Can you make EVA sprint, backlit, 35mm").renderablePrompt;
    expect(out).toBe("make EVA sprint, backlit, 35mm");
  });
});

describe("edge cases", () => {
  it("treats an empty message as a render, so the existing guards handle it", () => {
    expect(classifyMessage("").intent).toBe("render");
    expect(classifyMessage("   ").intent).toBe("render");
  });

  it("is not confused by leading or doubled whitespace", () => {
    expect(asks("   why did this fail")).toBe(true);
    expect(asks("what   should  I  change")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(asks("WHY DID THIS FAIL")).toBe(true);
    expect(renders("EVA IN A MARKET")).toBe(true);
  });
});
