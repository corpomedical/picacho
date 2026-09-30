import { describe, expect, it } from "vitest";
import {
  IDENTITY_MAX_REFERENCES,
  combineIdentityReadings,
  faceHeightShare,
  identityScorePrompt,
  parseFaceBox,
  parseIdentityReply,
} from "./identity-prompt";

// Scorer p3 (2026-09-30). What these pin is what the day's test set found.

describe("the words the scorer is sent", () => {
  it("asks about a character's face design, never about verifying a real person", () => {
    // gpt-5.5 refused 14 of 66 readings worded as face verification of one
    // real person; the character wording was refused 0 times in 220.
    for (const references of [1, 2, 3]) {
      const text = identityScorePrompt({ references });
      expect(text).toContain("FACE DESIGN");
      expect(text.toLowerCase()).not.toContain("verif");
      expect(text.toLowerCase()).not.toContain("real person");
      expect(text.toLowerCase()).not.toContain("same individual");
    }
  });

  it("names the shared look as never raising the score", () => {
    const text = identityScorePrompt({ references: 3 });
    for (const word of ["Hair colour", "freckles", "eye colour", "skin tone"]) expect(text).toContain(word);
    expect(text).toContain("must never raise the score");
  });

  it("carries no trait summary: there is no way to pass one", () => {
    // p2 listed "copper-red hair, freckles, hazel-green eyes" and a lookalike
    // with all three scored 96. The input type has no traits field.
    const text = identityScorePrompt({ references: 1 });
    expect(text).not.toContain("saved traits");
  });

  it("counts the references it was given, within 1..3", () => {
    expect(identityScorePrompt({ references: 1 })).toContain("The first image is the saved reference picture");
    expect(identityScorePrompt({ references: 3 })).toContain("The first 3 images are saved reference pictures");
    expect(identityScorePrompt({ references: 9 })).toContain(`The first ${IDENTITY_MAX_REFERENCES} images`);
    expect(identityScorePrompt({ references: 0 })).toContain("The first image is the saved reference picture");
  });

  it("says a frame may hold other people only when asked to", () => {
    expect(identityScorePrompt({ references: 1, severalPeople: true })).toContain("may hold other people");
    expect(identityScorePrompt({ references: 1 })).not.toContain("may hold other people");
  });

  it("asks for the note in another language only when one is named", () => {
    expect(identityScorePrompt({ references: 1, notesLanguage: "Español" })).toContain('Write the "notes" sentence in Español.');
    expect(identityScorePrompt({ references: 1 })).not.toContain("Write the");
  });
});

describe("reading the answer", () => {
  it("reads a full answer", () => {
    const r = parseIdentityReply('{"faceBox":[143,437,220,563],"score":76,"notes":"Jaw narrower.","unusable":false,"faceVisible":true}');
    expect(r).toEqual({ score: 76, notes: "Jaw narrower.", unusable: false, faceVisible: true, faceBox: [143, 437, 220, 563] });
  });

  it("finds the JSON inside surrounding words", () => {
    expect(parseIdentityReply('Here: {"score": 88, "faceVisible": true} done')?.score).toBe(88);
  });

  it("returns null for no JSON, broken JSON, a missing or out-of-range score", () => {
    for (const bad of [undefined, null, "", "no json", "{not json}", '{"notes":"x"}', '{"score":null}', '{"score":101}', '{"score":-1}', '{"score":"high"}']) {
      expect(parseIdentityReply(bad as string | null | undefined)).toBeNull();
    }
  });

  it("counts only an explicit false as a face not seen", () => {
    expect(parseIdentityReply('{"score":50}')?.faceVisible).toBe(true);
    expect(parseIdentityReply('{"score":50,"faceVisible":false}')?.faceVisible).toBe(false);
  });

  it("bounds the note", () => {
    expect(parseIdentityReply(`{"score":50,"notes":"${"a".repeat(900)}"}`)?.notes.length).toBe(300);
  });
});

describe("the face's box", () => {
  it("takes four in-range numbers with a real area", () => {
    expect(parseFaceBox([143, 437, 220, 563])).toEqual([143, 437, 220, 563]);
    expect(parseFaceBox(["143", "437", "220", "563"])).toEqual([143, 437, 220, 563]);
  });

  it("refuses anything else", () => {
    for (const bad of [null, undefined, [], [1, 2, 3], [1, 2, 3, 4, 5], [0, 0, 0, 0], [500, 10, 400, 20], [10, 500, 20, 400], [-1, 0, 10, 10], [0, 0, 10, 1001], [0, 0, "x", 10]]) {
      expect(parseFaceBox(bad)).toBeNull();
    }
  });

  it("gives the face's height as a share of the picture", () => {
    // The rooftop picture's face: 7.7% of its height (Apple Vision read 7.9%).
    expect(faceHeightShare([143, 437, 220, 563])).toBeCloseTo(0.077, 3);
    expect(faceHeightShare(null)).toBeNull();
  });

  it("is dropped from a reading when it is malformed, the score kept", () => {
    expect(parseIdentityReply('{"score":80,"faceBox":[1,2]}')).toMatchObject({ score: 80, faceBox: null });
  });
});

describe("two readings made into one", () => {
  const r = (score: number, over: Partial<Parameters<typeof combineIdentityReadings>[0][number] & object> = {}) => ({
    score,
    notes: `n${score}`,
    unusable: false,
    faceVisible: true,
    faceBox: null,
    ...over,
  });

  it("averages the scores and keeps the lower reading's note", () => {
    expect(combineIdentityReadings([r(84), r(68)])).toMatchObject({ score: 76, notes: "n68" });
  });

  it("uses the reading that saw a face when the other did not", () => {
    expect(combineIdentityReadings([r(80), r(20, { faceVisible: false })])).toMatchObject({ score: 80, faceVisible: true });
    expect(combineIdentityReadings([r(30, { faceVisible: false }), r(20, { faceVisible: false })])).toMatchObject({ score: 25, faceVisible: false });
  });

  it("is unusable only when every reading says so", () => {
    expect(combineIdentityReadings([r(0, { unusable: true }), r(80)])?.unusable).toBe(false);
    expect(combineIdentityReadings([r(0, { unusable: true }), r(0, { unusable: true })])?.unusable).toBe(true);
  });

  it("stands on the readings that came back, and is null when none did", () => {
    expect(combineIdentityReadings([null, r(71)])).toMatchObject({ score: 71 });
    expect(combineIdentityReadings([null, null])).toBeNull();
    expect(combineIdentityReadings([])).toBeNull();
  });

  it("keeps the first box given", () => {
    expect(combineIdentityReadings([r(80), r(70, { faceBox: [1, 2, 3, 4] })])?.faceBox).toEqual([1, 2, 3, 4]);
  });
});
