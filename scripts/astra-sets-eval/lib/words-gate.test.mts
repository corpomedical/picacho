import { describe, expect, it } from "vitest";
import { netContext } from "./net-guard.mts";
import { makeBriefGate, makeNotesGate, makePictureCheck, makeWordsJudge, NOT_REACHED, type AssertOutputAllowed, type AssertPromptAllowed } from "./words-gate.mts";

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
    expect(await odd("x", 0, "r")).toEqual({ verdict: "unavailable", scores: undefined });
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

// Part D starts every item's gate at once, so most calls wait in a queue.
// A stop (Ctrl-C, the spend guard) must reach them there: a photo still
// waiting for the picture check is never sent.
describe("a stop reaches the calls still queued", () => {
  it("a photo still waiting for the picture check when the run stops is never sent", async () => {
    let stop = false;
    const sent: string[] = [];
    let finishFirst: () => void = () => {};
    const check = makePictureCheck({
      assertOutputAllowed: async (input) => {
        sent.push(input.imageUrl);
        if (sent.length === 1) await new Promise<void>((r) => (finishFirst = r));
        return { allowed: true };
      },
      refusalReason,
      concurrency: 1,
      stopping: () => stop,
      ...noWait,
    });
    const first = check("photo-1", { promptScores: null, priorHits: 0 }, "pp-1-r1");
    const queued = [2, 3, 4].map((n) => check(`photo-${n}`, { promptScores: null, priorHits: 0 }, `pp-${n}-r1`));
    // Ctrl-C while the first photo is being read: it lands, the rest never go.
    stop = true;
    finishFirst();
    expect(await first).toBe("allowed");
    expect(await Promise.all(queued)).toEqual([NOT_REACHED, NOT_REACHED, NOT_REACHED]);
    expect(sent).toEqual(["photo-1"]);
  });

  it("a stop during the wait before a retry sends nothing more: the last reading stands", async () => {
    let stop = false;
    let calls = 0;
    const gate = makeNotesGate({
      assertPromptAllowed: async () => (calls++, Promise.reject(new Refusal("unavailable"))),
      refusalReason,
      retryDelaysMs: [1, 1],
      sleep: async () => {
        stop = true;
      },
      stopping: () => stop,
    });
    expect(await gate("the other half is a bar", 0, "pp-1-r1")).toEqual({ verdict: "unavailable", scores: undefined });
    expect(calls).toBe(1);
  });

  it("the brief gate stops the same way; the words gate takes no stop (it judges an answer already paid for)", async () => {
    let calls = 0;
    const brief = makeBriefGate({ assertPromptAllowed: async () => (calls++, {}), refusalReason, stopping: () => true, ...noWait });
    expect(await brief("a quiet showroom", 0, "adv-1-r1")).toBe(NOT_REACHED);
    expect(calls).toBe(0);
    // Even handed one, the words gate judges: a delivered answer is never left unjudged by a stop.
    const handedAStop = { assertPromptAllowed: async () => (calls++, {}), refusalReason, stopping: () => true, ...noWait };
    const words = makeWordsJudge(handedAStop);
    const spec = { title: "A showroom", description: "one red car", cameras: [], marks: [] } as unknown as Parameters<typeof words>[0];
    expect(await words(spec, "al-1-r1")).toBe("allowed");
    expect(calls).toBe(1);
  });
});
