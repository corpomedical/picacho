import { describe, expect, it } from "vitest";
import { aceBody, composeCostUsd, elevenBody, isTake, musicElement, promptText, sectionsFromCuts, type ComposeRequest } from "./composer";

// The Eva edit's real cuts (Opus's proof project, 2026-09-25).
const EVA_CUTS = [3.38, 7.28, 10.72, 13.76, 16.08, 18.55, 20, 21.17, 22.19, 24.56, 27.51];

describe("the composer", () => {
  it("prices a take from fal's listing: ElevenLabs by the started minute, ACE-Step by the second", () => {
    expect(composeCostUsd("eleven", 32.2, 3)).toBe(1.8);
    expect(composeCostUsd("eleven", 75, 1)).toBe(1.2);
    expect(composeCostUsd("ace", 32.2, 3)).toBeCloseTo(0.0193, 4);
    expect(composeCostUsd("eleven", 30, 9)).toBe(1.8); // at most three takes
  });

  it("lays the music's shape on the cut: build, rise, a drop on a real cut, outro — each at least 3 s", () => {
    const s = sectionsFromCuts(32.22, EVA_CUTS);
    expect(s.map((x) => x.name)).toEqual(["Build", "Rise", "Drop", "Outro"]);
    expect(s[0].start).toBe(0);
    expect(s.at(-1)?.end).toBe(32.22);
    for (const x of s) expect(x.end - x.start).toBeGreaterThanOrEqual(3);
    expect(EVA_CUTS).toContain(s[2].start);
    for (let i = 1; i < s.length; i++) expect(s[i].start).toBe(s[i - 1].end);
    expect(sectionsFromCuts(8, [4])).toEqual([{ name: "Build", start: 0, end: 8 }]);
  });

  it("tells both engines the same thing, and each in its own words", () => {
    const req: ComposeRequest = {
      engine: "eleven",
      prompt: "Dark cinematic trailer, heartbeat kick",
      styles: ["Dramatic", "Hybrid orchestral"],
      instrumental: true,
      seconds: 32.22,
      sections: sectionsFromCuts(32.22, EVA_CUTS),
      takes: 3,
    };
    const text = promptText(req);
    expect(text).toContain("Style: Dramatic, Hybrid orchestral.");
    expect(text).toMatch(/Structure: build 0:00–0:0\d/);
    expect(text).toContain("The big hit lands exactly at");
    expect(text).toContain("Instrumental, no vocals.");
    expect(elevenBody(req, 7)).toMatchObject({ music_length_ms: 32220, force_instrumental: true, seed: 7 });
    expect(aceBody({ ...req, engine: "ace" }, 7)).toEqual({ prompt: "Dark cinematic trailer, heartbeat kick, Dramatic, Hybrid orchestral", instrumental: true, duration: 32.22, seed: 7 });
  });

  it("puts a chosen take on the music track as one timed element", () => {
    expect(musicElement("music-1", "assets/music/take-1.mp3", 32.22)).toBe(
      '<audio id="music-1" src="assets/music/take-1.mp3" data-start="0" data-duration="32.22" data-media-start="0" data-volume="0.85" data-track-index="30" data-role="music"></audio>',
    );
    expect(isTake("assets/music/take-3f9a1c2e.mp3")).toBe(true);
    expect(isTake("assets/audio/clip-0-score-boosted.wav")).toBe(false);
    expect(isTake(null)).toBe(false);
  });
});
