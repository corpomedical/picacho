// The rig (Helios Cinema, 2026-09-15, drawn as canvas page I and approved
// with "Build it"): Cinema Studio's camera department, where the set makes
// it real. One rig per set, saved on it (`location_sets.rig`,
// supabase/applied/2026-09-15/helios-rig.sql), so every still, take and film beat on
// the set shoots with it — Higgsfield's "projects hold one package", with
// the set as the project.
//
// Every control lands in one of two places, and the page labels which:
//
//   HELD BY THE STAGE — the frame's shape (the render is cut to the frame
//   lines on the server, never hoped for in words), the lens's field of
//   view and where the camera stands (the sketch), and a move's two ends
//   (the film's keyframes, moves.ts).
//
//   CHECKED AFTER — what a sketch cannot carry by itself: the light's mood,
//   focus, film stock, lens character, era and palette. They ride as fixed
//   blocks of Picacho's own words, the stage previews them before a credit
//   moves, and after every still a rig check reads the picture and says
//   which landed (rig-check.ts).
//
// THE PROOF RULE (cinema-presets.ts): a block is text for the model, and a
// block that has not proven its look on screen is marked `proven: false`
// (THE PROOF, 2026-09-15, below, is the record of the ones that have).
// While Helios is admin-only the page shows unproven looks marked as
// untested, so the proof renders can be shot in the product itself with
// the rig check reading each one; before Helios opens beyond admins,
// anything still unproven stays invisible. Every look ships in two
// strengths: `block`, and `pushed` — the same look said harder, what "Shoot
// again, pushed" sends for the one look that missed (Higgsfield exaggerated
// each lens's character by hand; this is ours).
//
// THE MONEY. A still is one GPT Image 2.5 render at quality high whatever
// the format: 1024 × 1024 for the square, 1536 × 1024 (or 1024 × 1536) for
// the rest, cut to the frame lines after. Measured 2026-09-15 with the same
// three input pictures (scratchpad size-probe): 1024 × 1024 spent 1,756
// output image tokens ($0.0735), 1536 × 1024 spent 1,372 ($0.0619). The
// wide render is the cheaper one, so every format stays one credit.
//
// Blocks are English on purpose (text for the model); names are i18n.
// Relative imports only: the page, the actions and the tests share it.

import type { LabLooks } from "./lab-grade";

export const RIG_FORMATS = {
  square: { band: 1, render: [1024, 1024] },
  scope: { band: 2.39, render: [1536, 1024] },
  flat: { band: 1.85, render: [1536, 1024] },
  wide: { band: 16 / 9, render: [1536, 1024] },
  classic: { band: 4 / 3, render: [1536, 1024] },
  vertical: { band: 9 / 16, render: [1024, 1536] },
} as const satisfies Record<string, { band: number; render: readonly [number, number] }>;

export type RigFormat = keyof typeof RIG_FORMATS;
export const RIG_FORMAT_ORDER: readonly RigFormat[] = ["square", "scope", "flat", "wide", "classic", "vertical"];

/** GPT Image sizes a set shot may ask for (openai-images.ts). */
export type RigRenderSize = "1024x1024" | "1536x1024" | "1024x1536";

export type FormatFrame = {
  /** The render the image model is asked for, pixels. */
  renderW: number;
  renderH: number;
  /** The picture cut from it: the largest centred rectangle of the band's shape. */
  bandW: number;
  bandH: number;
  renderAspect: number;
  bandAspect: number;
  size: RigRenderSize;
  /** Whether anything is cut at all (the square is its own picture). */
  cut: boolean;
};

export function formatFrame(format: RigFormat): FormatFrame {
  const f = RIG_FORMATS[format] ?? RIG_FORMATS.square;
  const renderW: number = f.render[0];
  const renderH: number = f.render[1];
  const renderAspect = renderW / renderH;
  const bandAspect = f.band;
  let bandW = renderW;
  let bandH = renderH;
  if (bandAspect >= renderAspect) bandH = Math.round(renderW / bandAspect);
  else bandW = Math.round(renderH * bandAspect);
  return {
    renderW,
    renderH,
    bandW,
    bandH,
    renderAspect,
    bandAspect,
    size: `${renderW}x${renderH}` as RigRenderSize,
    cut: bandW !== renderW || bandH !== renderH,
  };
}

/**
 * The frame the page may ask the server to cut to: a known format, else the
 * square. The server trusts nothing else about the cut — it works out the
 * band itself from the format's name.
 */
export function isRigFormat(v: unknown): v is RigFormat {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(RIG_FORMATS, v);
}

// ---------------------------------------------------------------------------
// Looks: stock, lens, era, palette, light. Ids are data; names are i18n.
// ---------------------------------------------------------------------------

export type RigLook = { id: string; block: string; pushed: string; proven: boolean };
export type RigLookKind = "stock" | "lens" | "era" | "palette" | "light";

// THE PROOF, 2026-09-15. Every look was shot once on one set, one camera and
// one moment — Eva at the race track in Scope, still be0a3eaa's request word
// for word with only the look's sentence changed — read back by the rig
// check, shot again pushed where the check said it missed, and judged by the
// operator on a contact sheet (docs/ASTRA_SETS.md). 33 of the 34 passed —
// and so did both of the stop ring's focus proofs, f/1.4 and f/8; Silhouette
// failed — she stayed readable and lit from the front, the one thing the
// look exists to take away (its words asked for "the face just readable").
// Reworded to put the whole figure in shadow, face included, with only a rim
// of light, it was shot again the same evening and passed, plain and pushed
// (the "Helios Lab" page). A look is proven only by being listed here.
//
// A pass is the operator's judgement that the look is worth offering, not a
// promise it lands: on the proof stills the check read ten of the passed
// looks as missed plain and pushed (16 mm, home video, anamorphic, overhead,
// practicals, Mint Diner, Tropic Static, 2000s, 1970s, 1960s), and Silver
// Print and Neon Undertow landed only pushed. The check keeps reading every
// real still and says so on the still. The lab (lab-grade.ts) since holds
// the film stocks, the lenses and Silver Print, so those always land.
const PROVEN_LOOKS: ReadonlySet<string> = new Set([
  "stock:digital",
  "stock:film35",
  "stock:film16",
  "stock:homevideo",
  "lens:clean",
  "lens:anamorphic",
  "lens:vintage",
  "lens:halation",
  "era:2000s",
  "era:1990s",
  "era:1980s",
  "era:1970s",
  "era:1960s",
  "palette:amber-hour",
  "palette:sodium-rain",
  "palette:blue-motel",
  "palette:rust-cream",
  "palette:harbour-4am",
  "palette:silver-print",
  "palette:mint-diner",
  "palette:peach-dusk",
  "palette:tropic-static",
  "palette:ash-winter",
  "palette:neon-undertow",
  "palette:golden-reel",
  "light:contre-jour",
  "light:golden-hour",
  "light:window",
  "light:overhead",
  "light:practicals",
  "light:soft-cross",
  "light:silhouette",
  "light:hard-noon",
  "light:moonlight",
]);

const lookOf =
  (kind: RigLookKind) =>
  <I extends string>(id: I, block: string, pushed: string): RigLook & { id: I } => ({ id, block, pushed, proven: PROVEN_LOOKS.has(`${kind}:${id}`) });
const stockLook = lookOf("stock");
const lensLook = lookOf("lens");
const eraLook = lookOf("era");
const lightLook = lookOf("light");

/**
 * A proven look's picture for its tile, 240 × 100, in public/helios/looks.
 * A look the lab makes (every stock and lens, Silver Print) shows the lab's
 * own work on the control proof still — made by lab.ts itself — so its
 * tiles differ only in the look; the rest show the proof still that showed
 * them (the plain one, or Neon Undertow's pushed one; Silhouette's is its
 * reworded still). Eras are words on the page, no picture; an unproven look
 * keeps its drawn one.
 */
export function lookStill(kind: RigLookKind, id: string): string | null {
  if (kind === "era" || !PROVEN_LOOKS.has(`${kind}:${id}`)) return null;
  return `/helios/looks/${kind}-${id}.jpg`;
}

export const RIG_STOCKS = [
  stockLook(
    "digital",
    "Shot on a modern digital cinema camera: clean, crisp detail, no grain, a wide dynamic range.",
    "Unmistakably shot on a modern digital cinema camera: razor-clean detail, no grain at all, shadows that keep their detail, a crisp, clinical finish.",
  ),
  stockLook(
    "film35",
    "Shot on 35 mm motion-picture film: fine visible grain, highlights that roll off softly, a little warmth in the colour.",
    "Unmistakably shot on 35 mm motion-picture film: fine grain clearly visible across the whole frame, highlights that bloom and roll off softly, warm film colour, slightly lifted blacks.",
  ),
  stockLook(
    "film16",
    "Shot on 16 mm film: coarse visible grain, softer detail, slightly lifted blacks, a documentary texture.",
    "Unmistakably 16 mm film: heavy, coarse grain over everything, soft detail, milky lifted blacks, a faint dark vignette, the texture of a documentary print.",
  ),
  stockLook(
    "homevideo",
    "Recorded on a consumer home-video camcorder: soft analogue detail, a little colour bleed, faint scanlines, washed colours.",
    "Unmistakably a home-video camcorder recording: very soft analogue detail, colours bleeding past their edges, visible scanlines, washed-out colour, an amateur feel.",
  ),
] as const;

export const RIG_LENSES = [
  lensLook(
    "clean",
    "A clean modern prime lens: sharp across the frame, round and smooth bokeh, no flare.",
    "A clinically sharp modern prime lens: crisp from edge to edge, perfectly round, smooth bokeh, no flare and no distortion.",
  ),
  lensLook(
    "anamorphic",
    "An anamorphic lens: out-of-focus lights become tall oval bokeh, the brightest light throws a thin horizontal flare streak, the edges carry a slight wide-screen stretch.",
    "An anamorphic lens, unmistakably: every out-of-focus light is a tall vertical oval, the brightest light throws a long, thin horizontal blue flare streak across the frame, and the edges bend with a wide-screen stretch.",
  ),
  lensLook(
    "vintage",
    "A vintage lens: a soft glow around highlights, lower contrast, gentle darkening toward the corners, warm rendering.",
    "A strongly vintage lens: a soft blooming glow around every highlight, low contrast, dark soft corners, warm and dreamy rendering.",
  ),
  lensLook(
    "halation",
    "Film halation: bright highlights carry a red-orange glow bleeding into the dark around them.",
    "Strong film halation: every bright highlight and backlit edge carries a vivid red-orange glow bleeding into the surrounding dark.",
  ),
] as const;

// The era is the picture's look, never its objects: the set's objects are
// the set's, and an era that swapped the car for a 1960s one would break
// the look sheet's whole promise (look-sheet.ts).
const ERA_OBJECTS = "not its objects, which stay exactly as the set has them.";
export const RIG_ERAS = [
  eraLook(
    "2000s",
    `The picture looks as if made in the 2000s — early digital colour, cool slightly green shadows, crisp contrast — its look, ${ERA_OBJECTS}`,
    `The picture looks unmistakably made in the 2000s — early digital colour, cool green-tinted shadows, hard crisp contrast — its look, ${ERA_OBJECTS}`,
  ),
  eraLook(
    "1990s",
    `The picture looks as if made in the 1990s — saturated colour-negative film, warm skin, punchy contrast — its look, ${ERA_OBJECTS}`,
    `The picture looks unmistakably made in the 1990s — strongly saturated colour-negative film, warm skin, punchy contrast, visible grain — its look, ${ERA_OBJECTS}`,
  ),
  eraLook(
    "1980s",
    `The picture looks as if made in the 1980s — soft diffusion, glowing highlights, pastel colour — its look, ${ERA_OBJECTS}`,
    `The picture looks unmistakably made in the 1980s — heavy soft diffusion, glowing haloed highlights, pastel colour — its look, ${ERA_OBJECTS}`,
  ),
  eraLook(
    "1970s",
    `The picture looks as if made in the 1970s — warm brown-amber colour, soft contrast, visible grain — its look, ${ERA_OBJECTS}`,
    `The picture looks unmistakably made in the 1970s — strongly warm brown-amber colour, soft faded contrast, heavy grain — its look, ${ERA_OBJECTS}`,
  ),
  eraLook(
    "1960s",
    `The picture looks as if made in the 1960s — rich dye-transfer saturation, deep blacks, crisp studio polish — its look, ${ERA_OBJECTS}`,
    `The picture looks unmistakably made in the 1960s — intensely rich dye-transfer saturation, inky blacks, crisp studio polish — its look, ${ERA_OBJECTS}`,
  ),
] as const;

/**
 * Palettes: named like moods, our own names — never a film's title.
 * `swatch` draws the card; `filter` and `tint` preview the grade on the
 * stage (a CSS filter on the canvas and a soft-light wash over it) — a
 * preview only: the sketch the model sees is never graded.
 */
export type RigPaletteLook = RigLook & { swatch: readonly string[]; filter: string; tint: string | null };

const palette = <I extends string>(
  id: I,
  swatch: readonly string[],
  filter: string,
  tint: string | null,
  block: string,
  pushed: string,
): RigPaletteLook & { id: I } => ({ id, block, pushed, proven: PROVEN_LOOKS.has(`palette:${id}`), swatch, filter, tint });

export const RIG_PALETTES = [
  palette(
    "amber-hour",
    ["#1d2b31", "#2f4a50", "#8a6a4a", "#d99a5e", "#f3d2a2"],
    "saturate(1.12) contrast(1.06)",
    "rgba(230,150,80,0.30)",
    "Colour grade: amber highlights and teal shadows, skin kept warm and natural.",
    "A strong colour grade: rich amber highlights, deep teal shadows, a clear warm–cool split, skin kept warm and natural.",
  ),
  palette(
    "sodium-rain",
    ["#120e0c", "#3a2414", "#a4561c", "#e89a3c", "#f6d7a0"],
    "sepia(0.45) saturate(1.45) contrast(1.15) brightness(0.92)",
    "rgba(240,130,40,0.28)",
    "Colour grade: sodium-orange light over near-black shadows, a heavy night palette.",
    "A strong colour grade: everything under sodium-orange light, shadows falling to near black, a heavy, humid night palette.",
  ),
  palette(
    "blue-motel",
    ["#0d1426", "#1f3566", "#3f6fb0", "#e06a9a", "#f4c6d8"],
    "saturate(1.2) contrast(1.08) brightness(0.95)",
    "rgba(60,90,200,0.34)",
    "Colour grade: deep blue night with pink-magenta neon accents.",
    "A strong colour grade: the whole frame in deep blue night, vivid pink-magenta neon accents in the highlights.",
  ),
  palette(
    "rust-cream",
    ["#2a1a14", "#6b3a26", "#b5693f", "#e3c39c", "#f7ecd9"],
    "sepia(0.3) saturate(1.05) contrast(1.02)",
    "rgba(200,120,70,0.24)",
    "Colour grade: warm rust and earth tones with soft, creamy highlights.",
    "A strong colour grade: rust, brick and earth tones throughout, soft creamy highlights, no cold colour anywhere.",
  ),
  palette(
    "harbour-4am",
    ["#151b22", "#2c3844", "#54687a", "#8fa3b3", "#d6dee4"],
    "saturate(0.6) contrast(0.92) brightness(0.96)",
    "rgba(90,120,150,0.30)",
    "Colour grade: cold blue-grey, low contrast, muted and quiet.",
    "A strong colour grade: cold blue-grey everywhere, very low contrast, colour almost drained, still and quiet.",
  ),
  palette(
    "silver-print",
    ["#0b0b0b", "#3a3a3a", "#7a7a7a", "#bdbdbd", "#f2f2f2"],
    "grayscale(1) contrast(1.18)",
    null,
    "Black and white: rich blacks, silver highlights, a full range of greys.",
    "Pure black and white, no colour at all: inky blacks, bright silver highlights, a full, rich range of greys.",
  ),
  palette(
    "mint-diner",
    ["#16302b", "#3f8f7a", "#9fd9c0", "#e0474c", "#f6e6d4"],
    "saturate(1.15) contrast(1.04)",
    "rgba(90,200,170,0.22)",
    "Colour grade: mint greens and cherry reds, a bright retro palette.",
    "A strong colour grade: mint greens and cherry reds dominate, bright, clean and retro.",
  ),
  palette(
    "peach-dusk",
    ["#2c2438", "#6b4d6e", "#c98f8a", "#f1b89a", "#f9e1cf"],
    "saturate(1.05) contrast(0.96) brightness(1.02)",
    "rgba(240,160,150,0.26)",
    "Colour grade: peach and lavender dusk tones, soft and gentle.",
    "A strong colour grade: peach highlights and lavender shadows throughout, soft, gentle and romantic.",
  ),
  palette(
    "tropic-static",
    ["#12301c", "#2f6b33", "#8fbf3a", "#f2d23a", "#fbf0b0"],
    "saturate(1.4) contrast(1.08) brightness(1.03)",
    "rgba(190,210,60,0.22)",
    "Colour grade: saturated greens and hot yellows, a humid, sun-bleached palette.",
    "A strong colour grade: intensely saturated greens and hot yellows, sun-bleached highlights, humid air.",
  ),
  palette(
    "ash-winter",
    ["#1a1e22", "#46505a", "#8a949c", "#c4ccd2", "#eef1f3"],
    "saturate(0.45) contrast(1.02) brightness(1.04)",
    "rgba(170,190,210,0.24)",
    "Colour grade: desaturated cold tones and pale highlights, a winter stillness.",
    "A strong colour grade: colour almost gone, cold pale tones, bright pale highlights, a frozen winter stillness.",
  ),
  palette(
    "neon-undertow",
    ["#0a0610", "#2a0f3a", "#9b2fae", "#23c4d8", "#f2d9f5"],
    "saturate(1.35) contrast(1.2) brightness(0.9)",
    "rgba(170,60,200,0.30)",
    "Colour grade: magenta and cyan light with crushed blacks.",
    "A strong colour grade: vivid magenta and cyan light only, blacks crushed to pure black.",
  ),
  palette(
    "golden-reel",
    ["#2a1c0c", "#6b4a1c", "#c08a36", "#efc56a", "#fbeac2"],
    "sepia(0.35) saturate(1.2) contrast(1.03)",
    "rgba(235,180,80,0.28)",
    "Colour grade: honeyed gold highlights, warm midtones, gentle contrast.",
    "A strong colour grade: rich honeyed gold across highlights and midtones, warm and glowing, gentle contrast.",
  ),
] as const;

// ---------------------------------------------------------------------------
// Light schemes: a scheme is a light PLOT, not an adjective (light-schemes.ts
// places the lights in the set); the words say the mood the plot can't.
// ---------------------------------------------------------------------------

export const RIG_LIGHTS = [
  lightLook(
    "contre-jour",
    "Light: contre-jour — the sun low behind the person, a warm rim of light on the hair and shoulders, the face in soft shade toward the camera, a warm glow in the air.",
    "Strong contre-jour: the low sun directly behind the person, a bright glowing rim on the hair and shoulders, the face in clear soft shade, glowing haze and a little flare around them.",
  ),
  lightLook(
    "golden-hour",
    "Light: golden hour — a low warm sun from the side and behind, long shadows, honeyed light on the skin.",
    "Strong golden hour: a very low, deep-gold sun raking from the side and behind, very long shadows, everything glowing honey-warm.",
  ),
  lightLook(
    "window",
    "Light: soft daylight from one large window to the side — gentle falloff across the face, calm natural shadows.",
    "Strong window light: one large soft window to the side is the only source — bright on one side of the face, falling off to deep soft shadow on the other.",
  ),
  lightLook(
    "overhead",
    "Light: one overhead source — light falling from above onto the head and shoulders, the eyes in soft shadow, the surroundings dark.",
    "Strong overhead light: a single hard source straight above, a pool of light on the head and shoulders, the eyes in shadow, darkness all around.",
  ),
  lightLook(
    "practicals",
    "Light: only the practical lamps in the scene — warm pools of light, deep dark between them, the face lit by the nearest lamp.",
    "Strong practical light: nothing but the warm lamps in the scene, small bright pools in deep darkness, the face caught by the nearest lamp.",
  ),
  lightLook(
    "soft-cross",
    "Light: two soft sources crossing from either side in front — even, flattering light with soft shadows on both sides.",
    "Strong soft cross light: two large soft sources from front-left and front-right, the face evenly and flatteringly lit, shadows soft on both sides.",
  ),
  lightLook(
    "silhouette",
    "Light: silhouette — the person stands against a bright, glowing background with the light entirely behind them; the whole figure falls into dark shadow, face included, with only a thin bright rim tracing the outline of the hair and shoulders. No light reaches the front of the figure.",
    "A true silhouette: a blazing bright background directly behind the person, the figure a near-black shape with no light on its front at all, the face lost in shadow, only a crisp bright rim of light around the hair and shoulders.",
  ),
  lightLook(
    "hard-noon",
    "Light: hard midday sun from high above — crisp dark shadows with sharp edges, bright, saturated colour.",
    "Strong hard noon light: the sun straight overhead, short black shadows with razor edges, blazing bright highlights, saturated colour.",
  ),
  lightLook(
    "moonlight",
    "Light: moonlight — cool blue light from high to one side, deep night shadows, the face lit softly in blue.",
    "Strong moonlight: cold blue light from high to one side is the only source, deep black night shadows, the face softly lit in blue.",
  ),
] as const;

export type RigStock = (typeof RIG_STOCKS)[number]["id"];
export type RigLens = (typeof RIG_LENSES)[number]["id"];
export type RigEra = (typeof RIG_ERAS)[number]["id"];
export type RigPalette = (typeof RIG_PALETTES)[number]["id"];
export type RigLightScheme = (typeof RIG_LIGHTS)[number]["id"];

/** The stops the ring rolls through; null means no focus words at all. */
export const RIG_STOPS = [1.4, 2, 2.8, 4, 5.6, 8, 11] as const;
export type RigStop = (typeof RIG_STOPS)[number];

export const RIG_GENRES = ["drama", "action", "thriller", "noir", "horror", "comedy", "romance"] as const;
export type RigGenre = (typeof RIG_GENRES)[number];

/** Where a scheme's key light stands: a world bearing from the subject (0° = +Z, 90° = +X, as a mark faces) and a height above the horizon. */
export type RigLightState = { scheme: RigLightScheme; azimuthDeg: number; elevationDeg: number };

export type SetRig = {
  /** Suggests a rig; adds no words of its own. */
  genre: RigGenre | null;
  /** null = today: no era words. */
  era: RigEra | null;
  format: RigFormat;
  stock: RigStock | null;
  lens: RigLens | null;
  /** The f-number, or null for no focus words. */
  stop: RigStop | null;
  /** null = the set's own light, as built. */
  light: RigLightState | null;
  palette: RigPalette | null;
  /** Whether the stage previews the palette's grade (the sketch is never graded). */
  gradeStage: boolean;
};

export const DEFAULT_SET_RIG: SetRig = {
  genre: null,
  era: null,
  format: "square",
  stock: null,
  lens: null,
  stop: null,
  light: null,
  palette: null,
  gradeStage: true,
};

const ids = <T extends { id: string }>(list: readonly T[]) => list.map((x) => x.id);
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | null =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null;

const wrapDeg = (d: number) => ((d % 360) + 360) % 360;

/**
 * Any stored or sent rig through one door, the way normaliseSetFilm is the
 * door for films: unknown ids fall back to off, the format to the square,
 * angles are wrapped and clamped, and nothing throws.
 */
export function normaliseSetRig(v: unknown): SetRig {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ...DEFAULT_SET_RIG };
  const r = v as Record<string, unknown>;
  const stop = typeof r.stop === "number" && (RIG_STOPS as readonly number[]).includes(r.stop) ? (r.stop as RigStop) : null;
  let light: RigLightState | null = null;
  const l = r.light && typeof r.light === "object" && !Array.isArray(r.light) ? (r.light as Record<string, unknown>) : null;
  const scheme = l ? oneOf(l.scheme, ids(RIG_LIGHTS) as RigLightScheme[]) : null;
  if (l && scheme) {
    const az = typeof l.azimuthDeg === "number" && Number.isFinite(l.azimuthDeg) ? wrapDeg(l.azimuthDeg) : 0;
    const el = typeof l.elevationDeg === "number" && Number.isFinite(l.elevationDeg) ? l.elevationDeg : 10;
    light = { scheme, azimuthDeg: Math.round(az * 10) / 10, elevationDeg: Math.round(Math.min(89, Math.max(1, el)) * 10) / 10 };
  }
  return {
    genre: oneOf(r.genre, RIG_GENRES),
    era: oneOf(r.era, ids(RIG_ERAS) as RigEra[]),
    format: isRigFormat(r.format) ? r.format : "square",
    stock: oneOf(r.stock, ids(RIG_STOCKS) as RigStock[]),
    lens: oneOf(r.lens, ids(RIG_LENSES) as RigLens[]),
    stop,
    light,
    palette: oneOf(r.palette, ids(RIG_PALETTES) as RigPalette[]),
    gradeStage: r.gradeStage !== false,
  };
}

// ---------------------------------------------------------------------------
// Genre: suggestions, out in the open — a genre adds no words of its own.
// ---------------------------------------------------------------------------

export type RigSuggestion = { light: RigLightScheme; palette: RigPalette; moves: readonly string[] };

export const RIG_GENRE_SUGGESTS: Record<RigGenre, RigSuggestion> = {
  drama: { light: "soft-cross", palette: "rust-cream", moves: ["push-in", "pull-out", "hold", "arc-left"] },
  action: { light: "hard-noon", palette: "tropic-static", moves: ["truck-left", "crane-up", "low-hero", "orbit-90"] },
  thriller: { light: "practicals", palette: "harbour-4am", moves: ["dolly-zoom", "push-in", "truck-right"] },
  noir: { light: "overhead", palette: "silver-print", moves: ["push-in", "tilt-up", "hold"] },
  horror: { light: "moonlight", palette: "neon-undertow", moves: ["push-in", "dolly-zoom", "hold"] },
  comedy: { light: "window", palette: "mint-diner", moves: ["hold", "truck-left", "pull-out"] },
  romance: { light: "golden-hour", palette: "peach-dusk", moves: ["arc-left", "push-in", "crane-down"] },
};

// ---------------------------------------------------------------------------
// Focus: real optics from the real distance.
// ---------------------------------------------------------------------------

/** Full-frame circle of confusion, millimetres. */
export const RIG_COC_MM = 0.03;

/** The focal length a vertical field of view is, on a frame this many millimetres tall. */
export function focalMm(fovDeg: number, frameHeightMm = 24): number {
  return frameHeightMm / 2 / Math.tan((fovDeg * Math.PI) / 360);
}

/**
 * Where a lens focused at `distanceM` holds sharp: the near and far limits of
 * its depth of field, metres (far = Infinity past the hyperfocal distance).
 */
export function depthOfField(focal: number, fNumber: number, distanceM: number, cocMm = RIG_COC_MM): { nearM: number; farM: number } {
  const s = Math.max(0.05, distanceM) * 1000;
  const f = Math.max(1, focal);
  const H = (f * f) / (fNumber * cocMm) + f;
  const near = (s * (H - f)) / (H + s - 2 * f);
  const far = s >= H ? Infinity : (s * (H - f)) / (H - s);
  return { nearM: near / 1000, farM: far / 1000 };
}

const m1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

// ---------------------------------------------------------------------------
// The words that ride with a shot.
// ---------------------------------------------------------------------------

/** What the rig check reads, one per control that is Checked after. */
export const RIG_CHECK_ITEMS = ["light", "focus", "palette", "stock", "lens", "era"] as const;
export type RigCheckItem = (typeof RIG_CHECK_ITEMS)[number];

export function isRigCheckItem(v: unknown): v is RigCheckItem {
  return typeof v === "string" && (RIG_CHECK_ITEMS as readonly string[]).includes(v);
}

/** The controls a shot with this rig is checked on after it lands. */
export function rigCheckItems(rig: SetRig): RigCheckItem[] {
  const out: RigCheckItem[] = [];
  if (rig.light) out.push("light");
  if (rig.stop !== null) out.push("focus");
  if (rig.palette && !isLabPalette(rig.palette)) out.push("palette");
  if (rig.era) out.push("era");
  return out;
}

// ---------------------------------------------------------------------------
// HELD BY THE LAB (lab-grade.ts, 2026-09-15). The film stock, the lens's
// character and Silver Print are made after the cut on the finished pixels,
// so they never ride as words and the rig check never reads them: the model
// draws a clean frame and the lab makes the look. Their `block` and `pushed`
// stay as each look's written definition — what the lab is tuned to match —
// and a still shot before the lab keeps the words it was sent.
// ---------------------------------------------------------------------------

/** The palettes the lab makes rather than asks for: black and white. */
export function isLabPalette(id: string | null): boolean {
  return id === "silver-print";
}

/** What the lab develops for this rig, or null when there is nothing to do (no stock, lens or print it makes). */
export function labLooksOf(rig: Pick<SetRig, "stock" | "lens" | "palette">): LabLooks | null {
  const stock = rig.stock && rig.stock !== "digital" ? rig.stock : null;
  const lens = rig.lens && rig.lens !== "clean" ? rig.lens : null;
  const silver = isLabPalette(rig.palette);
  if (!stock && !lens && !silver) return null;
  return { stock, lens, silver };
}

export function findLook<T extends RigLook>(list: readonly T[], id: string | null): T | null {
  return id ? (list.find((x) => x.id === id) ?? null) : null;
}

/** Where a light stands as the camera sees it, in words — the sketch shows it, the words name it. */
export function lightDirectionWords(light: RigLightState, cameraBearingDeg: number): string {
  // The light's bearing against the camera's, both from the subject: 0 is
  // from behind the camera, 180 is from behind the subject.
  const rel = wrapDeg(light.azimuthDeg - cameraBearingDeg);
  const height = light.elevationDeg < 12 ? "low" : light.elevationDeg < 45 ? "high" : "almost overhead";
  const side = rel > 180 ? "frame left" : "frame right";
  let where: string;
  if (rel >= 150 && rel <= 210) where = "behind the person";
  else if (rel <= 30 || rel >= 330) where = "from behind the camera, onto the person";
  else if (rel > 30 && rel < 150) where = rel < 60 ? `from the front, ${side}` : rel > 120 ? `from behind, ${side}` : `from ${side}`;
  else where = rel > 300 ? `from the front, ${side}` : rel < 240 ? `from behind, ${side}` : `from ${side}`;
  // Screen side, reckoned the way set-shot-prompt.ts reckons a figure's facing.
  return `Light direction: the key light stands ${height}, ${where}, exactly as the sketch lights it.`;
}

export type RigShotContext = {
  /** Camera to subject, metres (the mark at eye height). */
  distanceM: number;
  /** The stage lens's vertical field of view over the render frame. */
  fovDeg: number;
  /** Bearing from the subject to the camera, degrees (0 = +Z). */
  cameraBearingDeg: number;
  /** Looks to say harder: what "Shoot again, pushed" sends for the ones that missed. */
  push?: readonly RigCheckItem[];
};

/**
 * Each checked look's words for one still, by the look they belong to —
 * what the shot sends, what the still keeps (shot-rig.ts), and exactly what
 * the rig check reads it against. The light carries its mood and its
 * direction; focus, its distances.
 */
export function rigWordsByItem(rig: SetRig, ctx: RigShotContext): Partial<Record<RigCheckItem, string>> {
  const push = new Set(ctx.push ?? []);
  const say = (item: RigCheckItem, l: RigLook | null) => (l ? (push.has(item) ? l.pushed : l.block) : "");
  const frame = formatFrame(rig.format);
  const out: Partial<Record<RigCheckItem, string>> = {};
  const light = rig.light ? findLook(RIG_LIGHTS, rig.light.scheme) : null;
  if (rig.light && light) out.light = `${say("light", light)} ${lightDirectionWords(rig.light, ctx.cameraBearingDeg)}`;
  if (rig.stop !== null && ctx.distanceM > 0) {
    const f = focalMm(ctx.fovDeg, frame.renderAspect >= 1 ? 24 : 36);
    const { nearM, farM } = depthOfField(f, rig.stop, ctx.distanceM);
    const d = m1(ctx.distanceM);
    if (push.has("focus")) {
      out.focus = Number.isFinite(farM)
        ? `Focus: very shallow — only the person, ${d} m from the camera, is sharp, from ${m1(nearM)} to ${m1(farM)} m; everything nearer or farther melts into soft blur.`
        : `Focus: deep — everything from ${m1(nearM)} m to the horizon is crisp, the person ${d} m from the camera included; nothing is blurred.`;
    } else {
      out.focus = Number.isFinite(farM)
        ? `Focus: the person, ${d} m from the camera, is sharp; the depth of field runs from ${m1(nearM)} to ${m1(farM)} m, and everything nearer or farther falls progressively soft.`
        : `Focus: the person, ${d} m from the camera, is sharp, and so is everything from ${m1(nearM)} m to the horizon.`;
    }
  }
  // The stock and the lens are the lab's (the section above): never words.
  const era = say("era", findLook(RIG_ERAS, rig.era));
  if (era) out.era = era;
  const pal = isLabPalette(rig.palette) ? "" : say("palette", findLook(RIG_PALETTES, rig.palette));
  if (pal) out.palette = pal;
  return out;
}

/** The order the rig's words read in a shot's prompt: the light first, the grade last. */
const PROMPT_ORDER: readonly RigCheckItem[] = ["light", "focus", "lens", "stock", "era", "palette"];

/**
 * The rig's sentences for one still, in the order they read: the frame's
 * cut, then each checked look (PROMPT_ORDER). All of it Picacho's own
 * words, with numbers the stage worked out; set-shot-prompt.ts strips them
 * for the brand-rule check like the rest of the scaffold.
 */
export function rigSentences(rig: SetRig, ctx: RigShotContext): string[] {
  const words = rigWordsByItem(rig, ctx);
  const cut = formatFrame(rig.format).cut ? (FORMAT_CUT_SENTENCE[rig.format] ?? "") : "";
  return [cut, ...PROMPT_ORDER.map((item) => words[item] ?? "")].filter(Boolean);
}

const FORMAT_CUT_SENTENCE: Partial<Record<RigFormat, string>> = {
  scope: "This frame will be cut to a wide 2.39 : 1 band across its middle: keep the person and everything that matters inside that band.",
  flat: "This frame will be cut to a 1.85 : 1 band across its middle: keep the person and everything that matters inside that band.",
  wide: "This frame will be cut to a 16 : 9 band across its middle: keep the person and everything that matters inside that band.",
  classic: "This frame will be cut to a 4 : 3 frame down its middle: keep the person and everything that matters inside it.",
  vertical: "This frame will be cut to a tall 9 : 16 band down its middle: keep the person and everything that matters inside that band.",
};

/** Every fixed rig sentence, for the scaffold stripper (set-shot-prompt.ts). */
export const RIG_FIXED_SENTENCES: readonly string[] = [
  ...Object.values(FORMAT_CUT_SENTENCE),
  ...[RIG_STOCKS, RIG_LENSES, RIG_ERAS, RIG_PALETTES, RIG_LIGHTS].flatMap((list) =>
    (list as readonly RigLook[]).flatMap((l) => [l.block, l.pushed]),
  ),
];

/** The rig's two sentences that carry numbers: "Light direction: …" and "Focus: …", to the full stop that ends them. */
export const RIG_NUMBERED_SENTENCE = /(?:Light direction|Focus): .*?(?<!\d)\.(?!\d)/g;
