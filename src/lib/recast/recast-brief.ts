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
// The engines that take no prompt (Wan's two) are given none; the brief is
// still composed and stored, because it is what the door shows and what a
// recipe carries.
//
// Relative imports only — the door composes the same text the server sends,
// so what is shown is what is charged for.

import { cleanText } from "../sets/set-spec";
import type { RecastJob } from "./recast";
import type { RecastKeep, RecastRead } from "./recast-read";

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

/** Kling takes 2500 characters and Luma 6000; one cap serves both. */
// Kling's own prompt limit (both its bodies cut at 2500, recast.ts). It was
// 2000 until the long take (2026-09-19): a later piece's continuity words run
// ~420 characters, and a brief is cut from its END — where the person's own
// direction stands.
export const RECAST_BRIEF_MAX_CHARS = 2500;
export const RECAST_DIRECTION_MAX_CHARS = 600;

export type RecastCasting = {
  /** The read's tag for the person being replaced ("A"), or null when there was no read. */
  tag: string | null;
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
export function recastImageTokens(characterToken: string | undefined, count: number): string[] {
  const first = characterToken === "@Image1" ? 2 : 1;
  return Array.from({ length: count }, (_, i) => `@Image${first + i}`);
}

const bullet = (s: string) => `- ${s}`;

/**
 * What each added image is called in the person's words ("image 1", as the
 * door labels it) against the engine's own name for it.
 */
function imageLines(tokens: string[]): string[] {
  if (tokens.length === 0) return [];
  return [
    "IMAGES",
    "Added by the person, to be used exactly as the direction below says:",
    ...tokens.map((token, i) => bullet(`${token} — "image ${i + 1}" in the direction.`)),
    "",
  ];
}

function sourceLines(read: RecastRead | null, seconds: number): string[] {
  if (!read) return [`One continuous clip of ${Math.round(seconds)} seconds.`];
  const out = [read.motion];
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

type BriefInput = {
  job: RecastJob;
  read: RecastRead | null;
  seconds: number;
  casting: RecastCasting | null;
  /** The keeps still ticked on the door — a subset of the read's. */
  keeps: RecastKeep[];
  direction: string;
  /** A later piece of a long take (chain.ts): its first second is already finished and must be carried on from. */
  continuing?: boolean;
  /** The engine's names for the images the person added (recastImageTokens) — Into the clip only. */
  images?: string[];
};

/**
 * The brief a take is sent with. `direction` is the person's own words and
 * always lands last, so it reads as the note on top of the order rather than
 * an argument with it.
 *
 * INSIDE THE ENGINE'S 2500 WITHOUT LOSING THEIR WORDS (2026-09-19). A brief
 * is cut from its END, where the direction stands — and a later piece of a
 * long take with the clothes line, three images, six keeps and a full
 * direction measured ~60 characters over. So when it is too long, the read's
 * account of the clip gives way first — the people after the lead, then the
 * account itself (the video shows all of it anyway) — and only then is
 * anything cut.
 */
export function composeRecastBrief(input: BriefInput): string {
  let read = input.read;
  for (;;) {
    const text = composeUncut({ ...input, read });
    if (Array.from(text).length <= RECAST_BRIEF_MAX_CHARS || read === null) return cleanBrief(text, RECAST_BRIEF_MAX_CHARS);
    read = read.people.length > 1 ? { ...read, people: read.people.slice(0, -1) } : null;
  }
}

function composeUncut(input: BriefInput): string {
  const direction = cleanText(input.direction, RECAST_DIRECTION_MAX_CHARS);
  const parts: string[] = [];

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

  const name = input.casting?.characterName ?? "The character";

  if (input.job === "motion") {
    // No character: the person's own image is the picture, and it need not
    // show a person at all.
    const who = input.casting
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
  if (!input.casting) {
    // Only ever sent to the one scene engine still offered, which reads names
    // (the retired ones take no prompt at all).
    const video = "@Video1";
    parts.push(
      "TASK",
      `Change ${video} exactly as the direction below says, and nothing more. Keep the performance exactly as it is.`,
      "",
      ...imageLines(images),
      "THE SOURCE",
      ...sourceLines(input.read, input.seconds),
      "",
      ...(input.continuing
        ? [
            "CONTINUITY",
            `The first second of ${video} is already finished: it shows exactly how everything must look — every person, their clothes and hair, and every change the direction asks for. Carry on from that second without any break, frame to frame, as if it were one continuous take.`,
            "",
          ]
        : []),
      "KEEP EXACTLY",
      bullet("The performance: every gesture, every step, every expression, on the same frames."),
      bullet("The framing, the camera move, the cuts and the timing."),
      ...keepLines(input.keeps).map(bullet),
      bullet(`Everything the direction does not change stays exactly as it is in ${video}.`),
    );
    if (direction) parts.push("", "DIRECTION", direction);
    return cleanBrief(parts.join("\n"), Number.POSITIVE_INFINITY);
  }

  const who = input.casting.tag ? `Person ${input.casting.tag}` : "The performer";
  // With names the engine reads (Kling O3 Edit: @Video1 for the clip, @Element1
  // or @Image1 for the character), the brief uses them; without, plain words.
  const token = input.casting.token;
  const video = token ? "@Video1" : "the source video";
  const character = token ?? "the character in the reference image";
  const photos = token === "@Element1" ? "those photos" : "the image";
  parts.push(
    "TASK",
    `Replace ${who} in ${video} with ${character}. Keep the performance exactly as it is.`,
    "",
    "THE CHARACTER",
    `${name} — ${token ? `${token}, ` : ""}the person in the reference ${token === "@Element1" ? "images" : "image"}. Their face, hair and build come from ${photos} and must stay the same in every frame.`,
    // THE CLOTHES (2026-09-19). The operator's first 30 s take: the brief
    // pinned face, hair and build to the photos but said nothing of clothes,
    // and ended "everything else stays exactly as it is" in the clip — so
    // part 1 dressed Eva in the performer's white shirt and part 2 in her own
    // black dress, and the outfit flipped at the join. Said once, for every
    // part; the direction can still dress them otherwise (an added image of
    // a coat, say).
    `So do their clothes: they wear what they wear in ${photos}, from the first frame to the last, unless the direction below says otherwise.`,
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
          "",
        ]
      : []),
    "KEEP EXACTLY",
    bullet("The performance: every gesture, every step, every expression, on the same frames."),
    bullet("The framing, the camera move, the cuts and the timing."),
    bullet("The lighting, the setting and everyone else in the shot."),
    ...keepLines(input.keeps).map(bullet),
    bullet(`Everything else stays exactly as it is in ${video}.`),
  );
  if (direction) parts.push("", "DIRECTION", direction);
  return cleanBrief(parts.join("\n"), Number.POSITIVE_INFINITY);
}
