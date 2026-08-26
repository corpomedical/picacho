// Cinema presets (2026-08-26, operator-approved after the Higgsfield Cinema
// Studio 4 review and a 6/6 sample validation on Seedance 2.0).
//
// The whole feature is film craft encoded as FIXED, PRE-TESTED prompt
// blocks — the Higgsfield insight without their private models: their
// Cinema Studio runs the same preset mechanism over Seedance 2.5, the
// model family Picacho already ships. Nothing here guesses, classifies, or
// asks a model to do something unproven: every block below was (or is
// being) fired as a real render on the Seedance 2.0 lane and reviewed by
// eye before it may ship; a preset that cannot prove its look on screen is
// deleted from this file, not fixed forward in production. The proof
// render itself becomes the preset's thumbnail in the composer.
//
// Blocks are English on purpose — they are text FOR THE MODEL, appended
// server-side (applyCinemaPreset in actions.ts) so the compiled prompt in
// the pipeline log always shows exactly what rode. Display names are i18n;
// blocks are not. Never put a living artist's or director's name in a
// block — looks are described in craft terms (lenses, light, grade).

export type CinemaPresetCategory = "move" | "look";

export type CinemaPreset = {
  id: string;
  category: CinemaPresetCategory;
  // The tested, model-facing text. Byte-identical to what the validation
  // matrix fired. Change it and it must be re-proven before shipping.
  block: string;
};

export const CINEMA_PRESETS: CinemaPreset[] = [
  // ——— Camera moves ———
  {
    id: "crash-zoom",
    category: "move",
    block:
      "Camera: rapid crash zoom from a wide view punching in fast to her face, whip-fast with slight motion blur. Modern digital cinema camera, clean sharp lens, f/4, high-energy look. Her eyes keep their natural color.",
  },
  {
    id: "dolly-35mm",
    category: "move",
    block:
      "Camera: one slow, smooth dolly-in from medium shot to close-up. Shot on 35mm film, vintage anamorphic lens with halation and gentle film grain, shallow depth of field at f/1.4, warm tungsten palette, prestige cinema drama grade.",
  },
  {
    id: "handheld-chase",
    category: "move",
    block:
      "Camera: frantic handheld camera chasing right behind her as she breaks into a run, shaky urgent movement, motion blur, wide lens close to the action. Gritty action-thriller look, muted desaturated cool grade with crushed blacks.",
  },
  {
    id: "orbit",
    category: "move",
    block:
      "Camera: continuous orbit around her as she stands still and looks up — the camera keeps circling the entire clip, steady gimbal glide, never stopping. Modern digital camera, clean sharp lens, glossy music-video look with vivid saturated color grade.",
  },
  {
    id: "crane-reveal",
    category: "move",
    block:
      "Camera: starts high above, looking down at the scene, then cranes smoothly down and in until it settles at her eye level in a medium close-up. One continuous descending move, elegant and deliberate, cinematic wide lens.",
  },
  {
    id: "aerial-pullback",
    category: "move",
    block:
      "Camera: starts close on her face, then pulls up and back into a rising aerial shot, revealing the whole scene around her growing smaller below. One continuous ascending drone move, epic scale reveal.",
  },
  {
    id: "low-hero",
    category: "move",
    block:
      "Camera: low-angle hero shot from near the ground looking up at her, slowly pushing in, wide lens, towering imposing framing against the sky. Powerful, monumental mood.",
  },
  {
    id: "bullet-time",
    category: "move",
    block:
      "Time freezes mid-action: falling rain hangs motionless in the air while the camera sweeps in a smooth arc around her frozen in place, then time resumes as the camera settles. Crisp frozen droplets, dramatic suspended-moment lighting.",
  },
  {
    id: "slowmo-glamour",
    category: "move",
    block:
      "Extreme slow motion, 120fps feel: her hair and clothing drift weightlessly, micro-expressions readable, every droplet and dust mote visible. Glossy commercial lighting, gentle push-in, luxurious slow-motion glamour.",
  },
  // ——— Looks ———
  {
    id: "noir",
    category: "look",
    block:
      "Film noir look: hard backlight from a streetlamp behind her (contre-jour), deep black shadows, high-contrast black-and-white with silver highlights, slow push-in, 1940s noir framing, thin atmospheric haze.",
  },
  {
    id: "film-80s",
    category: "look",
    block:
      "Era: 1980s consumer camcorder. VHS home-video look — soft analog degradation, chroma bleed, faint scanlines, slightly washed colors, static tripod shot with one clumsy manual zoom, nostalgic home-movie vibe.",
  },
  {
    id: "golden-hour",
    category: "look",
    block:
      "Golden hour: low warm sun directly behind her, rim light glowing in her hair, soft lens flare, long shadows, honeyed romantic grade, a gentle breeze. Tender, warm, intimate mood.",
  },
  {
    id: "horror",
    category: "look",
    block:
      "Horror look: cold teal-green grade, a single flickering light source, deep shadows that seem to move, slow uneasy push-in, faint fog at the floor, dread-soaked atmosphere. She senses something off-screen.",
  },
  {
    id: "neon-rain",
    category: "look",
    block:
      "Cyberpunk neon rain: drenched surfaces mirroring pink and cyan signs, wet hair and skin catching colored light, atmospheric haze, reflections everywhere, moody synthwave grade, slow cinematic drift.",
  },
  {
    id: "storybook",
    category: "look",
    block:
      "Symmetrical storybook look: perfectly centered composition, flat frontal lighting, pastel color palette, meticulous tidy production design, deadpan whimsical framing, static tripod camera, one precise lateral slide if the camera moves at all.",
  },
  {
    id: "documentary",
    category: "look",
    block:
      "Vérité documentary: handheld 16mm feel with natural film grain, available light only, imperfect searching framing that finds her like a real crew following the moment, honest muted colors, no glamour.",
  },
  {
    id: "epic-fantasy",
    category: "look",
    block:
      "Epic fantasy scale: vast misty landscape dwarfing her, god rays breaking through heavy clouds, wind-blown hair and clothing, sweeping slow aerial approach, painterly light, mythic grandeur.",
  },
  {
    id: "western-sunset",
    category: "look",
    block:
      "Western: dusty amber sunset, heat shimmer in the air, blinding low sun, wide desolate framing with her small against the horizon, slow push-in, gritty warm film grade, wind-carried dust.",
  },
  {
    id: "dream-haze",
    category: "look",
    block:
      "Dream sequence: soft diffusion blooming around every highlight, milky haze, gently overexposed whites, floating drifting camera, pastel wash, the softness of a half-remembered memory.",
  },
];

export function getCinemaPreset(id: string): CinemaPreset | null {
  return CINEMA_PRESETS.find((p) => p.id === id) ?? null;
}

// Server-side application (actions.ts): the block rides AFTER the user's
// prompt, separated by a blank line — same position the validation matrix
// fired it in. Unknown/empty ids are a no-op, never an error: a stale
// client sending a deleted preset id must not lose its generation over it.
export function applyCinemaPreset(prompt: string, presetId: string | null | undefined): string {
  if (!presetId) return prompt;
  const preset = getCinemaPreset(presetId);
  if (!preset) return prompt;
  return `${prompt.trim()}\n\n${preset.block}`;
}
