// "Perspective" (2026-08-27, operator-requested by name): one tap renders
// the character's full reference sheet — front, three-quarter, profile,
// full-body — instead of prompting each angle by hand. This module is the
// fixed shot list; the button in character-form.tsx runs each prompt
// through the EXISTING generateReferenceImage action (same identity anchor
// to the character's first photo, same per-photo allowance and refund, same
// GPT → soften → Flux ladder), so Perspective adds zero new pipeline
// behavior — it is orchestration over a proven lane.
//
// Every prompt below was validated the proving-day way before shipping:
// fired as a real render against the brand character on 2026-08-27 and
// judged by eye — true frontal, clean three-quarter, exact side profile
// with the freckles intact, head-to-shoes full body. Change a prompt and it
// must be re-proven. English on purpose: text for the model, like every
// other fixed prompt block in the codebase.

export type PerspectiveShot = {
  id: string;
  prompt: string;
};

export const PERSPECTIVE_SHOTS: PerspectiveShot[] = [
  {
    id: "front",
    prompt:
      "Studio reference portrait, facing the camera directly, head and shoulders, neutral relaxed expression, even soft lighting, plain light-gray seamless background.",
  },
  {
    id: "three-quarter",
    prompt:
      "Studio reference photo, head turned to a three-quarter view, chest-up framing, neutral relaxed expression, even soft lighting, plain light-gray seamless background.",
  },
  {
    id: "profile",
    prompt:
      "Studio reference photo, exact side profile, head and shoulders, neutral relaxed expression, even soft lighting, plain light-gray seamless background.",
  },
  {
    id: "full-body",
    prompt:
      "Studio reference photo, standing full-body shot facing the camera, whole figure visible head to shoes, arms relaxed at the sides, neutral expression, even soft lighting, plain light-gray seamless background.",
  },
];
