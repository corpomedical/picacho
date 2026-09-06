// Which three takes go in the dashboard highlight reel, and where each one is cut.
//
// Its own alias-free module so it can be unit-tested (same reasoning as
// refund-rules.ts) — the caller pulls in Supabase and the whole media chain.
//
// The operator's brief (2026-09-07): "the website takes best scoring videos
// generated, 3 at max. Making a one video with 3 to 5 seconds of footage from
// each", off "most used character with highest identity score".
//
// So the ranking is deliberately the operator's sentence and nothing more:
// most-worked character first, identity score only as the tie-break. An
// earlier draft weighted takes BY score (takes x mean/100), which reads well
// but needs an invented fallback constant for characters with no scored
// render — a number nobody could defend in a review. Take count is a fact;
// the tie-break is a fact; neither is a guess.

/** One generations row, narrowed to what the reel actually needs. */
export type ReelRow = {
  id: string;
  result_url: string | null;
  poster_url: string | null;
  content_type: string | null;
  status: string | null;
  character_profile_id: string | null;
  match_score: number | null;
  created_at: string | null;
  video_duration_seconds: number | null;
  video_aspect_ratio: string | null;
  prompt_input: string | null;
  angle_group_id: string | null;
  angle: string | null;
};

export type ReelClip = {
  generationId: string;
  /** Storage key, straight off the row — never a URL built here. */
  resultUrl: string;
  posterUrl: string | null;
  matchScore: number | null;
  /**
   * What the band calls this cut while it plays. The user's own line, not a
   * generated description — a reel that names its cuts in the words the person
   * typed reads like their edit rather than our summary of it.
   */
  label: string | null;
  /** Seconds into the source where this segment starts. */
  startSeconds: number;
  /** How long this segment runs. */
  durationSeconds: number;
};

export type ReelSelection = {
  characterProfileId: string;
  clips: ReelClip[];
  /** Take count for the winning character, over the window that was passed in. */
  takes: number;
  /** Mean match_score over that character's SCORED rows, or null if none. */
  meanIdentity: number | null;
};

/** Max clips in one reel — the operator's "3 at max". */
export const MAX_REEL_CLIPS = 3;

/**
 * Seconds taken from each take. The brief says 3-5; 3 is the default because
 * the reel's whole point is to be cheap, and segment length is the only knob
 * that scales the file size linearly. Measured on real footage at 640x360 /
 * 24fps / crf31: 3s x 3 takes = 322 KB, 5s x 3 takes = 617 KB.
 */
export const SEGMENT_SECONDS = 3;

/**
 * How far into a take the segment starts.
 *
 * The opening frames of a generated video are the least settled — the first
 * beat is often the model resolving the scene — and four of seven video lanes
 * pass the identity photo in AS frame one, so a segment starting at 0 can open
 * on the reference photograph rather than on the render. One second in is past
 * both.
 */
export const SEGMENT_LEAD_IN = 1;

/** Assumed length when video_duration_seconds is null (older rows). */
const ASSUMED_DURATION = 5;

/**
 * How many SCORED cuts a reel needs before it is worth showing at all.
 *
 * Operator, 2026-09-07, on seeing the first four real reels: drop the thin
 * ones. A single-cut "reel" has no assembly to show — the segmented bar does
 * not even render — and an unscored one has nothing behind the identity meter
 * or the score chips, so the band makes a claim it cannot back. Below this bar
 * the dashboard shows the example edit instead, which is honest about being
 * ours rather than a thin thing pretending to be theirs.
 *
 * The cost of the bar is real and worth stating: a user with genuine video
 * takes that predate scoring gets no reel of their own. That is the trade the
 * bar buys — nothing is shown until there is something to show.
 */
export const MIN_SCORED_CUTS = 2;

/**
 * The prompt, trimmed to something that fits one line over the video.
 * Cuts on a word boundary rather than mid-word, and gives up (returns null)
 * rather than showing a stub, because an empty slug is better than a truncated
 * one that reads like a bug.
 */
function shortLabel(prompt: string | null): string | null {
  const clean = (prompt ?? "").replace(/\s+/g, " ").trim();
  if (clean.length < 3) return null;
  if (clean.length <= 42) return clean;
  const cut = clean.slice(0, 42);
  const lastSpace = cut.lastIndexOf(" ");
  const kept = (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim();
  // Drop trailing sentence punctuation before the ellipsis: a prompt that
  // happens to end a sentence inside the first 42 characters otherwise reads
  // "A 15-second cinematic drama trailer.…", which looks like a bug.
  return `${kept.replace(/[.,;:!?—–-]+$/, "")}…`;
}

function isUsableVideo(row: ReelRow): boolean {
  return (
    row.content_type === "video" &&
    row.status === "succeeded" &&
    typeof row.result_url === "string" &&
    row.result_url.length > 0
  );
}

/**
 * Collapse a multi-angle request to one take.
 *
 * A multi-angle send writes one row per camera angle sharing an
 * angle_group_id, so a raw count rewards whoever used multi-angle — one user
 * action becomes N rows, and the reel would happily show three angles of the
 * same moment. Prefer the "front" member as representative, which is what
 * videos/page.tsx already does in TypeScript.
 */
function collapseAngles(rows: ReelRow[]): ReelRow[] {
  const groups = new Map<string, ReelRow[]>();
  for (const row of rows) {
    const key = row.angle_group_id ?? row.id;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  const out: ReelRow[] = [];
  for (const members of groups.values()) {
    const front = members.find((m) => m.angle === "front");
    out.push(front ?? members[0]);
  }
  return out;
}

function newest(a: ReelRow, b: ReelRow): number {
  return (b.created_at ?? "").localeCompare(a.created_at ?? "");
}

function meanScore(rows: ReelRow[]): number | null {
  const scored = rows.filter((r) => typeof r.match_score === "number");
  if (scored.length === 0) return null;
  const sum = scored.reduce((acc, r) => acc + (r.match_score as number), 0);
  return Math.round(sum / scored.length);
}

/**
 * Where to cut a segment out of one take.
 *
 * Clamped so a short take never asks for frames past its end: a 3-second
 * source cannot give a 3-second segment starting one second in, and ffmpeg
 * would silently return a shorter piece, desynchronising the reel's declared
 * length from its real one.
 */
export function segmentWindow(
  durationSeconds: number | null,
  segment: number = SEGMENT_SECONDS,
): { startSeconds: number; durationSeconds: number } {
  const total = typeof durationSeconds === "number" && durationSeconds > 0
    ? durationSeconds
    : ASSUMED_DURATION;
  const take = Math.min(segment, total);
  const start = Math.max(0, Math.min(SEGMENT_LEAD_IN, total - take));
  return { startSeconds: start, durationSeconds: take };
}

/**
 * Pick the character and the clips.
 *
 * Returns null when there is nothing worth cutting — no character has a usable
 * video take. The caller must treat that as "no reel", not as an error: a new
 * account legitimately has none, and the dashboard has to render anyway.
 *
 * Deliberately NOT handled here, and documented rather than hidden:
 *   - Companion characters. character_profile_ids is populated only on
 *     multi-character sends, so grouping by the scalar attributes a
 *     multi-character render to the lead alone.
 *   - Layer edits. They are identity-scored but reserve with
 *     character_profile_id null, so they never reach this function.
 *   - Deleted characters. The FK is ON DELETE SET NULL, so a deleted-and-
 *     recreated character starts from zero with no trace.
 */
export function selectReel(rows: ReelRow[], maxClips: number = MAX_REEL_CLIPS): ReelSelection | null {
  const usable = collapseAngles(rows.filter(isUsableVideo));

  const byCharacter = new Map<string, ReelRow[]>();
  for (const row of usable) {
    if (!row.character_profile_id) continue;
    const bucket = byCharacter.get(row.character_profile_id);
    if (bucket) bucket.push(row);
    else byCharacter.set(row.character_profile_id, [row]);
  }
  if (byCharacter.size === 0) return null;

  // Most-worked first; identity score only breaks a tie; then recency, then
  // id, so the winner is stable across renders and the reel does not reshuffle
  // itself between two page loads.
  const ranked = [...byCharacter.entries()].sort((a, b) => {
    const takeDiff = b[1].length - a[1].length;
    if (takeDiff !== 0) return takeDiff;
    const scoreDiff = (meanScore(b[1]) ?? -1) - (meanScore(a[1]) ?? -1);
    if (scoreDiff !== 0) return scoreDiff;
    const recency = newest(a[1][0], b[1][0]);
    if (recency !== 0) return recency;
    return a[0].localeCompare(b[0]);
  });

  const [characterProfileId, characterRows] = ranked[0];

  // Best-scoring takes lead, so the reel opens on the strongest frame it has.
  // An unscored row sorts last but is still eligible — a user whose renders
  // predate scoring should still get a reel.
  const clips = [...characterRows]
    .sort((a, b) => {
      const diff = (b.match_score ?? -1) - (a.match_score ?? -1);
      if (diff !== 0) return diff;
      const recency = newest(a, b);
      if (recency !== 0) return recency;
      return a.id.localeCompare(b.id);
    })
    .slice(0, maxClips)
    .map((row) => ({
      generationId: row.id,
      resultUrl: row.result_url as string,
      posterUrl: row.poster_url,
      matchScore: row.match_score,
      label: shortLabel(row.prompt_input),
      ...segmentWindow(row.video_duration_seconds),
    }));

  // The quality bar. Counted on the CUTS that would actually appear, not on
  // the character's whole history: a character with fifty scored takes still
  // fails if the three that made this reel are unscored.
  const scoredCuts = clips.filter((c) => typeof c.matchScore === "number").length;
  if (scoredCuts < MIN_SCORED_CUTS) return null;

  return {
    characterProfileId,
    clips,
    takes: characterRows.length,
    meanIdentity: meanScore(characterRows),
  };
}
