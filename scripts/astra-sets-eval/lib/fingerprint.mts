// What a run was measured against, so a rerun on changed instructions, a
// changed corpus or a dirty tree shows up in the manifest instead of hiding
// in a number. Local only: git is read, never written.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SET_BUILDER_INSTRUCTIONS, SET_PHOTO_RULES, SET_SPEC_JSON_SCHEMA, SET_SPEC_SCHEMA_NAME } from "../../../src/lib/sets/set-builder-prompt.ts";
import { RETRY_SMALLER, RETRY_SMALLER_PHOTO } from "../../../src/lib/sets/build-retry.ts";
import { MATCH_SHOT_INPUT_TEXT, MATCH_SHOT_INSTRUCTIONS, MATCH_SHOT_JSON_SCHEMA, MATCH_SHOT_SCHEMA_NAME } from "../../../src/lib/sets/match-shot.ts";
import {
  SET_BUILD_EFFORT,
  SET_BUILD_INPUT_TOKENS,
  SET_BUILD_MAX_ATTEMPTS,
  SET_BUILD_MAX_OUTPUT_TOKENS,
  SET_CLOSE_RETRY_INPUT_TOKENS,
  SET_CLOSE_RETRY_INSTANCE_ROOM,
  SET_CLOSE_RETRY_MAX_PREVIOUS_CHARS,
  SET_PHOTO_BUILD_EFFORT,
  SET_PHOTO_BUILD_INPUT_TOKENS,
  SET_PHOTO_BUILD_MAX_OUTPUT_TOKENS,
  SET_PHOTO_CLOSE_RETRY_INPUT_TOKENS,
  SET_PHOTO_MAX_SIDE_PX,
  SET_MATCH_DEADLINE_MS,
  SET_MATCH_EFFORT,
  SET_MATCH_INPUT_TOKENS,
  SET_MATCH_MAX_OUTPUT_TOKENS,
  SET_MATCH_POLL_MS,
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
  "src/lib/sets/build-tick.ts",
  "src/lib/sets/photo.ts",
  "src/lib/sets/photo-client.ts",
  "src/lib/sets/compare.ts",
  "src/lib/sets/match-shot.ts",
  "src/lib/sets/match-actions.ts",
  "src/components/sets/set-view.tsx",
  "src/lib/generations/providers/astra.ts",
  "src/lib/generations/providers/fetch-with-timeout.ts",
  "src/lib/generations/content-policy.ts",
  "src/lib/generations/output-policy.ts",
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

/**
 * A photo build's own: the words' fingerprint, plus the photo rules, the
 * photo retry's wording, the photo caps and effort. Kept apart, so a photo
 * change never starts a new canary baseline.
 */
export function photoPromptFingerprint(): string {
  return sha256(
    canonicalJson({
      base: promptFingerprint(),
      rules: SET_PHOTO_RULES,
      retrySmaller: RETRY_SMALLER_PHOTO,
      caps: { SET_PHOTO_BUILD_EFFORT, SET_PHOTO_BUILD_INPUT_TOKENS, SET_PHOTO_BUILD_MAX_OUTPUT_TOKENS, SET_PHOTO_CLOSE_RETRY_INPUT_TOKENS, SET_PHOTO_MAX_SIDE_PX },
    }),
  );
}

/**
 * A Match-this-shot read's own (Part E): its instructions, line, schema and
 * name, the effort, the caps and the clock it is read on. Two E runs with the
 * same fingerprint asked both builders the same thing.
 */
export function matchPromptFingerprint(): string {
  return sha256(
    canonicalJson({
      instructions: MATCH_SHOT_INSTRUCTIONS,
      line: MATCH_SHOT_INPUT_TEXT,
      schema: MATCH_SHOT_JSON_SCHEMA,
      schemaName: MATCH_SHOT_SCHEMA_NAME,
      caps: { SET_MATCH_EFFORT, SET_MATCH_INPUT_TOKENS, SET_MATCH_MAX_OUTPUT_TOKENS, SET_MATCH_POLL_MS, SET_MATCH_DEADLINE_MS },
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
