import { describe, expect, it } from "vitest";
import { compileComposition } from "./compile";
import { lintComposition } from "./lint";
import type { EditPlan, Shot } from "./plan";
import type { Word } from "./timeline";

// Every feature the compiler can emit, through HyperFrames' own linter: the
// rules that decide whether HeyGen renders it as we meant.
const shot = (over: Partial<Shot>): Shot => ({ clip: 0, from: 0, to: 2, zoom: 1, focusX: 0.5, focusY: 0.5, transitionIn: "cut", volume: 1, fit: "cover", ...over });
const words: Word[] = [
  { text: "Hello", start: 0.2, end: 0.5 },
  { text: "there", start: 0.6, end: 0.9 },
  { text: "friends", start: 1.0, end: 1.5 },
];

describe("compiled compositions pass HyperFrames' linter", () => {
  for (const look of ["clean", "bold", "cinematic"] as const) {
    for (const aspect of ["16:9", "9:16", "1:1"] as const) {
      it(`${look} ${aspect}: every feature, no errors and no warnings`, async () => {
        const plan: EditPlan = {
          summary: "",
          aspect,
          look,
          captions: look === "bold" ? "words" : "lines",
          shots: [
            shot({ from: 0, to: 2, transitionIn: "fade", fit: "contain" }),
            shot({ from: 3, to: 5, zoom: 1.2, focusX: 0.3 }),
            shot({ clip: 1, from: 1, to: 3, volume: 0 }),
            shot({ from: 6, to: 8, transitionIn: "fade" }),
          ],
          texts: [
            { text: "Title & <more>", start: 0, duration: 2, kind: "title" },
            { text: "Ana, Lisbon", start: 2.2, duration: 1.5, kind: "lower-third" },
            { text: "Big line", start: 4, duration: 1, kind: "callout" },
            { text: "Imagine yours", start: 6.5, duration: 1.5, kind: "end-card" },
          ],
          music: { clip: 2, from: 0, volume: 0.3 },
        };
        const html = compileComposition({
          plan,
          transcripts: [words, [], []],
          shotMedia: [
            { src: "media/shot-000.mp4", mediaStart: 0.5, hasAudio: true, fillSrc: "media/fill-000.mp4" },
            { src: "media/shot-001.mp4", mediaStart: 0.5, hasAudio: true },
            { src: "media/shot-002.mp4", mediaStart: 0.5, hasAudio: false },
            { src: "media/shot-003.mp4", mediaStart: 0.5, hasAudio: true },
          ],
          music: { src: "media/music.m4a", mediaStart: 0 },
        });
        const verdict = await lintComposition(html);
        expect(verdict.errors).toEqual([]);
        expect(verdict.warnings).toEqual([]);
      });
    }
  }
});

describe("captions and full-frame cards", () => {
  it("never shows a caption under a title or end card", () => {
    const html = compileComposition({
      plan: {
        summary: "",
        aspect: "9:16",
        look: "clean",
        captions: "lines",
        shots: [shot({ from: 0, to: 4 })],
        texts: [
          { text: "Open", start: 0, duration: 1.2, kind: "title" },
          { text: "End", start: 1.5, duration: 2.5, kind: "end-card" },
        ],
        music: null,
      },
      transcripts: [
        [
          { text: "Under", start: 0.3, end: 0.6 },
          { text: "the", start: 0.65, end: 0.8 },
          { text: "title", start: 0.85, end: 1.0 },
          { text: "Before", start: 1.22, end: 1.3 },
          { text: "card", start: 1.32, end: 1.7 },
        ],
      ],
      shotMedia: [{ src: "media/shot-000.mp4", mediaStart: 0, hasAudio: true }],
      music: null,
    });
    expect(html).not.toContain(">Under<");
    // "Before card" starts at 1.22 (between the cards) and is cut off when the end card lands at 1.5.
    expect(html).toMatch(/class="clip cap" data-start="1.22" data-duration="0.28"/);
  });
});
