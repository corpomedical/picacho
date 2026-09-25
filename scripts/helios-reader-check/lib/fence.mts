// The per-call fence the live runner hands the reader as its fetch (Helios
// Cut 2, step 13, 2026-09-25): each request's body is checked before it is
// sent — the address, the model, the answer cap the call was reserved at,
// and for v2 the pinned `reasoning_effort: "none"`. askShotReader's one
// retry without that setting (shot-words.ts; check of the spec, item 8) is
// never sent from here: it is refused, the reading comes back empty, and
// the run stops for the owner to decide — that retry's cap is 1,500 tokens,
// which the call was not reserved for.
//
// It also reads the answer's usage (readerUsageOf: token counts and how it
// ended, never a word) so the spend guard settles each call from what it
// really used.

import { readerUsageOf, SHOT_WORDS_MODEL, type ReaderUsage } from "../../../src/lib/sets/shot-words.ts";
import type { CallFacts } from "./grade.mts";

export const READER_URL = "https://api.openai.com/v1/chat/completions";

export type Fence = {
  fetch: typeof fetch;
  /** Requests that went out on this reading. */
  sent: number;
  /** A request refused before it was sent, and why. */
  refused: string | null;
  /** The reader dropped the pinned reasoning_effort (its one retry): the run stops. */
  effortRefused: boolean;
  call: CallFacts;
  usage: ReaderUsage | null;
};

/**
 * A fresh fence for one reading: v2 must send `reasoning_effort: "none"`
 * and at most `cap`; v1 must not send the setting, and at most `cap`.
 */
export function fenceFor(o: { version: "v2" | "v1"; cap: number }): Fence {
  const f: Fence = {
    sent: 0,
    refused: null,
    effortRefused: false,
    call: { status: null, finish: null, reasoning: null },
    usage: null,
    fetch: (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<string, unknown>;
      } catch {
        body = {};
      }
      const why =
        url !== READER_URL || (init?.method ?? "GET").toUpperCase() !== "POST"
          ? `not the reader's address (${url})`
          : body.model !== SHOT_WORDS_MODEL
            ? `model ${String(body.model)}, not ${SHOT_WORDS_MODEL}`
            : typeof body.max_completion_tokens !== "number" || body.max_completion_tokens > o.cap
              ? `an answer cap of ${String(body.max_completion_tokens)}, over the ${o.cap} this call was reserved at`
              : o.version === "v2" && body.reasoning_effort !== "none"
                ? "no pinned reasoning_effort (the reader's retry after the API refused it)"
                : o.version === "v1" && body.reasoning_effort !== undefined
                  ? "a reasoning_effort v1 never sends"
                  : null;
      if (why) {
        f.refused = why;
        if (o.version === "v2" && body.reasoning_effort === undefined && url === READER_URL) f.effortRefused = true;
        throw new Error(`reader check fence: ${why}`);
      }
      f.sent += 1;
      let res: Response;
      try {
        res = await fetch(input, init);
      } catch (err) {
        f.call.status = -1;
        throw err;
      }
      f.call.status = res.status;
      if (res.ok) {
        try {
          const data: unknown = await res.clone().json();
          f.usage = readerUsageOf(data, SHOT_WORDS_MODEL);
          f.call.finish = f.usage.finish;
          f.call.reasoning = f.usage.reasoning;
        } catch {
          f.usage = null;
        }
      }
      return res;
    }) as typeof fetch,
  };
  return f;
}
