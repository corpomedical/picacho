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

// Count-neutral since 2026-09-15: a set shot can now carry TWO place
// photos — the design sheet and, on a photo set, the very photograph the
// set was built from — and a sentence claiming only ONE non-person place
// photo would leave the second to fall under "every other reference photo
// is the person". "Any" covers however many ride; the prompt's own
// sentences say which is which.
export const LOOK_REFERENCE_NOTE =
  "Any reference photo showing this place itself — an earlier picture of it, a design sheet of its objects, or a photograph of the location — is scenery, and the prompt says what to take from it. Never take the face, hair or identity of anyone in it.";

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
