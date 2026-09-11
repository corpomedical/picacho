import { describe, expect, it } from "vitest";
import {
  ATTACHED_REFERENCE_NOTE,
  LOOK_REFERENCE_NOTE,
  OUTFIT_REFERENCE_NOTE,
  PERSON_REFERENCE_NOTE,
  referenceNotes,
} from "./reference-notes";

// The sentences that say what each extra reference photo is. The first three
// moved here from pipeline.ts unchanged; these pin them word for word, so a
// refactor can never quietly change what every render with an outfit or an
// attachment tells the image model.

describe("referenceNotes", () => {
  it("keeps the existing sentences exactly", () => {
    expect(OUTFIT_REFERENCE_NOTE).toBe(
      "One of the reference photos shows only an outfit laid out, with no person in it: dress the person in exactly that outfit, reproducing its design, colours, logos, and stitching.",
    );
    expect(ATTACHED_REFERENCE_NOTE).toBe(
      "One of the reference photos is an image the user attached — the prompt says how to use it. Follow the prompt's instructions about it, and do not copy its framing or composition unless the prompt asks for that.",
    );
    expect(PERSON_REFERENCE_NOTE).toBe("Every other reference photo is the person — match their face, hair, and identity exactly.");
  });

  it("appends them as before for outfit and attachment renders", () => {
    expect(referenceNotes({ outfit: true, attached: false, look: false, identity: true })).toBe(
      `\n\n${OUTFIT_REFERENCE_NOTE}\n\n${PERSON_REFERENCE_NOTE}`,
    );
    expect(referenceNotes({ outfit: false, attached: true, look: false, identity: true })).toBe(
      `\n\n${ATTACHED_REFERENCE_NOTE}\n\n${PERSON_REFERENCE_NOTE}`,
    );
    expect(referenceNotes({ outfit: true, attached: true, look: false, identity: true })).toBe(
      `\n\n${OUTFIT_REFERENCE_NOTE}\n\n${ATTACHED_REFERENCE_NOTE}\n\n${PERSON_REFERENCE_NOTE}`,
    );
  });

  it("never calls anything the person when no photo of the person rides", () => {
    expect(referenceNotes({ outfit: false, attached: true, look: false, identity: false })).toBe(`\n\n${ATTACHED_REFERENCE_NOTE}`);
    expect(referenceNotes({ outfit: false, attached: false, look: false, identity: true })).toBe("");
  });

  it("names a set's earlier still, so the person in it is never taken for the person", () => {
    const notes = referenceNotes({ outfit: false, attached: true, look: true, identity: true });
    expect(notes).toBe(`\n\n${ATTACHED_REFERENCE_NOTE}\n\n${LOOK_REFERENCE_NOTE}\n\n${PERSON_REFERENCE_NOTE}`);
    expect(LOOK_REFERENCE_NOTE).toContain("Never take the face, hair or identity of anyone in it.");
  });
});
