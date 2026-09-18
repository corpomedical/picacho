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
export const RECAST_BRIEF_MAX_CHARS = 2000;
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

const bullet = (s: string) => `- ${s}`;

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

/**
 * The brief a take is sent with. `direction` is the person's own words and
 * always lands last, so it reads as the note on top of the order rather than
 * an argument with it.
 */
export function composeRecastBrief(input: {
  job: RecastJob;
  read: RecastRead | null;
  seconds: number;
  casting: RecastCasting | null;
  /** The keeps still ticked on the door — a subset of the read's. */
  keeps: RecastKeep[];
  direction: string;
}): string {
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
    return cleanBrief(parts.join("\n"), RECAST_BRIEF_MAX_CHARS);
  }

  const name = input.casting?.characterName ?? "The character";

  if (input.job === "motion") {
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
      `${name} — the person in the reference image. Their face, hair and build must stay the same in every frame.`,
      "",
      "TAKE FROM THE VIDEO, AND NOTHING ELSE",
      bullet("The performance: every gesture, every step, every expression, on the same frames."),
      bullet("The timing, and the way the camera moves."),
      "",
      "THE MOVEMENT IN THE VIDEO",
      ...sourceLines(input.read, input.seconds),
    );
    if (direction) parts.push("", "DIRECTION", direction);
    return cleanBrief(parts.join("\n"), RECAST_BRIEF_MAX_CHARS);
  }

  const who = input.casting?.tag ? `Person ${input.casting.tag}` : "The performer";
  // With names the engine reads (Kling O3 Edit: @Video1 for the clip, @Element1
  // or @Image1 for the character), the brief uses them; without, plain words.
  const token = input.casting?.token;
  const video = token ? "@Video1" : "the source video";
  const character = token ?? "the character in the reference image";
  parts.push(
    "TASK",
    `Replace ${who} in ${video} with ${character}. Keep the performance exactly as it is.`,
    "",
    "THE CHARACTER",
    `${name} — ${token ? `${token}, ` : ""}the person in the reference ${token === "@Element1" ? "images" : "image"}. Their face, hair and build come from ${token === "@Element1" ? "those photos" : "the image"} and must stay the same in every frame.`,
    // THE LINE THAT MATTERS MOST (2026-09-19). The operator's take on Wan
    // lost his character the moment the performer turned his back: nothing
    // said what the back of the character's head looks like. Kling O3 Edit
    // held Eva through the same turn with this said in so many words.
    `They stay the same person from every side, including from behind: when they turn away or walk off, it is still their hair and their build we see, never the original performer's.`,
    "",
    "THE SOURCE",
    ...sourceLines(input.read, input.seconds),
    "",
    "KEEP EXACTLY",
    bullet("The performance: every gesture, every step, every expression, on the same frames."),
    bullet("The framing, the camera move, the cuts and the timing."),
    bullet("The lighting, the setting and everyone else in the shot."),
    ...keepLines(input.keeps).map(bullet),
    bullet(`Everything else stays exactly as it is in ${video}.`),
  );
  if (direction) parts.push("", "DIRECTION", direction);
  return cleanBrief(parts.join("\n"), RECAST_BRIEF_MAX_CHARS);
}
