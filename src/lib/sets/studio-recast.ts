// Helios Studio · Render ▸ "Video with your character" (2026-09-30; the
// operator picked it: "Video with your character"). The Studio records its
// animated scene — the car moving, the people walking and posing, the shot
// camera moving — and Recast, the lane already live in Picacho, re-shoots
// that recording with a saved character in a figure's place. This is how
// the rivals work: animate in 3D, record, AI re-shoot.
//
// Pure, no path aliases (vitest has none): the range, the size, the price
// and the payload, worked out the way Recast works them out. The price is
// Recast's own (trim.ts recastWindowCredits, the call its door quotes with
// and its start charges with), never a number of the Studio's.

import { RECAST_ENGINES, RECAST_JOB_MAX_SECONDS, RECAST_MIN_SECONDS, type RecastEngine } from "../recast/recast";
import { RECAST_DIRECTION_MAX_CHARS } from "../recast/recast-brief";
import type { RecastRead } from "../recast/recast-read";
import { recastWindowCredits, type RecastWindow } from "../recast/trim";

/**
 * The lanes the Studio offers, in Recast's order. Into the clip (Kling O3
 * Edit) keeps the recording's moves, camera and look and swaps the figure;
 * Restage (MiniMax H3 Max, 768p) takes the recording as a reference and
 * films it again. Photo to life is left out: it builds the picture from the
 * character's photo and leaves the recording's world — the whole point here
 * — behind. Restyle casts nobody.
 */
export const STUDIO_RECAST_ENGINES = ["kling-edit", "h3-768"] as const satisfies readonly RecastEngine[];
export type StudioRecastEngine = (typeof STUDIO_RECAST_ENGINES)[number];

export function parseStudioRecastEngine(v: unknown): StudioRecastEngine | null {
  return typeof v === "string" && (STUDIO_RECAST_ENGINES as readonly string[]).includes(v) ? (v as StudioRecastEngine) : null;
}

/** The short side of the recording: Kling O3 Edit takes 720–3840 px a side, so nothing needs scaling up on the server. */
export const STUDIO_RECAST_SHORT_PX = 720;
export const STUDIO_RECAST_LONG_MAX_PX = 3840;
/** Bits a second for the recording: 10 s stays near 8 MB, far inside Recast's 50 MB. */
export const STUDIO_RECAST_BITRATE = 6_000_000;

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** The recording's size for the shot camera's format: short side 720, even numbers, the format's own shape. */
export function studioRecastSize(aspect: number): { width: number; height: number } {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  if (a >= 1) return { width: Math.min(STUDIO_RECAST_LONG_MAX_PX, even(STUDIO_RECAST_SHORT_PX * a)), height: STUDIO_RECAST_SHORT_PX };
  return { width: STUDIO_RECAST_SHORT_PX, height: Math.min(STUDIO_RECAST_LONG_MAX_PX, even(STUDIO_RECAST_SHORT_PX / a)) };
}

/**
 * The timeline's playback range as Recast will take it (frames are 1-based
 * and inclusive; frame f shows at (f − 1) / fps): at least Recast's shortest
 * take, at most the job's ceiling and the timeline. The start is kept where
 * it was put and the end moved, as Recast's own window does (trim.ts
 * clampRecastWindow).
 */
export function studioRecastRange(a: { start: number; end: number; fps: number; lastFrame: number; engine: StudioRecastEngine }): {
  start: number;
  end: number;
  seconds: number;
  clamped: boolean;
} {
  const fps = a.fps;
  const lastFrame = Math.max(1, Math.floor(a.lastFrame));
  const maxFrames = Math.floor(Math.min(RECAST_JOB_MAX_SECONDS[RECAST_ENGINES[a.engine].job], lastFrame / fps) * fps + 1e-9);
  const minFrames = Math.min(lastFrame, Math.ceil(RECAST_MIN_SECONDS * fps - 1e-9));
  let start = Math.min(lastFrame, Math.max(1, Math.round(a.start)));
  let end = Math.min(lastFrame, Math.max(start, Math.round(a.end)));
  const was = [start, end].join();
  if (end - start + 1 > maxFrames) end = start + maxFrames - 1;
  if (end - start + 1 < minFrames) {
    end = Math.min(lastFrame, start + minFrames - 1);
    start = Math.max(1, end - minFrames + 1);
  }
  return { start, end, seconds: (end - start + 1) / fps, clamped: [start, end].join() !== was };
}

/** How many of a character's photos ride with a take on this engine — Recast's own rule (actions.ts photosOfRow). */
export function studioRecastPhotos(engine: StudioRecastEngine, photoCount: number): number {
  return Math.min(RECAST_ENGINES[engine].takesMorePhotos ? 4 : 1, Math.max(1, Math.floor(photoCount) || 0));
}

/** The whole recording is the window: from its first frame, for the range's length. */
export function studioRecastWindow(seconds: number): RecastWindow {
  return { start: 0, end: seconds };
}

/**
 * THE price, in credits: Recast's quote for a window this long on this
 * engine. Restage bills its reference pictures beside its seconds, and a
 * lone character's photos are all it carries (the Studio adds no images).
 */
export function studioRecastCredits(engine: StudioRecastEngine, seconds: number, photoCount: number, looks = 0): number {
  // Recast's own quote (actions.ts startRecastTakes): Restage bills its reference pictures — the character's photos and
  // every added image (a look from the gallery, 2026-09-30) — beside its seconds; Into the clip bills its seconds only.
  const references = RECAST_ENGINES[engine].restages ? studioRecastPhotos(engine, photoCount) + Math.max(0, Math.floor(looks) || 0) : 0;
  return recastWindowCredits(engine, { seconds, frames: null }, studioRecastWindow(seconds), references);
}

export type FigureSpot = "left" | "middle" | "right";

/** Where a figure stands across the frame, from its screen x (−1 left edge … 1 right edge). */
export function studioFigureSpot(x: number): FigureSpot {
  return x < -0.25 ? "left" : x > 0.25 ? "right" : "middle";
}

const SPOT_WORDS: Record<FigureSpot, string> = { left: "on the left of the frame", middle: "in the middle of the frame", right: "on the right of the frame" };

/**
 * The person in Recast's read who is this figure, or null when that can't be
 * said for sure. One figure in the shot: the read's lead. Several: only when
 * the read found as many people as there are figures and says plainly where
 * each stands (left, middle, right), in the same order as the figures stand.
 * Otherwise the words say which figure, and the brief names nobody.
 */
export function studioRecastTag(read: Pick<RecastRead, "people"> | null, figuresX: readonly number[], chosen: number): string | null {
  const people = read?.people ?? [];
  if (people.length === 0 || chosen < 0 || chosen >= figuresX.length) return null;
  if (figuresX.length === 1) return (people.find((p) => p.lead) ?? people[0]).tag;
  if (people.length !== figuresX.length) return null;
  const across = (where: string): number | null => {
    const w = where.toLowerCase();
    const l = /\bleft\b/.test(w), r = /\bright\b/.test(w), m = /\b(middle|centre|center)\b/.test(w);
    return l && !r ? -1 : r && !l ? 1 : m && !l && !r ? 0 : null;
  };
  const read2 = people.map((p) => ({ tag: p.tag, x: across(p.where) }));
  if (read2.some((p) => p.x === null) || new Set(read2.map((p) => p.x)).size !== read2.length) return null;
  const figs = figuresX.map((x, i) => ({ i, x }));
  if (new Set(figs.map((f) => studioFigureSpot(f.x))).size !== figs.length) return null;
  const byX = [...figs].sort((p, q) => p.x - q.x).map((f) => f.i);
  const tags = [...read2].sort((p, q) => (p.x as number) - (q.x as number)).map((p) => p.tag);
  return tags[byX.indexOf(chosen)] ?? null;
}

/** The line that says which figure the character replaces, always sent (the grey mannequin is a stand-in, not a person). */
export function studioFigureLine(several: boolean, spot: FigureSpot): string {
  return several
    ? `The character takes the place of the grey mannequin figure ${SPOT_WORDS[spot]} and does exactly what it does; the other figures stay as they are.`
    : "The character takes the place of the grey mannequin figure and does exactly what it does.";
}

/** Restage's own line: the recording is a grey 3D mock-up, and this lane films it for real. */
export const STUDIO_RESTAGE_LINE = "Film it as live action: real materials, real light and a real place in place of the grey 3D mock-up, with the same camera move.";

/**
 * The direction sent to Recast: what happens (the person's words, prefilled
 * from the poses and moves), which figure, and Restage's line — bounded at
 * Recast's own limit, with the person's words shortened first.
 */
export function studioRecastDirection(a: {
  words: string;
  several: boolean;
  spot: FigureSpot;
  engine: StudioRecastEngine;
  /** "Real scene" on: the whole scene made real (studioRealSceneLine), in place of Restage's own line. */
  realScene?: string | null;
  /** What the character wears (studioWearLine), sent on its own when Real scene is off — the real-scene line carries it when on. */
  wear?: string | null;
}): string {
  const scene = a.realScene ? [a.realScene] : [...(a.wear ? [a.wear] : []), ...(RECAST_ENGINES[a.engine].restages ? [STUDIO_RESTAGE_LINE] : [])];
  const fixed = [studioFigureLine(a.several, a.spot), ...scene].join(" ");
  const room = RECAST_DIRECTION_MAX_CHARS - fixed.length - 1;
  const words = a.words.replace(/\s+/g, " ").trim();
  const kept = Array.from(words).slice(0, Math.max(0, room)).join("").trim();
  return (kept ? `${kept} ${fixed}` : fixed).slice(0, RECAST_DIRECTION_MAX_CHARS);
}

// ---------------- "Real scene" (2026-09-30, operator: "Go ahead", then "fix") ----------------
// Live Test A (8d425291): restyle words in the direction turned the WHOLE
// recording photoreal on Into the clip — "a real race track with real
// asphalt, kerbs and grass, a real concrete pit building, a real yellow sports
// car, natural daylight, shot on a cinema camera" — Eva at IDENTITY 92, same
// engine and price. The first built line (f997e4ea, IDENTITY 72) was worse:
// it quoted the set description and was cut inside a clause ("…beside a)"),
// named no sky or ground (both stayed flat CG), and said nothing of the
// outfit (the engine invented a black evening dress). So the line is now
// made only of short whole items — the kind of place with its real surfaces,
// its buildings and its things by colour, the hour's light and sky, real
// ground, the outfit from the photos — and when it runs long, whole items
// go, lowest first; nothing is ever cut mid-phrase. It shares Recast's
// 600-character direction (recast-brief.ts RECAST_DIRECTION_MAX_CHARS; the
// engine's own prompt stops at 2,500), so it stays under
// STUDIO_REAL_SCENE_MAX and the person keeps the rest. Characters carry no
// pronoun (and the house rule never guesses one): always "the character".

export const STUDIO_REAL_SCENE_MAX = 340;
const THINGS_MAX = 3;
const BUILDINGS_MAX = 2;

type PlaceKind = { re: RegExp; kind: string; surfaces: string; indoor: boolean };
/** Kinds of place, found in the set's title and description, each with the real surfaces the engine should draw. First match wins. */
const PLACE_KINDS: PlaceKind[] = [
  { re: /\b(race ?track|racing circuit|circuit|raceway|speedway|racecourse|grand prix)\b/, kind: "race track", surfaces: "real asphalt, kerbs and grass", indoor: false },
  { re: /\bshowroom\b/, kind: "car showroom", surfaces: "real polished floors and glass", indoor: true },
  { re: /\b(parking (lot|garage|structure)|car park)\b/, kind: "parking lot", surfaces: "real concrete and painted lines", indoor: false },
  { re: /\bwarehouse\b/, kind: "warehouse", surfaces: "real concrete floors and brick walls", indoor: true },
  { re: /\bgarage\b/, kind: "garage", surfaces: "real concrete floors and walls", indoor: true },
  { re: /\brooftop\b/, kind: "rooftop", surfaces: "real concrete, railings and a city skyline", indoor: false },
  { re: /\b(street|avenue|alley|boulevard|downtown|sidewalk|pavement)\b/, kind: "city street", surfaces: "real pavement, kerbs and shopfronts", indoor: false },
  { re: /\b(highway|freeway|motorway|country road|desert road)\b/, kind: "road", surfaces: "real asphalt, road markings and verges", indoor: false },
  { re: /\bbeach\b/, kind: "beach", surfaces: "real sand and water", indoor: false },
  { re: /\bdesert\b/, kind: "desert", surfaces: "real sand, rocks and dust", indoor: false },
  { re: /\b(forest|woods|woodland)\b/, kind: "forest", surfaces: "real trees, leaves and earth", indoor: false },
  { re: /\bstudio\b/, kind: "studio", surfaces: "real floors, walls and lights", indoor: true },
  { re: /\boffice\b/, kind: "office", surfaces: "real desks, floors and windows", indoor: true },
  { re: /\b(kitchen|living room|bedroom|apartment|loft)\b/, kind: "home", surfaces: "real furniture, floors and walls", indoor: true },
];
const ANY_PLACE: PlaceKind = { re: /$^/, kind: "place", surfaces: "real walls, floors and materials", indoor: false };

function placeKind(title: string, description: string): PlaceKind {
  const text = `${title} ${description}`.toLowerCase();
  return PLACE_KINDS.find((k) => k.re.test(text)) ?? ANY_PLACE;
}

/** Whether the set is a place under a roof (a showroom, a warehouse, a studio…): the Studio's default sky follows it. */
export function studioPlaceIndoor(title: string, description: string): boolean {
  return placeKind(title, description).indoor;
}

/** The place: its kind and its real surfaces ("a real race track with real asphalt, kerbs and grass"). Never the set's own sentences. */
export function studioPlaceWords(title: string, description: string): string {
  const k = placeKind(title, description);
  return `a real ${k.kind} with ${k.surfaces}`;
}

/** Buildings the set's words name, as real ones. */
const BUILDINGS: [RegExp, string][] = [
  [/\bpit (garages?|buildings?|boxes|lane)\b/, "a real concrete pit building"],
  [/\bgrandstands?\b/, "real grandstands"],
  [/\b(terminal|facades?|towers?|office blocks?|buildings?)\b/, "real buildings"],
  [/\b(warehouses?|hangars?|sheds?)\b/, "a real warehouse"],
  [/\bgarages?\b/, "a real garage"],
  [/\b(barriers?|walls?)\b/, "real concrete walls"],
];

const COLOURS = "yellow|red|scarlet|crimson|orange|blue|navy|teal|green|black|white|silver|grey|gray|gold|bronze|purple|pink|brown|beige";
/** Longer names first, so "sports coupe" wins over "coupe"; the value is how the engine hears it. */
const VEHICLES: [string, string][] = [
  ["sports coupe", "sports car"], ["sports car", "sports car"], ["race car", "race car"], ["racing car", "race car"],
  ["supercar", "sports car"], ["hypercar", "sports car"], ["coupe", "sports car"], ["sedan", "sedan"], ["convertible", "convertible"],
  ["pickup truck", "pickup truck"], ["truck", "truck"], ["van", "van"], ["motorcycle", "motorcycle"], ["motorbike", "motorcycle"],
  ["scooter", "scooter"], ["bus", "bus"], ["taxi", "taxi"], ["jeep", "jeep"], ["suv", "SUV"], ["helicopter", "helicopter"],
  ["boat", "boat"], ["yacht", "yacht"], ["jet", "jet"], ["bicycle", "bicycle"], ["car", "car"],
];
const THING_RE = new RegExp(`\\b(${COLOURS})\\s+(?:[a-z-]+\\s+){0,2}?(${VEHICLES.map(([w]) => w).join("|")})\\b`, "g");

/** The things the set's words name with a colour: "an unbadged scarlet supercar" → "scarlet sports car". */
export function studioDescribedThings(description: string): string[] {
  const out: string[] = [];
  for (const m of description.toLowerCase().matchAll(THING_RE)) {
    const colour = m[1] === "gray" ? "grey" : m[1];
    out.push(`${colour} ${VEHICLES.find(([w]) => w === m[2])![1]}`);
  }
  return out;
}

/** The light, from the Studio's hour (sun time, 0–24). */
export function studioSceneLight(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  if (h < 5 || h >= 21) return "real night light from real lamps";
  if (h < 7.5) return "soft early-morning daylight";
  if (h < 16.5) return "natural daylight";
  if (h < 19) return "warm golden-hour light";
  return "dusk light";
}

/** The sky for the hour — always named, or it stays flat CG (f997e4ea). */
export function studioSceneSky(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  if (h < 5 || h >= 21) return "a real night sky";
  if (h < 7.5) return "a real morning sky";
  if (h < 16.5) return "a real sky with soft clouds";
  if (h < 19) return "a real golden evening sky";
  return "a real dusk sky";
}

export const STUDIO_REAL_OUTFIT_LINE = "The character keeps the outfit and hair from the photos.";
/** The Outfit box's longest words (the real-scene line still fits: whole items go first). */
export const STUDIO_OUTFIT_MAX = 90;

/**
 * What the character wears, for the engine (2026-09-30, operator: "Add outfit and make it so I can pick from eva's
 * image gallery"): the Outfit box's words, and/or a look picked from their gallery, which rides to Recast as an
 * added image — "image 1" in the direction (recast-brief.ts imageLines). Neither: null, and the photos' own
 * outfit holds (STUDIO_REAL_OUTFIT_LINE on a real scene; Recast's brief says so on its own otherwise).
 */
export function studioWearLine(a: { outfit: string; look: boolean; photo?: boolean }): string | null {
  const words = a.outfit.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "").slice(0, STUDIO_OUTFIT_MAX).trim();
  // A photo's look rides as the still's outfit reference (the render lane's "outfit" role, named "the outfit
  // photo" in its own notes); a video's as Recast's added image, "image 1" in its brief.
  const where = a.photo ? "the outfit photo" : "image 1";
  if (words && a.look) return `The character wears: ${words} (as in ${where}).`;
  if (words) return `The character wears: ${words}.`;
  if (a.look) return a.photo ? "The character wears the outfit from the outfit photo." : "The character wears the outfit and hair from image 1.";
  return null;
}

/**
 * Outfit words from a gallery picture's own prompt, for the Outfit box: what follows "wearing", "dressed in" or
 * "outfit:" up to the end of that phrase. "" when the prompt says nothing of clothes.
 */
export function studioOutfitFromPrompt(prompt: string | null | undefined): string {
  const text = (prompt ?? "").replace(/\s+/g, " ");
  const m = text.match(/\b(?:wearing|wears|dressed in|clad in|outfit:|in (?:a|an) (?=(?:[\w-]+ ){1,3}(?:dress|suit|jacket|coat|shirt|t-shirt|hoodie|gown|uniform|jumpsuit)\b))\s*([^.;:!?\n]{3,})/i);
  if (!m) return "";
  let words = m[1].split(/,\s*(?:(?:she|he|they|standing|sitting|walking|looking|holding|with (?:her|his|their) (?:back|hands?|arms?))\b)|\s+(?:and )?(?:standing|sitting|walking|looking|posing|holding|smiling|in front of|on a|at the|against|under|beside|next to)\b/i)[0];
  words = words.replace(/[,\s]+$/, "").trim();
  if (words.length > STUDIO_OUTFIT_MAX) words = words.slice(0, STUDIO_OUTFIT_MAX).replace(/[,\s][^,\s]*$/, "").trim();
  return words;
}
const KEEP_LINE = "Keep the moves and camera exactly.";

/**
 * The "Real scene" line, in Test A's words: the place with its real surfaces,
 * its buildings and things (by colour), the hour's light and sky, real
 * ground, the outfit from the photos, the moves and the camera kept. Over
 * STUDIO_REAL_SCENE_MAX, whole items go, lowest first: the later things and
 * buildings, then the first building, then the first thing, then the
 * surfaces. The sky, the ground and the outfit always stay.
 */
export function studioRealSceneLine(a: { title: string; description: string; things: string[]; hour: number; wear?: string | null }): string {
  const wear = a.wear || STUDIO_REAL_OUTFIT_LINE;
  const k = placeKind(a.title, a.description);
  const norm = (t: string) => t.replace(/^(the|a|an)\s+/i, "").replace(/\s+/g, " ").trim().toLowerCase();
  const things = [...new Set([...studioDescribedThings(a.description), ...a.things.map(norm)].filter(Boolean))].slice(0, THINGS_MAX).map((t) => `a real ${t}`);
  const text = `${a.title} ${a.description}`.toLowerCase();
  const buildings = [...new Set(BUILDINGS.filter(([re]) => re.test(text)).map(([, w]) => w))].slice(0, BUILDINGS_MAX);
  const sky = k.indoor ? `${studioSceneSky(a.hour)} through the windows` : studioSceneSky(a.hour);
  // Keep priority, highest first: the first thing, the first building, then the rest in turn.
  const extras: string[] = [];
  for (let i = 0; i < Math.max(things.length, buildings.length); i++) {
    if (things[i]) extras.push(things[i]);
    if (buildings[i]) extras.push(buildings[i]);
  }
  const build = (kept: Set<string>, place: string) =>
    `Turn the whole scene into real live-action footage: ${[
      place,
      ...buildings.filter((b) => kept.has(b)),
      ...things.filter((t) => kept.has(t)),
      studioSceneLight(a.hour),
      sky,
      "real ground",
    ].join(", ")}, shot on a cinema camera. ${wear} ${KEEP_LINE}`;
  for (const place of [`a real ${k.kind} with ${k.surfaces}`, `a real ${k.kind}`]) {
    for (let n = extras.length; n >= 0; n--) {
      const line = build(new Set(extras.slice(0, n)), place);
      if (line.length <= STUDIO_REAL_SCENE_MAX) return line;
    }
  }
  return build(new Set(), `a real ${k.kind}`);
}

/**
 * One step the chosen figure takes inside the range, in seconds from the range's start. For a walk or run,
 * `toward` is how it goes as the shot camera sees it ("toward the camera", studioWalkWords); for a turn, what it
 * turns to face. `gaze`: where it looks on the way ("looking ahead" unless a Look at… is set).
 */
export type StudioRecastStep = { kind: "walk" | "run" | "turn"; from: number; to: number; toward: string | null; gaze?: string | null };

/**
 * How a walk goes as the shot camera sees it (2026-09-30: the prefill said "walk to the yellow car" while she
 * walked TOWARD THE CAMERA — the engine turned her head to the car). From the figure's distance to the camera
 * (metres) and its place across the frame (−1 left edge … 1 right) at the step's start and end.
 */
export function studioWalkWords(a: { depth0: number; depth1: number; x0: number; x1: number }): string | null {
  const dd = a.depth1 - a.depth0, dx = a.x1 - a.x0;
  const closer = dd < -0.6 ? "toward the camera" : dd > 0.6 ? "away from the camera" : null;
  const across = Math.abs(dx) > 0.35 ? (dx > 0 ? "from left to right" : "from right to left") : null;
  if (closer && across) return `${closer}, crossing the frame ${across}`;
  if (closer) return closer;
  if (across) return `across the frame ${across}`;
  return null;
}

const secs = (n: number) => `${Math.round(n * 10) / 10} s`;

/**
 * "What happens", prefilled: how the figure starts (the pose builder's own
 * sentence, studio-pose.ts poseSentence) and what it does over the range.
 * In English, for the video engine; the person may change it freely.
 */
export function studioRecastHappens(start: string, steps: readonly StudioRecastStep[]): string {
  const said = steps.map((s) => {
    const when = `From ${secs(s.from)} to ${secs(s.to)}`;
    if (s.kind === "turn") return `${when} they turn${s.toward === "left" || s.toward === "right" ? ` to their ${s.toward}` : s.toward ? ` to face ${s.toward}` : " on the spot"}.`;
    const verb = s.kind === "run" ? "run" : "walk";
    return `${when} they ${verb}${s.toward ? ` ${s.toward}` : ""}${s.gaze ? `, ${s.gaze}` : ""}.`;
  });
  return [start.trim(), ...said].filter(Boolean).join(" ");
}

/**
 * Whether the face check can read the figure's face at one frame of the
 * recording (2026-09-30: both first live takes read IDENTITY 34 while the
 * face was clearly the character's — the check records its WORST of the
 * first, middle and last frames, and a walk that starts far off, or with its
 * back to the camera, hands it a frame with no face to read). The Studio
 * measures its own figure: the head at least HEAD_MIN_SHARE of the frame's
 * height, and turned no more than FACE_MAX_TURN_DEG from the camera (a
 * profile still reads).
 */
export const HEAD_MIN_SHARE = 0.05;
export const FACE_MAX_TURN_DEG = 100;
export function studioFaceReadable(at: { headPx: number; frameH: number; turnDeg: number; inFrame: boolean }): boolean {
  return at.inFrame && at.frameH > 0 && at.headPx / at.frameH >= HEAD_MIN_SHARE && at.turnDeg <= FACE_MAX_TURN_DEG;
}

/** What startRecastTakes is sent from the Studio: one character, the whole recording, this press's id. */
export type StudioRecastStart = {
  sendId: string;
  path: string;
  characterIds: string[];
  engine: StudioRecastEngine;
  keeps: string[];
  direction: string;
  castTag?: string;
  read: RecastRead | null;
  window: RecastWindow;
  /** Whether the face can be read at the recording's first and last frame. */
  faceAt: { first: boolean; last: boolean };
  /** The look picked from the character's gallery, as Recast's added image. */
  imagePaths?: string[];
  rights: true;
};

export function studioRecastStart(a: {
  sendId: string;
  path: string;
  characterId: string;
  engine: StudioRecastEngine;
  seconds: number;
  direction: string;
  read: RecastRead | null;
  castTag: string | null;
  /** Measured by the Studio; left out, both ends are read as before. */
  faceAt?: { first: boolean; last: boolean } | null;
  /** A look from the character's gallery, copied into Recast's image folder (studio-recast-actions.ts): an added image. */
  imagePath?: string | null;
}): StudioRecastStart {
  return {
    sendId: a.sendId,
    path: a.path,
    characterIds: [a.characterId],
    engine: a.engine,
    // Recast's door sends the read's keeps that are still ticked; nothing is untick-able here, so all of them.
    keeps: (a.read?.keeps ?? []).map((k) => k.what),
    direction: a.direction,
    ...(a.castTag ? { castTag: a.castTag } : {}),
    read: a.read,
    window: studioRecastWindow(a.seconds),
    faceAt: { first: a.faceAt?.first !== false, last: a.faceAt?.last !== false },
    ...(a.imagePath ? { imagePaths: [a.imagePath] } : {}),
    // The recording is made here, from the person's own scene.
    rights: true,
  };
}
