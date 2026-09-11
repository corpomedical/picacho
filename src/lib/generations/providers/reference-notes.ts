// What the image prompt says about each extra reference photo riding a
// render beside the person's own (pipeline.ts appends these after the prompt
// has been reviewed, so they cannot disturb the trait gate).
//
// Its own module, with no "@/" imports, so the words are tested — every
// sentence here is an instruction the image model acts on, and one of them
// ("every other reference photo is the person") decides whose face it draws.
// The outfit, attached and person sentences moved here unchanged from
// pipeline.ts (2026-09-11).
//
// The look photo (2026-09-11, Astra Sets): an earlier still from the same
// set, so the car, furniture and finishes stay the same objects from shot to
// shot. It shows the place finished — usually with a person in it — so it
// needs its own sentence: left out of the list, it would fall under "every
// other reference photo is the person", and the model would take a face from
// whoever stands in it. Which parts of it to keep is the set's own prompt's
// job (set-shot-prompt.ts); this sentence only fences off identity.

export const OUTFIT_REFERENCE_NOTE =
  "One of the reference photos shows only an outfit laid out, with no person in it: dress the person in exactly that outfit, reproducing its design, colours, logos, and stitching.";

export const ATTACHED_REFERENCE_NOTE =
  "One of the reference photos is an image the user attached — the prompt says how to use it. Follow the prompt's instructions about it, and do not copy its framing or composition unless the prompt asks for that.";

export const LOOK_REFERENCE_NOTE =
  "One of the reference photos is an earlier picture of this same place — the prompt says what to take from it. Never take the face, hair or identity of anyone in it.";

export const PERSON_REFERENCE_NOTE =
  "Every other reference photo is the person — match their face, hair, and identity exactly.";

/**
 * The sentences to append for the extra photos that actually ride this
 * render. `identity` is whether a photo of the person is among the
 * references: with none, the extras are the only references, and calling
 * any of them "the person" would be a lie the model acts on.
 */
export function referenceNotes(input: { outfit: boolean; attached: boolean; look: boolean; identity: boolean }): string {
  let notes = "";
  if (input.outfit) notes += `\n\n${OUTFIT_REFERENCE_NOTE}`;
  if (input.attached) notes += `\n\n${ATTACHED_REFERENCE_NOTE}`;
  if (input.look) notes += `\n\n${LOOK_REFERENCE_NOTE}`;
  if ((input.outfit || input.attached || input.look) && input.identity) notes += `\n\n${PERSON_REFERENCE_NOTE}`;
  return notes;
}
