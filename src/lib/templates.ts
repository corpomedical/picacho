// Curated generation templates — ready-made scenes a person drops their own
// character into. Tapping one lands on the composer with the prompt
// prefilled (the existing ?prompt=&type= handoff — review-and-edit, never
// auto-send), so a template is just a well-written starting point, not a
// separate pipeline.
//
// Kept in code like credit-packs.json: this is admin-curated content that
// ships with the app. Prompts are deliberately English-only — the same
// convention as the guides — because every model in the catalog follows
// English best; the page chrome around them is translated as usual.
// [Square brackets] mark the slots the person is expected to personalise.

export type TemplateCategory = "portrait" | "product" | "social" | "marketing" | "story";

export type GenerationTemplate = {
  id: string;
  category: TemplateCategory;
  contentType: "image" | "video";
  title: string;
  description: string;
  prompt: string;
};

export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  "portrait",
  "product",
  "social",
  "marketing",
  "story",
];

export const TEMPLATES: GenerationTemplate[] = [
  // ---- portraits --------------------------------------------------------
  {
    id: "linkedin-headshot",
    category: "portrait",
    contentType: "image",
    title: "LinkedIn headshot",
    description: "A studio-grade professional portrait for profiles and bios.",
    prompt:
      "Professional headshot: wearing a tailored [charcoal] blazer against a softly blurred modern office background, confident warm smile, soft studio key light, shallow depth of field, corporate photography.",
  },
  {
    id: "magazine-cover",
    category: "portrait",
    contentType: "image",
    title: "Magazine cover",
    description: "Editorial cover shot with space left for a masthead.",
    prompt:
      "Fashion magazine cover photo: bold editorial pose in [outfit], solid [deep red] studio backdrop, dramatic directional lighting, negative space at the top for a masthead, high-end retouching look.",
  },
  // ---- product ----------------------------------------------------------
  {
    id: "product-hero",
    category: "product",
    contentType: "image",
    title: "Product hero shot",
    description: "Your character presenting your product, ad-ready.",
    prompt:
      "Holding [your product] at chest height with a delighted expression, clean [brand-color] studio background, soft commercial lighting, crisp advertising photography, focus on both face and product.",
  },
  {
    id: "product-intro",
    category: "product",
    contentType: "video",
    title: "Product intro clip",
    description: "A direct-to-camera pitch with your one-liner.",
    prompt:
      "Holds up [your product], looks straight into the camera and says with a smile: \"[your one-line pitch]\". Bright studio set, energetic direct-to-camera ad style, subtle push-in.",
  },
  {
    id: "unboxing",
    category: "product",
    contentType: "video",
    title: "Unboxing moment",
    description: "The open-the-box reaction, close and personal.",
    prompt:
      "Excitedly unboxes [your product] at a warm wooden desk: close-up on hands lifting the lid, then a delighted reaction straight to camera. Cozy natural light, authentic creator-video feel.",
  },
  // ---- social -----------------------------------------------------------
  {
    id: "cafe-lifestyle",
    category: "social",
    contentType: "image",
    title: "Café lifestyle",
    description: "Candid golden-morning shot for the feed.",
    prompt:
      "Candid lifestyle photo: laughing at a sunlit café table with a cappuccino, golden morning light through the window, shot on a 50mm lens, authentic and unposed, soft film grain.",
  },
  {
    id: "gym-motivation",
    category: "social",
    contentType: "image",
    title: "Gym motivation",
    description: "High-energy fitness shot with dramatic light.",
    prompt:
      "Mid-workout in a modern gym: determined expression while [lifting a dumbbell], dramatic side lighting, visible effort, dark moody background, motivational fitness photography.",
  },
  {
    id: "travel-postcard",
    category: "social",
    contentType: "image",
    title: "Travel postcard",
    description: "Golden hour at a landmark of your choice.",
    prompt:
      "Standing at [the landmark], golden hour glow, wind in the hair, wide travel-photography shot with the landmark clearly visible behind, joyful expression, postcard composition.",
  },
  {
    id: "morning-routine",
    category: "social",
    contentType: "video",
    title: "Morning routine",
    description: "Lifestyle-vlog b-roll of the day starting.",
    prompt:
      "Morning routine sequence: stretching by a sunlit window, pouring fresh coffee, opening a laptop at a tidy desk — smooth continuous camera movement, calm lifestyle-vlog energy, warm tones.",
  },
  // ---- marketing --------------------------------------------------------
  {
    id: "mascot-sticker",
    category: "marketing",
    contentType: "image",
    title: "Mascot sticker",
    description: "Die-cut sticker art of your character.",
    prompt:
      "Die-cut sticker design: playful wink and thumbs up, thick white outline, bold flat colors, clean vector-illustration style, isolated on a plain background.",
  },
  {
    id: "seasonal-greeting",
    category: "marketing",
    contentType: "image",
    title: "Seasonal greeting",
    description: "A warm holiday card from your character.",
    prompt:
      "Cozy seasonal scene: wearing a warm knit sweater, holding a steaming mug, fairy-light bokeh in the background, soft festive greeting-card photography, inviting smile.",
  },
  {
    id: "testimonial",
    category: "marketing",
    contentType: "video",
    title: "Testimonial clip",
    description: "A warm, credible quote to camera.",
    prompt:
      "Seated in a bright living room, speaking warmly to camera: \"[the customer quote]\". Natural window light, relaxed posture, authentic testimonial style, gentle handheld feel.",
  },
  {
    id: "announcement",
    category: "marketing",
    contentType: "video",
    title: "Big announcement",
    description: "Suspense, reveal, celebration — in one clip.",
    prompt:
      "Looks into the camera, builds suspense with a pause, then announces: \"[your news]\" with a huge smile as confetti falls. Bright celebratory set, punchy social-video energy.",
  },
  // ---- story & film -----------------------------------------------------
  {
    id: "walking-broll",
    category: "story",
    contentType: "video",
    title: "City dusk b-roll",
    description: "Cinematic tracking shot through neon streets.",
    prompt:
      "Cinematic b-roll: walking through a city street at dusk, neon signs reflecting on wet pavement, slow tracking shot from the side, shallow depth of field, film-grade color.",
  },
  {
    id: "runway-walk",
    category: "story",
    contentType: "video",
    title: "Runway walk",
    description: "A confident stride under the flashes.",
    prompt:
      "Walks a fashion runway straight toward the camera in [outfit], camera flashes sparkling in the darkness around, confident stride, dramatic spotlight, fashion-film energy.",
  },
  {
    id: "cooking-show",
    category: "story",
    contentType: "video",
    title: "Cooking show host",
    description: "Steam, sizzle and a grin — kitchen TV energy.",
    prompt:
      "Hosts a cooking show: tossing ingredients into a sizzling pan with a grin, steam rising, bright kitchen set, dynamic close-ups cutting between hands and face, upbeat TV pacing.",
  },
];
