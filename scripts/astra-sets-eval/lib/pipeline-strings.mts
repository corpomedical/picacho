// What the runner takes from the product's image pipeline, and the product
// lines its stills leg mirrors.
//
//   GENERATE_RETRIES   the render attempts one pipeline call may make
//                      (pipeline.ts, inside runRealPipeline — not exported,
//                      so copied here and checked against the source at run
//                      start). C and D reserve this many renders per still.
//   the notes          what the pipeline appends about each extra reference
//                      photo. Since 2026-09-11 they live in, and are imported
//                      from, src/lib/generations/providers/reference-notes.ts
//                      — the runner keeps no copy that can drift.
//   the mirrors        lines of the product the stills leg copies what it
//                      does from, because it cannot call their code: when a
//                      look rides (runGeneration and the pipeline), how a
//                      Set's shot is sent (shootInSet: the prompt is final,
//                      the sketch rides as a reference, the look as a look),
//                      the lane and attachment flags runGeneration passes,
//                      the identity scorer's trait summary, and the Seedream
//                      endpoint (the Angle Stage's). Each is compared with
//                      its whitespace folded, so a reformat is not drift.
//
// Seedream v4 edit is not a product lane, so a Seedream set shot composes
// its own prompt from the same notes (shots.mts); the GPT Image and FLUX
// shots go through runRealPipeline itself, and the net guard's tap checks
// what they actually sent (promptParity).
//
// A runtime check, not a suite test, on purpose: a product commit must never
// be blocked by the eval. A real C or D run refuses on drift unless
// --accept-drift (recorded).

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
 * notes for the sketch (an attached photo), the look when one rides (an
 * earlier still of the set), and the person's photo beside them.
 */
export function pipelinePrompt(shotPrompt: string, o: { look?: boolean } = {}): string {
  return shotPrompt + referenceNotes({ outfit: false, attached: true, look: o.look === true, identity: true });
}

export type PipelineDrift = { ok: boolean; missing: string[] };

/** A product line the stills leg copies, compared with its whitespace folded. */
export type Mirrored = { file: string; label: string; text: string };

export const MIRRORED: readonly Mirrored[] = [
  { file: "src/lib/generations/pipeline.ts", label: "pipeline.ts: const GENERATE_RETRIES = 2", text: `const GENERATE_RETRIES = ${GENERATE_RETRIES};` },
  { file: "src/lib/generations/pipeline.ts", label: "pipeline.ts appends referenceNotes(…) to the image prompt", text: "referenceNotes({" },
  {
    file: "src/lib/generations/pipeline.ts",
    label: "pipeline.ts: a look rides only beside one identity photo",
    text: "const lookActive = Boolean(options.lookImageUrl && !usingMultiCharacterImages && options.referenceImageUrl);",
  },
  {
    file: "src/lib/generations/actions.ts",
    label: "runGeneration: a look rides on a still, one character, GPT Image or FLUX, beside an identity photo",
    text: 'const lookImageUrl = lookAttachmentUrl && referenceImageUrl && contentType === "image" && !wantsMultiCharacter && !storyboardShots && (imageModelId === "gpt-image" || imageModelId === "flux") ? absolutizeMediaUrl(lookAttachmentUrl, await getOrigin()) : null;',
  },
  { file: "src/lib/generations/actions.ts", label: "runGeneration: the strict lane when an attachment rides", text: "strictContentLane: editingAnUpload || continuationFromUpload," },
  { file: "src/lib/generations/actions.ts", label: "runGeneration: the drafter is told a photo rides", text: "hasAttachedReference: Boolean(propImageUrl)," },
  {
    file: "src/lib/generations/actions.ts",
    label: "runGeneration: the identity scorer's trait summary",
    text: 'const traitSummary = [ character?.traits?.hair ? `hair: ${character.traits.hair}` : null, character?.traits?.distinguishing_features ? `distinguishing features: ${character.traits.distinguishing_features}` : null, ] .filter(Boolean) .join("; ");',
  },
  { file: "src/lib/sets/actions.ts", label: "shootInSet: the look is the same character's when the still is theirs", text: "sameCharacter: lookTake?.character_profile_id === characterId," },
  { file: "src/lib/sets/actions.ts", label: "shootInSet: the shot prompt is final (no drafter)", text: 'fd.set("prompt_is_final", "1");' },
  { file: "src/lib/sets/actions.ts", label: "shootInSet: the sketch rides as a reference", text: '{ url: mediaUrl("chat-attachments", framePath), role: "reference" },' },
  { file: "src/lib/sets/actions.ts", label: "shootInSet: the look rides as a look", text: '...(look ? [{ url: look.url, role: "look" }] : []),' },
  { file: "src/lib/generations/angle-stage.ts", label: "angle-stage.ts: the Seedream v4 edit endpoint", text: 'const SEEDREAM_EDIT_ENDPOINT = "fal-ai/bytedance/seedream/v4/edit";' },
];

const fold = (s: string) => s.replace(/\s+/g, " ");

/** Which mirrored lines a set of sources no longer has. Pure: `read` returns a file's text, or null when it is gone. */
export function missingMirrors(read: (file: string) => string | null, mirrored: readonly Mirrored[] = MIRRORED): string[] {
  const folded = new Map<string, string | null>();
  const missing: string[] = [];
  for (const m of mirrored) {
    if (!folded.has(m.file)) {
      const src = read(m.file);
      folded.set(m.file, src === null ? null : fold(src));
    }
    const src = folded.get(m.file);
    if (src === null || src === undefined || !src.includes(fold(m.text))) missing.push(m.label);
  }
  return missing;
}

/** The copied retry count and every mirrored line still match the product. */
export function checkPipelineStrings(repoRoot: string): PipelineDrift {
  const missing = missingMirrors((file) => {
    try {
      return readFileSync(join(repoRoot, file), "utf8");
    } catch {
      return null;
    }
  });
  return { ok: missing.length === 0, missing };
}
