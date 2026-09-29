// The effects library (operator, 2026-09-29: "VFX in the shot, one-tap
// effect library, effects inside Generate, effects tracks in the editor" —
// all four, one library behind them). Pure data and arithmetic: the engines,
// their prices as read at source, the recipes for effects on a video, and
// every one-tap photo effect.
//
// Engines, chosen by the engine test of 2026-09-29 (his yes, ~$2.18 spent):
// "blue lightning crackles between her fingers" on LIFT's 5 s hands shot —
// FLUX 3 edit put strong lightning on her hands and its blue light on her
// face, face unchanged, $0.15 in 59 s; Kling O3 standard barely added any
// and lost it once her face showed ($0.63); Happy Horse drew lightning ON
// her face and garbled the corner badge ($1.40); Gemini Omni Flash 1.1
// refused the clip. So effects on a video run on FLUX 3 edit.

import { PIXVERSE_EFFECTS, VIDU_TEMPLATES, WAN_EFFECTS } from "./presets-data";

/** What one credit is worth to us, the rule every lane prices by: ceil(cost / $0.28). */
export const USD_PER_CREDIT = 0.28;
export function creditsFor(usd: number): number {
  return Math.max(1, Math.ceil(usd / USD_PER_CREDIT - 1e-9));
}

// ------------------------------------------------------------------ engines

export type EngineKey = "flux3" | "pixverse" | "wan" | "vidu";

export type Engine = {
  key: EngineKey;
  endpoint: string;
  /** What it takes. */
  input: "video" | "image";
  label: string;
  /** Longest video it edits, seconds. */
  maxSeconds?: number;
  maxBytes?: number;
};

export const ENGINES: Record<EngineKey, Engine> = {
  // fal.ai/models/blackforestlabs/flux-3/edit-video: "$0.03/s (720p)", under 15 s and 50 MB.
  flux3: { key: "flux3", endpoint: "blackforestlabs/flux-3/edit-video", input: "video", label: "FLUX 3 edit", maxSeconds: 15, maxBytes: 50 * 1024 * 1024 },
  // fal.ai/models/fal-ai/pixverse/v5.5/effects: 5 s at 720p "$0.2".
  pixverse: { key: "pixverse", endpoint: "fal-ai/pixverse/v5.5/effects", input: "image", label: "PixVerse 5.5" },
  // fal.ai/models/fal-ai/wan-effects: "$0.35 per video".
  wan: { key: "wan", endpoint: "fal-ai/wan-effects", input: "image", label: "Wan effects" },
  // fal.ai/models/fal-ai/vidu/template-to-video: $0.20 / $0.30 / $0.50 by tier; the page doesn't say which
  // template is in which tier, so every template is priced at the top one.
  vidu: { key: "vidu", endpoint: "fal-ai/vidu/template-to-video", input: "image", label: "Vidu templates" },
};

/** What a run costs us, US dollars — the engine's own price as stated on its page. */
export function engineUsd(engine: EngineKey, seconds: number | null): number {
  switch (engine) {
    case "flux3":
      return 0.03 * Math.min(ENGINES.flux3.maxSeconds!, Math.max(1, seconds ?? ENGINES.flux3.maxSeconds!));
    case "pixverse":
      return 0.2;
    case "wan":
      return 0.35;
    case "vidu":
      return 0.5;
  }
}

/** Opus 5.5 reads the shot before and checks the frames after; a ceiling for the two reads, US dollars. */
export const OPUS_USD_PER_EFFECT = 0.08;

/** What one effect is expected to cost us, for the page (before Opus's two reads are known). */
export function expectedUsd(kind: "shot" | "photo", engine: EngineKey, seconds: number | null): number {
  return engineUsd(engine, seconds) + (kind === "shot" ? OPUS_USD_PER_EFFECT : 0);
}

// --------------------------------------------------------- effects on a video

export type ShotCategory = "powers" | "elements" | "magic" | "looks";
export const SHOT_CATEGORIES: readonly ShotCategory[] = ["powers", "elements", "magic", "looks"];

/** An effect put into an existing shot: what to add, in words FLUX 3 edit is given (after Opus fits it to the shot). */
export type ShotRecipe = { id: string; name: string; category: ShotCategory; add: string };

export const SHOT_RECIPES: readonly ShotRecipe[] = [
  { id: "lightning-hands", name: "Lightning hands", category: "powers", add: "blue electric lightning crackles and arcs between the person's fingers and across their palms, casting flickering blue light on their skin and face" },
  { id: "fire-hands", name: "Fire in the hands", category: "powers", add: "real flames ignite in the person's open hands, throwing warm flickering orange light on their face and the surroundings" },
  { id: "electric-surge", name: "Electric surge", category: "powers", add: "electricity crackles across the person's whole body in thin bright blue arcs" },
  { id: "energy-aura", name: "Energy aura", category: "powers", add: "a glowing energy aura shimmers around the person's whole body, with faint particles of light rising from it" },
  { id: "glowing-eyes", name: "Glowing eyes", category: "powers", add: "the person's eyes glow with bright light, a soft glow spilling onto their face" },
  { id: "telekinesis", name: "Telekinesis", category: "powers", add: "small objects, debris and dust near the person lift off the ground and float in the air around them" },
  { id: "levitation-aura", name: "Levitation aura", category: "powers", add: "dust and small stones float upward around the person, with a faint glowing ring of light beneath their feet" },
  { id: "speed-trails", name: "Flash speed", category: "powers", add: "bright streaks of light and motion trails follow the moving person, with sparks and wind-blown dust at their feet" },
  { id: "frost-touch", name: "Frost touch", category: "powers", add: "frost and ice crystals spread from the person's hands across nearby surfaces, with cold mist in the air" },
  { id: "shadow-smoke", name: "Shadow smoke", category: "powers", add: "dark smoke tendrils curl and drift around the person's body" },
  { id: "heavy-rain", name: "Heavy rain", category: "elements", add: "heavy rain falls through the whole scene, with wet reflections, splashes on the ground and raindrops on the person" },
  { id: "snowfall", name: "Snowfall", category: "elements", add: "snow falls gently through the whole scene, a light dusting settling on surfaces, hair and clothes" },
  { id: "thunderstorm", name: "Thunderstorm", category: "elements", add: "dark storm clouds fill the sky with flashes of lightning lighting up the scene, and the wind picks up" },
  { id: "rolling-fog", name: "Rolling fog", category: "elements", add: "thick fog rolls through the scene at ground level, softening the background" },
  { id: "embers", name: "Floating embers", category: "elements", add: "glowing embers and sparks drift slowly through the air across the whole scene" },
  { id: "fire-behind", name: "Fire behind", category: "elements", add: "flames burn in the background behind the person, lighting the scene with warm flickering orange light" },
  { id: "falling-leaves", name: "Falling leaves", category: "elements", add: "autumn leaves blow and tumble through the scene in the wind" },
  { id: "dust-storm", name: "Dust storm", category: "elements", add: "a sandy dust storm blows through the scene, hazy orange air and flying sand" },
  { id: "magic-sparkles", name: "Magic sparkles", category: "magic", add: "glittering magical sparkles and motes of golden light swirl around the person" },
  { id: "portal", name: "Portal", category: "magic", add: "a glowing circular magical portal of swirling light opens in the background" },
  { id: "turn-to-dust", name: "Turn to dust", category: "magic", add: "the person's body slowly disintegrates into fine dust particles that drift away on the wind" },
  { id: "hologram", name: "Hologram", category: "magic", add: "the person flickers like a blue sci-fi hologram, with faint scan lines and glitches" },
  { id: "invisibility", name: "Invisibility", category: "magic", add: "the person's body turns into a transparent, shimmering heat-haze outline" },
  { id: "butterflies", name: "Butterflies", category: "magic", add: "glowing butterflies flutter around the person" },
  { id: "day-to-night", name: "Day to night", category: "looks", add: "the scene becomes night, lit by streetlights, windows and moonlight" },
  { id: "golden-hour", name: "Golden hour", category: "looks", add: "warm low golden-hour sunlight with long shadows and a soft glow" },
  { id: "neon-city", name: "Neon glow", category: "looks", add: "colourful neon lights and their reflections glow across the scene" },
  { id: "film-noir", name: "Film noir", category: "looks", add: "black-and-white, high contrast, hard shadows like a 1940s film" },
  { id: "winter-world", name: "Winter world", category: "looks", add: "everything in the scene is covered in fresh snow and frost" },
];

/** What every effect on a video keeps — the half of the prompt the engine test proved matters. */
export const KEEP_THE_SHOT =
  "Keep everything else exactly as it is: the same people and their faces, their clothes, the place, the camera movement and the timing.";

export function shotRecipe(id: string | null | undefined): ShotRecipe | null {
  return SHOT_RECIPES.find((r) => r.id === id) ?? null;
}

// ------------------------------------------------------ one-tap photo effects

export type PhotoCategory = "transform" | "powers" | "camera" | "fun" | "style" | "moves" | "love";
export const PHOTO_CATEGORIES: readonly PhotoCategory[] = ["transform", "powers", "camera", "fun", "style", "moves", "love"];

export type PhotoPreset = {
  /** `<engine>:<provider's name>` — the name is sent exactly as written. */
  id: string;
  engine: "pixverse" | "wan" | "vidu";
  /** The provider's own name. */
  value: string;
  name: string;
  category: PhotoCategory;
};

const CATEGORY_WORDS: [PhotoCategory, RegExp][] = [
  ["camera", /zoom|dolly|orbit|spin|360|hitchcock|earth|fisheye|walk_forward|smooth_shift|auto_spin|rotate|timelapse/i],
  ["love", /hug|kiss|couple|love|wedding|proposal|romantic|cupid|heart|embrace|bouquet|flower/i],
  ["moves", /dance|shake|twist|jiggle|bounce|sway|march|flick|slide|run|leap|jump|lift|sweep|stride|walk|carpet/i],
  ["powers", /thunder|fire|flame|blast|explo|boom|lightning|wing|fly|flying|dragon|summon|beast|hero|super|power|saber|warrior|muscle|tsunami|cloud|aliens|universe|beam/i],
  ["style", /anime|clay|pixel|comic|manga|pop_art|painting|cartoon|doodle|figurine|perler|sticker|3d|bjd|style|art|poster|paper/i],
  ["transform", /robot|zombie|werewolf|metal|liquid|dust|baby|mermaid|hair|face|devil|monster|ghost|age|younger|pet2human|transform|skeleton|mummy|vampire|squid|cake|inflate|deflate|squish|crush|melt|morph|clone|cloning|thinner|shark|tiger|samurai|pirate|princess|bride|vip|zen|assassin/i],
];

function categoryOf(value: string): PhotoCategory {
  for (const [cat, re] of CATEGORY_WORDS) if (re.test(value)) return cat;
  return "fun";
}

function titled(value: string): string {
  if (/[A-Z]/.test(value) || /\s/.test(value)) return value;
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => (w === "360" || w === "180" ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export const PHOTO_PRESETS: readonly PhotoPreset[] = [
  ...PIXVERSE_EFFECTS.map((v) => ({ id: `pixverse:${v}`, engine: "pixverse" as const, value: v, name: titled(v), category: categoryOf(v) })),
  ...WAN_EFFECTS.map((v) => ({ id: `wan:${v}`, engine: "wan" as const, value: v, name: titled(v), category: categoryOf(v) })),
  ...VIDU_TEMPLATES.map((v) => ({ id: `vidu:${v}`, engine: "vidu" as const, value: v, name: titled(v), category: categoryOf(v) })),
];

/** The shelf the library opens on: the effects people ask for by name. */
export const FEATURED_PHOTO: readonly string[] = [
  "pixverse:Dust Me Away",
  "pixverse:Thunder God",
  "pixverse:Liquid Metal",
  "vidu:earth_zoom_out",
  "vidu:flying",
  "wan:inflate",
  "wan:cakeify",
  "wan:squish",
  "vidu:background_explosion",
  "pixverse:Robot",
  "pixverse:Werewolf Rage",
  "vidu:spin360",
  "wan:fire",
  "pixverse:Holy Wings",
  "vidu:hitchcock_zoom",
  "pixverse:Dragon Evoker",
  "wan:blast",
  "vidu:grow_wings",
  "pixverse:Zombie Mode",
  "vidu:cloning",
].filter((id) => PHOTO_PRESETS.some((p) => p.id === id));

export function photoPreset(id: string | null | undefined): PhotoPreset | null {
  return PHOTO_PRESETS.find((p) => p.id === id) ?? null;
}

/** The request each photo engine takes (from its API schema, 2026-09-29). */
export function presetBody(preset: PhotoPreset, imageUrl: string, shape: { width: number | null; height: number | null }): Record<string, unknown> {
  const tall = shape.width && shape.height ? shape.height > shape.width * 1.1 : false;
  const square = shape.width && shape.height ? Math.abs(shape.width - shape.height) / Math.max(shape.width, shape.height) < 0.1 : false;
  switch (preset.engine) {
    case "pixverse":
      return { image_url: imageUrl, effect: preset.value, resolution: "720p", duration: "5" };
    case "wan":
      return { image_url: imageUrl, effect_type: preset.value, subject: "the main subject of the photo", aspect_ratio: square ? "1:1" : tall ? "9:16" : "16:9" };
    case "vidu":
      return { input_image_urls: [imageUrl], template: preset.value, aspect_ratio: tall ? "9:16" : "16:9" };
  }
}

/** A library search: every word must appear in the name or the category. */
export function searchPresets(query: string, pool: readonly PhotoPreset[] = PHOTO_PRESETS): PhotoPreset[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...pool];
  return pool.filter((p) => words.every((w) => `${p.name} ${p.value} ${p.category}`.toLowerCase().includes(w)));
}
