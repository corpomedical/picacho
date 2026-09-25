// The honest reply (Helios Cut 2, "Astra understands", step 8, 2026-09-25 —
// operator: "Run, keep going.").
//
// WHAT. One turn of the set's chat — a plan (turn-plan.ts planTurn), what
// the page's executors actually changed, and the page's own facts — becomes
// the reply the person reads (spec §5): the answers to what they asked,
// what was DONE (or what would be, in Just talking, or what was UNDONE),
// what was already so, the notes, what is NOT YET possible and where to do
// it now, what NEEDS THEIR OK before anything is spent (an Astra change, a
// "which one?", a take the chat set up, a held shot), the ways to try it,
// and anything cut or left out. When none of those apply it says so: a turn
// is never silent.
//
// EVERY SENTENCE IS PICACHO'S (spec §5.2). The model's words appear only as
// its labelled idea, in quotes; the person's own words only where they
// wrote them (a "not yet", the Astra card, "what happens"). Chips are
// "group · value" pills, and a rig chip is exactly ⌘K's label
// (commands.ts rigCommandLabel). "Done" lists only what an executor
// changed — the side the camera REACHED, not the side asked — and the page
// hands those in; a plan with no page behind it (Just talking's preview, a
// suggestion, the phrase-check's dry run) is said as planned
// (plannedOutcomes).
//
// MONEY IN WORDS (spec §3.8 rule 7). Every button that spends carries its
// price — credits, or the Astra card's count of changes — computed from
// that button's own plan (turn-plan.ts secondButton, pressFor).
//
// MEANING, NOT WORDS (his standard). Nothing here reads the message: no
// regular expression anywhere in this file (a source pin holds it), and the
// placeholders are filled in one pass (fill), so no one's words are ever
// read as a placeholder.
//
// Pure, relative imports only: the page, the tests and the phrase-check's
// dry run share it.

import { formatMsg } from "../i18n/format";
import type { Messages } from "../i18n/messages/en";
import { astraCardKind, astraCardLine, astraCardWords, type AstraCardKind } from "./astra-card";
import { fill } from "./fill";
import { nearestLens } from "./build-scene";
import { rigCommandLabel, rigPatchFor, type RigCommandWords } from "./commands";
import { setElements, type SetElement } from "./elements";
import { schemeHasSun } from "./light-schemes";
import type { FilmMove, FilmTexture } from "./moves";
import { cameraSideOf, readerThings, type ColourId, type ThingWhere } from "./reader-context";
import { depthOfField, sensorCocMm, stepEv, type RigSensor, type SetRig } from "./rig";
import { SET_DIRECTION_MAX_CHARS, SET_EDIT_MAX_CHARS } from "./set-config";
import type { SetSpec, StandPose } from "./set-spec";
import type { AskTopic, CantCode, FrameX, GazeSide, NearSide, ReaderAliases, ReaderStep, ShotAct, TurnWord } from "./shot-reading";
import { composeHappens } from "./shot-reading";
import { HEIGHT_M, SHOT_WORDS_MAX_CHARS, type CameraHeight, type CameraSide, type FigureFacing, type ShotSize } from "./shot-words";
import { SET_TAKE_ENGINES, type SetTakeEngine } from "./take";
import { timeLabel } from "./time-of-day";
import {
  cameraStep,
  frameXAfter,
  lookPatch,
  secondButton,
  spotToMatch,
  type CameraSpot,
  type Note,
  type ShootDecision,
  type Step,
  type StepClamp,
  type TurnMode,
  type TurnPlan,
} from "./turn-plan";

// ---------------------------------------------------------------------------
// The words: every sentence from the person's own catalog.
// ---------------------------------------------------------------------------

type Reply = Messages["sets"]["reply"];

/** The catalog pieces a reply is made of: its own block (t.sets.reply) and the labels the page already shows. */
export type ReplyWords = {
  reply: Reply;
  /** ⌘K's words, so a rig chip reads exactly as ⌘K lists it. */
  rig: RigCommandWords;
  pose: string;
  poses: Record<StandPose, string>;
  eyeline: string;
  gazeCamera: string;
  gazeThing: string;
  exposure: string;
  timeAsBuilt: string;
  moves: Record<FilmMove, string>;
  textures: Record<FilmTexture, string>;
  engines: Record<SetTakeEngine, string>;
  /** "Still {n}". */
  still: string;
  film: string;
  build: string;
  notCastable: string;
  driveLay: string;
  frameLineMoved: string;
  settings: string;
  billing: string;
  /** "your character", when no one is on the chip. */
  yourCharacter: string;
  /** The mode that shoots on its own, by its own name ("Shoot without asking"). */
  autoMode: string;
  things: { car: string; carN: string; vehicle: string; vehicleN: string; object: string; objectN: string };
};

/** A reply's words from one catalog: the page and the tests build them the same way. */
export function replyWordsOf(t: Messages): ReplyWords {
  const s = t.sets;
  return {
    reply: s.reply,
    rig: {
      formats: s.rig.formats,
      frame: s.rig.frame,
      squeeze: s.rig.squeeze,
      focus: s.rig.focus,
      stop: s.rig.stop,
      off: s.rig.off,
      light: s.rig.light,
      lights: s.rig.lights,
      asBuilt: s.rig.asBuilt,
      time: s.rig.time,
      timePresets: s.palette.timePresets,
      stock: s.rig.stock,
      stocks: s.rig.stocks,
      lensCharacter: s.rig.lens,
      lenses: s.rig.lenses,
      palette: s.rig.palette,
      palettes: s.rig.palettes,
      era: s.rig.era,
      eras: s.rig.eras,
      genre: s.rig.genre,
      genres: s.rig.genres,
    },
    pose: s.pose,
    poses: s.poses,
    eyeline: s.studio.eyeline,
    gazeCamera: s.studio.gazeCamera,
    gazeThing: s.studio.gazeThing,
    exposure: s.rig.exposure,
    timeAsBuilt: s.rig.timeAsBuilt,
    moves: s.rig.moves,
    textures: s.rig.textures,
    engines: { omni: s.sequencer.engineOmni, veo: s.sequencer.engineVeo },
    still: s.stillTile,
    film: s.filmTab,
    build: s.editorOpen,
    notCastable: s.cast.notCastable,
    driveLay: s.cast.driveLay,
    frameLineMoved: s.frameLineMoved,
    settings: t.nav.settings,
    billing: t.settingsHub.tabBilling,
    yourCharacter: s.exampleCharacter,
    autoMode: s.shootWithoutAsking,
    things: { car: s.cast.car, carN: s.cast.carN, vehicle: s.cast.vehicle, vehicleN: s.cast.vehicleN, object: s.cast.object, objectN: s.cast.objectN },
  };
}

/** The one-pass fill, shared with the Astra card (fill.ts): re-exported, so the page and the tests keep their import. */
export { fill } from "./fill";

/** Metres with at most one decimal, in the person's own number format (en 2.6, es/pt/it 2,6). */
export function formatMetres(n: number, locale: string): string {
  const rounded = Math.round(n * 10) / 10;
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(rounded === 0 ? 0 : rounded);
  } catch {
    return String(rounded === 0 ? 0 : rounded);
  }
}

/** An exposure in thirds of a stop, as the rig's EV reads: +1, +⅓, −1⅔, 0. */
export function formatEv(thirds: number): string {
  const t = Math.round(thirds);
  if (t === 0) return "0";
  const a = Math.abs(t);
  const whole = Math.floor(a / 3);
  const frac = a % 3 === 1 ? "⅓" : a % 3 === 2 ? "⅔" : "";
  return `${t > 0 ? "+" : "−"}${whole > 0 ? whole : ""}${frac}`;
}

/**
 * A "{items}." line whose last chip already closes a sentence — "What
 * happens: “She leans on the car.”" — without a second full stop after it.
 * Reads only Picacho's own template and the chips it just wrote.
 */
function fillItems(template: string, items: string): string {
  const out = fill(template, { items });
  return closesSentence(items) && template.endsWith("{items}.") ? out.slice(0, -1) : out;
}
const closesSentence = (items: string) => [".", "!", "?", "”", "»", '"', "…"].includes(items.slice(-1));

/**
 * The same line as parts (ReplyItems): the template's words either side of
 * "{items}", with fillItems's rule for the full stop, so the pills and the
 * sentence can never say it differently.
 */
function itemsOf(template: string, chips: string[]): ReplyItems {
  const at = template.indexOf("{items}");
  if (at < 0) return { lead: template, chips, tail: "" };
  const tail = template.slice(at + "{items}".length);
  const last = chips[chips.length - 1] ?? "";
  return { lead: template.slice(0, at), chips, tail: tail === "." && closesSentence(last) ? "" : tail };
}

/** A price as every priced button says it: "1 credit", "4 credits". */
export function creditsLabel(reply: Pick<Reply, "creditOne" | "creditsN">, n: number): string {
  return n === 1 ? reply.creditOne : formatMsg(reply.creditsN, { n });
}

// ---------------------------------------------------------------------------
// The page's facts.
// ---------------------------------------------------------------------------

/** One of the set's things as the reply names it: the page's own name (set-view's elementName rule), what it is, its colour and where it lies from the figure. */
export type ReplyThing = { key: string; name: string; kind: SetElement["kind"]; colour: ColourId; where: ThingWhere };

/**
 * A thing's name as the page says it (set-view.tsx elementName): "Car" when
 * the set has one, "Car 2" when it has several, the same for vehicles and
 * objects, in the person's language.
 */
export function thingName(key: string, els: readonly Pick<SetElement, "key" | "kind" | "ordinal">[], words: Pick<ReplyWords, "things">): string {
  const e = els.find((x) => x.key === key);
  if (!e) return words.things.object;
  const many = els.filter((x) => x.kind === e.kind).length > 1;
  const w = words.things;
  if (e.kind === "car") return many ? formatMsg(w.carN, { n: e.ordinal }) : w.car;
  if (e.kind === "vehicle") return many ? formatMsg(w.vehicleN, { n: e.ordinal }) : w.vehicle;
  return many ? formatMsg(w.objectN, { n: e.ordinal }) : w.object;
}

/** The things a reply can name: the reader's own twelve nearest (reader-context.ts readerThings), with the page's names. */
export function replyThingsOf(spec: SetSpec, mark: { x: number; z: number; facingDeg: number }, words: Pick<ReplyWords, "things">): ReplyThing[] {
  const els = setElements(spec);
  return readerThings(spec, mark).map((t) => ({ key: t.key, name: thingName(t.key, els, words), kind: t.kind, colour: t.colour, where: t.where }));
}

/**
 * What the reply reads of the page, as it stands after the turn (for a
 * preview, as it stands now): names, the frame, the rig, the prices, the
 * month's changes, and the shot this turn decided.
 */
export type ReplyFacts = {
  /** The interface's language, for numbers (formatMetres). */
  locale: string;
  mode: TurnMode;
  characters: readonly { id: string; name: string }[];
  characterId: string | null;
  marks: readonly { id: string; label: string }[];
  cameras: readonly { id: string; label: string }[];
  things: readonly ReplyThing[];
  markId: string | null;
  pose: StandPose;
  /** Which way she faces, by the camera (shot-words.ts facingFor's words). */
  facing: FigureFacing;
  cameraId: string | null;
  frameX: FrameX;
  rig: SetRig;
  direction: string;
  /** The render's lens on this body, mm, and the camera's distance to her, metres (the focus answer). */
  lensMm: number;
  distanceM: number;
  /** Where the camera stands round her, so a preview can say where word steps land; null says only the steps. */
  spot?: { spot: CameraSpot; facingDeg: number; sensorHeightMm: number } | null;
  credits: { still: number; take: Record<SetTakeEngine, number> };
  takeEngine: SetTakeEngine;
  /**
   * Who set up the take waiting now, if one is: the PERSON's renders on
   * its own in "Shoot without asking" (pressFor), so the help answer prices
   * that (review of Cut 2, W6).
   */
  takeArmedBy?: "chat" | "person" | null;
  /** The still a take would start from now, by its number; null when none fits. */
  takeFrom: number | null;
  /** The newest still's number (a look of "newest"). */
  newestStill: number | null;
  lastStill: { n: number; status: "succeeded" | "failed" | "generating"; score: number | null } | null;
  editsLeft: number | null;
  editsCap: number;
  tooBig: boolean;
  /** The Producer's lamp is on this page (producerVisible): "elsewhere" offers it. */
  producerOn: boolean;
  /** This turn's shot (turn-plan.ts shootDecision), or null when none was decided. */
  shot: ShootDecision | null;
};

// ---------------------------------------------------------------------------
// What a turn did: the executors' outcomes, in the order they ran.
// ---------------------------------------------------------------------------

/** One thing a turn changed, with the value it REACHED (the page reads the stage after each executor). */
export type Outcome =
  | { kind: "who"; characterId: string; was: string | null }
  | { kind: "mark"; markId: string }
  | { kind: "ownSpot" }
  | { kind: "near"; key: string; side: NearSide }
  | { kind: "nudge"; right: number; toward: number }
  | { kind: "pose"; pose: StandPose }
  | { kind: "camera"; cameraId: string }
  | { kind: "size"; size: ShotSize }
  /** A height word with its metres, or (height null) the camera's height after a step. */
  | { kind: "height"; height: CameraHeight | null; m: number; clamp?: StepClamp | null }
  | { kind: "side"; side: CameraSide }
  | { kind: "distance"; m: number; clamp?: StepClamp | null }
  | { kind: "tilt"; deg: number; clamp?: StepClamp | null }
  | { kind: "lens"; mm: number; clamp?: StepClamp | null }
  | { kind: "frameX"; frameX: FrameX }
  | { kind: "step"; step: ReaderStep }
  | { kind: "facing"; facing: FigureFacing | { key: string } }
  | { kind: "turn"; turn: TurnWord }
  | { kind: "gaze"; gaze: "camera" | "none" | { key: string } | { side: GazeSide } }
  /** A ⌘K rig command (commands.ts): its chip is ⌘K's label. */
  | { kind: "rig"; id: string }
  | { kind: "hour"; hour: number }
  /** The exposure after the turn, stops. */
  | { kind: "ev"; ev: number }
  | { kind: "look"; look: "off" | number }
  /** What happens now; "" when it was cleared. */
  | { kind: "happens"; text: string }
  | { kind: "takeFrom"; still: number }
  | { kind: "move"; move: FilmMove }
  | { kind: "texture"; texture: FilmTexture }
  | { kind: "engine"; engine: SetTakeEngine }
  /** A set change a preview would ask Astra for: the person's own words. */
  | { kind: "astra"; said: string };

export type OutcomeKind = Outcome["kind"];

/** What the page found as it ran the turn, beside the plan's own notes. */
export type PageNote =
  /** She was stepped clear of something built, toward the camera (marks.ts clearMarks). */
  | { kind: "stepped"; key: string }
  | { kind: "cameraFollowed" }
  /** The stage moved the camera round something built (match-shot.ts "around" / "blocked"). */
  | { kind: "frameLineMoved" }
  /** The shot the turn decided could not start (shoot() or take() answered false). */
  | { kind: "notStarted" }
  | { kind: "undoHand" }
  | { kind: "undoAstra" }
  | { kind: "undoAstraText" }
  /** The turn's Astra change could not be undone: it is still there, and Undo can be tried again (review of Cut 2, W7). */
  | { kind: "undoAstraFailed" }
  | { kind: "stillsStay" }
  | { kind: "undoNone" };

export type TurnOutcomes = { chips: Outcome[]; notes: PageNote[] };

/**
 * The frame card's rows (set-view.tsx), for its "changed this turn" dot
 * (spec §5.1): the card stays below the reply, and the dot says which of
 * its rows the last message moved.
 */
export type FrameRow = "who" | "where" | "camera" | "rig" | "light" | "time" | "palette" | "happens";

/** Which frame-card row a rig command's change shows on, by its ⌘K group (commands.ts ids are "group:value"). */
const RIG_ROWS: Record<string, readonly FrameRow[]> = {
  format: ["camera"],
  squeeze: ["camera"],
  stop: ["rig"],
  stock: ["rig"],
  character: ["rig"],
  light: ["light"],
  time: ["time"],
  palette: ["palette"],
  // A genre sets its light and its grade together (commands.ts genreLookPatch).
  genre: ["light", "palette"],
};

/**
 * The rows a turn changed, from what its steps REACHED (never what it
 * planned): nothing for a preview, a reading that failed or a turn that
 * found nothing to do. Rows the card doesn't show (an era, the exposure,
 * the take's move) get no dot.
 */
export function frameRowsChanged(plan: Pick<TurnPlan, "kind">, outcomes: TurnOutcomes | null): FrameRow[] {
  if (!outcomes || (plan.kind !== "run" && plan.kind !== "undo")) return [];
  const rows = new Set<FrameRow>();
  for (const o of outcomes.chips) {
    switch (o.kind) {
      case "who":
        rows.add("who");
        break;
      case "mark":
      case "ownSpot":
      case "near":
      case "nudge":
      case "pose":
      case "facing":
      case "turn":
      case "gaze":
        rows.add("where");
        break;
      case "camera":
      case "size":
      case "height":
      case "side":
      case "distance":
      case "tilt":
      case "lens":
      case "frameX":
      case "step":
        rows.add("camera");
        break;
      case "rig":
        for (const row of RIG_ROWS[o.id.slice(0, o.id.indexOf(":"))] ?? []) rows.add(row);
        break;
      case "hour":
        rows.add("time");
        break;
      case "happens":
        rows.add("happens");
        break;
      default:
        break;
    }
  }
  return [...rows];
}

// ---------------------------------------------------------------------------
// The reply, as data the page draws.
// ---------------------------------------------------------------------------

/** What a reply's button does. Every paid one carries its price (money rule 7). */
export type ReplyAction =
  | { kind: "undo" }
  /** Runs a stored reading as a button turn: "plan" is this turn's preview, "rest" an undo's rest, a number a suggestion. Never shoots. */
  | { kind: "doIt"; row: number | "plan" | "rest" }
  | { kind: "doItShoot"; row: number | "plan"; credits: number }
  | { kind: "doItTake"; row: number | "plan"; credits: number }
  | { kind: "which"; slot: "near" | "facing" | "gaze"; key: string }
  | { kind: "useHour" }
  /** [Take · n]: the take waiting for its priced press. */
  | { kind: "take"; credits: number }
  /** [Shoot as it is · n] — or, when the person set a take up, [Take · n]: what the held shot would do. */
  | { kind: "shootAsIs"; press: "still" | "take"; credits: number }
  | { kind: "astraGo" }
  | { kind: "astraGoShoot"; credits: number }
  | { kind: "notNow" }
  | { kind: "useMyWords" }
  | { kind: "tryAgain" }
  | { kind: "openFilm" }
  | { kind: "openCard"; key: string }
  | { kind: "buildNew" }
  /** Opens the @ menu. */
  | { kind: "at" }
  | { kind: "askProducer" };
export type ReplyButton = ReplyAction & { label: string };

export type ReplyLineKind =
  | "answer"
  | "idea"
  | "done"
  | "planned"
  | "undone"
  | "shooting"
  | "already"
  | "note"
  | "notYet"
  | "notYetMore"
  | "needs"
  | "astra"
  | "which"
  | "ways"
  | "way"
  | "cut"
  | "dropped"
  | "nothing"
  | "down"
  | "busy";
/**
 * A line that lists chips (Done, Here's what I'd do, Undone, Already so, a
 * way to try it) as its parts, so the page can draw them as pills (spec
 * §5.2): the words before the chips, the chips themselves, and the words
 * after them, all Picacho's own template around ⌘K's own labels. `text`
 * is always the whole sentence, for the tests, the phrase check and a
 * screen reader.
 */
export type ReplyItems = { lead: string; chips: string[]; tail: string };
export type ReplyLine = { kind: ReplyLineKind; text: string; buttons: ReplyButton[]; items?: ReplyItems };
/** The Astra card's own data, for astra-change-card.tsx. */
export type ReplyAstraCard = { said: string; cut: boolean; card: AstraCardKind; canGo: boolean; shootCredits: number | null };
export type ReplyModel = { lines: ReplyLine[]; astra: ReplyAstraCard | null };

/** The reply as one text, buttons in brackets: what the tests and the phrase check read. */
export function replyText(model: ReplyModel): string {
  return model.lines
    .map((l) => [l.text, ...l.buttons.map((b) => `[${b.label}]`)].filter((x) => x.length > 0).join(" "))
    .join("\n");
}

// ---------------------------------------------------------------------------
// Chips.
// ---------------------------------------------------------------------------

const nameOf = (facts: Pick<ReplyFacts, "characters">, id: string | null): string | null => (id ? (facts.characters.find((c) => c.id === id)?.name ?? null) : null);
const personOf = (facts: Pick<ReplyFacts, "characters" | "characterId">, words: Pick<ReplyWords, "yourCharacter">): string => nameOf(facts, facts.characterId) ?? words.yourCharacter;
const thingOf = (facts: Pick<ReplyFacts, "things">, key: string, words: Pick<ReplyWords, "things">): string => facts.things.find((t) => t.key === key)?.name ?? words.things.object;
const markLabel = (facts: Pick<ReplyFacts, "marks">, id: string | null): string | null => (id ? (facts.marks.find((m) => m.id === id)?.label ?? null) : null);
const stillLabel = (words: Pick<ReplyWords, "still">, n: number) => formatMsg(words.still, { n });
/** A sentence's first letter up, for a name that opens one ("your character can't…"). */
const capital = (s: string) => (s.length > 0 ? s[0].toLocaleUpperCase() + s.slice(1) : s);

/** "Time of day · 18:15": an hour that is none of ⌘K's presets. */
function hourChip(hour: number, words: ReplyWords): string {
  return `${words.rig.time} · ${timeLabel(hour)}`;
}

function withClamp(text: string, clamp: StepClamp | null | undefined, words: ReplyWords): string {
  return clamp ? `${text} ${words.reply.chips.clamps[clamp]}` : text;
}

/** One chip: a "group · value" pill in the person's language, never a raw id. */
export function chipFor(o: Outcome, facts: ReplyFacts, words: ReplyWords): string {
  const c = words.reply.chips;
  const m = (n: number) => formatMetres(n, facts.locale);
  switch (o.kind) {
    case "who": {
      const name = nameOf(facts, o.characterId) ?? words.yourCharacter;
      const was = nameOf(facts, o.was);
      return was ? fill(c.whoWas, { name, was }) : name;
    }
    case "mark":
      return fill(c.mark, { mark: markLabel(facts, o.markId) ?? c.ownSpot });
    case "ownSpot":
      return c.ownSpot;
    case "near":
      return fill(c.near, { thing: thingOf(facts, o.key, words), side: c.nearSides[o.side] });
    case "nudge": {
      const parts: string[] = [];
      if (Math.abs(o.right) >= 0.05) parts.push(fill(o.right > 0 ? c.nudgeRight : c.nudgeLeft, { m: m(Math.abs(o.right)) }));
      if (Math.abs(o.toward) >= 0.05) parts.push(fill(o.toward > 0 ? c.nudgeToward : c.nudgeAway, { m: m(Math.abs(o.toward)) }));
      return fill(c.nudge, { parts: parts.join(", ") });
    }
    case "pose":
      return `${words.pose} · ${words.poses[o.pose]}`;
    case "camera":
      return fill(c.camera, { label: facts.cameras.find((x) => x.id === o.cameraId)?.label ?? "" });
    case "size":
      return c.sizes[o.size];
    case "height":
      return withClamp(o.height ? fill(c.heights[o.height], { m: m(o.m) }) : fill(c.cameraAt, { m: m(o.m) }), o.clamp, words);
    case "side":
      return c.sides[o.side];
    case "distance":
      return withClamp(fill(c.distance, { m: m(o.m) }), o.clamp, words);
    case "tilt": {
      const d = Math.round(Math.abs(o.deg));
      return withClamp(d < 1 ? c.tilts.level : fill(o.deg > 0 ? c.tilts.up : c.tilts.down, { d }), o.clamp, words);
    }
    case "lens":
      return withClamp(fill(c.lens, { mm: Math.round(o.mm) }), o.clamp, words);
    case "frameX":
      return c.frameX[o.frameX];
    case "step":
      return c.steps[o.step];
    case "facing":
      return fill(c.facing, { value: typeof o.facing === "string" ? c.facings[o.facing] : fill(c.facings.thing, { thing: thingOf(facts, o.facing.key, words) }) });
    case "turn":
      return fill(c.turn, { way: c.turnWays[o.turn] });
    case "gaze": {
      const g = o.gaze;
      const value =
        g === "camera"
          ? words.gazeCamera
          : g === "none"
            ? c.gazeNoneValue
            : "side" in g
              ? c.gazeSides[g.side]
              : fill(words.gazeThing, { thing: thingOf(facts, g.key, words) });
      return `${words.eyeline} · ${value}`;
    }
    case "rig":
      return rigCommandLabel(o.id, words.rig) ?? "";
    case "hour":
      return hourChip(o.hour, words);
    case "ev":
      return `${words.exposure} · ${formatEv(o.ev * 3)}`;
    case "look":
      return o.look === "off" ? c.lookOff : fill(c.lookFrom, { still: stillLabel(words, o.look) });
    case "happens":
      return o.text ? fill(c.happens, { text: o.text }) : c.happensCleared;
    case "takeFrom":
      return fill(c.takeFrom, { take: words.reply.takeLabel, still: stillLabel(words, o.still) });
    case "move":
      return fill(c.move, { move: words.moves[o.move] });
    case "texture":
      return words.textures[o.texture];
    case "engine":
      return fill(c.engine, { engine: words.engines[o.engine], s: SET_TAKE_ENGINES[o.engine].seconds });
    case "astra":
      return fill(c.astra, { words: astraCardWords(o.said).quoted });
  }
}

/** A chip for something that was already so: the key (or ⌘K id) the plan named, read from the page as it is. */
export function alreadyChip(key: string, facts: ReplyFacts, words: ReplyWords): string | null {
  if (key.includes(":")) return rigCommandLabel(key, words.rig);
  switch (key) {
    case "who":
      return nameOf(facts, facts.characterId);
    case "mark":
      return facts.markId ? chipFor({ kind: "mark", markId: facts.markId }, facts, words) : null;
    case "pose":
      return chipFor({ kind: "pose", pose: facts.pose }, facts, words);
    case "cameraId":
      return facts.cameraId ? chipFor({ kind: "camera", cameraId: facts.cameraId }, facts, words) : null;
    case "frameX":
      return chipFor({ kind: "frameX", frameX: facts.frameX }, facts, words);
    case "hour":
      return facts.rig.time !== null ? hourChip(facts.rig.time, words) : null;
    case "ev":
      return chipFor({ kind: "ev", ev: facts.rig.ev }, facts, words);
    case "happens":
      return chipFor({ kind: "happens", text: facts.direction }, facts, words);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// What a plan would do, said as planned (a preview, a suggestion, the dry run).
// ---------------------------------------------------------------------------

/** The camera's side after a word step, by her own front (reader-context.ts cameraSideOf). */
function sideOfSpot(spot: CameraSpot, facingDeg: number): CameraSide {
  const mark = { x: 0, z: 0, facingDeg };
  return cameraSideOf(mark, spotToMatch(spot, mark).from);
}

/** A step's own chips: the values it asks for, and where word steps land when the camera's spot is known. */
export function stepOutcomes(step: Step, facts: Pick<ReplyFacts, "rig" | "newestStill" | "spot">): Outcome[] {
  const out: Outcome[] = [];
  switch (step.kind) {
    case "who":
      out.push({ kind: "who", characterId: step.characterId, was: step.was });
      break;
    case "frame":
      for (const id of step.ids) out.push({ kind: "rig", id });
      break;
    case "place":
      if (step.markId !== undefined) out.push({ kind: "mark", markId: step.markId });
      if (step.near) out.push({ kind: "near", key: step.near.key, side: step.near.side });
      if (step.nudge) out.push({ kind: "nudge", right: step.nudge.right, toward: step.nudge.toward });
      break;
    case "pose":
      out.push({ kind: "pose", pose: step.pose });
      break;
    case "camera": {
      if (step.cameraId !== undefined) out.push({ kind: "camera", cameraId: step.cameraId });
      if (step.size !== undefined) out.push({ kind: "size", size: step.size });
      if (step.height !== undefined) out.push({ kind: "height", height: step.height, m: HEIGHT_M[step.height] });
      if (step.side !== undefined) out.push({ kind: "side", side: step.side });
      if (step.tiltDeg !== undefined) out.push({ kind: "tilt", deg: step.tiltDeg });
      if (step.lensMm !== undefined) out.push({ kind: "lens", mm: step.lensMm });
      if (step.frameX !== undefined) out.push({ kind: "frameX", frameX: step.frameX });
      const at = facts.spot;
      let spot = at?.spot ?? null;
      for (const st of step.steps ?? []) {
        out.push({ kind: "step", step: st });
        if (!at || !spot) continue;
        const r = cameraStep(st, spot, { facingDeg: at.facingDeg }, at.sensorHeightMm);
        spot = r.spot;
        if (st === "closer" || st === "further") out.push({ kind: "distance", m: spot.distanceM, clamp: r.clamp });
        else if (st === "higher" || st === "lower") out.push({ kind: "height", height: null, m: spot.heightM, clamp: r.clamp });
        else if (st === "left" || st === "right" || st === "other_side") out.push({ kind: "side", side: sideOfSpot(spot, at.facingDeg) });
        else if (st === "tilt_up" || st === "tilt_down") out.push({ kind: "tilt", deg: spot.pitchDeg, clamp: r.clamp });
        else out.push({ kind: "lens", mm: nearestLens(spot.fovDeg, at.sensorHeightMm), clamp: r.clamp });
      }
      break;
    }
    case "facing":
      if (step.facing !== undefined) out.push({ kind: "facing", facing: step.facing });
      if (step.turn !== undefined) out.push({ kind: "turn", turn: step.turn });
      break;
    case "gaze":
      out.push({ kind: "gaze", gaze: step.gaze });
      break;
    case "look":
      for (const id of step.ids) out.push({ kind: "rig", id });
      if (step.hour !== undefined) out.push({ kind: "hour", hour: step.hour });
      if (step.evThirds !== undefined) out.push({ kind: "ev", ev: stepEv(facts.rig.ev, step.evThirds) });
      if (step.look !== undefined) {
        const look = step.look === "newest" ? facts.newestStill : step.look;
        out.push({ kind: "look", look: look === null || look === "off" ? "off" : look });
      }
      break;
    case "words":
      if (step.happens) out.push({ kind: "happens", text: step.happens.text });
      break;
    case "takeArm":
      out.push({ kind: "takeFrom", still: step.still.n });
      break;
    case "motion":
      if (step.move !== undefined) out.push({ kind: "move", move: step.move });
      for (const t of step.textures ?? []) out.push({ kind: "texture", texture: t });
      if (step.engine !== undefined) out.push({ kind: "engine", engine: step.engine });
      break;
    case "takeCancel":
      break;
  }
  return out;
}

/**
 * A plan said as planned: its steps' chips in order, and "the camera moved
 * with her" where a place carries the camera along. What the page's
 * executors really reach can differ (the stage moves a camera round
 * something built); the page hands those in instead, and this is only for a
 * turn nothing ran for — Just talking's preview, the phrase-check's dry run.
 */
export function plannedOutcomes(plan: TurnPlan, facts: Pick<ReplyFacts, "rig" | "newestStill" | "spot">): TurnOutcomes {
  const chips: Outcome[] = [];
  const notes: PageNote[] = [];
  for (const step of plan.steps) {
    chips.push(...stepOutcomes(step, facts));
    if (step.kind === "place" && step.cameraFollows) notes.push({ kind: "cameraFollowed" });
  }
  // A preview of a set change: Do it ends at its card (spec §3.6).
  if (plan.kind === "proposal" && plan.reading?.setChange) chips.push({ kind: "astra", said: plan.reading.setChange.said });
  return { chips, notes };
}

/**
 * The page as a plan would leave it, for a turn nothing ran for: who is on
 * the chip, the mark, the pose, the camera and the third, the rig (a light
 * plot aimed from the camera's bearing when it is known), what happens, and
 * the lens. Questions are answered after the changes ("make it night, and
 * what lens is this?"), so a turn said as planned (the phrase-check's dry
 * run) answers them from here too.
 */
export function plannedFacts(plan: TurnPlan, facts: ReplyFacts): ReplyFacts {
  // Just talking moves nothing, so its answers are about the page as it is.
  if (plan.kind !== "run") return facts;
  let next: ReplyFacts = { ...facts };
  const bearing = facts.spot?.spot.bearingDeg ?? 0;
  for (const step of plan.steps) {
    if (step.kind === "who") next = { ...next, characterId: step.characterId };
    else if (step.kind === "frame") {
      const patch: Partial<SetRig> = {};
      for (const id of step.ids) Object.assign(patch, rigPatchFor(id, { cameraBearingDeg: bearing }) ?? {});
      next = { ...next, rig: { ...next.rig, ...patch } };
    } else if (step.kind === "place") next = { ...next, markId: step.markId ?? (step.near || step.nudge ? null : next.markId) };
    else if (step.kind === "pose") next = { ...next, pose: step.pose };
    else if (step.kind === "camera") {
      const named = step.cameraId !== undefined;
      const words = step.side !== undefined || step.size !== undefined || step.height !== undefined || step.tiltDeg !== undefined || step.lensMm !== undefined || step.steps !== undefined;
      next = {
        ...next,
        cameraId: named && !words ? (step.cameraId ?? null) : null,
        frameX: frameXAfter(next.frameX, named ? { kind: "camera", frameX: step.frameX } : { kind: "words", frameX: step.frameX }),
        lensMm: step.lensMm ?? next.lensMm,
      };
    } else if (step.kind === "facing" && typeof step.facing === "string") next = { ...next, facing: step.facing };
    else if (step.kind === "look") next = { ...next, rig: { ...next.rig, ...lookPatch(step, next.rig, bearing).patch } };
    else if (step.kind === "words" && step.happens) next = { ...next, direction: step.happens.text };
  }
  return next;
}

/**
 * The chips of a stored reading that has no plan of its own yet — a
 * suggestion row, an undo's rest — each key as it asks: the same order as
 * a turn runs (turn-plan.ts §3.1).
 */
export function actOutcomes(act: ShotAct & { happens?: { keep: string[]; add: string[] }; setChange?: { said: string } }, facts: ReplyFacts): Outcome[] {
  const out: Outcome[] = [];
  const frameIds = (act.rig ?? []).filter((id) => id.startsWith("format:") || id.startsWith("squeeze:"));
  const lookIds = (act.rig ?? []).filter((id) => !frameIds.includes(id));
  if (act.characterId !== undefined) out.push({ kind: "who", characterId: act.characterId, was: facts.characterId !== act.characterId ? facts.characterId : null });
  for (const id of frameIds) out.push({ kind: "rig", id });
  if (act.markId !== undefined) out.push({ kind: "mark", markId: act.markId });
  else if (act.near && "key" in act.near.thing) out.push({ kind: "near", key: act.near.thing.key, side: act.near.side });
  if (act.nudge) out.push({ kind: "nudge", right: act.nudge.right, toward: act.nudge.toward });
  if (act.pose !== undefined) out.push({ kind: "pose", pose: act.pose });
  if (act.cameraId !== undefined) out.push({ kind: "camera", cameraId: act.cameraId });
  if (act.size !== undefined) out.push({ kind: "size", size: act.size });
  if (act.height !== undefined) out.push({ kind: "height", height: act.height, m: HEIGHT_M[act.height] });
  if (act.side !== undefined) out.push({ kind: "side", side: act.side });
  if (act.tiltDeg !== undefined) out.push({ kind: "tilt", deg: act.tiltDeg });
  if (act.lensMm !== undefined) out.push({ kind: "lens", mm: act.lensMm });
  if (act.frameX !== undefined) out.push({ kind: "frameX", frameX: act.frameX });
  for (const st of act.steps ?? []) out.push({ kind: "step", step: st });
  if (typeof act.facing === "string") out.push({ kind: "facing", facing: act.facing });
  else if (act.facing && "key" in act.facing) out.push({ kind: "facing", facing: { key: act.facing.key } });
  if (act.turn !== undefined) out.push({ kind: "turn", turn: act.turn });
  if (act.gaze !== undefined) {
    const g = act.gaze;
    if (g === "camera" || g === "none") out.push({ kind: "gaze", gaze: g });
    else if ("side" in g) out.push({ kind: "gaze", gaze: { side: g.side } });
    else if ("key" in g) out.push({ kind: "gaze", gaze: { key: g.key } });
  }
  for (const id of lookIds) out.push({ kind: "rig", id });
  if (act.hour !== undefined) out.push({ kind: "hour", hour: act.hour });
  if (act.evThirds !== undefined) out.push({ kind: "ev", ev: stepEv(facts.rig.ev, act.evThirds) });
  if (act.look !== undefined) {
    const look = act.look === "newest" ? facts.newestStill : act.look;
    out.push({ kind: "look", look: look === null || look === "off" ? "off" : look });
  }
  if (act.happens) {
    const composed = composeHappens(act.happens, facts.direction);
    out.push({ kind: "happens", text: composed.text });
  }
  if (act.move !== undefined) out.push({ kind: "move", move: act.move });
  for (const t of act.textures ?? []) out.push({ kind: "texture", texture: t });
  if (act.engine !== undefined) out.push({ kind: "engine", engine: act.engine });
  if (act.setChange) out.push({ kind: "astra", said: act.setChange.said });
  return out;
}

// ---------------------------------------------------------------------------
// "Not yet" (spec §5.5) and answers from the page's facts (§5.6).
// ---------------------------------------------------------------------------

/** A thing a "photo" line can point at: the nearest car, else the nearest thing (the things come nearest first). */
function cardThing(facts: Pick<ReplyFacts, "things">): ReplyThing | null {
  return facts.things.find((t) => t.kind === "car") ?? facts.things[0] ?? null;
}

/**
 * Why a "not yet" item can't be done, where to do it now, and the button
 * that goes there. `ran.near`: the turn placed her by a thing, so the
 * figure left on the ground IS beside it; otherwise that is not said
 * (review of Cut 2, W5).
 */
export function cantLine(
  code: CantCode,
  said: string | null,
  facts: ReplyFacts,
  words: ReplyWords,
  ran: { near?: boolean } = {},
): { text: string; buttons: ReplyButton[] } {
  const r = words.reply;
  const c = r.cant;
  const name = personOf(facts, words);
  const buttons: ReplyButton[] = [];
  let why: string;
  switch (code) {
    case "two_people":
      why = fill(c.two_people, { name });
      buttons.push({ kind: "at", label: r.pickWithAt });
      break;
    case "raise_figure":
      why = capital(fill(ran.near ? c.raise_figure : r.cantRaiseGround, { name }));
      break;
    case "aim_thing":
      why = fill(c.aim_thing, { name });
      break;
    case "thirds":
      why = fill(c.thirds, { name });
      break;
    case "altitude":
      why = fill(c.altitude, { m: formatMetres(HEIGHT_M.high, facts.locale) });
      break;
    case "thing_unknown":
      why = fill(c.thing_unknown, { name });
      break;
    case "weather":
      // The palette and the hour by their own names in this language (review of Cut 2, W9).
      why = fill(c.weather, { night: words.rig.timePresets.night ?? "", palette: words.rig.palettes["harbour-4am"] });
      break;
    case "film_beats":
      why = fill(c.film_beats, { film: words.film });
      buttons.push({ kind: "openFilm", label: fill(r.openFilm, { film: words.film }) });
      break;
    case "clip_length":
      why = fill(c.clip_length, { omni: SET_TAKE_ENGINES.omni.seconds, veo: SET_TAKE_ENGINES.veo.seconds });
      break;
    case "mover":
      why = fill(c.mover, { film: words.film, driveLay: words.driveLay });
      buttons.push({ kind: "openFilm", label: fill(r.openFilm, { film: words.film }) });
      break;
    case "photo": {
      why = c.photo;
      const thing = cardThing(facts);
      if (thing) buttons.push({ kind: "openCard", key: thing.key, label: fill(r.openCard, { thing: thing.name }) });
      break;
    }
    case "likeness":
      why = capital(fill(c.likeness, { name }));
      break;
    case "rebuild":
      why = c.rebuild;
      buttons.push({ kind: "buildNew", label: r.buildNew });
      break;
    default:
      why = c[code];
  }
  // Their own words go in last, in one pass: nothing they wrote is read as a placeholder.
  const text = said ? fill(r.replyNotYet, { why, said }) : fill(r.replyNotYetPart, { why });
  return { text, buttons };
}

/** The lens on this body in the person's words: "full frame", "Super 35". */
const sensorName = (sensor: RigSensor, words: ReplyWords) => words.reply.sensorNames[sensor];

/** Whether the hour waits under the light: a plot that brings its own sun over a set hour (moonlight at night carries it). */
function hourWaits(rig: SetRig): boolean {
  if (!rig.light || rig.time === null || !schemeHasSun(rig.light.scheme)) return false;
  return !(rig.light.scheme === "moonlight" && (rig.time >= 19 || rig.time < 6));
}

/** The answer to one question, from the page's own facts (spec §5.6). */
export function answerFor(topic: AskTopic, facts: ReplyFacts, words: ReplyWords): { text: string; buttons: ReplyButton[] } {
  const r = words.reply;
  const m = (n: number) => formatMetres(n, facts.locale);
  const rig = facts.rig;
  const plain = (text: string) => ({ text, buttons: [] as ReplyButton[] });
  switch (topic) {
    case "lens":
      return plain(
        fill(r.answerLens, {
          mm: Math.round(facts.lensMm),
          sensor: sensorName(rig.sensor, words),
          look: rig.lens ? fill(r.answerLensLook, { character: words.rig.lenses[rig.lens] }) : r.answerLensNoLook,
        }),
      );
    case "focus": {
      if (rig.stop === null) return plain(r.answerFocusNone);
      const dof = depthOfField(facts.lensMm, rig.stop, facts.distanceM, sensorCocMm(rig.sensor));
      return plain(
        Number.isFinite(dof.farM)
          ? fill(r.answerFocus, { stop: rig.stop, near: m(dof.nearM), far: m(dof.farM) })
          : fill(r.answerFocusDeep, { stop: rig.stop, near: m(dof.nearM) }),
      );
    }
    case "format":
      return plain(fill(r.answerFormat, { format: words.rig.formats[rig.format], squeeze: rig.squeeze !== 1 ? fill(r.answerSqueeze, { q: rig.squeeze }) : "" }));
    case "light":
      return plain(
        fill(r.answerLight, {
          plot: rig.light ? words.rig.lights[rig.light.scheme] : words.rig.asBuilt,
          time: rig.time !== null ? timeLabel(rig.time) : words.timeAsBuilt,
          waits: hourWaits(rig) ? r.answerLightWaits : "",
        }),
      );
    case "look": {
      const ids = [
        rig.stock ? `stock:${rig.stock}` : null,
        rig.lens ? `character:${rig.lens}` : null,
        rig.palette ? `palette:${rig.palette}` : null,
        rig.era ? `era:${rig.era}` : null,
        rig.genre ? `genre:${rig.genre}` : null,
      ].filter((x): x is string => x !== null);
      const items = ids.map((id) => rigCommandLabel(id, words.rig)).filter((x): x is string => Boolean(x));
      return plain(items.length > 0 ? fill(r.answerLook, { items: items.join(" · ") }) : r.answerLookNone);
    }
    case "who": {
      const name = nameOf(facts, facts.characterId);
      return plain(name ? fill(r.answerWho, { name }) : r.answerWhoNone);
    }
    case "where": {
      const label = markLabel(facts, facts.markId);
      return plain(
        fill(r.answerWhere, {
          place: label ? fill(r.chips.mark, { mark: label }) : r.chips.ownSpot,
          facing: fill(r.chips.facing, { value: r.chips.facings[facts.facing] }),
          // The chip form, "Pose · Sentada", agrees with the noun for anyone (check of the spec, item 10).
          pose: `${words.pose} · ${words.poses[facts.pose]}`,
          name: personOf(facts, words),
        }),
      );
    }
    case "happens":
      return plain(facts.direction ? fill(r.answerHappens, { direction: facts.direction }) : r.answerHappensNone);
    case "cost": {
      const still = fill(r.answerCost, { credits: creditsLabel(r, facts.credits.still) });
      const take =
        facts.takeFrom !== null
          ? fill(r.answerCostTake, { take: r.takeWord, still: stillLabel(words, facts.takeFrom), credits: creditsLabel(r, facts.credits.take[facts.takeEngine]) })
          : "";
      return plain(still + take);
    }
    case "edits_left": {
      const kind = astraCardKind({ editsLeft: facts.editsLeft, editsCap: facts.editsCap, tooBig: false });
      if (kind === "none") return plain(fill(r.answerEditsNone, { build: words.build }));
      if (kind === "askOpen") return plain(r.answerEditsOpen);
      if (kind === "askUnknown") return plain(fill(r.answerEditsUnknown, { cap: facts.editsCap }));
      if (kind === "askLast") return plain(r.answerEditsOne);
      return plain(fill(r.answerEditsLeft, { n: facts.editsLeft ?? 0 }));
    }
    case "last_still": {
      const s = facts.lastStill;
      if (!s) return plain(r.answerNoStill);
      return plain(
        fill(r.answerLastStill, {
          still: stillLabel(words, s.n),
          status: r.answerStatus[s.status],
          score: s.score !== null ? fill(r.answerScore, { score: Math.round(s.score) }) : "",
        }),
      );
    }
    case "things":
      return plain(
        facts.things.length > 0 ? fill(r.answerThings, { list: facts.things.map((t) => `${t.name} (${r.colours[t.colour]})`).join(", ") }) : r.answerThingsNone,
      );
    case "help":
      // What it says about money depends on the mode (check of the spec, item 5): in
      // "Shoot without asking" a changed frame IS shot at once, at its price.
      // With the person's own take set up, the changed frame is that take, at its price (pressFor; review of Cut 2, W6).
      if (facts.mode !== "auto") return plain(r.answerHelp);
      return plain(
        fill(r.answerHelpAuto, {
          mode: words.autoMode,
          credits:
            facts.takeArmedBy === "person"
              ? fill(r.answerHelpAutoTake, { take: r.takeWord, credits: creditsLabel(r, facts.credits.take[facts.takeEngine]) })
              : creditsLabel(r, facts.credits.still),
        }),
      );
    case "elsewhere": {
      const text = fill(r.answerElsewhere, { settings: words.settings, billing: words.billing });
      if (!facts.producerOn) return plain(text);
      return { text: text + r.answerElsewhereProducer, buttons: [{ kind: "askProducer", label: r.askProducer }] };
    }
  }
}

// ---------------------------------------------------------------------------
// The whole reply (spec §5.1).
// ---------------------------------------------------------------------------

/** The notes, in the order §5.1 says them. */
const NOTE_RANK: Record<Note["kind"] | PageNote["kind"] | "held", number> = {
  notCastable: 0,
  whoUnknown: 0,
  hourPlotOff: 1,
  hourWaits: 1,
  moonKept: 1,
  stepped: 2,
  cameraFollowed: 3,
  frameLineMoved: 4,
  outfitOff: 5,
  takeArmed: 6,
  takeCancelled: 7,
  takeCancelledFormat: 7,
  needsStill: 8,
  builtFromWords: 9,
  placeKept: 10,
  held: 11,
  notStarted: 11,
  undoHand: 12,
  undoAstra: 12,
  undoAstraText: 12,
  undoAstraFailed: 12,
  stillsStay: 13,
  undoNone: 14,
};

/** At most this many "not yet" lines; the rest are counted (spec §5.1). */
export const NOT_YET_SHOWN = 3;

function planNoteText(n: Note, facts: ReplyFacts, words: ReplyWords): string | null {
  const r = words.reply;
  const name = (id: string | null) => nameOf(facts, id) ?? words.yourCharacter;
  switch (n.kind) {
    case "notCastable":
      return fill(words.notCastable, { name: name(n.characterId) });
    case "whoUnknown":
      // Someone the page doesn't know can't be named: said under "didn't match" (review of Cut 2, W12).
      return null;
    case "takeCancelled":
      return fill(r.noteTakeCancelled, { take: r.takeWord, name: name(n.characterId) });
    case "takeCancelledFormat":
      return fill(r.noteTakeCancelledFormat, { take: r.takeWord, from: words.rig.formats[n.from], to: words.rig.formats[n.to] });
    case "takeArmed":
      return fill(r.noteTakeArmed, { take: r.takeWord, still: stillLabel(words, n.still.n) });
    case "needsStill":
      return fill(r.noteNeedsStillOf, { format: words.rig.formats[n.format], name: name(n.characterId) });
    case "hourPlotOff":
      return fill(r.noteHourPlotOff, { plot: words.rig.lights[n.scheme], time: timeLabel(n.hour) });
    case "hourWaits":
      return fill(r.noteHourWaits, { plot: words.rig.lights[n.scheme] });
    case "moonKept":
      return r.noteMoonKept;
    case "outfitOff":
      return fill(r.noteOutfitOff, { name: name(n.characterId) });
    case "builtFromWords":
      return r.noteBuiltFromWords;
    case "placeKept":
      // Its own line, not "didn't match": the thing is there, one place was used (review of Cut 2, understanding N4).
      return fill(r.notePlaceKept, { name: name(facts.characterId), mark: markLabel(facts, n.markId) ?? n.markId });
  }
}

function pageNoteText(n: PageNote, facts: ReplyFacts, words: ReplyWords): string {
  const r = words.reply;
  const name = personOf(facts, words);
  switch (n.kind) {
    case "stepped":
      return fill(r.noteStepped, { thing: thingOf(facts, n.key, words), name });
    case "cameraFollowed":
      return fill(r.noteCameraFollowed, { name });
    case "frameLineMoved":
      return fill(words.frameLineMoved, { name });
    case "notStarted":
      return r.noteNotStarted;
    case "undoHand":
      return r.noteUndoHand;
    case "undoAstra":
      return r.noteUndoAstra;
    case "undoAstraText":
      return r.noteUndoAstraText;
    case "undoAstraFailed":
      return r.noteUndoAstraFailed;
    case "stillsStay":
      return r.noteStillsStay;
    case "undoNone":
      return r.noteUndoNone;
  }
}

/** A suggestion's or a preview's second button, priced from its own plan (turn-plan.ts secondButton). */
function secondFor(row: number | "plan", second: { kind: "shoot" | "take"; credits: number } | null, r: Reply): ReplyButton | null {
  if (!second) return null;
  const credits = creditsLabel(r, second.credits);
  return second.kind === "take"
    ? { kind: "doItTake", row, credits: second.credits, label: fill(r.doItTake, { take: r.takeWord, credits }) }
    : { kind: "doItShoot", row, credits: second.credits, label: fill(r.doItShoot, { credits }) };
}

/**
 * The reply to one turn. `outcomes` is what the page's executors changed
 * and found (null for a turn nothing ran for: said as planned); `facts` the
 * page after the turn, with the shot it decided.
 */
export function composeReply(plan: TurnPlan, outcomes: TurnOutcomes | null, facts: ReplyFacts, words: ReplyWords): ReplyModel {
  const r = words.reply;
  const lines: ReplyLine[] = [];
  const push = (kind: ReplyLineKind, text: string, buttons: ReplyButton[] = []) => lines.push({ kind, text, buttons });
  let astra: ReplyAstraCard | null = null;

  // A reading that failed or was limited changes nothing and shoots nothing (decision 2).
  if (plan.kind === "guard") {
    if (plan.why === "limited") push("busy", r.replyReaderBusy);
    else if (plan.why === "down") push("down", r.replyReaderDown, [{ kind: "useMyWords", label: r.useMyWords }, { kind: "tryAgain", label: r.tryAgain }]);
    return { lines, astra };
  }
  if (plan.kind === "nothing") return { lines, astra };

  const out = outcomes ?? plannedOutcomes(plan, facts);
  const chipsOf = (chips: readonly Outcome[]) => chips.map((o) => chipFor(o, facts, words)).filter((x) => x.length > 0);
  /** A line of chips: the sentence, and its parts for the pills (ReplyItems). */
  const pushItems = (kind: ReplyLineKind, template: string, chips: string[], buttons: ReplyButton[] = []) =>
    lines.push({ kind, text: fillItems(template, chips.join(" · ")), buttons, items: itemsOf(template, chips) });

  // 1. The answers, from the page as the turn leaves it, then the idea.
  for (const topic of plan.ask) {
    const a = answerFor(topic, facts, words);
    push("answer", a.text, a.buttons);
  }
  if (plan.idea) push("idea", fill(r.replyIdea, { idea: plan.idea }));

  // 2. Done, or what it would do, or what was undone.
  const done = chipsOf(out.chips);
  if (plan.kind === "undo") {
    // Nothing to undo, or only an Astra change that could not be undone: never "Undone: the last change." (review of Cut 2, W7).
    const restored = out.notes.some((n) => n.kind === "undoNone" || n.kind === "undoAstraFailed");
    if (done.length > 0) pushItems("undone", r.replyUndone, done);
    else if (!restored) push("undone", r.replyUndoneLast);
    // Anything else the message asked is offered, never run (spec §3.5).
    if (plan.proposal) {
      const rest = chipsOf(actOutcomes(plan.proposal, facts));
      if (rest.length > 0) pushItems("planned", r.replyPlanned, rest, [{ kind: "doIt", row: "rest", label: r.doIt }]);
    }
  } else if (plan.kind === "proposal") {
    // "Undo that" in Just talking is offered like the rest, never said as
    // "I couldn't place that" (review of Cut 2, U4): Do it steps back.
    const planned = plan.reading?.undo ? [r.chips.undoLast, ...done] : done;
    if (planned.length > 0) {
      const buttons: ReplyButton[] = [{ kind: "doIt", row: "plan", label: r.doIt }];
      const second = secondFor("plan", secondButton(plan, facts), r);
      if (second) buttons.push(second);
      pushItems("planned", r.replyPlanned, planned, buttons);
    }
  } else if (done.length > 0) {
    pushItems("done", r.replyDone, done, [{ kind: "undo", label: r.undo }]);
  }
  if (facts.shot && facts.shot.kind !== "none") {
    const n = facts.shot.kind === "take" ? facts.credits.take[facts.takeEngine] : facts.credits.still;
    push("shooting", fill(r.replyShooting, { credits: creditsLabel(r, n) }));
  }

  // 3. Already so.
  const already = plan.already.map((k) => alreadyChip(k, facts, words)).filter((x): x is string => Boolean(x));
  if (already.length > 0) pushItems("already", r.replyAlready, already);

  // 4. Notes: the plan's, the page's, and a held shot, in §5.1's order.
  const notes: { rank: number; text: string }[] = [];
  /** Something asked for could not be named on this set: said once, under "didn't match". */
  let unmatched = false;
  for (const n of plan.notes) {
    const text = planNoteText(n, facts, words);
    if (text) notes.push({ rank: NOTE_RANK[n.kind], text });
    else if (n.kind === "whoUnknown") unmatched = true;
  }
  for (const n of out.notes) notes.push({ rank: NOTE_RANK[n.kind], text: pageNoteText(n, facts, words) });
  const held = facts.shot !== null && facts.shot.kind === "none" && facts.shot.offer !== null && facts.shot.held.length > 0 ? facts.shot : null;
  // Said by what held it: Try again only, the chat's own take only, or a
  // part that isn't done (review of Cut 2, W1 and understanding N1).
  if (held) {
    const only = held.held.length === 1 ? held.held[0] : null;
    const text = only === "retry" ? r.replyRetryHeld : only === "take" ? fill(r.replyHeldTake, { take: r.takeWord }) : r.replyHeldShot;
    notes.push({ rank: NOTE_RANK.held, text });
  }
  notes.sort((a, b) => a.rank - b.rank);
  for (const n of notes) push("note", n.text);

  // 5. Not yet: at most three lines, then how many more.
  const nearRan = out.chips.some((o) => o.kind === "near");
  plan.cant.slice(0, NOT_YET_SHOWN).forEach((c) => {
    const line = cantLine(c.code, c.said, facts, words, { near: nearRan });
    push("notYet", line.text, line.buttons);
  });
  if (plan.cant.length > NOT_YET_SHOWN) push("notYetMore", fill(r.replyNotYetMore, { n: plan.cant.length - NOT_YET_SHOWN }));

  // 6. Needs your OK: the Astra card, "which one?", the take format, then the priced presses.
  const presses: ReplyButton[] = [];
  const needLines: ReplyLine[] = [];
  for (const need of plan.needs) {
    if (need.kind === "astra") {
      const shootCredits = need.canGo ? facts.credits.still : null;
      const text = astraCardLine(r, { kind: need.card, words: need.said, editsLeft: facts.editsLeft, editsCap: facts.editsCap, build: words.build });
      const buttons: ReplyButton[] = [];
      if (need.canGo) {
        buttons.push({ kind: "astraGo", label: r.astraGo });
        if (shootCredits !== null) buttons.push({ kind: "astraGoShoot", credits: shootCredits, label: fill(r.astraGoShoot, { credits: creditsLabel(r, shootCredits) }) });
      }
      buttons.push({ kind: "notNow", label: r.notNow });
      // Only the words Astra will read are quoted, and a longer message says so (check of the spec, item 9).
      const cut = astraCardWords(need.said).cut || need.cut;
      // Astra's own limit, not the reader's: "Astra gets only the first 300" (review of Cut 2, W3).
      needLines.push({ kind: "astra", text: cut ? `${text} ${fill(r.astraCutMessage, { n: SET_EDIT_MAX_CHARS })}` : text, buttons });
      astra = { said: need.said, cut, card: need.card, canGo: need.canGo, shootCredits };
    } else if (need.kind === "which") {
      const buttons: ReplyButton[] = [];
      for (const key of need.candidates) {
        const t = facts.things.find((x) => x.key === key);
        if (!t) continue;
        buttons.push({ kind: "which", slot: need.slot, key, label: fill(r.chips.which, { thing: t.name, colour: r.colours[t.colour], where: r.chips.whichWhere[t.where] }) });
      }
      if (buttons.length > 0) needLines.push({ kind: "which", text: r.replyWhich, buttons });
      else unmatched = true;
    } else if (need.kind === "takeFormat") {
      // A preview has changed no frame yet: its take-format need only keeps the priced button away.
      if (plan.kind === "proposal") continue;
      needLines.push({ kind: "note", text: fill(r.noteTakeFormat, { take: r.takeWord, from: words.rig.formats[need.stillFormat], to: words.rig.formats[need.format] }), buttons: [] });
    } else if (need.kind === "hour") {
      presses.push({ kind: "useHour", label: r.useHour });
    } else if (need.kind === "take") {
      presses.push({ kind: "take", credits: need.credits, label: fill(r.takeNow, { take: r.takeLabel, credits: creditsLabel(r, need.credits) }) });
    }
  }
  if (held?.offer) {
    const n = held.offer === "take" ? facts.credits.take[facts.takeEngine] : facts.credits.still;
    const credits = creditsLabel(r, n);
    presses.push({
      kind: "shootAsIs",
      press: held.offer,
      credits: n,
      label: held.offer === "take" ? fill(r.takeNow, { take: r.takeLabel, credits }) : fill(r.shootAsIs, { credits }),
    });
  }
  if (needLines.length > 0 || presses.length > 0) {
    push("needs", r.replyNeeds, presses);
    lines.push(...needLines);
  }

  // 7. Ways to try it: each row with Do it and its own priced second button.
  if (plan.suggestions.length > 0) {
    push("ways", plan.cant.length > 0 && !plan.idea ? r.replyClosest : r.replyWays);
    plan.suggestions.forEach((s, i) => {
      const buttons: ReplyButton[] = [{ kind: "doIt", row: i, label: r.doIt }];
      const second = secondFor(i, s.second, r);
      if (second) buttons.push(second);
      pushItems("way", "{items}", chipsOf(actOutcomes(s.act, facts)), buttons);
    });
  }

  // 8. What was cut or left out.
  if (plan.messageCut) push("cut", fill(r.replyCutMessage, { n: SHOT_WORDS_MAX_CHARS }));
  if (plan.directionCut) push("cut", fill(r.replyCutDirection, { n: SET_DIRECTION_MAX_CHARS, tail: plan.directionCut }));
  // The thing left for a mark said in the same words is said by its note, and still holds the shot (placeKept).
  const keptPlace = plan.notes.some((n) => n.kind === "placeKept");
  const dropped = plan.dropped.filter((d) => !(keptPlace && d === "near"));
  if (dropped.length > 0 || unmatched) push("dropped", r.replyDropped);

  // Never silent.
  if (lines.length === 0) push("nothing", r.replyNothing);
  return { lines, astra };
}

// ---------------------------------------------------------------------------
// LAST TURNS: what the page did, in the reader's own terms (spec §4.4).
// ---------------------------------------------------------------------------

/** The most a turn's "did" line holds (reader-context.ts READER_CONTEXT_MAX.turnChars). */
export const TURN_DID_MAX_CHARS = 200;

/**
 * What a turn did, written by the PAGE from its outcomes for the reader's
 * LAST TURNS — never by the model: "who p1; near t1 beside; pose lean;
 * camera low 0.7 m; rig time:golden, character:anamorphic; happens set;
 * astra change pending". Aliases are the ones the reading came with, so the
 * next reading sees the same names. English, like the rest of the context.
 */
export function turnDid(plan: TurnPlan, outcomes: TurnOutcomes, aliases: ReaderAliases): string {
  const alias = (map: Record<string, string>, id: string) => Object.entries(map).find(([, v]) => v === id)?.[0] ?? null;
  const parts: string[] = [];
  const rig: string[] = [];
  if (plan.kind === "undo") parts.push("undo");
  for (const o of outcomes.chips) {
    switch (o.kind) {
      case "who": {
        const a = alias(aliases.people, o.characterId);
        if (a) parts.push(`who ${a}`);
        break;
      }
      case "mark":
        parts.push(`mark ${o.markId}`);
        break;
      case "near": {
        const a = alias(aliases.things, o.key);
        parts.push(a ? `near ${a} ${o.side}` : `near ${o.side}`);
        break;
      }
      case "nudge":
        parts.push("nudged");
        break;
      case "pose":
        parts.push(`pose ${o.pose}`);
        break;
      case "camera":
        parts.push(`camera ${o.cameraId}`);
        break;
      case "size":
        parts.push(`size ${o.size}`);
        break;
      case "height":
        parts.push(o.height ? `camera ${o.height} ${Math.round(o.m * 10) / 10} m` : `camera ${Math.round(o.m * 10) / 10} m`);
        break;
      case "side":
        parts.push(`side ${o.side}`);
        break;
      case "lens":
        parts.push(`lens ${Math.round(o.mm)}`);
        break;
      case "frameX":
        parts.push(`frame_x ${o.frameX}`);
        break;
      case "step":
        parts.push(o.step);
        break;
      case "facing":
        parts.push(typeof o.facing === "string" ? `facing ${o.facing}` : `facing ${alias(aliases.things, o.facing.key) ?? "a thing"}`);
        break;
      case "turn":
        parts.push(`turn ${o.turn}`);
        break;
      case "gaze":
        parts.push(`gaze ${typeof o.gaze === "string" ? o.gaze : "side" in o.gaze ? o.gaze.side : (alias(aliases.things, o.gaze.key) ?? "a thing")}`);
        break;
      case "rig":
        rig.push(o.id);
        break;
      case "hour":
        rig.push(`hour ${o.hour}`);
        break;
      case "ev":
        rig.push("exposure");
        break;
      case "look":
        parts.push(o.look === "off" ? "look off" : `look ${o.look}`);
        break;
      case "happens":
        parts.push(o.text ? "happens set" : "happens cleared");
        break;
      case "takeFrom":
        parts.push(`take armed from still ${o.still}`);
        break;
      case "move":
        parts.push(`move ${o.move}`);
        break;
      default:
        break;
    }
  }
  if (rig.length > 0) parts.push(`rig ${rig.join(", ")}`);
  if (plan.needs.some((n) => n.kind === "astra")) parts.push("astra change pending");
  if (plan.cant.length > 0) parts.push(`not yet ${plan.cant.map((c) => c.code).join(", ")}`);
  const did = parts.join("; ") || "nothing changed";
  return Array.from(did).length > TURN_DID_MAX_CHARS ? `${Array.from(did).slice(0, TURN_DID_MAX_CHARS - 1).join("")}…` : did;
}

