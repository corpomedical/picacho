// The reader's contract, v2 (Helios Cut 2, "Astra understands", step 4,
// 2026-09-25 — operator: "Run, keep going.").
//
// WHAT. One message to a set's chat can say many things at once — "Eva
// leans on the car, golden hour, anamorphic, low angle" — correct what was
// just done ("no, lower"), ask a question, or ask for what the set can't do
// yet. The reader (shot-words.ts askShotReader, the same small model as v1)
// answers with ONE sparse JSON object in the shape SHOT_READER_STATIC
// teaches, and this file holds that answer to the set: every value checked
// against its list or the set's own ids, every number clamped, the model's
// short aliases (t1, p1) mapped back to the set's own things and the
// person's own characters. What does not match is dropped and NAMED, never
// guessed — the page says "part of that didn't match" and, in "Shoot
// without asking", shoots nothing (the money rules, spec §3.8).
//
// THE PERSON'S OWN WORDS (spec §2.4, critic item 12). The model never
// writes words that reach a picture or Astra. "What happens" is built only
// from exact pieces of what NOW already says and of the message
// (composeHappens), a set change quotes only the message (set_change.said),
// and a "not yet" quotes only the message (cant[].said) — each checked by
// exactPiece, which keeps the SOURCE's text, so the person's own spelling
// and capitals survive. The one model-written line is the labelled idea
// (≤160 characters, the owner's decision 4), shown in quotes and never
// sent anywhere.
//
// MEANING, NOT WORDS (his standard). Nothing here routes on words: the
// page acts on the fields. The example words inside SHOT_READER_STATIC
// ("take it, go, shoot now") teach the model what a key means; the page
// never matches them.
//
// Pure, relative imports only: the server action and the page share it,
// and the tests read it with no network.

import { LENSES_MM } from "./build-scene";
import { rigCommandIds } from "./commands";
import { FILM_MOVES, FILM_TEXTURES, type FilmMove, type FilmTexture } from "./moves";
import { SET_DIRECTION_MAX_CHARS, SET_MAX_TILT_DOWN_DEG, SET_MAX_TILT_UP_DEG } from "./set-config";
import { STAND_POSES, cleanText, type SetSpec, type StandPose } from "./set-spec";
import { CAMERA_HEIGHTS, CAMERA_SIDES, FIGURE_FACINGS, SHOT_SIZES, type CameraHeight, type CameraSide, type FigureFacing, type LensMm, type ShotSize } from "./shot-words";
import { astraCardWords } from "./astra-card";
import type { SetTakeEngine } from "./take";

// ---------------------------------------------------------------------------
// The switches.
// ---------------------------------------------------------------------------

/** The labelled idea line (≤160 characters) is allowed: the owner's decision 4, 2026-09-25. */
export const SHOT_READER_IDEAS = true;
/**
 * Reader v2 is for admins until check A passes (spec §7.4): the paid
 * phrase check the owner runs himself, once the OpenAI balance is topped
 * up. Everyone else keeps v1 with step 1's guards.
 */
export const SHOT_READER_V2_OPEN_TO_ALL = false;
/**
 * The answer's cap, visible text and hidden reasoning together. 600 until
 * check A measures the answers: then max(400, 1.5 × the p99 of what they
 * used). This model can spend the cap on reasoning before it writes
 * (describe-image.ts, operator report 2026-08-25), so a "length" finish in
 * check A is a hard fail, and what a reading costs is measured, not argued.
 */
export const SHOT_READER_MAX_COMPLETION = 600;

// ---------------------------------------------------------------------------
// The lists a value must be on.
// ---------------------------------------------------------------------------

/** Camera changes relative to NOW, in order (turn-plan.ts cameraStep). */
export const READER_STEPS = ["closer", "further", "higher", "lower", "left", "right", "other_side", "tilt_up", "tilt_down", "wider", "longer"] as const;
export type ReaderStep = (typeof READER_STEPS)[number];
/** The side of a thing they stand at. */
export const NEAR_SIDES = ["front", "back", "left", "right", "beside"] as const;
export type NearSide = (typeof NEAR_SIDES)[number];
/** A look out of frame, by their own front: people.ts sideOf's words. */
export const GAZE_SIDES = ["ahead", "left", "right", "behind"] as const;
export type GazeSide = (typeof GAZE_SIDES)[number];
export const TURN_WORDS = ["left", "right", "around"] as const;
export type TurnWord = (typeof TURN_WORDS)[number];
/** Where they stand across the picture: the thirds, through the Match solver's off-centre subject (the owner's decision 5). */
export const FRAME_XS = ["left_third", "centre", "right_third"] as const;
export type FrameX = (typeof FRAME_XS)[number];
/** What a question may be about; each is answered from the page's own facts (turn-reply.ts). */
export const ASK_TOPICS = ["lens", "focus", "format", "light", "look", "who", "where", "happens", "cost", "edits_left", "last_still", "things", "help", "elsewhere"] as const;
export type AskTopic = (typeof ASK_TOPICS)[number];
/**
 * What the chat can't do yet, each with its own honest line (spec §5.5).
 * The seam later cuts retire codes from: a code goes when its cut lands.
 */
export const CANT_CODES = [
  "two_people",
  "extras",
  "raise_figure",
  "roll",
  "camera_inside",
  "aim_thing",
  "thirds",
  "altitude",
  "thing_unknown",
  "weather",
  "film_beats",
  "clip_length",
  "mover",
  "sound",
  "photo",
  "brand",
  "likeness",
  "rebuild",
  "other",
] as const;
export type CantCode = (typeof CANT_CODES)[number];
/** The take engines a message may ask for by length or name (take.ts SET_TAKE_ENGINES; the test holds them equal). */
export const READER_ENGINES = ["omni", "veo"] as const satisfies readonly SetTakeEngine[];
/** The rig ids the reader may answer with: ⌘K's own (commands.ts), so the chat and ⌘K set the rig the same way. */
export const READER_RIG_IDS: readonly string[] = rigCommandIds();
/** An id of READER_RIG_IDS, "group:value" (time:golden, stock:film35). */
export type ReaderRigId = string;

/** Every cap the contract holds a reading to (spec §2.2, §2.4). */
export const READER_MAX = {
  keep: 4,
  add: 3,
  /** A piece shorter than this is no quote: a happens piece is dropped without a word, a "not yet" says "part of that". */
  pieceMinChars: 2,
  steps: 4,
  rig: 8,
  textures: 3,
  ask: 4,
  suggest: 3,
  cant: 5,
  cantSaid: 60,
  gloss: 200,
  idea: 160,
  /** Things one "which one?" offers. */
  candidates: 3,
  /** Metres either way, in picture terms. */
  nudge: 10,
  /** Exposure change, thirds of a stop either way (rig.ts RIG_EV_RANGE is 3 stops). */
  evThirds: 9,
  hourMin: 5,
  hourMax: 22,
  hourStep: 0.25,
  /** The highest still number a message may point at: past any set's filmstrip. */
  stillNumber: 9999,
} as const;

// ---------------------------------------------------------------------------
// The shapes.
// ---------------------------------------------------------------------------

/** A thing the words point at: one of the set's things (elements.ts keys), or two or three that fit equally — the page asks "which one?". */
export type ThingPick = { key: string } | { candidates: string[] };
/** What happens, as pieces: kept from NOW's, added from the message. Both empty clears it. */
export type HappensOp = { keep: string[]; add: string[] };
/** The model's short names, mapped back on the server (reader-context.ts readerStageBlock): alias → element key, alias → the person's own character id. */
export type ReaderAliases = { things: Record<string, string>; people: Record<string, string> };

/** What a reading asks the stage to do: every one free. A suggestion is one of these too. */
export type ShotAct = {
  characterId?: string;
  markId?: string;
  near?: { thing: ThingPick; side: NearSide };
  nudge?: { right: number; toward: number };
  turn?: TurnWord;
  pose?: StandPose;
  /** A facing word, or a thing to face (one, or candidates for "which one?"). */
  facing?: FigureFacing | ThingPick;
  gaze?: "camera" | "none" | ThingPick | { side: GazeSide };
  cameraId?: string;
  side?: CameraSide;
  size?: ShotSize;
  height?: CameraHeight;
  tiltDeg?: number;
  lensMm?: LensMm;
  frameX?: FrameX;
  steps?: ReaderStep[];
  look?: "newest" | "off" | number;
  rig?: ReaderRigId[];
  hour?: number;
  evThirds?: number;
  move?: FilmMove;
  textures?: FilmTexture[];
  engine?: SetTakeEngine;
};

/** The ShotAct keys, for a page that asks whether a reading acts at all. */
export const SHOT_ACT_KEYS = [
  "characterId",
  "markId",
  "near",
  "nudge",
  "turn",
  "pose",
  "facing",
  "gaze",
  "cameraId",
  "side",
  "size",
  "height",
  "tiltDeg",
  "lensMm",
  "frameX",
  "steps",
  "look",
  "rig",
  "hour",
  "evThirds",
  "move",
  "textures",
  "engine",
] as const satisfies readonly (keyof ShotAct)[];

export type ShotReading = ShotAct & {
  shoot?: true;
  undo?: true;
  happens?: HappensOp;
  wardrobe?: true;
  /** Their own words asking to change the set itself (≤300, SET_EDIT_MAX_CHARS; `cut` when they wrote more), and the model's short English gloss, gated as the reader's (spec §6.2). */
  setChange?: { said: string; gloss: string | null; cut: boolean };
  ask?: AskTopic[];
  /** The model's one labelled line of advice, ≤160 characters. */
  idea?: string;
  /** Up to three options to try, with no words, no wardrobe and no set change by construction. */
  suggest?: ShotAct[];
  /** What it could not place, with their own words when it quoted them exactly (else null: "part of that"). */
  cant?: { code: CantCode; said: string | null }[];
};

// ---------------------------------------------------------------------------
// The instructions: the first system message, byte-identical on every call
// so the provider's prompt cache holds it (spec §2.1). Copied verbatim from
// the spec's measured draft (§2.5, 6,164 characters); a test pins it at
// 6,300 at most, holds every list below to it, and keeps it a plain literal.
// ---------------------------------------------------------------------------

export const SHOT_READER_STATIC = `You are the first assistant director on a small 3D film set. The director writes to you: often several instructions in one breath, a correction of what was just done, or a question. Read what they MEAN, in the context of STAGE, NOW and LAST TURNS, and answer with ONE JSON object and no other text. Include only the keys you set; a missing key means "not said". Set only what they asked for or clearly meant; never invent. Never say that anything was done: the page reports what it did. Do the nearest thing you can AND list what you could not in cant.

KEYS
shoot: true only when they ask to take the picture now (take it, go, shoot now). Words about how to shoot (shoot her from below) are camera keys, never shoot.
undo: true when they ask to take back the last change.
who: a character alias when they NAME who is in the frame. she, he, her, him, they mean whoever is in NOW: a pronoun never sets who. One person per shot: anyone else is cant two_people.
happens: what happens in the picture (action, pose, expression, mood, what they wear or hold, small things with them) as {"keep": [pieces of NOW's What happens that still hold], "add": [pieces of their message]}. Copy every piece exactly, never reworded or shortened. Leave out camera, lens, light, time, grade and look words, and anything you put in cant. {} clears it.
wardrobe: true when happens says what they wear.
mark: a mark id when they name a mark or its place.
near: {"thing": alias, "side": "front"|"back"|"left"|"right"|"beside"} stands them by a thing. When the words fit several things equally, "thing" is the list of candidates.
nudge: {"right": m, "toward": m} moves them in the picture's terms (+right = picture right, +toward = toward the camera), each -10..10; "a bit" is 0.5.
turn: "left"|"right"|"around", from the way they face now.
pose: stand|sit|walk|lean. On top of something is cant raise_figure; they sit beside it.
facing: camera|away|left|right (the picture's sides) or {"thing": alias}.
gaze: "camera", "none", {"thing": alias}, or {"side": "ahead"|"left"|"right"|"behind"} for a look out of frame.
camera_id: a camera id when they name it or ask for the view its name describes. Other camera keys then adjust from it.
side: where the camera stands by THEIR front: front, back, left, right, front_left, front_right, back_left, back_right. The side of something else is not a side.
size: close_up|medium|full|wide. height: low|eye|high. tilt_deg: + up, - down, only when said.
lens_mm: 18|24|35|50|85|135 when they name a focal length. 35mm film or grain is a stock, never a lens.
frame_x: left_third|centre|right_third, where they stand across the picture.
steps: up to 4 camera changes relative to NOW, in order: closer, further, higher, lower, left, right, other_side, tilt_up, tilt_down, wider, longer.
look: "newest", "off" or a still number: which earlier still the picture copies its world from.
rig: up to 8 LOOK IDS, each group:value (time:golden). A named time of day is a time id; a clock time is hour.
hour: a clock time, 5 to 22 in quarter hours (6:30 pm = 18.5).
ev: exposure change in thirds of a stop, -9..9 (a touch brighter = 1, brighter = 3).
move, textures: a camera move and textures for a moving shot, from MOVES and TEXTURES. engine: omni (5 s) or veo (8 s), only when they ask for a length or an engine.
set_change: {"said": their exact words asking to change the PLACE ITSELF (add, remove, recolour or move what is built, add a lamp), "gloss": optional short English meaning, no brand names}. Never time, light, sky, grade or look (LOOK IDS are free), never the camera, the person or what they hold.
ask: up to 4 topics they ask about: lens, focus, format, light, look, who, where, happens, cost, edits_left, last_still, things, help, elsewhere (their account, plan, credits, other tools).
idea: only when they ask for advice or an opinion: at most 160 characters, in their language, about this set and shot. Never facts about the page, never a promise.
suggest: when they ask what would look good, or name a style you must interpret (a filmmaker, a film, a mood): up to 3 options, each an object with keys from who to engine, never happens or set_change. Suggest instead of acting when you interpret.
cant: [{"code": CODE, "said": their exact words, at most 60 characters}] for what you could not place. CODES: two_people; extras (crowds, animals as figures); raise_figure (on top of a thing); roll (a tilted horizon); camera_inside (inside a car or thing); aim_thing (framing a thing instead of the person); thirds (a spot in frame other than left third, centre or right third); altitude (above a high camera); thing_unknown (a built part not in THINGS); weather; film_beats (then..., cuts, several shots); clip_length; mover (a thing that drives or moves); sound (voices, dialogue, music, sound effects); photo; brand; likeness (to look like a real person); rebuild (a whole different place); other.

LOOK IDS (free, instant)
format: square, scope (2.39), flat (1.85), wide (16:9), classic (4:3), vertical (9:16). squeeze: 1, 1.33, 2.
stop: 1.4, 2, 2.8, 4, 5.6, 8, 11 (shallow to deep focus), off.
light: contre-jour (sun behind them, rim), golden-hour, window, overhead, practicals (lamps only), soft-cross, silhouette, hard-noon, moonlight, as-built.
time: dawn, noon, golden, night, as-built.
stock: digital, film35 (35 mm grain), film16 (coarse grain), homevideo, none.
character: clean, anamorphic, vintage, halation, none.
palette: amber-hour (amber, teal), sodium-rain (orange night), blue-motel (blue, pink neon), rust-cream (warm earth), harbour-4am (cold blue-grey), silver-print (black and white), mint-diner (mint, cherry), peach-dusk (peach, lavender), tropic-static (hot greens, yellows), ash-winter (cold, desaturated), neon-undertow (magenta, cyan), golden-reel (honeyed gold), none.
era: 2000s, 1990s, 1980s, 1970s, 1960s, none.
genre: drama, action, thriller, noir, horror, comedy, romance (a genre brings its own light and grade).
MOVES: push-in, pull-out, hold, arc-left, arc-right, orbit-90, crane-up, crane-down, rise-reveal, truck-left, truck-right, tilt-up, low-hero, dolly-zoom. TEXTURES: handheld, slow-motion, whip-pan.`;

// ---------------------------------------------------------------------------
// The person's exact words.
// ---------------------------------------------------------------------------

const QUOTE_FOLD: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "‚": "'",
  "‛": "'",
  "‹": "'",
  "›": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "‟": '"',
  "«": '"',
  "»": '"',
};

/**
 * A text folded the way two pieces are compared — curly and angle quotes
 * straight, every run of spaces one space, lower case — with, for each
 * folded character, where it came from in the text, so a match is read
 * back as the text's own characters.
 */
function fold(text: string): { folded: string; from: number[]; to: number[] } {
  let folded = "";
  const from: number[] = [];
  const to: number[] = [];
  let at = 0;
  for (const ch of text) {
    const start = at;
    at += ch.length;
    if (/\s/u.test(ch)) {
      if (folded.endsWith(" ")) continue;
      folded += " ";
      from.push(start);
      to.push(at);
      continue;
    }
    for (const unit of (QUOTE_FOLD[ch] ?? ch).toLowerCase()) {
      folded += unit;
      from.push(start);
      to.push(at);
    }
  }
  return { folded, from, to };
}

/** Spaces and the joining marks a piece may end on: "Eva leans on the car," keeps "Eva leans on the car". */
const PIECE_EDGE = /^[\s,;:—–-]+|[\s,;:—–-]+$/g;
/** What a model may wrap a quoted piece in, or end it with, that the message need not have. */
const PIECE_WRAP = /^[\s"'‘’“”«»([{¿¡.,;:!?…—–-]+|[\s"'‘’“”«»)\]}.,;:!?…—–-]+$/g;

/** Where a piece is in its source, as the source's own text; null when it is not there. */
function findPiece(piece: unknown, source: string): { text: string; start: number; end: number } | null {
  if (typeof piece !== "string") return null;
  const src = source.normalize("NFC");
  const hay = fold(src);
  const asked = piece.normalize("NFC");
  // As written first; then without quotes or a full stop the model put
  // round it ("sit on the bonnet." for "…sit on the bonnet"). The text kept
  // is the source's either way, so no word the person did not write gets in.
  for (const candidate of [asked, asked.replace(PIECE_WRAP, "")]) {
    const needle = fold(candidate).folded.trim();
    if (!needle) continue;
    const i = hay.folded.indexOf(needle);
    if (i < 0) continue;
    const start = hay.from[i];
    const end = hay.to[i + needle.length - 1];
    const raw = src.slice(start, end);
    const text = raw.replace(PIECE_EDGE, "");
    if (!text) return null;
    const lead = raw.length - raw.replace(/^[\s,;:—–-]+/, "").length;
    return { text, start: start + lead, end: start + lead + text.length };
  }
  return null;
}

/**
 * The piece as the source has it, when it IS a piece of the source: both
 * compared with curly quotes straight, spaces run together and case
 * ignored; the source's own characters kept, trimmed of spaces and of a
 * trailing , ; : — or -. Null for a paraphrase, a translation, a summary.
 */
export function exactPiece(piece: unknown, source: string): string | null {
  return findPiece(piece, source)?.text ?? null;
}

/** A quoted piece held to `max` characters, cut at a word where one is near. */
function capWords(text: string, max: number): string {
  const points = Array.from(text);
  if (points.length <= max) return text;
  const head = points.slice(0, max).join("");
  const space = head.lastIndexOf(" ");
  return (space >= max / 2 ? head.slice(0, space) : head).replace(PIECE_EDGE, "");
}

const SENTENCE_END = /[.!?…"'”’»)]$/;

/** A piece as a sentence of "what happens": its first letter a capital, a full stop unless it already ends one. */
function asSentence(piece: string): string {
  const p = piece.trim();
  const first = p.search(/[\p{L}\p{N}]/u);
  const withCap = first >= 0 && /\p{Ll}/u.test(p[first]) ? p.slice(0, first) + p[first].toUpperCase() + p.slice(first + 1) : p;
  return SENTENCE_END.test(withCap) ? withCap : `${withCap}.`;
}

/**
 * What happens after a turn: NOW's own text when the reading said nothing
 * about it; empty when it cleared it; else the kept pieces in NOW's order,
 * then the added ones in the message's (parseShotReading orders them),
 * each a sentence, held to SET_DIRECTION_MAX_CHARS (300) — cut at a word,
 * and the words that did not fit handed back for the reply to say so
 * ("What happens keeps 300 characters; “…{tail}” didn't fit.").
 */
export function composeHappens(op: HappensOp | undefined, nowHappens: string): { text: string; cut: string | null } {
  if (!op) return { text: nowHappens, cut: null };
  const nowFolded = fold(nowHappens.normalize("NFC")).folded;
  const at = (piece: string) => {
    const i = nowFolded.indexOf(fold(piece.normalize("NFC")).folded.trim());
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const keep = op.keep.map((p, i) => ({ p, i, at: at(p) })).sort((a, b) => a.at - b.at || a.i - b.i).map((x) => x.p);
  const whole = cleanText([...keep, ...op.add].filter((p) => p.trim().length > 0).map(asSentence).join(" "), Number.MAX_SAFE_INTEGER);
  const points = Array.from(whole);
  if (points.length <= SET_DIRECTION_MAX_CHARS) return { text: whole, cut: null };
  const text = capWords(whole, SET_DIRECTION_MAX_CHARS);
  const tail = whole.slice(text.length).trim();
  return { text, cut: tail.length > 0 ? tail : null };
}

// ---------------------------------------------------------------------------
// Reading the model's answer.
// ---------------------------------------------------------------------------

export type ShotReadingContext = {
  /** The working copy the page draws: its cameras and marks are the only ids a reading may name. */
  spec: Pick<SetSpec, "cameras" | "marks">;
  aliases: ReaderAliases;
  /** The message as the reader was given it (cleaned, ≤600). */
  message: string;
  /** NOW's "What happens", as the server checked it: the only source of kept pieces. */
  nowHappens: string;
};

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
/** Not said: a key left out, or left empty the way a form leaves it. */
const unsaid = (v: unknown) => v === undefined || v === null || v === false || v === "" || (Array.isArray(v) && v.length === 0);
const onList = <T extends string | number>(v: unknown, list: readonly T[]): T | null => ((list as readonly unknown[]).includes(v) ? (v as T) : null);
const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const has = (map: Record<string, string>, k: string) => Object.prototype.hasOwnProperty.call(map, k);

/** The keys a model may write, snake_case as SHOT_READER_STATIC teaches them. */
const ACT_KEYS = [
  "who",
  "mark",
  "near",
  "nudge",
  "turn",
  "pose",
  "facing",
  "gaze",
  "camera_id",
  "side",
  "size",
  "height",
  "tilt_deg",
  "lens_mm",
  "frame_x",
  "steps",
  "look",
  "rig",
  "hour",
  "ev",
  "move",
  "textures",
  "engine",
] as const;
const READING_KEYS = [...ACT_KEYS, "shoot", "undo", "happens", "wardrobe", "set_change", "ask", "idea", "suggest", "cant"] as const;

/** One of the set's things, or two or three that fit equally; unknown aliases named. */
function thingPick(v: unknown, aliases: ReaderAliases, drop: (name: string) => void, name: string): ThingPick | null {
  const asked = Array.isArray(v) ? v : [v];
  const keys: string[] = [];
  for (const a of asked) {
    if (typeof a === "string" && has(aliases.things, a)) {
      const key = aliases.things[a];
      if (!keys.includes(key)) keys.push(key);
    } else {
      drop(name);
    }
  }
  if (keys.length === 0) return null;
  if (keys.length > READER_MAX.candidates) drop(name);
  return keys.length === 1 ? { key: keys[0] } : { candidates: keys.slice(0, READER_MAX.candidates) };
}

/**
 * The act keys of one object — the reading's own, or one suggestion's —
 * into `out`, each held to its list; `drop` hears the name of every key
 * whose value did not match.
 */
function readAct(r: Record<string, unknown>, ctx: ShotReadingContext, out: ShotAct, drop: (name: string) => void) {
  const { spec, aliases } = ctx;
  const one = <K extends keyof ShotAct>(key: string, field: K, value: ShotAct[K] | null) => {
    if (unsaid(r[key])) return;
    if (value === null) drop(key);
    else out[field] = value;
  };

  one("who", "characterId", typeof r.who === "string" && has(aliases.people, r.who) ? aliases.people[r.who] : null);
  one("mark", "markId", typeof r.mark === "string" && spec.marks.some((m) => m.id === r.mark) ? r.mark : null);

  if (!unsaid(r.near)) {
    const n = r.near;
    const side = isObject(n) ? onList(n.side, NEAR_SIDES) : null;
    const thing = isObject(n) && side ? thingPick(n.thing, aliases, drop, "near.thing") : null;
    if (side && thing) out.near = { thing, side };
    else drop("near");
  }

  if (!unsaid(r.nudge)) {
    const n = isObject(r.nudge) ? r.nudge : null;
    const right = n ? finite(n.right) : null;
    const toward = n ? finite(n.toward) : null;
    if (right === null && toward === null) drop("nudge");
    else {
      const m = (v: number | null) => Math.round(clamp(v ?? 0, -READER_MAX.nudge, READER_MAX.nudge) * 10) / 10 || 0;
      const nudge = { right: m(right), toward: m(toward) };
      // Nothing to move by: not a change, and nothing to say.
      if (nudge.right !== 0 || nudge.toward !== 0) out.nudge = nudge;
    }
  }

  one("turn", "turn", onList(r.turn, TURN_WORDS));
  one("pose", "pose", onList(r.pose, STAND_POSES));

  if (!unsaid(r.facing)) {
    const f = r.facing;
    const word = onList(f, FIGURE_FACINGS);
    const thing = !word && isObject(f) ? thingPick(f.thing, aliases, drop, "facing.thing") : null;
    if (word) out.facing = word;
    else if (thing) out.facing = thing;
    else drop("facing");
  }

  if (!unsaid(r.gaze)) {
    const g = r.gaze;
    if (g === "camera" || g === "none") out.gaze = g;
    else if (isObject(g) && !unsaid(g.side) && onList(g.side, GAZE_SIDES)) out.gaze = { side: g.side as GazeSide };
    else {
      const thing = isObject(g) && !unsaid(g.thing) ? thingPick(g.thing, aliases, drop, "gaze.thing") : null;
      if (thing) out.gaze = thing;
      else drop("gaze");
    }
  }

  one("camera_id", "cameraId", typeof r.camera_id === "string" && spec.cameras.some((c) => c.id === r.camera_id) ? r.camera_id : null);
  one("side", "side", onList(r.side, CAMERA_SIDES));
  one("size", "size", onList(r.size, SHOT_SIZES));
  one("height", "height", onList(r.height, CAMERA_HEIGHTS));
  const tilt = finite(r.tilt_deg);
  one("tilt_deg", "tiltDeg", tilt === null ? null : Math.round(clamp(tilt, -SET_MAX_TILT_DOWN_DEG, SET_MAX_TILT_UP_DEG)) || 0);
  one("lens_mm", "lensMm", onList(r.lens_mm, LENSES_MM));
  one("frame_x", "frameX", onList(r.frame_x, FRAME_XS));

  if (!unsaid(r.steps)) {
    const steps: ReaderStep[] = [];
    for (const s of Array.isArray(r.steps) ? r.steps : [r.steps]) {
      const step = onList(s, READER_STEPS);
      if (step && steps.length < READER_MAX.steps) steps.push(step);
      else drop("steps");
    }
    if (steps.length > 0) out.steps = steps;
  }

  if (!unsaid(r.look)) {
    const l = r.look;
    const n = finite(l);
    if (l === "newest" || l === "off") out.look = l;
    else if (n !== null && Number.isInteger(n) && n >= 1 && n <= READER_MAX.stillNumber) out.look = n;
    else drop("look");
  }

  if (!unsaid(r.rig)) {
    // One value per group, the last said winning ("golden hour… no, night"),
    // in the order the groups were first named.
    const byGroup = new Map<string, string>();
    for (const id of Array.isArray(r.rig) ? r.rig : [r.rig]) {
      if (typeof id === "string" && READER_RIG_IDS.includes(id)) byGroup.set(id.slice(0, id.indexOf(":")), id);
      else drop("rig");
    }
    const rig = [...byGroup.values()];
    if (rig.length > READER_MAX.rig) drop("rig");
    if (rig.length > 0) out.rig = rig.slice(0, READER_MAX.rig);
  }

  const hour = finite(r.hour);
  one("hour", "hour", hour === null ? null : Math.round(clamp(hour, READER_MAX.hourMin, READER_MAX.hourMax) / READER_MAX.hourStep) * READER_MAX.hourStep);
  if (!unsaid(r.ev)) {
    const ev = finite(r.ev);
    if (ev === null) drop("ev");
    else {
      const thirds = Math.round(clamp(ev, -READER_MAX.evThirds, READER_MAX.evThirds)) || 0;
      if (thirds !== 0) out.evThirds = thirds;
    }
  }

  one("move", "move", onList(r.move, FILM_MOVES));
  if (!unsaid(r.textures)) {
    const textures: FilmTexture[] = [];
    for (const t of Array.isArray(r.textures) ? r.textures : [r.textures]) {
      const texture = onList(t, FILM_TEXTURES);
      if (!texture) drop("textures");
      else if (!textures.includes(texture) && textures.length < READER_MAX.textures) textures.push(texture);
    }
    if (textures.length > 0) out.textures = textures;
  }
  one("engine", "engine", onList(r.engine, READER_ENGINES));
}

/** Pieces of a source, in the source's order, each once; the names of any that were not pieces of it. */
function readPieces(v: unknown, source: string, max: number, name: string, drop: (name: string) => void): { pieces: { text: string; start: number; end: number }[]; given: number } {
  if (unsaid(v)) return { pieces: [], given: 0 };
  const asked = Array.isArray(v) ? v : [v];
  const found: { text: string; start: number; end: number }[] = [];
  let given = 0;
  for (const p of asked) {
    if (typeof p === "string" && p.trim().length === 0) continue;
    given += 1;
    const hit = findPiece(p, source);
    if (!hit) {
      drop(name);
      continue;
    }
    if (Array.from(hit.text).length < READER_MAX.pieceMinChars) continue;
    found.push(hit);
  }
  found.sort((a, b) => a.start - b.start);
  // A piece inside one already kept says nothing more ("leans on the car" in "She leans on the car").
  const pieces: typeof found = [];
  for (const f of found) if (!pieces.some((p) => f.start >= p.start && f.end <= p.end)) pieces.push(f);
  if (pieces.length > max) drop(name);
  return { pieces: pieces.slice(0, max), given };
}

/**
 * The model's answer held to the contract, or null when it is not a JSON
 * object at all (the action then says the reader is down, and nothing
 * changes). `dropped` names every part that did not match — key names
 * only, never a word of the answer — so the page can say "part of that
 * didn't match" and hold an automatic shot.
 */
export function parseShotReading(text: string, ctx: ShotReadingContext): { reading: ShotReading; dropped: string[] } | null {
  if (typeof text !== "string") return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!isObject(parsed)) return null;
  const r = parsed;
  const dropped: string[] = [];
  const drop = (name: string) => {
    if (!dropped.includes(name)) dropped.push(name);
  };
  const reading: ShotReading = {};

  // A key the contract does not have is a part that did not match. Named
  // "unknown", never by the model's own word.
  for (const k of Object.keys(r)) if (!(READING_KEYS as readonly string[]).includes(k) && !unsaid(r[k])) drop("unknown");

  const flag = (key: "shoot" | "undo" | "wardrobe") => {
    if (unsaid(r[key])) return;
    if (r[key] === true) reading[key] = true;
    else drop(key);
  };
  flag("shoot");
  flag("undo");

  readAct(r, ctx, reading, drop);

  if (!unsaid(r.happens)) {
    const h = r.happens;
    if (!isObject(h)) drop("happens");
    else {
      const keep = readPieces(h.keep, ctx.nowHappens, READER_MAX.keep, "happens.keep", drop);
      const add = readPieces(h.add, ctx.message, READER_MAX.add, "happens.add", drop);
      // An added piece NOW already holds is not said twice.
      const kept = keep.pieces.map((p) => fold(p.text).folded);
      const added = add.pieces.filter((p) => !kept.some((k) => k.includes(fold(p.text).folded)));
      if (keep.given + add.given === 0) {
        // {} and nothing in it: the words say to clear what happens.
        reading.happens = { keep: [], add: [] };
      } else if (keep.pieces.length + added.length === 0) {
        // Pieces were given and none held: nothing changes, and the reply says part of it didn't match.
        drop("happens");
      } else {
        reading.happens = { keep: keep.pieces.map((p) => p.text), add: added.map((p) => p.text) };
      }
    }
  }
  flag("wardrobe");

  if (!unsaid(r.set_change)) {
    const s = r.set_change;
    const said = isObject(s) ? exactPiece(s.said, ctx.message) : null;
    if (!said) {
      // Astra is never sent words the person did not write: the whole change goes.
      drop("set_change");
    } else {
      const { quoted, cut } = astraCardWords(said);
      const gloss = isObject(s) ? cleanText(s.gloss, READER_MAX.gloss) : "";
      reading.setChange = { said: quoted, gloss: gloss.length > 0 ? gloss : null, cut };
    }
  }

  if (!unsaid(r.ask)) {
    const ask: AskTopic[] = [];
    for (const a of Array.isArray(r.ask) ? r.ask : [r.ask]) {
      const topic = onList(a, ASK_TOPICS);
      if (!topic) drop("ask");
      else if (!ask.includes(topic)) ask.push(topic);
    }
    if (ask.length > READER_MAX.ask) drop("ask");
    if (ask.length > 0) reading.ask = ask.slice(0, READER_MAX.ask);
  }

  if (!unsaid(r.idea)) {
    const idea = cleanText(r.idea, READER_MAX.idea);
    if (typeof r.idea !== "string") drop("idea");
    else if (SHOT_READER_IDEAS && idea.length > 0) reading.idea = idea;
  }

  if (!unsaid(r.suggest)) {
    const suggest: ShotAct[] = [];
    for (const s of Array.isArray(r.suggest) ? r.suggest : [r.suggest]) {
      if (!isObject(s)) {
        drop("suggest");
        continue;
      }
      // Only the act keys are read: words, wardrobe, a set change and the
      // rest can't ride a suggestion, whatever the model put in one. What
      // did not match inside one is not named — nothing of a suggestion
      // runs until Do it.
      const act: ShotAct = {};
      readAct(s, ctx, act, () => {});
      if (Object.keys(act).length > 0 && suggest.length < READER_MAX.suggest) suggest.push(act);
    }
    if (suggest.length > 0) reading.suggest = suggest;
  }

  if (!unsaid(r.cant)) {
    const cant: { code: CantCode; said: string | null }[] = [];
    for (const c of Array.isArray(r.cant) ? r.cant : [r.cant]) {
      const item = isObject(c) ? c : typeof c === "string" ? { code: c } : null;
      if (!item) {
        drop("cant");
        continue;
      }
      // A code off the list is still something it could not place: "other", never left out.
      const code = onList(item.code, CANT_CODES) ?? "other";
      const piece = exactPiece(item.said, ctx.message);
      const said = piece && Array.from(piece).length >= READER_MAX.pieceMinChars ? capWords(piece, READER_MAX.cantSaid) : null;
      if (cant.some((x) => x.code === code && x.said === said)) continue;
      if (cant.length >= READER_MAX.cant) {
        drop("cant");
        continue;
      }
      cant.push({ code, said });
    }
    if (cant.length > 0) reading.cant = cant;
  }

  return { reading, dropped };
}

// ---------------------------------------------------------------------------
// What kind of reading it is.
// ---------------------------------------------------------------------------

const acts = (r: ShotReading) => SHOT_ACT_KEYS.some((k) => r[k] !== undefined);
const changes = (r: ShotReading) => acts(r) || r.happens !== undefined || r.wardrobe !== undefined || r.setChange !== undefined;

/** Only questions, an idea or options to try — nothing to do, and never a shot (spec §3.3). A "not yet" may ride along. */
export function isQuestionOnly(r: ShotReading): boolean {
  return (r.ask !== undefined || r.idea !== undefined || r.suggest !== undefined) && !changes(r) && !r.shoot && !r.undo;
}

/** Only "undo that": the last turn steps back, nothing is read again, nothing shoots. */
export function isUndoOnly(r: ShotReading): boolean {
  return r.undo === true && Object.keys(r).length === 1;
}
