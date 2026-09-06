import { describe, expect, it } from "vitest";
import {
  MAX_REEL_CLIPS,
  MIN_SCORED_CUTS,
  SEGMENT_SECONDS,
  segmentWindow,
  selectReel,
  type ReelRow,
} from "./reel-select";

// The dashboard highlight reel's selection (2026-09-07, operator: "the website
// takes best scoring videos generated, 3 at max").
//
// What this file exists to catch: a future edit that lets the reel show three
// angles of one moment, that squashes the ranking into a weighted score with an
// invented constant, or that asks ffmpeg for frames a short take does not have.

let seq = 0;
function row(over: Partial<ReelRow> = {}): ReelRow {
  seq += 1;
  return {
    id: `g${seq}`,
    result_url: `user/${seq}.mp4`,
    poster_url: `user/${seq}.jpg`,
    content_type: "video",
    status: "succeeded",
    character_profile_id: "eva",
    match_score: 80,
    created_at: `2026-09-0${(seq % 9) + 1}T00:00:00Z`,
    video_duration_seconds: 10,
    video_aspect_ratio: "16:9",
    prompt_input: "Eva on a snowy ridge, looking up",
    angle_group_id: null,
    angle: null,
    ...over,
  };
}

describe("picking the character", () => {
  it("takes the most-worked one, not the best-scoring one", () => {
    // Adam scores higher on every render; Eva has been worked more. The
    // operator's sentence is "most used character with highest identity
    // score" — take count leads, score only breaks ties.
    const rows = [
      row({ character_profile_id: "eva", match_score: 70 }),
      row({ character_profile_id: "eva", match_score: 70 }),
      row({ character_profile_id: "eva", match_score: 70 }),
      row({ character_profile_id: "adam", match_score: 99 }),
      row({ character_profile_id: "adam", match_score: 99 }),
    ];
    expect(selectReel(rows)?.characterProfileId).toBe("eva");
  });

  it("uses identity score only to break a tie on take count", () => {
    const rows = [
      row({ character_profile_id: "eva", match_score: 60 }),
      row({ character_profile_id: "eva", match_score: 60 }),
      row({ character_profile_id: "adam", match_score: 95 }),
      row({ character_profile_id: "adam", match_score: 95 }),
    ];
    expect(selectReel(rows)?.characterProfileId).toBe("adam");
  });

  // Reversed on 2026-09-07, deliberately, and worth stating as a cost rather
  // than hiding: a character whose renders all predate scoring USED to get a
  // reel. It no longer does, because the band's meter and score chips would
  // have nothing behind them. Those users see the example edit instead.
  it("gives no reel to a character whose renders all predate scoring", () => {
    const rows = [
      row({ character_profile_id: "eva", match_score: null }),
      row({ character_profile_id: "eva", match_score: null }),
    ];
    expect(selectReel(rows)).toBeNull();
  });

  it("still reports the mean over the character's scored rows when it qualifies", () => {
    const rows = [
      row({ character_profile_id: "eva", match_score: 90 }),
      row({ character_profile_id: "eva", match_score: 70 }),
      row({ character_profile_id: "eva", match_score: null }),
    ];
    const picked = selectReel(rows);
    expect(picked?.characterProfileId).toBe("eva");
    expect(picked?.meanIdentity).toBe(80);
    expect(picked?.takes).toBe(3);
  });

  it("returns null rather than throwing when there is nothing to cut", () => {
    // A new account is the common case here, not an error.
    expect(selectReel([])).toBeNull();
    expect(selectReel([row({ content_type: "image" })])).toBeNull();
    expect(selectReel([row({ character_profile_id: null })])).toBeNull();
  });
});

describe("which rows are eligible at all", () => {
  it("ignores stills, unfinished renders and rows with no file", () => {
    const rows = [
      row({ content_type: "image" }),
      row({ status: "failed" }),
      row({ result_url: null }),
      row({ result_url: "" }),
    ];
    expect(selectReel(rows)).toBeNull();
  });

  // A multi-angle send writes one row per camera angle sharing an
  // angle_group_id. Counting them raw both inflates the take count and lets
  // the reel play three angles of the same moment.
  it("collapses a multi-angle group to one take, preferring the front angle", () => {
    const rows = [
      row({ id: "a-left", angle_group_id: "grp", angle: "left", match_score: 90 }),
      row({ id: "a-front", angle_group_id: "grp", angle: "front", match_score: 90 }),
      row({ id: "a-right", angle_group_id: "grp", angle: "right", match_score: 90 }),
      row({ id: "solo-1", match_score: 70 }),
      row({ id: "solo-2", match_score: 60 }),
    ];
    const picked = selectReel(rows);
    // Three angle rows count as ONE take, so the character has three.
    expect(picked?.takes).toBe(3);
    const ids = picked?.clips.map((c) => c.generationId) ?? [];
    expect(ids).toContain("a-front");
    expect(ids).not.toContain("a-left");
    expect(ids).not.toContain("a-right");
  });

  it("does not let a multi-angle group outrank a genuinely busier character", () => {
    const rows = [
      row({ character_profile_id: "adam", angle_group_id: "g", angle: "left" }),
      row({ character_profile_id: "adam", angle_group_id: "g", angle: "front" }),
      row({ character_profile_id: "adam", angle_group_id: "g", angle: "right" }),
      row({ character_profile_id: "eva" }),
      row({ character_profile_id: "eva" }),
    ];
    expect(selectReel(rows)?.characterProfileId).toBe("eva");
  });
});

describe("choosing the clips", () => {
  it("caps at three and opens on the best-scoring take", () => {
    const rows = [
      row({ id: "low", match_score: 60 }),
      row({ id: "best", match_score: 96 }),
      row({ id: "mid", match_score: 88 }),
      row({ id: "worst", match_score: 12 }),
    ];
    const picked = selectReel(rows);
    expect(picked?.clips).toHaveLength(MAX_REEL_CLIPS);
    expect(picked?.clips.map((c) => c.generationId)).toEqual(["best", "mid", "low"]);
  });

  it("sorts unscored takes last but still uses them", () => {
    // Two scored cuts clear the bar; the unscored one rides along at the end
    // rather than being dropped.
    const rows = [
      row({ id: "unscored", match_score: null }),
      row({ id: "high", match_score: 90 }),
      row({ id: "low", match_score: 50 }),
    ];
    expect(selectReel(rows)?.clips.map((c) => c.generationId)).toEqual([
      "high",
      "low",
      "unscored",
    ]);
  });

  it("is stable — the same rows in a different order pick the same reel", () => {
    const rows = [row({ id: "a" }), row({ id: "b" }), row({ id: "c" }), row({ id: "d" })];
    const forward = selectReel(rows)?.clips.map((c) => c.generationId);
    const backward = selectReel([...rows].reverse())?.clips.map((c) => c.generationId);
    expect(forward).toEqual(backward);
  });
});

// The band names each cut in the person's own words while it plays, so the
// label has to survive a long prompt without reading like a bug.
describe("what the band calls each cut", () => {
  it("uses the prompt as typed when it already fits", () => {
    const picked = selectReel([
      row({ prompt_input: "Eva on a snowy ridge", match_score: 95 }),
      row({ match_score: 50 }),
    ]);
    expect(picked?.clips[0].label).toBe("Eva on a snowy ridge");
  });

  it("collapses whitespace so a pasted prompt does not break the line", () => {
    const picked = selectReel([
      row({ prompt_input: "  Eva\n\n  on   a ridge  ", match_score: 95 }),
      row({ match_score: 50 }),
    ]);
    expect(picked?.clips[0].label).toBe("Eva on a ridge");
  });

  it("trims a long prompt on a word boundary, never mid-word", () => {
    const long = "Eva standing on a snowy ridge at golden hour looking upward";
    const label =
      selectReel([row({ prompt_input: long, match_score: 95 }), row({ match_score: 50 })])
        ?.clips[0].label ?? "";
    expect(label.length).toBeLessThanOrEqual(43);
    expect(label.endsWith("…")).toBe(true);
    // The visible part must be whole words from the original.
    expect(long.startsWith(label.slice(0, -1))).toBe(true);
    expect(label).not.toMatch(/\s…$/);
  });

  it("does not strand punctuation in front of the ellipsis", () => {
    // Real prompts open with a full sentence ("A 15-second cinematic drama
    // trailer. Eva walks..."), and the trim can land right after the stop.
    const label =
      selectReel([
        row({ prompt_input: "A 15-second cinematic drama trailer. Eva walks in", match_score: 95 }),
        row({ match_score: 50 }),
      ])?.clips[0].label ?? "";
    expect(label.endsWith("…")).toBe(true);
    expect(label).not.toMatch(/[.,;:!?-]…$/);
  });

  it("gives up rather than showing a stub", () => {
    const pair = (p: string | null) => [row({ prompt_input: p, match_score: 95 }), row({ match_score: 50 })];
    expect(selectReel(pair(null))?.clips[0].label).toBeNull();
    expect(selectReel(pair("  "))?.clips[0].label).toBeNull();
  });
});

// The quality bar (2026-09-07, operator: drop the thin reels). Below it the
// dashboard shows the example edit instead, which is honest about being ours.
describe("the bar a reel has to clear to be shown at all", () => {
  it("refuses a single-cut reel, which has no assembly to show", () => {
    expect(selectReel([row({ match_score: 99 })])).toBeNull();
  });

  it("refuses a reel whose cuts are all unscored", () => {
    // The band's meter and score chips would have nothing behind them.
    const rows = [row({ match_score: null }), row({ match_score: null }), row({ match_score: null })];
    expect(selectReel(rows)).toBeNull();
  });

  it("accepts exactly the bar and no less", () => {
    const scored = (n: number) =>
      Array.from({ length: 3 }, (_, i) => row({ match_score: i < n ? 80 : null }));
    expect(selectReel(scored(MIN_SCORED_CUTS - 1))).toBeNull();
    expect(selectReel(scored(MIN_SCORED_CUTS))).not.toBeNull();
  });

  // Counted on the cuts that actually appear, not the character's history: a
  // busy character whose best three happen to be unscored still fails.
  it("counts the cuts in the reel, not the character's whole history", () => {
    const rows = [
      ...Array.from({ length: 6 }, () => row({ match_score: null, created_at: "2026-09-09T00:00:00Z" })),
      row({ match_score: 90, created_at: "2026-01-01T00:00:00Z" }),
      row({ match_score: 90, created_at: "2026-01-01T00:00:00Z" }),
    ];
    // Scored takes sort first, so these two DO make the cut and it passes.
    expect(selectReel(rows)).not.toBeNull();
    expect(selectReel(rows)?.clips.filter((c) => c.matchScore !== null)).toHaveLength(2);
  });
});

describe("where each segment is cut", () => {
  it("starts a second in, past the model settling and past any injected first frame", () => {
    expect(segmentWindow(10)).toEqual({ startSeconds: 1, durationSeconds: SEGMENT_SECONDS });
  });

  // Asking ffmpeg for frames past the end returns a SHORTER piece without
  // complaining, which desynchronises the reel's declared length from its real
  // one — the reason this clamps rather than trusting the numbers.
  it("never asks a short take for frames it does not have", () => {
    const w = segmentWindow(3);
    expect(w.startSeconds + w.durationSeconds).toBeLessThanOrEqual(3);
    const tiny = segmentWindow(1);
    expect(tiny.startSeconds).toBe(0);
    expect(tiny.durationSeconds).toBe(1);
  });

  it("assumes the product's shortest real duration when the column is null", () => {
    // Older rows predate video_duration_seconds; 5s is the shortest duration
    // the catalogue actually offers, so it can never over-read.
    const w = segmentWindow(null);
    expect(w.startSeconds + w.durationSeconds).toBeLessThanOrEqual(5);
  });

  it("honours a caller-supplied segment length (the brief allows 3 to 5)", () => {
    expect(segmentWindow(10, 5)).toEqual({ startSeconds: 1, durationSeconds: 5 });
  });
});
