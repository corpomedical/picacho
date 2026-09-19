// Face verification's server sentences — English on the wire, mapped to the
// four dictionaries at display time (lib/i18n/server-text.ts), pinned by the
// truth-contract test.

export const FACE_NOT_OPEN = "Face verification is in private testing.";
export const FACE_UNAVAILABLE = "Face verification isn't available right now.";
export const FACE_NOT_CONFIGURED = "Face verification needs its BytePlus access keys first.";
export const FACE_NEEDS_CONSENT = "Tick the box to agree before the face check.";
export const FACE_NEEDS_PHOTO = "Add a photo of yourself to this character first.";
export const FACE_ALREADY_VERIFIED = "Your face is already verified. Remove it first to verify again.";
export const FACE_NOT_VERIFIED = "Verify your face first.";
export const FACE_TOO_FAST = "You're starting face checks quickly — give it a minute.";
export const FACE_COULDNT_START = "Couldn't start the face check — try again.";
export const FACE_CHARACTER_MISSING = "Couldn't find that character.";
