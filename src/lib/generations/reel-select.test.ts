import { describe, expect, it } from "vitest";
import {
  MAX_REEL_CLIPS,
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

  it("still picks a character whose renders all predate scoring", () => {
    const rows = [
      row({ character_profile_id: "eva", match_score: null }),
      row({ character_profile_id: "eva", match_score: null }),
    ];
    const picked = selectReel(rows);
    expect(picked?.characterProfileId).toBe("eva");
    expect(picked?.meanIdentity).toBeNull();
    expect(picked?.clips).toHaveLength(2);
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
      row({ id: "a-left", angle_group_id: "grp", angle: "left" }),
      row({ id: "a-front", angle_group_id: "grp", angle: "front" }),
      row({ id: "a-right", angle_group_id: "grp", angle: "right" }),
    ];
    const picked = selectReel(rows);
    expect(picked?.takes).toBe(1);
    expect(picked?.clips.map((c) => c.generationId)).toEqual(["a-front"]);
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
    const rows = [
      row({ id: "unscored", match_score: null }),
      row({ id: "scored", match_score: 50 }),
    ];
    expect(selectReel(rows)?.clips.map((c) => c.generationId)).toEqual(["scored", "unscored"]);
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
    const picked = selectReel([row({ prompt_input: "Eva on a snowy ridge" })]);
    expect(picked?.clips[0].label).toBe("Eva on a snowy ridge");
  });

  it("collapses whitespace so a pasted prompt does not break the line", () => {
    const picked = selectReel([row({ prompt_input: "  Eva\n\n  on   a ridge  " })]);
    expect(picked?.clips[0].label).toBe("Eva on a ridge");
  });

  it("trims a long prompt on a word boundary, never mid-word", () => {
    const long = "Eva standing on a snowy ridge at golden hour looking upward";
    const label = selectReel([row({ prompt_input: long })])?.clips[0].label ?? "";
    expect(label.length).toBeLessThanOrEqual(43);
    expect(label.endsWith("…")).toBe(true);
    // The visible part must be whole words from the original.
    expect(long.startsWith(label.slice(0, -1))).toBe(true);
    expect(label).not.toMatch(/\s…$/);
  });

  it("gives up rather than showing a stub", () => {
    expect(selectReel([row({ prompt_input: null })])?.clips[0].label).toBeNull();
    expect(selectReel([row({ prompt_input: "  " })])?.clips[0].label).toBeNull();
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
