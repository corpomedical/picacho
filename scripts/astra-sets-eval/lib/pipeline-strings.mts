// What the runner takes from the product's image pipeline.
//
//   GENERATE_RETRIES   the render attempts one pipeline call may make
//                      (pipeline.ts, inside runRealPipeline — not exported,
//                      so copied here and checked against the source at run
//                      start). C and D reserve this many renders per still.
//   the notes          what the pipeline appends about each extra reference
//                      photo. Since 2026-09-11 they live in, and are imported
//                      from, src/lib/generations/providers/reference-notes.ts
//                      — the runner no longer keeps a copy that can drift.
//
// Seedream v4 edit is not a product lane, so a Seedream set shot composes
// its own prompt from the same notes (second sitting, design §6.5); the GPT
// Image and FLUX shots go through runRealPipeline itself.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ATTACHED_REFERENCE_NOTE,
  PERSON_REFERENCE_NOTE,
  referenceNotes,
} from "../../../src/lib/generations/providers/reference-notes.ts";

export const GENERATE_RETRIES = 2;

/** The attached-photo and person sentences, as the pipeline appends them. */
export const ATTACHMENT_LINE = `\n\n${ATTACHED_REFERENCE_NOTE}`;
export const PERSON_LINE = `\n\n${PERSON_REFERENCE_NOTE}`;

/**
 * The prompt the pipeline sends for a set shot: the shot prompt, then the
 * notes for the sketch (an attached photo) beside the person's photo. The
 * eval's shots carry no look (an earlier still): each still is judged on its
 * own sketch.
 */
export function pipelinePrompt(shotPrompt: string): string {
  return shotPrompt + referenceNotes({ outfit: false, attached: true, look: false, identity: true });
}

export type PipelineDrift = { ok: boolean; missing: string[] };

/** The copied retry count still matches, and the pipeline still appends the notes. */
export function checkPipelineStrings(repoRoot: string): PipelineDrift {
  const src = readFileSync(join(repoRoot, "src/lib/generations/pipeline.ts"), "utf8");
  const missing: string[] = [];
  if (!new RegExp(`const GENERATE_RETRIES = ${GENERATE_RETRIES};`).test(src)) missing.push(`const GENERATE_RETRIES = ${GENERATE_RETRIES};`);
  if (!src.includes("referenceNotes({")) missing.push("pipeline.ts appends referenceNotes(…) to the image prompt");
  return { ok: missing.length === 0, missing };
}
