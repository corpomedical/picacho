import { describe, expect, it } from "vitest";
import { netContext } from "./net-guard.mts";
import { makeNotesGate, makePictureCheck, type AssertOutputAllowed, type AssertPromptAllowed } from "./words-gate.mts";

// D's photo leg calls the product's gates directly, as submitSetPhotoBuild
// does, and never the database: the notes with a real photograph beside
// them, then the picture itself, strict lane, with the notes' scores. The
// gates here are scripted; nothing is read.

class Refusal extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}
const refusalReason = (e: unknown) => (e instanceof Refusal ? e.reason : null);
const noWait = { retryDelaysMs: [1, 1], sleep: async () => {} };

describe("the notes gate", () => {
  it("judges the notes as submitSetPhotoBuild does, and hands back the scores the picture check reads", async () => {
    const seen: Parameters<AssertPromptAllowed>[0][] = [];
    const scores = { sexual_nudity: "NEGLIGIBLE" };
    const gate = makeNotesGate({ assertPromptAllowed: async (input) => (seen.push(input), scores), refusalReason, ...noWait });
    expect(await gate("the other half is a bar", 0, "pp-1-r1")).toEqual({ verdict: "allowed", scores });
    expect(seen).toEqual([{ prompt: "the other half is a bar", hasRealPersonReference: true, sessionPriorHits: 0 }]);
  });

  it("a refusal is a verdict; an error that is no refusal reads as unavailable, after the retries", async () => {
    const refused = makeNotesGate({ assertPromptAllowed: async () => Promise.reject(new Refusal("sexual")), refusalReason, ...noWait });
    expect(await refused("x", 0, "r")).toEqual({ verdict: { refused: "sexual" }, scores: undefined });
    let calls = 0;
    const odd = makeNotesGate({ assertPromptAllowed: async () => (calls++, Promise.reject(new Error("socket"))), refusalReason, ...noWait });
    expect((await odd("x", 0, "r")).verdict).toBe("unavailable");
    expect(calls).toBe(3);
  });
});

describe("the picture check", () => {
  it("reads the photo's own bytes in the strict lane, with the notes' scores and the prior hits, tagged for the meter", async () => {
    const seen: Parameters<AssertOutputAllowed>[0][] = [];
    const tags: (string | undefined)[] = [];
    const check = makePictureCheck({
      assertOutputAllowed: async (input) => {
        seen.push(input);
        tags.push(netContext.getStore()?.tag);
        return { allowed: true };
      },
      refusalReason,
      ...noWait,
    });
    const scores = { minor_sexualized: "NEGLIGIBLE" };
    expect(await check("data:image/jpeg;base64,/9j/", { promptScores: scores, priorHits: 0 }, "pp-1-r1")).toBe("allowed");
    expect(seen).toEqual([{ imageUrl: "data:image/jpeg;base64,/9j/", promptScores: scores, sessionPriorHits: 0, strictLane: true }]);
    expect(tags).toEqual(["picture-check"]);
    await check("data:image/jpeg;base64,/9j/", { promptScores: undefined, priorHits: 2 }, "pp-2-r1");
    expect(seen[1]).toMatchObject({ promptScores: null, sessionPriorHits: 2 });
  });

  it("a refused photo is a verdict; unavailable is tried again, then reported, never a refusal", async () => {
    const refused = makePictureCheck({ assertOutputAllowed: async () => Promise.reject(new Refusal("minors")), refusalReason, ...noWait });
    expect(await refused("d", { promptScores: null, priorHits: 0 }, "r")).toEqual({ refused: "minors" });
    let calls = 0;
    const flaky = makePictureCheck({
      assertOutputAllowed: async () => {
        calls += 1;
        if (calls < 3) throw new Refusal("unavailable");
        return { allowed: true };
      },
      refusalReason,
      ...noWait,
    });
    expect(await flaky("d", { promptScores: null, priorHits: 0 }, "r")).toBe("allowed");
    const down = makePictureCheck({ assertOutputAllowed: async () => Promise.reject(new Refusal("unavailable")), refusalReason, ...noWait });
    expect(await down("d", { promptScores: null, priorHits: 0 }, "r")).toBe("unavailable");
  });
});
