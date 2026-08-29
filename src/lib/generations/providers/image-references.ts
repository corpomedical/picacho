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
};

export function buildImageReferences({
  identity,
  outfit,
  prop,
}: ImageReferenceInput): string | string[] | null | undefined {
  const extras = [...(outfit ? [outfit] : []), ...(prop ? [prop] : [])];
  if (extras.length === 0) return identity;
  // A multi-character array's ORDER is its meaning (one photo per person) —
  // extras are never merged into it.
  if (Array.isArray(identity)) return identity;
  if (typeof identity === "string" && identity) return [identity, ...extras];
  // No identity photo: the user's attachment IS the reference set. Returning
  // `identity` (null) here is the bug that shipped.
  return extras;
}
