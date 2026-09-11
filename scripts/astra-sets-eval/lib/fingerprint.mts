// What a run was measured against, so a rerun on changed instructions, a
// changed corpus or a dirty tree shows up in the manifest instead of hiding
// in a number. Local only: git is read, never written.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SET_BUILDER_INSTRUCTIONS, SET_SPEC_JSON_SCHEMA, SET_SPEC_SCHEMA_NAME } from "../../../src/lib/sets/set-builder-prompt.ts";
import { RETRY_SMALLER } from "../../../src/lib/sets/build-retry.ts";
import {
  SET_BUILD_EFFORT,
  SET_BUILD_INPUT_TOKENS,
  SET_BUILD_MAX_ATTEMPTS,
  SET_BUILD_MAX_OUTPUT_TOKENS,
  SET_CLOSE_RETRY_INPUT_TOKENS,
  SET_CLOSE_RETRY_INSTANCE_ROOM,
  SET_CLOSE_RETRY_MAX_PREVIOUS_CHARS,
} from "../../../src/lib/sets/set-config.ts";
import { canonicalJson, sha256 } from "./util.mts";

/** Every product file the runner imports or mirrors, hashed into the manifest. */
export const SRC_FILES = [
  "src/lib/sets/set-spec.ts",
  "src/lib/sets/set-builder-prompt.ts",
  "src/lib/sets/build-retry.ts",
  "src/lib/sets/closure.ts",
  "src/lib/sets/build-scene.ts",
  "src/lib/sets/exposure.ts",
  "src/lib/sets/set-config.ts",
  "src/lib/sets/set-shot-prompt.ts",
  "src/lib/sets/astra-request.ts",
  "src/lib/sets/actions.ts",
  "src/components/sets/set-view.tsx",
  "src/lib/generations/providers/astra.ts",
  "src/lib/generations/providers/fetch-with-timeout.ts",
  "src/lib/generations/content-policy.ts",
  "src/lib/generations/pipeline.ts",
  "src/lib/generations/providers/reference-notes.ts",
  "src/lib/generations/identity-gate.ts",
  "src/lib/astra/prices.ts",
  "src/lib/admin/economics.ts",
  "src/lib/generations/providers/video-models.ts",
  "src/lib/plans.ts",
  "docs/ASTRA_SETS.md",
];

export function srcHashes(repoRoot: string): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const f of SRC_FILES) {
    const p = join(repoRoot, f);
    out[f] = existsSync(p) ? sha256(readFileSync(p)) : null;
  }
  return out;
}

/**
 * sha256 of everything that shapes a build request: the instructions, the
 * schema and its name, the retry wording and the caps. Two runs with the
 * same fingerprint asked the model the same thing.
 */
export function promptFingerprint(): string {
  return sha256(
    canonicalJson({
      instructions: SET_BUILDER_INSTRUCTIONS,
      schema: SET_SPEC_JSON_SCHEMA,
      schemaName: SET_SPEC_SCHEMA_NAME,
      retrySmaller: RETRY_SMALLER,
      caps: {
        SET_BUILD_EFFORT,
        SET_BUILD_INPUT_TOKENS,
        SET_BUILD_MAX_ATTEMPTS,
        SET_BUILD_MAX_OUTPUT_TOKENS,
        SET_CLOSE_RETRY_INPUT_TOKENS,
        SET_CLOSE_RETRY_INSTANCE_ROOM,
        SET_CLOSE_RETRY_MAX_PREVIOUS_CHARS,
      },
    }),
  );
}

export type GitState = { head: string | null; dirty: string[]; error?: string };

export function gitState(repoRoot: string): GitState {
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain", "--", "src/lib/sets", "src/lib/generations", "src/lib/astra", "src/components/sets"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    return { head, dirty };
  } catch (e) {
    return { head: null, dirty: [], error: e instanceof Error ? e.message.slice(0, 200) : String(e) };
  }
}

/** The line of docs/ASTRA_SETS.md that carries a sentence, or null when it is gone. */
export function docLineOf(repoRoot: string, sentence: string): number | null {
  const p = join(repoRoot, "docs/ASTRA_SETS.md");
  if (!existsSync(p)) return null;
  const i = readFileSync(p, "utf8").split("\n").findIndex((l) => l.includes(sentence));
  return i < 0 ? null : i + 1;
}
