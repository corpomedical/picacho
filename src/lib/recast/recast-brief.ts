// The brief (cut 2, 2026-09-18).
//
// Genjutsu's best-kept trick is that its recipes are not prompts, they are
// BRIEFS: a task, the references in play, what the source video does, and a
// list headed "everything else stays exactly". Their own library shows them
// running to six hundred words. It works because a video model given a
// performance will happily improve it unless told, in writing, not to.
//
// Ours is composed here from the read's fields, the casting, the keep list
// and the person's own direction — and then SHOWN on the door, where it can
// be edited before it is sent. Theirs cannot be seen at all.
//
// Two shapes, because the jobs ask different things:
//   scene/motion  replace the performer, keep everything else
//   world         keep what everyone DOES, redraw how it all looks
//
// THE BRIEF SAYS REPLACE (cut 3, 2026-09-23). A paid pair of takes on one
// 15 s window of a school courtyard measured three faults in the words, and
// all three are answered here:
//   the direction arrived last, 1,700 characters after the order to replace,
//     and the engine ADDED the character beside the man instead of replacing
//     him — so on a scene take the person's words now sit with the TASK;
//   nothing said the man was GONE, so a take could keep him and gain a
//     person — so the TASK says outright that he is in no frame, that the
//     head count never changes, and that the character stands where he stood;
//   the keep list closed on "everything the direction does not change stays
//     exactly as it is", which reads as an order to keep him too — so that
//     line is now scoped to whoever and whatever the TASK does not name.
// A controlled re-run with the direction inside the instruction replaced him
// in place, dressed him as the direction said, and kept the real crowd
// (92/82/85 on the face check). What that re-run did NOT fix is the load
// limit: a lead swap and a whole-crowd swap in one render still duplicate
// and collapse. That is the engine's, not the wording's.
//
// The engines that take no prompt (Wan's two) are given none; the brief is
// still composed and stored, because it is what the door shows and what a
// recipe carries.
//
// Relative imports only — the door composes the same text the server sends,
// so what is shown is what is charged for.

import { cleanText } from "../sets/set-spec";
import { RECAST_ENGINES, type RecastEngine, type RecastJob } from "./recast";
import type { RecastKeep, RecastPerson, RecastRead } from "./recast-read";
import { cutsInWindow, type RecastWindow } from "./trim";

// cleanText collapses EVERY run of whitespace, newlines included — right for
// a one-line field, fatal here: it flattens the headings and the bullets into
// one paragraph, and the layout is most of why a brief works at all. So the
// brief gets its own bound: control characters out, runs of spaces in, line
// breaks kept (at most one blank line), then cut to length.
function cleanBrief(value: string, max: number): string {
  const flat = value
    // Control characters and the invisible direction marks, but NOT \n.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028\u2029]/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const points = Array.from(flat);
  return points.length > max ? points.slice(0, max).join("").trim() : flat;
}

/**
 * The tightest prompt any engine takes — Kling's 2,500 — and the cap on a
 * brief composed without naming its engine. Each engine's own number is
 * recast.ts's promptMax (2026-09-22): Luma and Restage are given up to 6,000.
 */
// It was 2000 until the long take (2026-09-19): a later piece's continuity
// words run ~420 characters, and a brief was cut from its END — where the
// person's own direction stood. Nothing is cut from the end any more, and on
// a scene take the direction is not at the end at all (cut 3): it sits with
// the TASK, so the end a cut would reach holds nothing of theirs.
export const RECAST_BRIEF_MAX_CHARS = 2500;
export const RECAST_DIRECTION_MAX_CHARS = 600;
/**
 * A mark is the read's plain-words handle for someone a take REPLACES, and
 * the TASK leads with it. Bounded like the read's own `where`, because the
 * read makes a round trip through a browser before the server composes with
 * it and the two copies must come out byte for byte the same.
 */
export const RECAST_MARK_MAX_CHARS = 90;

export type RecastCasting = {
  /** The read's tag for the person being replaced ("A"), or null when there was no read. */
  tag: string | null;
  /**
   * That tag is MANY people, not one (the read's `many`) — a crowd, a row, a
   * class. Casting over them means every one of them becomes the character,
   * which the brief has to say outright: asking to "replace Person B" while
   * promising to keep everyone else in the shot is a contradiction, and the
   * engine resolved it by redrawing the whole picture (2026-09-20).
   */
  many?: boolean;
  characterName: string;
  /**
   * How the engine names the character's photos in its prompt — Kling O3
   * Edit's "@Element1" (a front photo bound to more angles) or "@Image1"
   * (a character with one photo). Absent for an engine that takes no names.
   */
  token?: string;
};

/** The engine's name for the character, from how many of their photos ride. */
export function recastCharacterToken(photoCount: number): string {
  return photoCount > 1 ? "@Element1" : "@Image1";
}

/**
 * The engine's names for the images the person added, in order: @Image1… —
 * or from @Image2 when a one-photo character already goes as @Image1
 * (recastRequestBody puts them in that order).
 */
export function recastImageTokens(characterTokens: string | string[] | undefined, count: number): string[] {
  const taken = (Array.isArray(characterTokens) ? characterTokens : characterTokens ? [characterTokens] : []).filter((t) =>
    t.startsWith("@Image"),
  ).length;
  return Array.from({ length: count }, (_, i) => `@Image${taken + 1 + i}`);
}

/**
 * The engine's names for several characters in ONE take, in cast order:
 * @Element1, @Element2 for those with more than one photo, @Image1… for
 * those with one — the order recastRequestBody binds them in.
 */
/**
 * Restage names its references by modality and order — "Video 1", "Image 1",
 * "Images 1–3" — rather than by @Element/@Image, and a character holds as many
 * places as it has photos riding. Returns each character's name for the brief
 * and how many places they took, so the added images can follow.
 */
export function recastRestageTokens(photoCounts: number[]): { tokens: string[]; used: number } {
  let at = 1;
  const tokens = photoCounts.map((count) => {
    const n = Math.max(1, count);
    const token = n === 1 ? `Image ${at}` : `Images ${at}–${at + n - 1}`;
    at += n;
    return token;
  });
  return { tokens, used: at - 1 };
}

export function recastCastTokens(photoCounts: number[]): string[] {
  let elements = 0;
  let images = 0;
  return photoCounts.map((n) => (n > 1 ? `@Element${++elements}` : `@Image${++images}`));
}

/**
 * EVERY NAME A TAKE'S WORDS USE, in one place (2026-09-22): the cast's, the
 * added images', and — for a later part of a long take — the still at its
 * switch, each exactly as recastRequestBody binds them. The action names
 * every part with this, and the tests read each part's words against its
 * body with it, so a brief can never point at a picture the part was not
 * sent ("A long take's later parts get every picture they are told about").
 *
 * photos  how many photos of each cast character ride, in cast order
 * images  how many added images ride
 */
export function recastBriefNames(input: { job: RecastJob; engine: RecastEngine; photos: number[]; images: number }): {
  cast: string[];
  images: string[];
  /** The still at a later part's switch, named after everything else; null where nothing chains. */
  look: string | null;
} {
  if (RECAST_ENGINES[input.engine].restages) {
    const { tokens, used } = recastRestageTokens(input.photos);
    return { cast: tokens, images: Array.from({ length: input.images }, (_, i) => `Image ${used + 1 + i}`), look: null };
  }
  if (input.job === "scene" && input.engine === "kling-edit") {
    const cast = recastCastTokens(input.photos);
    const images = recastImageTokens(cast, input.images);
    return { cast, images, look: recastImageTokens([...cast, ...images], 1)[0] };
  }
  // The engines that read no names are given none.
  return { cast: [], images: [], look: null };
}

/**
 * THE WORDS A TAKE WAS ACTUALLY SENT, read back from its pipeline log
 * (2026-09-22). A long take's parts each get their own brief, composed whole
 * when it starts — and the job row that carried them is deleted when the
 * take finishes. So the action keeps every part's words on the log's first
 * attempt (`partBriefs`), and a take of one piece has its one brief as the
 * attempt's compiledPrompt. `expanded` is what Restage's engine rewrote the
 * words into, where the runner recorded one (the last attempt's
 * `expandedPrompt`, H3's own `expanded_prompt`).
 *
 * Pure and tolerant: the log is data from a row, so anything that is not
 * exactly a list of strings reads as nothing.
 */
export function recastSentBriefs(log: unknown): { parts: string[]; expanded: string | null } {
  const attempts = Array.isArray(log) ? log.filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null) : [];
  const first = attempts[0];
  const last = attempts[attempts.length - 1];
  const parts = Array.isArray(first?.partBriefs)
    ? first.partBriefs.filter((b): b is string => typeof b === "string" && b.length > 0)
    : typeof first?.compiledPrompt === "string" && first.compiledPrompt
      ? [first.compiledPrompt]
      : [];
  const expanded = typeof last?.expandedPrompt === "string" && last.expandedPrompt ? last.expandedPrompt : null;
  return { parts, expanded };
}

const bullet = (s: string) => `- ${s}`;

/**
 * THE STILL AT THE SWITCH (2026-09-20). A later piece is sent one second of
 * the piece before it and then the footage again, so a take that changed the
 * whole picture can fall back to what the clip shows — the operator's Anubis
 * take built an Egyptian field for two parts and came back as the school for
 * the third. The last finished frame rides as a reference, and these words
 * are what point the engine at it.
 */
function lookLines(look: string | undefined): string[] {
  return look
    ? [
        `${look} IS that finished frame. The place, the light, the clothes and every person in the picture look exactly like that for the whole of this piece — even where the footage underneath still looks like it did before.`,
      ]
    : [];
}

/**
 * What each added image is called in the person's words ("image 1", as the
 * door labels it) against the engine's own name for it.
 */
function imageLines(tokens: string[]): string[] {
  if (tokens.length === 0) return [];
  return [
    "IMAGES",
    // "as the direction says", not "below": on a scene take the direction now
    // stands above this block (taskBlock), and this same line goes to Restage,
    // where it still stands below. The heading DIRECTION is what points at it.
    "Added by the person, to be used exactly as the direction says:",
    ...tokens.map((token, i) => bullet(`${token} — "image ${i + 1}" in the direction.`)),
    "",
  ];
}

function sourceLines(read: RecastRead | null, seconds: number): string[] {
  // With no read there is no ground to call the clip continuous — its length
  // is all that is known (review, 2026-09-22).
  if (!read) return [`A clip of ${Math.round(seconds)} seconds.`];
  // The account of what happens gives way before who is who (composeRecastBrief).
  const out = read.motion ? [read.motion] : [];
  out.push(
    read.cuts.length === 0
      ? `${Math.round(seconds)} seconds, one continuous shot.`
      : `${Math.round(seconds)} seconds, cutting at ${read.cuts.map((c) => `${c}s`).join(", ")}.`,
  );
  for (const p of read.people) out.push(`Person ${p.tag}: ${[p.where, p.does].filter(Boolean).join(" — ")}`);
  return out;
}

function keepLines(keeps: RecastKeep[]): string[] {
  return keeps.map((k) => k.what);
}

/**
 * THE PERSON THE ENGINE HAS TO FIND (2026-09-23). A tag is ours, not the
 * picture's: "Person A" means nothing to a model looking at a courtyard with
 * forty schoolboys in it, and the take that failed was told to replace one.
 * The read gives a plain-words MARK for the people a take replaces — "the man
 * in the white shirt" — and the TASK leads with it.
 *
 * Read off the person structurally, so this file composes the same brief
 * whether or not the read lane's field has landed; and used ONLY for someone
 * being replaced. Everyone else in the clip is still only ever where they are
 * and what they do, which is the whole of recast-read.ts's rule about real
 * people in somebody's footage.
 */
function markFor(read: RecastRead | null, tag: string | null): string {
  if (!read || !tag) return "";
  const person: (RecastPerson & { mark?: unknown }) | undefined = read.people.find((p) => p.tag === tag);
  return typeof person?.mark === "string" ? cleanText(person.mark, RECAST_MARK_MAX_CHARS) : "";
}

/**
 * How the TASK names someone it replaces: their mark when the read gave one,
 * with their tag beside it so THE SOURCE's own "Person A: …" line still ties
 * to the same person, and the tag alone when it did not.
 */
function replacedAs(casting: RecastCasting, mark: string): string {
  if (!casting.tag) return "The performer";
  const tagged = casting.many ? `Person ${casting.tag}’s group` : `Person ${casting.tag}`;
  if (!mark) return casting.many ? `every single person in ${tagged}` : tagged;
  return casting.many ? `every single one of ${mark} (${tagged})` : `${mark} (${tagged})`;
}

/**
 * NOTHING SAID THE PERSON WAS GONE (2026-09-23). Asked to replace the man in
 * the white shirt, the engine put the character BESIDE him and left him in
 * the shot; asked to do a lead swap and a crowd swap at once, it grew a
 * second copy of the character where a student had stood. Neither is refused
 * anywhere in a brief that only ever says what to keep — so the TASK now says
 * the negative in as many words, on the same line as the order to replace.
 *
 * The head-count sentence is the world job's own, word for word: that job has
 * held "How many people are in the shot, and where each of them stands" since
 * it was written, and a wording that already works is worth more here than a
 * new one.
 */
function goneLine(input: { character: string; video: string; characters: number; places: number; short?: boolean }): string {
  // The two sides are counted separately, because they can differ either way:
  // ONE character cast over a whole group is one name and many places, and
  // several characters replacing one person each are many of both.
  const many = input.places > 1;
  const who = many ? "people" : "person";
  const replaces = input.characters > 1 ? "replace" : "replaces";
  const appears = many ? "appear" : "appears";
  const stands = input.characters > 1 ? "stand" : "stands";
  const where = many ? "their exact positions" : "their exact position";
  // Said without repeating who they are — the order to replace is the line
  // above, and these characters are dear at Kling's 2,500.
  const gone = `The ${who} ${input.character} ${replaces} ${appears} in no frame of ${input.video}; how many people are in the shot, and where each of them stands, never changes`;
  // Short (composeRecastBrief's second step, on a brief that will not
  // otherwise fit): the last clause goes, because "where each of them stands
  // never changes" is already the whole of it — the character can only be
  // standing where the person they replace stood. Everything the re-run
  // measured is still said; it is said once instead of twice.
  if (input.short) return `${gone}.`;
  return `${gone}; and ${input.character} ${stands} in ${where}, doing exactly what they did.`;
}

/**
 * THE DIRECTION ARRIVES WITH THE ORDER (2026-09-23). On the take that failed,
 * the person's words were 29 characters at position 1,933 of a 1,963-character
 * brief: the engine read the order to replace, the cast lines, the keep list
 * and nine "unless the direction changes it" clauses before it ever reached
 * what the person actually asked for — and it did neither the replacement nor
 * the wardrobe. Re-run with the direction stated inside the instruction, on
 * the same clip and the same window, it did both. So a scene brief opens with
 * the TASK and the person's own words together, and the rest of the brief —
 * who the character is, what the clip shows, what must not change — reads as
 * the conditions on an order the engine has already been given whole.
 *
 * SAID ONCE, NOT TWICE. Leaving a copy at the end as well was the obvious
 * safe move, and it does not fit: Kling O3 Edit takes 2,500 characters, the
 * heaviest take the door can send already gives way to fit ONE 600-character
 * direction (its ticked keeps go, then the read's account), and a second copy
 * would be paid for out of the read's own lines — who the cast replaces, the
 * window's cuts, the place by name — which a review pinned as never giving
 * way. What is shown is still what is sent: the door composes with this same
 * function, so "See the brief" shows the direction exactly where the engine
 * reads it. And with the direction no longer at the end, nothing that gives
 * way from the end can reach it by construction rather than by care.
 *
 * The keep lines that used to say "unless the direction below changes it" say
 * "unless the direction changes it" now: one word out, because "below" became
 * untrue the moment the block moved, and the block is headed DIRECTION either
 * way. Only the scene job moves — Restage, Photo to life and the restyle keep
 * the person's words last, where their own measured takes were sent with them.
 */
function taskBlock(task: string[], direction: string): string[] {
  return ["TASK", ...task, ...(direction ? ["", "DIRECTION", direction] : []), ""];
}

type BriefCommon = {
  job: RecastJob;
  /**
   * The engine the brief is sent to, whose own prompt limit it is composed
   * to fit (recast.ts promptMax). Absent: the tightest there is, 2,500.
   */
  engine?: RecastEngine;
  read: RecastRead | null;
  /** Who is cast: one character, several in one take (Into the clip and Restage), or nobody. */
  casting: RecastCasting | RecastCasting[] | null;
  /** The keeps still ticked on the door — a subset of the read's. */
  keeps: RecastKeep[];
  direction: string;
  /** A later piece of a long take (chain.ts): its first second is already finished and must be carried on from. */
  continuing?: boolean;
  /**
   * One part of a take rendered in parts — ANY part, the first included
   * (chain.ts). Such a take keeps its keep lines as they always were: see
   * "YOUR WORDS WIN" in composeUncut for why only a take of one piece lets
   * the person's direction change what the list keeps.
   */
  longTake?: boolean;
  /** The engine's names for the images the person added (recastImageTokens, or Restage's "Image n"). */
  images?: string[];
  /**
   * A later piece of a long take: the engine's name for the STILL at the
   * switch — the last finished frame, bound as a reference so the piece
   * carries the take's look and not the footage's (chain.ts ChainState.look).
   */
  look?: string;
};

type BriefInput = BriefCommon &
  (
    | {
        /**
         * THE STRETCH THIS BRIEF IS FOR, in seconds of the file — and `read`
         * is then the read of the WHOLE clip. The brief says the window's own
         * length and only the cuts inside it, on its own clock (trim.ts
         * cutsInWindow). The door and the action both compose this way, so
         * what "See the brief" shows is what is sent (2026-09-22: the door
         * had been composing from the whole clip's length and every cut in
         * it, while the take was sent the trimmed stretch's).
         */
        window: RecastWindow;
        seconds?: undefined;
      }
    | {
        /** Without a window: the length of what is sent, and `read` already describes just that. */
        seconds: number;
        window?: undefined;
      }
  );

/** The characters a brief casts, whichever shape they were given in. */
function castingsIn(casting: BriefCommon["casting"]): RecastCasting[] {
  return casting === null ? [] : Array.isArray(casting) ? casting : [casting];
}

/**
 * The brief a take is sent with. `direction` is the person's own words: on a
 * scene take they sit with the TASK, where the engine reads them beside the
 * order they qualify (taskBlock, 2026-09-23); on every other job they land
 * last, as the note on top of an order already given.
 *
 * EVERY WORD THEY WROTE REACHES THE TAKE (2026-09-22). Until today a brief
 * too long for its engine was cut from its END — where the direction stands
 * — and the copy actually sent was the recipe's, cut at 2,000 from the end
 * again: a 400-character direction beside three keeps, two images and a
 * four-person read lost 336 of its characters, on every single-piece take.
 * Now the brief is composed to fit its own engine (recast.ts promptMax), and
 * when it is too long OUR words give way, in this order:
 *
 *   1. the read's account of the other people — anyone not cast, the lead
 *      last of them (the video shows them anyway);
 *   2. our own KEEP wording, said again in its short form (the same
 *      promises in a third of the words);
 *   3. the read's account of what happens (the video shows it);
 *   4. the keeps the person ticked, the last ticked first.
 *
 * The read is never dropped whole (review, 2026-09-22): who the cast
 * replaces, the clip's length and cuts, and the place by name stay — a
 * brief that says "Replace Person A" must say who Person A is, and a
 * window with a cut in it is never called one continuous shot. Where the
 * read gave that person a mark, the TASK says who they are in plain words
 * too, and the source line is the tag's second home rather than its only one.
 *
 * Two things never give way. The person's direction (at most 600
 * characters) is never cut. And a later part's CONTINUITY wording is never
 * shortened: it is the wording every passing seam test was sent with, and a
 * shorter one is an untested change to something measured good. Should all
 * of that still leave it too long — no take the door can ask for gets there
 * (recast-brief.test.ts runs every shape) — whole lines of the keep list go
 * from its end, and never a line of the direction or the continuity.
 */
export function composeRecastBrief(input: BriefInput): string {
  const max = input.engine ? RECAST_ENGINES[input.engine].promptMax : RECAST_BRIEF_MAX_CHARS;
  const seconds = input.window ? input.window.end - input.window.start : input.seconds;
  let read =
    input.window && input.read ? { ...input.read, cuts: cutsInWindow(input.read.cuts, input.window) } : input.read;
  let keeps = input.keeps;
  let short = false;
  const cast = new Set(castingsIn(input.casting).map((c) => c.tag));
  for (;;) {
    const text = composeUncut({ ...input, seconds, read, keeps, short });
    if (Array.from(text).length <= max) return text;
    // 1. The people nobody is cast as: those after the lead first, then the lead.
    const spare = (read?.people ?? []).map((p, i) => ({ p, i })).filter(({ p }) => !cast.has(p.tag));
    const next = spare.filter(({ p }) => !p.lead).pop() ?? spare.pop();
    if (read && next) {
      read = { ...read, people: read.people.filter((_, i) => i !== next.i) };
      continue;
    }
    // 2. Our own keep wording, short.
    if (!short) {
      short = true;
      continue;
    }
    // 3. The account of what happens (the video shows it). The rest of the
    // read stays whatever happens: the cast people's lines, the length and
    // its cuts, and the place by name — dropping the read whole left
    // "Replace Person A" with nobody saying who Person A is, and called a
    // window with a cut in it one continuous shot (review, 2026-09-22).
    if (read?.motion) {
      read = { ...read, motion: "" };
      continue;
    }
    // 4. The keeps the person ticked, the last first.
    if (keeps.length > 0) {
      keeps = keeps.slice(0, -1);
      continue;
    }
    // 5. Only a take the door cannot send gets here (a four-character long
    // take is refused before composing): the cast people's own lines, the
    // lead last, then the read's remnants — everything before a word of the
    // person's direction.
    if (read && read.people.length > 0) {
      const last = read.people.map((p, i) => ({ p, i })).filter(({ p }) => !p.lead).pop() ?? { i: read.people.length - 1 };
      read = { ...read, people: read.people.filter((_, i) => i !== last.i) };
      continue;
    }
    if (read) {
      read = null;
      continue;
    }
    return dropKeepLines(text, max);
  }
}

/**
 * The last resort, and never reached by a take the door can send: whole
 * lines of the KEEP block go, from its end, until the brief fits — never a
 * line of the direction, and never one of the continuity, which stands
 * above the keeps. A brief with nothing left to drop is cut from its end.
 *
 * Either layout is safe. Where the direction stands below the keeps (Restage,
 * Photo to life, the restyle) the block ends where DIRECTION begins; where it
 * stands with the TASK (a scene take, taskBlock) the keep block runs to the
 * end of the brief and the search starts there, which is the same thing.
 *
 * The CLOSING line is not one of the lines that go (2026-09-23). It is the
 * last line of the block, so dropping from the end used to reach it first —
 * and it is the one line that says what the whole list covers and, since
 * today, what it does NOT: the person the TASK replaces. Every other line
 * promises something the TASK or THE CHARACTER promises again in its own
 * words; that one does not.
 */
function dropKeepLines(text: string, max: number): string {
  const lines = text.split("\n");
  const keepAt = lines.findIndex((l) => l.startsWith("KEEP"));
  const directionAt = lines.lastIndexOf("DIRECTION");
  const end = (directionAt > keepAt ? directionAt - 1 : lines.length) - 1;
  for (let drop = end - 1; keepAt >= 0 && drop > keepAt; drop--) {
    if (lines[drop] === "") continue;
    lines.splice(drop, 1);
    const fitted = lines.join("\n");
    if (Array.from(fitted).length <= max) return fitted;
  }
  return cleanBrief(lines.join("\n"), max);
}

function composeUncut(input: BriefCommon & { seconds: number; short?: boolean }): string {
  const direction = cleanText(input.direction, RECAST_DIRECTION_MAX_CHARS);
  const parts: string[] = [];

  // YOUR WORDS WIN OVER OUR OWN KEEP LIST (2026-09-22). The operator wrote
  // "start close on her face and pull out", "arms crossed", "dress her as
  // Cleopatra" — and the same brief told the engine to KEEP EXACTLY the
  // clip's camera, its performance and everything else, so our own list
  // overruled his words. On Into the clip, when the person wrote a
  // direction, every keep line now holds "unless the direction below
  // changes it", and the list closes on "everything the direction does not
  // change stays exactly as it is": what their words leave alone is still
  // kept. No reading of their words is needed or made — the condition is the
  // same whatever they wrote, and the engine judges what they mean.
  //
  // ONLY A TAKE OF ONE PIECE (up to 15 s). A long take's later parts are
  // handed the footage again and follow it wherever the keep lines stop
  // holding them: that is how two takes of the operator's crowd came back
  // as his students at the join (21175109, 825c6f53). Released there, a
  // "start close and pull out" could restart at the top of every part. So
  // every part of a long take — the first included — keeps today's lines
  // exactly, until a chained take is proven to hold a released one.
  const released = input.job === "scene" && direction !== "" && input.longTake !== true && input.continuing !== true;
  /** The TASK's own promise to keep the performance, held the same way. */
  const keepPerformance = released ? `Keep the performance exactly as it is, ${UNLESS}.` : "Keep the performance exactly as it is.";

  if (input.job === "world") {
    parts.push(
      "TASK",
      "Redraw the source video in a new look. Everyone in it keeps doing exactly what they do, on exactly the same frames.",
      "",
      "THE SOURCE",
      ...sourceLines(input.read, input.seconds),
    );
    if (input.read?.world) parts.push(`It is set in: ${input.read.world}`);
    parts.push("", "THE NEW LOOK", direction || "The same place, at night, under rain and neon.");
    parts.push(
      "",
      "KEEP EXACTLY",
      // Everything this engine was MEASURED to hold, and nothing it was not:
      // it does not keep a face (see recast.ts's note on the 2026-09-18
      // probe), so no line here asks it to.
      bullet("Every person's performance, gestures and timing, frame for frame."),
      bullet("The framing, the camera move and the cuts."),
      bullet("How many people are in the shot, and where each of them stands."),
      ...keepLines(input.keeps).map(bullet),
    );
    return cleanBrief(parts.join("\n"), Number.POSITIVE_INFINITY);
  }

  const castings = input.casting === null ? [] : Array.isArray(input.casting) ? input.casting : [input.casting];
  const casting = castings[0] ?? null;
  const name = casting?.characterName ?? "The character";

  // RESTAGE (2026-09-20). A different engine and a different promise: the clip
  // is a REFERENCE, so the camera and the staging are the person's to direct
  // and the clip's own performance is not kept. It names its references by
  // modality and order — "Video 1", "Image 1" — and the wording below is the
  // one that came back right first try on the operator's own clip: the place
  // and the cast said plainly, then his words last.
  if (input.job === "restage") {
    parts.push(
      "Video 1 is the scene to build on.",
      ...(input.read ? [...(input.read.motion ? [input.read.motion] : []), ...(input.read.world ? [`It is set in: ${input.read.world}`] : [])] : []),
      "",
      ...(castings.length > 0
        ? [
            "THE CAST",
            ...castings.map((c) =>
              bullet(
                `${c.characterName} is the person in ${c.token ?? "the reference images"} — their face, hair and build come from those pictures${
                  c.tag ? (c.many ? `, and they take the place of every person in Person ${c.tag}'s group` : `, and they take the place of Person ${c.tag}`) : ""
                }.`,
              ),
            ),
            // Several at once (2026-09-21): one video, and nobody borrows
            // another's face — the line Into the clip's shared takes carry.
            ...(castings.length > 1
              ? ["They all appear together in this one video, each exactly as their own pictures show — never with each other's face."]
              : []),
            "",
          ]
        : []),
      ...imageLines(input.images ?? []),
      "KEEP",
      bullet(`The place and the light of Video 1${input.read?.world ? `: ${input.read.world}` : ""}`),
      bullet("Everyone who is not named above, as they are in Video 1."),
      ...keepLines(input.keeps).map(bullet),
    );
    if (direction) parts.push("", "DIRECTION", direction);
    return cleanBrief(parts.join("\n"), Number.POSITIVE_INFINITY);
  }

  if (input.job === "motion") {
    // No character: the person's own image is the picture, and it need not
    // show a person at all.
    const who = casting
      ? `${name} — the person in the reference image. Their face, hair and build must stay the same in every frame.`
      : "Whoever or whatever the reference image shows. They must stay the same in every frame.";
    // THE ONE THE ENGINE ACTUALLY READS, and the one that was wrong until
    // 2026-09-18. Motion control builds the video OUT OF the reference
    // image — its person, its clothes, its background, its light — and takes
    // only the movement from the video. The scene brief below tells it to
    // keep the source video's setting and that "everything else stays
    // exactly as it is in the source video", which is the opposite of what
    // this engine does; sent here, it argues with the model for two
    // thousand characters. The scene job, whose brief that is, sends no
    // prompt at all, so the only brief we ever transmitted was the wrong one.
    parts.push(
      "TASK",
      "The person in the reference image performs the movements in the source video. The reference image is the world: the character, what they wear, the place around them and its light all come from it. Only the movement comes from the video.",
      "",
      "THE CHARACTER",
      who,
      "",
      "TAKE FROM THE VIDEO, AND NOTHING ELSE",
      bullet("The performance: every gesture, every step, every expression, on the same frames."),
      bullet("The timing, and the way the camera moves."),
      "",
      "THE MOVEMENT IN THE VIDEO",
      ...sourceLines(input.read, input.seconds),
    );
    if (direction) parts.push("", "DIRECTION", direction);
    return cleanBrief(parts.join("\n"), Number.POSITIVE_INFINITY);
  }

  const images = input.images ?? [];

  // NO CHARACTER (2026-09-19, "Do not lock it just on characters"): the
  // person's own words say what changes — with their images, or without —
  // and everything they do not change is kept, the performance first.
  if (!casting) {
    // Only ever sent to the one scene engine still offered, which reads names
    // (the retired ones take no prompt at all).
    const video = "@Video1";
    parts.push(
      ...taskBlock([`Change ${video} exactly as the direction below says, and nothing more. ${keepPerformance}`], direction),
      ...imageLines(images),
      "THE SOURCE",
      ...sourceLines(input.read, input.seconds),
      "",
      ...(input.continuing
        ? [
            "CONTINUITY",
            `The first second of ${video} is already finished: it shows exactly how everything must look — every person, their clothes and hair, and every change the direction asks for. Carry on from that second without any break, frame to frame, as if it were one continuous take.`,
            ...lookLines(input.look),
            "",
          ]
        : []),
      ...wordsKeepLines({ video, world: input.read?.world, keeps: input.keeps, short: input.short, released }),
    );
    return cleanBrief(parts.join("\n"), Number.POSITIVE_INFINITY);
  }

  // SEVERAL CHARACTERS IN ONE TAKE (2026-09-19, "Selecting two characters
  // still makes two videos separately"): each named by the engine's own name
  // for their photos, each given the person in the clip they play — or left
  // to the direction — and the same promises the single cast is given.
  if (castings.length > 1) {
    const video = "@Video1";
    const named = castings.map((c, i) => ({ ...c, token: c.token ?? `the character in reference ${i + 1}` }));
    const swaps = named.filter((c) => c.tag);
    const placed = named.filter((c) => !c.tag);
    const task: string[] = [];
    // Only the people actually being replaced are named by their mark, and
    // only here in the TASK (markFor): a character who is merely PUT into the
    // clip takes nobody's place, and nobody else in the footage is described
    // at all.
    const taken = swaps.map((c) => replacedAs(c, markFor(input.read, c.tag)));
    if (swaps.length > 0) {
      // A tag that covers MANY people is said as many: every one of them
      // becomes that character, which is what casting over a crowd means
      // (2026-09-20).
      task.push(
        `Replace ${swaps.map((c, i) => `${i === 0 ? "" : "and "}${taken[i]}${i === 0 ? ` in ${video}` : ""} with ${c.token}`).join(", ")}.`,
      );
    }
    if (placed.length > 0) task.push(`Put ${placed.map((c) => c.token).join(" and ")} into ${video} as the direction below says.`);
    task.push(`They all appear together in this one video. ${keepPerformance}`);
    parts.push(
      ...taskBlock(
        [
          task.join(" "),
          // Each swap is one person out and one in — said plainly, because
          // the take that grew a second character said nothing of the sort.
          ...(swaps.length > 0
            ? [
                goneLine({
                  character: swaps.map((c) => c.token).join(" and "),
                  video,
                  characters: swaps.length,
                  // A group counts as many places on its own, whoever else is cast.
                  places: swaps.some((c) => c.many) ? 2 : swaps.length,
                  short: input.short,
                }),
              ]
            : []),
        ],
        direction,
      ),
      "THE CHARACTERS",
      ...named.map((c) =>
        bullet(
          `${c.characterName} — ${c.token}. Their face, hair and build come from ${c.token.startsWith("@Element") ? "those photos" : "that image"}, and so do their clothes, from the first frame to the last, unless the direction says otherwise.`,
        ),
      ),
      `Each of them stays the same person from every side, including from behind: when they turn away or walk off, it is still their own hair and build we see, never the original performer's — and never each other's.`,
      "",
      ...imageLines(images),
      "THE SOURCE",
      ...sourceLines(input.read, input.seconds),
      "",
      ...(input.continuing
        ? [
            "CONTINUITY",
            `The first second of ${video} is already finished: it shows ${named.map((c) => c.token).join(" and ")} exactly as they must look — their clothes, their hair, their pose — and the people around them exactly as they must look. Carry on from that second without any break: the same clothes, the same hair, the same faces and hair on everyone, frame to frame, as if it were one continuous take.`,
            ...lookLines(input.look),
            "",
          ]
        : []),
      ...castKeepLines({ video, world: input.read?.world, keeps: input.keeps, short: input.short, released }),
    );
    return cleanBrief(parts.join("\n"), Number.POSITIVE_INFINITY);
  }

  // The read's mark for the one person this take replaces, where it has one:
  // "the man in the white shirt" tells the engine which of forty people to
  // take out, and "Person A" does not.
  const who = replacedAs(casting, markFor(input.read, casting.tag));
  // With names the engine reads (Kling O3 Edit: @Video1 for the clip, @Element1
  // or @Image1 for the character), the brief uses them; without, plain words.
  const token = casting.token;
  const video = token ? "@Video1" : "the source video";
  const character = token ?? "the character in the reference image";
  const photos = token === "@Element1" ? "those photos" : "the image";
  parts.push(
    ...taskBlock(
      [
        `Replace ${who} in ${video} with ${character}. ${keepPerformance}`,
        // Said only where someone is actually replaced: with no tag there is
        // no person to take out, and nothing to promise about the head count.
        ...(casting.tag ? [goneLine({ character, video, characters: 1, places: casting.many === true ? 2 : 1, short: input.short })] : []),
      ],
      direction,
    ),
    "THE CHARACTER",
    `${name} — ${token ? `${token}, ` : ""}the person in the reference ${token === "@Element1" ? "images" : "image"}. Their face, hair and build come from ${photos} and must stay the same in every frame.`,
    // THE CLOTHES (2026-09-19). The operator's first 30 s take: the brief
    // pinned face, hair and build to the photos but said nothing of clothes,
    // and ended "everything else stays exactly as it is" in the clip — so
    // part 1 dressed Eva in the performer's white shirt and part 2 in her own
    // black dress, and the outfit flipped at the join. Said once, for every
    // part; the direction can still dress them otherwise (an added image of
    // a coat, say).
    `So do their clothes: they wear what they wear in ${photos}, from the first frame to the last, unless the direction says otherwise.`,
    // THE LINE THAT MATTERS MOST (2026-09-19). The operator's take on Wan
    // lost his character the moment the performer turned his back: nothing
    // said what the back of the character's head looks like. Kling O3 Edit
    // held Eva through the same turn with this said in so many words.
    `They stay the same person from every side, including from behind: when they turn away or walk off, it is still their hair and their build we see, never the original performer's.`,
    "",
    ...imageLines(images),
    "THE SOURCE",
    ...sourceLines(input.read, input.seconds),
    "",
    // A LATER PIECE OF A LONG TAKE (chain.ts, 2026-09-19). Its input opens on
    // the last second of the piece before, already rendered. These are the
    // words every passing seam test was sent with: said this way, Kling
    // re-drew that second almost pixel for pixel and carried her clothes,
    // her hair and the boy beside her across.
    ...(input.continuing
      ? [
          "CONTINUITY",
          `The first second of ${video} is already finished: it shows ${character} exactly as they must look — their clothes, their hair, their pose — and the people around them exactly as they must look. Carry on from that second without any break: the same clothes, the same hair, the same faces and hair on everyone beside them, frame to frame, as if it were one continuous take.`,
          ...lookLines(input.look),
          "",
        ]
      : []),
    ...castKeepLines({ video, world: input.read?.world, keeps: input.keeps, short: input.short, released }),
  );
  return cleanBrief(parts.join("\n"), Number.POSITIVE_INFINITY);
}

/**
 * The condition a released keep line holds under (YOUR WORDS WIN,
 * composeUncut). It said "the direction below" until the direction moved up
 * to sit with the TASK (taskBlock): the block is headed DIRECTION wherever it
 * stands, so the word that stopped being true simply goes.
 */
const UNLESS = "unless the direction changes it";

/** One of the person's ticked keeps, held only until their own words change it. */
const heldUnless = (what: string) => `${what.replace(/[.\s]+$/, "")} — ${UNLESS}.`;

type KeepInput = {
  video: string;
  world: string | undefined;
  keeps: RecastKeep[];
  /** Half the words for the same promises (composeRecastBrief's third step). */
  short?: boolean;
  /** Every line held only until the direction changes it (YOUR WORDS WIN, composeUncut). */
  released?: boolean;
};

/**
 * THE LAST LINE THE ENGINE READS (2026-09-23). The list used to close on
 * "Everything else stays exactly as it is in @Video1" — and the person being
 * replaced is part of everything else. Read as the final word on a brief that
 * had already asked for a replacement, it says to keep him, which is exactly
 * what came back: the character beside the man rather than in his place. So
 * the catch-all now excludes whoever and whatever the TASK names — the person
 * going out and the character coming in — and covers the rest of the shot,
 * which is all it was ever meant to promise.
 *
 * It also does the work of the line that used to stand above the ticked
 * keeps, "Everyone in @Video1 who is not named above stays exactly as they
 * are" (2026-09-20), so that line is gone. Both promised the bystanders; this
 * one draws the boundary where the engine can see it. "Named above" covered
 * everything written earlier in the brief, THE SOURCE's own account of Person
 * C and Person D included — so the people most in need of the promise were
 * the ones it quietly let out, while the TASK names exactly the one person
 * who must NOT be kept. Saying it once also buys back the characters the
 * negative above costs, which matters at Kling's 2,500.
 */
function closingKeep(video: string, opts: { short?: boolean; released?: boolean }): string {
  if (opts.short) return bullet(`Everyone and everything the TASK does not name, as it is in ${video}.`);
  return bullet(`Everyone and everything the TASK does not name stays exactly as it is in ${video}${opts.released ? ` — ${UNLESS}` : ""}.`);
}

/**
 * What a take with someone cast in it keeps — one character or several.
 *
 * `short` is the same promises in half the words, said only when the brief
 * would not otherwise fit its engine (composeRecastBrief's third step): the
 * full wording is the one the passing takes were sent with.
 *
 * `released`: every line holds only until the person's direction changes it,
 * and the list closes on what their words leave alone (composeUncut).
 */
function castKeepLines(input: KeepInput): string[] {
  const { video, world } = input;
  if (input.released) {
    return [
      "KEEP",
      ...(input.short
        ? [
            bullet(`The performance, the camera, the cuts, the timing, the lighting${world ? "" : " and the setting"} — each ${UNLESS}.`),
            ...(world ? [bullet(`The place it happens in — ${UNLESS}: ${world}`)] : []),
          ]
        : [
            bullet(`The performance: every gesture, every step, every expression, on the same frames — ${UNLESS}.`),
            bullet(`The framing, the camera move, the cuts and the timing — ${UNLESS}.`),
            bullet(world ? `The place it happens in — ${UNLESS}: ${world}` : `The setting — ${UNLESS}.`),
            bullet(`The lighting — ${UNLESS}.`),
          ]),
      ...input.keeps.map((k) => bullet(heldUnless(k.what))),
      closingKeep(video, { released: true }),
    ];
  }
  if (input.short) {
    return [
      "KEEP EXACTLY",
      bullet(world ? "The performance, the camera, the cuts, the timing and the lighting." : "The performance, the camera, the cuts, the timing, the lighting and the setting."),
      ...(world ? [bullet(`The place it happens in, unchanged: ${world}`)] : []),
      ...keepLines(input.keeps).map(bullet),
      closingKeep(video, { short: true }),
    ];
  }
  return [
    "KEEP EXACTLY",
    bullet("The performance: every gesture, every step, every expression, on the same frames."),
    bullet("The framing, the camera move, the cuts and the timing."),
    // THE PLACE, BY NAME (2026-09-20). "The setting" in the abstract was
    // not enough: asked to turn a whole crowd into one character, the
    // engine decided the scene must be somewhere else and built an
    // Egyptian field where a school courtyard had been — in the FIRST
    // part, before any join. Naming what the read saw gives it something
    // concrete to keep.
    bullet(world ? `The place it happens in, unchanged: ${world}` : "The lighting and the setting."),
    bullet("The lighting."),
    // NOT "everyone else in the shot": when a cast character plays a GROUP,
    // that promise contradicts the task, and the engine settled the argument
    // by redrawing the whole picture (2026-09-20). The bystanders are promised
    // by the closing line now, which draws the same boundary where the engine
    // can check it — the TASK's own names (closingKeep, 2026-09-23).
    ...keepLines(input.keeps).map(bullet),
    closingKeep(video, {}),
  ];
}

/** What a take with nobody cast keeps: everything its words do not change. `short` and `released` as castKeepLines. */
function wordsKeepLines(input: KeepInput): string[] {
  const { video, world } = input;
  if (input.released) {
    return [
      "KEEP",
      ...(input.short
        ? [bullet(`The performance, the camera, the cuts and the timing — each ${UNLESS}.`)]
        : [
            bullet(`The performance: every gesture, every step, every expression, on the same frames — ${UNLESS}.`),
            bullet(`The framing, the camera move, the cuts and the timing — ${UNLESS}.`),
          ]),
      ...(world ? [bullet(`The place it happens in — ${UNLESS}: ${world}`)] : []),
      ...input.keeps.map((k) => bullet(heldUnless(k.what))),
      bullet(`Everything the direction does not change stays exactly as it is in ${video}.`),
    ];
  }
  return [
    "KEEP EXACTLY",
    ...(input.short
      ? [bullet("The performance, the camera, the cuts and the timing.")]
      : [
          bullet("The performance: every gesture, every step, every expression, on the same frames."),
          bullet("The framing, the camera move, the cuts and the timing."),
        ]),
    ...(world ? [bullet(`The place it happens in, unless the direction changes it: ${world}`)] : []),
    ...keepLines(input.keeps).map(bullet),
    bullet(`Everything the direction does not change stays exactly as it is in ${video}.`),
  ];
}
