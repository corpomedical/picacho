// The three things the runner copies from src/lib/generations/pipeline.ts
// because pipeline.ts does not export them — each checked against the
// product source at run start (checkPipelineStrings), so a product change
// shows up as drift instead of a silently stale copy.
//
//   GENERATE_RETRIES   the render attempts one pipeline call may make
//                      (pipeline.ts, inside runRealPipeline). C and D reserve
//                      this many renders per still.
//   ATTACHMENT_LINE    appended to the prompt when a user attachment rides
//                      (the set frame, in a set shot).
//   PERSON_LINE        appended when an identity photo rides beside it.
//
// Seedream v4 edit is not a product lane, so a Seedream set shot composes
// its own prompt from these two sentences (second sitting, design §6.5);
// the GPT Image and FLUX shots go through runRealPipeline itself.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const GENERATE_RETRIES = 2;

export const ATTACHMENT_LINE =
  "\n\nOne of the reference photos is an image the user attached — the prompt says how to use it. Follow the prompt's instructions about it, and do not copy its framing or composition unless the prompt asks for that.";

export const PERSON_LINE = "\n\nEvery other reference photo is the person — match their face, hair, and identity exactly.";

/** The prompt the pipeline sends for a set shot: the shot prompt plus both sentences. */
export function pipelinePrompt(shotPrompt: string): string {
  return shotPrompt + ATTACHMENT_LINE + PERSON_LINE;
}

export type PipelineDrift = { ok: boolean; missing: string[] };

/** Every mirrored piece must still appear, verbatim, in pipeline.ts. */
export function checkPipelineStrings(repoRoot: string): PipelineDrift {
  const src = readFileSync(join(repoRoot, "src/lib/generations/pipeline.ts"), "utf8");
  const missing: string[] = [];
  if (!new RegExp(`const GENERATE_RETRIES = ${GENERATE_RETRIES};`).test(src)) missing.push(`const GENERATE_RETRIES = ${GENERATE_RETRIES};`);
  for (const line of [ATTACHMENT_LINE, PERSON_LINE]) {
    const literal = line.replace(/\n/g, "\\n");
    if (!src.includes(literal)) missing.push(line.trim().slice(0, 60) + "…");
  }
  return { ok: missing.length === 0, missing };
}
