import { describe, expect, it } from "vitest";
import { studioCastInput } from "./studio-cast";

const frame = { layout: { markId: "m1" }, canvasAspect: 1.5, rig: { format: "wide" }, movers: [] };
const base = { viewFrameUri: "data:image/jpeg;base64,VIEW", characterId: "c1", words: "  walks to the car  ", maxChars: 12, frame, pressId: "press-1" };

describe("Photo with your character: what is sent", () => {
  it("sends the viewport's frame when no clean traced frame was made", () => {
    const input = studioCastInput(base);
    expect(input.frameDataUri).toBe("data:image/jpeg;base64,VIEW");
    expect(input.pressId).toBe("press-1");
    expect(input.beat).toBe(true);
    expect(input.lifted).toBe(false);
    expect(input.direction).toBe("walks to the");
    expect(input.words).toBe("walks to the");
    expect(input.layout).toBe(frame.layout);
    expect(input.rig).toBe(frame.rig);
  });

  it("sends the clean traced frame when one was made, with the same press id and everything else unchanged", () => {
    const view = studioCastInput(base);
    const traced = studioCastInput({ ...base, tracedFrameUri: "data:image/jpeg;base64,TRACED" });
    expect(traced.frameDataUri).toBe("data:image/jpeg;base64,TRACED");
    expect({ ...traced, frameDataUri: "" }).toEqual({ ...view, frameDataUri: "" });
  });

  it("no words, no words field", () => {
    const input = studioCastInput({ ...base, words: "   " });
    expect(input.direction).toBe("");
    expect("words" in input).toBe(false);
  });
});
