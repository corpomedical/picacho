// Where the words land once the footage is cut.
//
// The transcript is timed in SOURCE seconds, per clip. The finished video is
// timed in OUTPUT seconds. Everything a viewer reads or hears — captions, the
// read-back the director checks its own cut against, whether a cut clips a
// word in half — is a question about the mapping between the two, so it is
// answered once, here, in plain code.

import { round3, type EditPlan, type Shot } from "./plan";

export type Word = { text: string; start: number; end: number };

/** Per clip, in clip order. A clip without speech has an empty list. */
export type Transcripts = Word[][];

/** A word as the viewer meets it: output time, and the shot it belongs to. */
export type PlacedWord = Word & { shot: number };

/** Where each shot starts in the finished video. */
export function shotStarts(shots: Pick<Shot, "from" | "to">[]): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const s of shots) {
    starts.push(round3(at));
    at += s.to - s.from;
  }
  return starts;
}

/**
 * Move each cut point that falls INSIDE a spoken word to that word's nearer
 * edge, so no shot opens on the back half of a syllable or closes on the
 * front half. Cuts in silence are left exactly where the director put them.
 * A shot that would shrink below `minSeconds` keeps its original points.
 */
export function snapShotsToWords(shots: Shot[], transcripts: Transcripts, minSeconds = 0.4): Shot[] {
  return shots.map((shot) => {
    const words = transcripts[shot.clip] ?? [];
    const from = snapPoint(shot.from, words, "in");
    const to = snapPoint(shot.to, words, "out");
    if (to - from < minSeconds) return shot;
    return { ...shot, from: round3(from), to: round3(to) };
  });
}

// Handles, in seconds: breathing room kept either side of a word a cut was
// moved to, so the consonant is not shaved. Small enough not to reveal the
// next word.
const LEAD = 0.04;
const TAIL = 0.08;

function snapPoint(t: number, words: Word[], side: "in" | "out"): number {
  const w = words.find((word) => word.start < t && t < word.end);
  if (!w) return t;
  const toStart = t - w.start;
  const toEnd = w.end - t;
  if (side === "in") {
    // Opening a shot: keep the word if most of it would survive, else skip it.
    return toStart <= toEnd ? Math.max(0, w.start - LEAD) : w.end;
  }
  // Closing a shot: finish the word if most of it was said, else stop before it.
  return toEnd <= toStart ? w.end + TAIL : w.start;
}

/** Every word that is heard in the edit, in output time. Words cut across a shot edge are dropped. */
export function placeWords(plan: Pick<EditPlan, "shots">, transcripts: Transcripts): PlacedWord[] {
  const starts = shotStarts(plan.shots);
  const out: PlacedWord[] = [];
  plan.shots.forEach((shot, i) => {
    if (shot.volume <= 0.05) return;
    for (const w of transcripts[shot.clip] ?? []) {
      if (w.start < shot.from - 0.01 || w.end > shot.to + 0.01) continue;
      out.push({
        text: w.text,
        start: round3(starts[i] + (w.start - shot.from)),
        end: round3(starts[i] + (Math.min(w.end, shot.to) - shot.from)),
        shot: i,
      });
    }
  });
  return out;
}

/**
 * What the viewer hears, shot by shot — the director reads this back to check
 * its own cut (a sentence left dangling, a retake kept twice, a joke without
 * its punchline). Plain text, one line per shot.
 */
export function readBack(plan: Pick<EditPlan, "shots">, transcripts: Transcripts): string {
  const starts = shotStarts(plan.shots);
  const words = placeWords(plan, transcripts);
  return plan.shots
    .map((shot, i) => {
      const said = words.filter((w) => w.shot === i).map((w) => w.text.trim()).join(" ");
      const len = shot.to - shot.from;
      return `#${i + 1} @${starts[i].toFixed(2)}s clip ${shot.clip} ${shot.from.toFixed(2)}–${shot.to.toFixed(2)} (${len.toFixed(2)}s): ${said || "(no speech)"}`;
    })
    .join("\n");
}

export type CaptionLine = { start: number; end: number; words: PlacedWord[] };

/** How many characters past maxChars a line may run to keep its last word. */
const ORPHAN_ALLOWANCE = 10;

/**
 * Group heard words into caption lines a viewer can read: a new line at a
 * shot change, at a pause, or when the line gets too long. Each line stays up
 * a moment after its last word unless the next one needs the space.
 */
export function captionLines(words: PlacedWord[], opts: { maxChars: number; maxGap?: number; hold?: number }): CaptionLine[] {
  const maxGap = opts.maxGap ?? 0.6;
  const hold = opts.hold ?? 0.25;
  const lines: CaptionLine[] = [];
  let current: PlacedWord[] = [];
  const flush = () => {
    if (current.length === 0) return;
    lines.push({ start: current[0].start, end: current[current.length - 1].end, words: current });
    current = [];
  };
  // Would this word end its phrase (nothing after it in the same shot and breath)?
  const endsPhrase = (i: number) => {
    const next = words[i + 1];
    return !next || next.shot !== words[i].shot || next.start - words[i].end > maxGap;
  };
  words.forEach((w, i) => {
    const prev = current[current.length - 1];
    const chars = current.reduce((n, x) => n + x.text.trim().length + 1, 0) + w.text.trim().length;
    // A line may run a little long rather than leave one word alone on the
    // next (first paid proof, 2026-09-24: "MAKE THE IMPOSSIBLE" / "REAL").
    const tooLong = chars > opts.maxChars && !(endsPhrase(i) && chars <= opts.maxChars + ORPHAN_ALLOWANCE);
    if (prev && (prev.shot !== w.shot || w.start - prev.end > maxGap || tooLong)) flush();
    current.push(w);
  });
  flush();
  for (let i = 0; i < lines.length; i++) {
    const next = lines[i + 1];
    const extended = lines[i].end + hold;
    lines[i].end = round3(next ? Math.min(extended, next.start) : extended);
  }
  return lines;
}
