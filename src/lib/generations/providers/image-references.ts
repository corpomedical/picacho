// How the reference photos handed to an image model are assembled.
//
// Its own module (with no "@/" imports) so it can be unit-tested — vitest
// here has no path alias, and image.ts pulls in the provider SDK chain.
//
// The rule, and the incident that wrote it (2026-08-29, the first bug
// report from an outside user): "I sent an image with the background that I
// wanted it to use. But it didn't use it. It only used the prompt."
// The assembly used to require a character identity photo before it would
// include ANY extra reference, so a user with no character selected had
// their own attachment silently dropped — the model never saw it.

export type ImageReferenceInput = {
  /** The character's identity photo, or an array for multi-character. */
  identity: string | string[] | null | undefined;
  /** Clothing photo riding alongside the person. */
  outfit?: string | null;
  /** A user-attached reference photo (background, product, anything). */
  prop?: string | null;
  /** An earlier still from the same set, for its objects' design (Astra Sets). */
  look?: string | null;
  /** The photograph a photo set was built from, for its real materials (2026-09-15). */
  place?: string | null;
  /**
   * Close-ups from the character's expression set (2026-09-19,
   * lib/characters/expression-set.ts): the same person, so they ride right
   * after the identity photo and before anything that is not the person.
   * Beside ONE identity photo only — a multi-character array's order is its
   * meaning, and with no photo of the person a close-up must never be the
   * only face the model sees.
   */
  expressionSet?: readonly string[] | null;
  /**
   * Design sheets of the set's things (R1, 2026-09-21, sets/elements.ts):
   * one per thing with reference photos, last of all and in the order the
   * set shot's prompt numbers them ("sheet 1 first").
   */
  elements?: readonly string[] | null;
};

export function buildImageReferences({
  identity,
  outfit,
  prop,
  look,
  place,
  expressionSet,
  elements,
}: ImageReferenceInput): string | string[] | null | undefined {
  const closeUps = typeof identity === "string" && identity ? (expressionSet ?? []).filter(Boolean) : [];
  const extras = [
    ...(outfit ? [outfit] : []),
    ...(prop ? [prop] : []),
    ...(look ? [look] : []),
    // The place photograph (2026-09-15): the photo a photo set was built
    // from, riding a set shot so the render copies the real materials
    // instead of re-imagining them from words. Last, like the look — the
    // identity photos arrive first and the prompt names each extra by what
    // it shows.
    ...(place ? [place] : []),
    // The things' sheets (R1): last, in the prompt's sheet order.
    ...(elements ?? []).filter(Boolean),
  ];
  if (extras.length === 0 && closeUps.length === 0) return identity;
  // A multi-character array's ORDER is its meaning (one photo per person) —
  // extras are never merged into it.
  if (Array.isArray(identity)) return identity;
  if (typeof identity === "string" && identity) return [identity, ...closeUps, ...extras];
  // No identity photo: the user's attachment IS the reference set. Returning
  // `identity` (null) here is the bug that shipped.
  return extras;
}
