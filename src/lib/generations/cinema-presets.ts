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

export type CinemaPresetCategory = "move" | "look" | "fx";

export type CinemaPreset = {
  id: string;
  category: CinemaPresetCategory;
  // The tested, model-facing text. Byte-identical to what the validation
  // matrix fired. Change it and it must be re-proven before shipping.
  block: string;
  // Absent = true (every original entry shipped proven). `proven: false`
  // marks a DRAFTED block awaiting its validation render (2026-08-27, FX +
  // lighting approved with fal balance low — "add it and we test later"):
  // invisible in the composer, refused by getCinemaPreset, exempt from the
  // thumbnail test. Validation day flips it true, adds the proof assets,
  // and nothing else changes.
  proven?: boolean;
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
  // ——— Lighting (drafted 2026-08-27, operator-approved; PENDING VALIDATION —
  // proven: false keeps every entry invisible until its proof render) ———
  {
    id: "candlelight",
    category: "look",
    proven: false,
    block:
      "Lighting: the scene is lit only by warm candlelight — a soft flickering key from below-left, deep amber tones, gentle shadow dance on the walls, intimate and quiet. The face stays clearly lit by the flame's glow.",
  },
  {
    id: "window-light",
    category: "look",
    proven: false,
    block:
      "Lighting: soft directional daylight from one large window to the side — gentle falloff across the face, airy natural shadows, calm morning stillness, honest documentary-portrait light.",
  },
  {
    id: "rembrandt",
    category: "look",
    proven: false,
    block:
      "Lighting: classic Rembrandt portrait light — a single warm key high to one side forming the small triangle of light on the shadow cheek, deep soft background, painterly chiaroscuro, timeless studio portrait.",
  },
  {
    id: "blue-hour",
    category: "look",
    proven: false,
    block:
      "Lighting: blue hour just after sunset — cool ambient dusk sky as the base, warm practical lights glowing in the background, soft cyan-and-amber contrast on the face, quiet cinematic melancholy.",
  },
  {
    id: "hard-sun",
    category: "look",
    proven: false,
    block:
      "Lighting: hard direct noon sunlight — crisp dark shadows with sharp edges, squint-bright highlights, saturated sky, bold fashion-editorial contrast. The face stays clearly visible in the sun.",
  },
  {
    id: "ring-light",
    category: "look",
    proven: false,
    block:
      "Lighting: modern beauty ring light straight on — even, shadowless glow on the face with the signature circular catchlight in both eyes, clean vlogger-studio look, flattering and bright.",
  },
  {
    id: "backlit-silhouette",
    category: "look",
    proven: false,
    block:
      "Lighting: strong backlight rims the subject in glowing edge light, face lifted just out of full silhouette by a faint soft fill — hair haloed, atmosphere hazy, dramatic and cinematic. Features stay recognizable.",
  },
  {
    id: "studio-softbox",
    category: "look",
    proven: false,
    block:
      "Lighting: clean commercial studio lighting — large softbox key with gentle wraparound, subtle rim light, seamless backdrop softly graded, polished premium-campaign finish.",
  },

  // ——— FX (drafted 2026-08-27 from the approved proposal; PENDING
  // VALIDATION — every block stages the effect AROUND the character and
  // explicitly protects the face; face-morph effects are excluded by
  // design) ———
  {
    id: "fx-explosion",
    category: "fx",
    proven: false,
    block:
      "FX: the subject walks slowly toward the camera with a calm, unbothered expression while a massive practical explosion erupts in the background behind them — a rolling orange fireball with debris and a dust shockwave. They never look back. Slow motion, embers drifting past the lens, warm rim light from the blast. The face stays clearly visible and unchanged.",
  },
  {
    id: "fx-smoke-reveal",
    category: "fx",
    proven: false,
    block:
      "FX: dense gray smoke fills the frame; the subject steps forward out of the smoke into a clean shaft of light, sharpening into full focus as the haze parts around their shoulders. Fine particles drift in the beam. The face emerges fully lit and unmistakable.",
  },
  {
    id: "fx-lightning",
    category: "fx",
    proven: false,
    block:
      "FX: under a dark storm sky, jagged lightning bolts strike the ground behind the subject, each flash throwing hard white light across their face while wind pulls at their hair and clothes. They stand their ground, steady, facing the camera. Rain stays a fine mist; the face stays sharply visible in every flash.",
  },
  {
    id: "fx-glitch-teleport",
    category: "fx",
    proven: false,
    block:
      "FX: the subject stands facing the camera; their outline briefly fractures into digital glitch slices and RGB-split shards that scatter sideways, then instantly reassemble into the same person one step closer to the lens. The face is fully intact and identical before and after; the distortion lasts only an instant.",
  },
  {
    id: "fx-rain-burst",
    category: "fx",
    proven: false,
    block:
      "FX: a sudden heavy downpour begins mid-shot — slow-motion raindrops streak and splash around the subject, backlit so every drop glows, while they tilt their face slightly up into the rain. Wet hair, glistening skin, cinematic teal-and-amber light. The face stays clearly visible through the rain.",
  },
  {
    id: "fx-fire-aura",
    category: "fx",
    proven: false,
    block:
      "FX: thin ribbons of stylized flame ignite along the subject's outline — shoulders, arms, silhouette — like a rising aura of energy, while they look into the camera with quiet intensity. The flames stay strictly outside the silhouette: no fire on the face or skin, no burning; the face remains perfectly clear and unharmed.",
  },
  {
    id: "fx-levitation",
    category: "fx",
    proven: false,
    block:
      "FX: the subject rises slowly and weightlessly a meter off the ground, arms relaxed, hair and clothing drifting as if underwater, small pebbles and dust floating up around them. The camera tilts up slightly to follow. Serene expression, face toward the lens the whole time.",
  },
  {
    id: "fx-confetti",
    category: "fx",
    proven: false,
    block:
      "FX: confetti cannons fire from both sides just off-frame — thousands of colorful paper pieces and gold streamers burst across the scene in slow motion while the subject laughs and raises their arms in celebration. Bright festive key light; confetti drifts between subject and camera without covering the face.",
  },
  {
    id: "fx-time-freeze",
    category: "fx",
    proven: false,
    block:
      "FX: everything in the scene freezes mid-motion — passers-by locked mid-stride, a splash suspended in the air, papers hanging — while the subject alone keeps walking naturally through the frozen world, glancing around at it. Smooth lateral tracking shot. The face stays clear and recognizable throughout.",
  },
  {
    id: "fx-product-reveal",
    category: "fx",
    proven: false,
    block:
      "FX: the subject raises the product into frame at chest height and presents it to the camera as a soft sweep of golden light passes across it; gentle push-in on the product, then focus returns to the subject's confident smile. Clean studio backdrop, premium commercial lighting. Product label readable, face clearly visible.",
  },
];

export function getCinemaPreset(id: string): CinemaPreset | null {
  // Unproven drafts are invisible to the product: the composer never shows
  // them and a crafted/stale id resolving here gets the same null a deleted
  // preset gets — the send proceeds with no block, never with untested text.
  const preset = CINEMA_PRESETS.find((p) => p.id === id) ?? null;
  return preset && preset.proven !== false ? preset : null;
}

export function isProvenPreset(p: CinemaPreset): boolean {
  return p.proven !== false;
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
