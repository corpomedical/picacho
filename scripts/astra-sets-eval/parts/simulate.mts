// The dry run's fakes. Nothing here touches the network: a fake builder
// answers from the product's own recorded Astra sets
// (src/lib/sets/fixtures-*.json), a fake gate allows or refuses by index,
// and a fake engine hands back the frame as the still. Every row a fake
// produces carries simulated: true, and report refuses to put one under a
// bar.
//
// Outcomes rotate by item index, so three items already walk the retry
// paths that matter:
//   0  valid and closed                      → delivered after 1 attempt
//   1  open, then a mend that closes it      → delivered after 2 (retry-close)
//   2  not JSON, then a valid retry          → delivered after 2 (retry-plain)
//   3  incomplete, then a smaller retry      → delivered after 2 (retry-smaller)
//   4  refused                               → failed, no retry
// A photo build (fakePhotoAnswer) walks the same five, except that item 2's
// first answer is a recorded set with its cameras taken out: the normaliser
// gives it a stand-in camera, which a photo build counts as invalid.
// Fake usage sits at the cap bounds (a photo build's at the photo caps), so
// a simulated build costs exactly its worst case: the simulated spend
// equals the ceiling.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SET_BUILD_INPUT_TOKENS,
  SET_BUILD_MAX_OUTPUT_TOKENS,
  SET_CLOSE_RETRY_INPUT_TOKENS,
  SET_PHOTO_BUILD_INPUT_TOKENS,
  SET_PHOTO_BUILD_MAX_OUTPUT_TOKENS,
  SET_PHOTO_CLOSE_RETRY_INPUT_TOKENS,
} from "../../../src/lib/sets/set-config.ts";
import type { AttemptKind, TransportResult, Usage, WordsVerdict } from "../lib/build-flow.mts";
import type { GateReading, GateVerdict } from "../lib/words-gate.mts";
import { baselineInputBoundChars } from "../lib/prices.mts";
import { REPO_ROOT } from "../lib/util.mts";

export const FIXTURES = ["showroom-closed", "showroom-open", "rainy-market", "beach"] as const;
export type FixtureName = (typeof FIXTURES)[number];

const cache = new Map<string, string>();
export function fixtureText(name: FixtureName): string {
  let t = cache.get(name);
  if (!t) {
    t = readFileSync(join(REPO_ROOT, `src/lib/sets/fixtures-${name}.json`), "utf8");
    cache.set(name, t);
  }
  return t;
}

export function fixtureJson(name: FixtureName): unknown {
  return JSON.parse(fixtureText(name));
}

/** Usage at the cap bounds for an Astra-shaped (Responses) or Anthropic-shaped answer; a photo build's at the photo caps. */
export function capUsage(provider: "openai" | "anthropic", attempt: AttemptKind, baseline: boolean, photo = false): Usage {
  const first = attempt === "first";
  const input = baseline
    ? baselineInputBoundChars(first ? "first" : "retry")
    : photo
      ? first
        ? SET_PHOTO_BUILD_INPUT_TOKENS
        : SET_PHOTO_CLOSE_RETRY_INPUT_TOKENS
      : first
        ? SET_BUILD_INPUT_TOKENS
        : SET_CLOSE_RETRY_INPUT_TOKENS;
  const output = photo ? SET_PHOTO_BUILD_MAX_OUTPUT_TOKENS : SET_BUILD_MAX_OUTPUT_TOKENS;
  if (provider === "anthropic") {
    return { input_tokens: input, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: output };
  }
  return {
    input_tokens: input,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: baseline ? 0 : input },
    output_tokens: output,
    output_tokens_details: { reasoning_tokens: 0 },
  };
}

/** The scripted answer for item `index` on its `attempt`-th attempt (1 or 2). */
export function fakeAnswer(index: number, attempt: number, usage: Usage): TransportResult {
  const done = (name: FixtureName): TransportResult => ({ state: "done", text: fixtureText(name), usage });
  switch (index % 5) {
    case 0:
      return done("showroom-closed");
    case 1:
      return attempt === 1 ? done("showroom-open") : done("showroom-closed");
    case 2:
      return attempt === 1 ? { state: "done", text: '{"title": "cut short', usage } : done("rainy-market");
    case 3:
      return attempt === 1 ? { state: "failed", kind: "incomplete", detail: "max_output_tokens (simulated)", usage } : done("beach");
    default:
      return { state: "failed", kind: "refused", detail: "model refusal (simulated)", usage };
  }
}

/** A recorded set with no cameras: the normaliser adds its stand-in camera 1 ("default_camera"). */
export function camerasRemoved(name: FixtureName): string {
  return JSON.stringify({ ...(fixtureJson(name) as Record<string, unknown>), cameras: [] });
}

/** The scripted answer for photo build `index`: fakeAnswer's, except item 2 first comes back without a camera of its own. */
export function fakePhotoAnswer(index: number, attempt: number, usage: Usage): TransportResult {
  if (index % 5 === 2 && attempt === 1) return { state: "done", text: camerasRemoved("showroom-closed"), usage };
  return fakeAnswer(index, attempt, usage);
}

/** Fake notes gate for D's photo leg: allows every note, with no scores. */
export function fakeNotesGate(): GateReading {
  return { verdict: "allowed", scores: undefined };
}

/** Fake picture check for D's photo leg: refuses item 1 of every 4 (like the fake brief gate), allows the rest. */
export function fakePictureCheck(index: number): GateVerdict {
  return index % 4 === 1 ? { refused: "simulated" } : "allowed";
}

/** Fake words gate: allows, except every seventh reading, which it refuses. */
export function fakeWords(counter: { n: number }): () => Promise<WordsVerdict> {
  return async () => {
    counter.n += 1;
    return counter.n % 7 === 0 ? { refused: "simulated" } : "allowed";
  };
}

/** Fake brief gate for Part D: refuses item 1 of every 4, allows the rest. */
export function fakeBriefGate(index: number): GateVerdict {
  return index % 4 === 1 ? { refused: "simulated" } : "allowed";
}
