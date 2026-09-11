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
//
// "unavailable" is not a reading. The words gate tries again at 1.5 s and
// 5 s (production hands the answer to the next poll tick instead), then
// reports "unavailable": a build flagged so is UNJUDGED in Part D and never
// counted as a refusal. Every call runs inside a net context tagged with
// the gate and the build, so the meter can attribute the readers' tokens.

import { specTextForGate, type SetSpec } from "../../../src/lib/sets/set-spec.ts";
import type { WordsVerdict } from "./build-flow.mts";
import { withNetContext } from "./net-guard.mts";
import { Semaphore, sleep as realSleep } from "./util.mts";

export type AssertPromptAllowed = (input: { prompt: string; hasRealPersonReference?: boolean; sessionPriorHits?: number }) => Promise<unknown>;

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

export function makeGate(deps: GateDeps) {
  const sem = new Semaphore(deps.concurrency ?? 4);
  const delays = deps.retryDelaysMs ?? [1500, 5000];
  const sleep = deps.sleep ?? realSleep;
  const once = async (input: Parameters<AssertPromptAllowed>[0], tag: string, ref: string): Promise<GateVerdict> =>
    sem.use(() =>
      withNetContext({ tag, ref, settled: false }, async () => {
        try {
          await deps.assertPromptAllowed(input);
          return "allowed" as const;
        } catch (err) {
          const reason = deps.refusalReason(err);
          if (reason === null) {
            deps.onOddError?.(ref, err);
            return "unavailable" as const;
          }
          return reason === "unavailable" ? ("unavailable" as const) : { refused: reason };
        }
      }),
    );
  return async (input: Parameters<AssertPromptAllowed>[0], tag: string, ref: string, retry: boolean): Promise<GateVerdict> => {
    let v = await once(input, tag, ref);
    if (!retry) return v;
    for (const d of delays) {
      if (v !== "unavailable") return v;
      await sleep(d);
      v = await once(input, tag, ref);
    }
    return v;
  };
}

/** The words gate on Astra's (or a baseline's) own words. */
export function makeWordsJudge(deps: GateDeps): (spec: SetSpec, ref: string) => Promise<WordsVerdict> {
  const gate = makeGate(deps);
  return (spec, ref) => gate({ prompt: specTextForGate(spec), hasRealPersonReference: true }, "words-gate", ref, true);
}

/** Part D's brief gate. */
export function makeBriefGate(deps: GateDeps): (brief: string, priorHits: number, ref: string) => Promise<GateVerdict> {
  const gate = makeGate(deps);
  return (brief, priorHits, ref) => gate({ prompt: brief, hasRealPersonReference: false, sessionPriorHits: priorHits }, "brief-gate", ref, true);
}

export const skipWords = async (): Promise<WordsVerdict> => "skipped";
