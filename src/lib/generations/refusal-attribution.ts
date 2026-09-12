// Whose words a refused prompt was (2026-09-12). Server-only.
//
// A refusal of the person's own words is logged against them, and for the
// next hour their other requests are judged more strictly (policy-log.ts
// recentRefusalCount → sessionPriorHits). A Set shot's prompt is mostly not
// theirs: Astra wrote the set's description (already judged in the strict
// lane when the set was built) and Picacho wrote the framing sentences; only
// the direction they typed is theirs, and often there is none. So when such
// a prompt is refused, the part that is not theirs is judged again on its
// own, fresh: refused alone, the refusal was the model's words, and it is
// logged under the model (provider "astra", which never counts); passing
// alone, their words made the difference, and it counts as it always did.
//
// NOT A REQUEST FIELD. runGeneration is a server action any browser can
// call with any form fields, so a flag there would let anyone mark their
// own words as the model's. The model-written part is held in server memory
// for the one call that set it (AsyncLocalStorage), by the one caller that
// built the prompt (sets/actions.ts shootInSet); nothing a request carries
// can set or change it.

import { AsyncLocalStorage } from "node:async_hooks";
import { decideRefusalProvider, type ModelWrittenPrompt } from "./refusal-attribution-core";

export type { ModelWrittenPrompt };

const context = new AsyncLocalStorage<ModelWrittenPrompt>();

/** Runs `fn` knowing which part of the prompt it sends is model-written. */
export function withModelWrittenPrompt<T>(written: ModelWrittenPrompt, fn: () => Promise<T>): Promise<T> {
  return context.run(written, fn);
}

/**
 * Who a refusal of `prompt` is logged against: null for the person (it
 * counts), or the model's provider tag. `refusedAlone` judges a text as the
 * refused prompt was judged, with no session history.
 */
export async function refusalProviderFor(
  prompt: string,
  refusedAlone: (text: string) => Promise<boolean>,
): Promise<string | null> {
  return decideRefusalProvider(context.getStore() ?? null, prompt, refusedAlone);
}
