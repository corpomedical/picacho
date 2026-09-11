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
//   shot gate    assertPromptAllowed({ prompt: a still's prompt,
//                hasRealPersonReference, sessionPriorHits }) — runGeneration's
//                entry gate on a Set's shot (the strict lane: an attachment
//                rides) or on an ordinary render (a control: nothing rides).
//
// "unavailable" is not a reading. Every gate tries again at 1.5 s and 5 s
// (production hands the answer to the next poll tick, or the person to a
// second try, instead), then reports "unavailable": a build flagged so is
// UNJUDGED in Part D and never counted as a refusal. Every call runs inside
// a net context tagged with the gate and the item, so the meter can
// attribute the readers' tokens.
//
// A STOP REACHES A CALL STILL WAITING FOR ITS TURN. Part D starts every
// item's gate at once and the calls queue for a slot (the picture check
// reads two photos at a time, 10–100 s each), so a stop checked only when
// an item starts would let every queued call through after Ctrl-C or the
// spend guard's stop — a photo with people sent to the readers, metered past
// --max-usd. A gate made with `stopping` asks it when the call's turn comes
// and before each retry: once the run is stopping it calls nothing and
// answers NOT_REACHED (nothing sent, nothing judged), or, after a first read
// came back unavailable, that read. The words gate takes no stop: it judges
// an answer the run has already paid for, which a budget stop lets land.

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
  /** The run is stopping (Ctrl-C, the spend guard): asked when each call's turn comes, and before each retry. */
  stopping?: () => boolean;
};

export type GateVerdict = "allowed" | { refused: string } | "unavailable";
/** A verdict and, when allowed, what the gate returned (the prompt gate's scores). */
export type GateReading = { verdict: GateVerdict; scores: unknown };
/** A stop-aware gate's answer when the run stopped before its call: nothing was sent, nothing judged. */
export const NOT_REACHED = "not-reached";
export type NotReached = typeof NOT_REACHED;

type Retry = Pick<GateDeps, "retryDelaysMs" | "sleep" | "stopping">;

/** Reads again while the answer is "unavailable", at each delay, then gives the last reading. A stop ends the retries: the last reading stands. */
async function readWithRetries(read: () => Promise<GateReading | NotReached>, retry: boolean, o: Retry): Promise<GateReading | NotReached> {
  let v = await read();
  if (!retry || v === NOT_REACHED) return v;
  for (const d of o.retryDelaysMs ?? [1500, 5000]) {
    if (v.verdict !== "unavailable" || o.stopping?.()) return v;
    await (o.sleep ?? realSleep)(d);
    const again = await read();
    // Stopped during the wait: the item was read once, so it is unavailable, not unreached.
    if (again === NOT_REACHED) return v;
    v = again;
  }
  return v;
}

/** One judgement, in its net context: allowed, refused with a reason, or unavailable (an error that is no refusal counts as unavailable) — or not reached, when the run is stopping by the time its turn comes. */
function judged(
  sem: Semaphore,
  deps: Pick<GateDeps, "refusalReason" | "onOddError" | "stopping">,
  tag: string,
  ref: string,
  call: () => Promise<unknown>,
): Promise<GateReading | NotReached> {
  return sem.use(async () => {
    // Asked when this call's turn comes, not when it was queued.
    if (deps.stopping?.()) return NOT_REACHED;
    return withNetContext({ tag, ref, settled: false }, async (): Promise<GateReading> => {
      try {
        return { verdict: "allowed", scores: await call() };
      } catch (err) {
        const reason = deps.refusalReason(err);
        if (reason === null) {
          deps.onOddError?.(ref, err);
          return { verdict: "unavailable", scores: undefined };
        }
        return { verdict: reason === "unavailable" ? "unavailable" : { refused: reason }, scores: undefined };
      }
    });
  });
}

const verdictOf = (r: GateReading | NotReached): GateVerdict | NotReached => (r === NOT_REACHED ? r : r.verdict);

export function makeGate(deps: GateDeps) {
  const sem = new Semaphore(deps.concurrency ?? 4);
  return (input: Parameters<AssertPromptAllowed>[0], tag: string, ref: string, retry: boolean): Promise<GateReading | NotReached> =>
    readWithRetries(() => judged(sem, deps, tag, ref, () => deps.assertPromptAllowed(input)), retry, deps);
}

/** The words gate on Astra's (or a baseline's) own words. It takes no stop (see the header). */
export function makeWordsJudge(deps: Omit<GateDeps, "stopping">): (spec: SetSpec, ref: string) => Promise<WordsVerdict> {
  const gate = makeGate({ ...deps, stopping: undefined });
  return async (spec, ref) => {
    const r = verdictOf(await gate({ prompt: specTextForGate(spec), hasRealPersonReference: true }, "words-gate", ref, true));
    // Never NOT_REACHED without a stop; were it, the answer would be unjudged.
    return r === NOT_REACHED ? "unavailable" : r;
  };
}

/** Part D's brief gate. */
export function makeBriefGate(deps: GateDeps): (brief: string, priorHits: number, ref: string) => Promise<GateVerdict | NotReached> {
  const gate = makeGate(deps);
  return async (brief, priorHits, ref) => verdictOf(await gate({ prompt: brief, hasRealPersonReference: false, sessionPriorHits: priorHits }, "brief-gate", ref, true));
}

/** Part D's photo leg: the photographer's notes, judged as submitSetPhotoBuild judges them; the reading carries the scores the picture check reads. */
export function makeNotesGate(deps: GateDeps): (notes: string, priorHits: number, ref: string) => Promise<GateReading | NotReached> {
  const gate = makeGate(deps);
  return (notes, priorHits, ref) => gate({ prompt: notes, hasRealPersonReference: true, sessionPriorHits: priorHits }, "notes-gate", ref, true);
}

/** C's and D's stills: runGeneration's entry gate on the still's own prompt (shots.mts). */
export function makeShotGate(deps: GateDeps): (prompt: string, o: { hasRealPersonReference: boolean; priorHits: number }, ref: string) => Promise<GateReading | NotReached> {
  const gate = makeGate(deps);
  return (prompt, o, ref) => gate({ prompt, hasRealPersonReference: o.hasRealPersonReference, sessionPriorHits: o.priorHits }, "shot-gate", ref, true);
}

export type PictureDeps = Omit<GateDeps, "assertPromptAllowed"> & { assertOutputAllowed: AssertOutputAllowed };

/** Part D's photo leg: the picture check on the photo's own bytes (a data URL), in the strict lane. */
export function makePictureCheck(deps: PictureDeps): (dataUrl: string, o: { promptScores: unknown; priorHits: number }, ref: string) => Promise<GateVerdict | NotReached> {
  // The readers take 10–100 s a photo: fewer at once than the prompt gate.
  const sem = new Semaphore(deps.concurrency ?? 2);
  return async (dataUrl, o, ref) =>
    verdictOf(
      await readWithRetries(
        () => judged(sem, deps, "picture-check", ref, () => deps.assertOutputAllowed({ imageUrl: dataUrl, promptScores: o.promptScores ?? null, sessionPriorHits: o.priorHits, strictLane: true })),
        true,
        deps,
      ),
    );
}

export const skipWords = async (): Promise<WordsVerdict> => "skipped";
