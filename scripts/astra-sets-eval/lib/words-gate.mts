// The content gates the eval calls, without the database.
//
// The product's gatePrompt reads and writes the production policy_refusals
// table; the runner never uses it. It calls assertPromptAllowed directly —
// the same judgement — with sessionPriorHits passed explicitly. Both
// functions are injected (run.mts imports content-policy.ts under tsx), so
// this module stays importable by the tests.
//
//   words gate   assertPromptAllowed({ prompt: specTextForGate(spec),
//                hasRealPersonReference: true }) — exactly the build tick's
//                call (sets/build-tick.ts), which passes no sessionPriorHits.
//   brief gate   assertPromptAllowed({ prompt: brief, hasRealPersonReference:
//                false, sessionPriorHits }) — submitSetBuild's judgement.
//   notes gate   assertPromptAllowed({ prompt: notes, hasRealPersonReference:
//                true, sessionPriorHits }) — submitSetPhotoBuild's judgement
//                of a photo's notes (a real photograph is beside them). Its
//                scores are handed on to the picture check, as the product
//                hands gatePrompt's.
//   picture      assertOutputAllowed({ imageUrl: the photo's data URL,
//   check        strictLane: true, promptScores, sessionPriorHits }) —
//                submitSetPhotoBuild's check of the photo's own bytes, before
//                it is stored or sent to Astra. Injected the same way
//                (output-policy.ts), and never logged anywhere.
//
// "unavailable" is not a reading. Every gate tries again at 1.5 s and 5 s
// (production hands the answer to the next poll tick, or the person to a
// second try, instead), then reports "unavailable": a build flagged so is
// UNJUDGED in Part D and never counted as a refusal. Every call runs inside
// a net context tagged with the gate and the item, so the meter can
// attribute the readers' tokens.

import { specTextForGate, type SetSpec } from "../../../src/lib/sets/set-spec.ts";
import type { WordsVerdict } from "./build-flow.mts";
import { withNetContext } from "./net-guard.mts";
import { Semaphore, sleep as realSleep } from "./util.mts";

export type AssertPromptAllowed = (input: { prompt: string; hasRealPersonReference?: boolean; sessionPriorHits?: number }) => Promise<unknown>;
export type AssertOutputAllowed = (input: { imageUrl: string; promptScores: unknown; sessionPriorHits: number; strictLane: true }) => Promise<unknown>;

export type GateDeps = {
  assertPromptAllowed: AssertPromptAllowed;
  /** The refusal's reason, or null when the error is not a ContentPolicyRefusal. */
  refusalReason: (err: unknown) => string | null;
  concurrency?: number;
  retryDelaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
  onOddError?: (ref: string, err: unknown) => void;
};

export type GateVerdict = "allowed" | { refused: string } | "unavailable";
/** A verdict and, when allowed, what the gate returned (the prompt gate's scores). */
export type GateReading = { verdict: GateVerdict; scores: unknown };

type Retry = Pick<GateDeps, "retryDelaysMs" | "sleep">;

/** Reads again while the answer is "unavailable", at each delay, then gives the last reading. */
async function readWithRetries(read: () => Promise<GateReading>, retry: boolean, o: Retry): Promise<GateReading> {
  let v = await read();
  if (!retry) return v;
  for (const d of o.retryDelaysMs ?? [1500, 5000]) {
    if (v.verdict !== "unavailable") return v;
    await (o.sleep ?? realSleep)(d);
    v = await read();
  }
  return v;
}

/** One judgement, in its net context: allowed, refused with a reason, or unavailable (an error that is no refusal counts as unavailable). */
function judged(
  sem: Semaphore,
  deps: Pick<GateDeps, "refusalReason" | "onOddError">,
  tag: string,
  ref: string,
  call: () => Promise<unknown>,
): Promise<GateReading> {
  return sem.use(() =>
    withNetContext({ tag, ref, settled: false }, async () => {
      try {
        return { verdict: "allowed" as const, scores: await call() };
      } catch (err) {
        const reason = deps.refusalReason(err);
        if (reason === null) {
          deps.onOddError?.(ref, err);
          return { verdict: "unavailable" as const, scores: undefined };
        }
        return { verdict: reason === "unavailable" ? ("unavailable" as const) : { refused: reason }, scores: undefined };
      }
    }),
  );
}

export function makeGate(deps: GateDeps) {
  const sem = new Semaphore(deps.concurrency ?? 4);
  return (input: Parameters<AssertPromptAllowed>[0], tag: string, ref: string, retry: boolean): Promise<GateReading> =>
    readWithRetries(() => judged(sem, deps, tag, ref, () => deps.assertPromptAllowed(input)), retry, deps);
}

/** The words gate on Astra's (or a baseline's) own words. */
export function makeWordsJudge(deps: GateDeps): (spec: SetSpec, ref: string) => Promise<WordsVerdict> {
  const gate = makeGate(deps);
  return async (spec, ref) => (await gate({ prompt: specTextForGate(spec), hasRealPersonReference: true }, "words-gate", ref, true)).verdict;
}

/** Part D's brief gate. */
export function makeBriefGate(deps: GateDeps): (brief: string, priorHits: number, ref: string) => Promise<GateVerdict> {
  const gate = makeGate(deps);
  return async (brief, priorHits, ref) => (await gate({ prompt: brief, hasRealPersonReference: false, sessionPriorHits: priorHits }, "brief-gate", ref, true)).verdict;
}

/** Part D's photo leg: the photographer's notes, judged as submitSetPhotoBuild judges them; the reading carries the scores the picture check reads. */
export function makeNotesGate(deps: GateDeps): (notes: string, priorHits: number, ref: string) => Promise<GateReading> {
  const gate = makeGate(deps);
  return (notes, priorHits, ref) => gate({ prompt: notes, hasRealPersonReference: true, sessionPriorHits: priorHits }, "notes-gate", ref, true);
}

export type PictureDeps = Omit<GateDeps, "assertPromptAllowed"> & { assertOutputAllowed: AssertOutputAllowed };

/** Part D's photo leg: the picture check on the photo's own bytes (a data URL), in the strict lane. */
export function makePictureCheck(deps: PictureDeps): (dataUrl: string, o: { promptScores: unknown; priorHits: number }, ref: string) => Promise<GateVerdict> {
  // The readers take 10–100 s a photo: fewer at once than the prompt gate.
  const sem = new Semaphore(deps.concurrency ?? 2);
  return async (dataUrl, o, ref) =>
    (
      await readWithRetries(
        () => judged(sem, deps, "picture-check", ref, () => deps.assertOutputAllowed({ imageUrl: dataUrl, promptScores: o.promptScores ?? null, sessionPriorHits: o.priorHits, strictLane: true })),
        true,
        deps,
      )
    ).verdict;
}

export const skipWords = async (): Promise<WordsVerdict> => "skipped";
