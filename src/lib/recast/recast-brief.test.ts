import { describe, expect, it } from "vitest";
import { composeRecastBrief, RECAST_BRIEF_MAX_CHARS } from "./recast-brief";
import type { RecastRead } from "./recast-read";

// The brief is what a video model is actually told. Genjutsu's works because
// it names, in writing, everything that must NOT change; these pin that it
// still does — and that nobody in the footage is described in it.

const read: RecastRead = {
  title: "slow turn to camera",
  motion: "She turns from the window and crosses her arms.",
  world: "A white studio under flat daylight.",
  people: [
    { tag: "A", where: "centre, facing camera", does: "turns and crosses her arms", lead: true },
    { tag: "B", where: "behind, walks in at 0:04", does: "walks past and exits right", lead: false },
  ],
  keeps: [{ what: "a wristwatch on the left wrist", kind: "accessory" }],
  cuts: [4.3],
  framing: "medium",
  sound: "speech",
  headVisible: true,
  confidence: "high",
};

const base = {
  read,
  seconds: 8,
  casting: { tag: "A", characterName: "Eva" },
  keeps: read.keeps,
  direction: "",
};

describe("a recast's brief", () => {
  const brief = composeRecastBrief({ ...base, job: "scene" });

  it("names the task, the character, the source and what must not change", () => {
    expect(brief).toContain("TASK");
    expect(brief).toContain("THE CHARACTER");
    expect(brief).toContain("THE SOURCE");
    expect(brief).toContain("KEEP EXACTLY");
    expect(brief).toContain("Eva");
    expect(brief).toContain("Replace Person A in the source video");
    // The line Genjutsu's own recipes end on, and the reason they work.
    expect(brief).toContain("Everything else stays exactly as it is in the source video.");
  });

  it("carries the read's own account of the clip, cuts and all", () => {
    expect(brief).toContain("She turns from the window");
    expect(brief).toContain("4.3s");
    expect(brief).toContain("Person A: centre, facing camera — turns and crosses her arms");
    expect(brief).toContain("Person B:");
  });

  it("carries every keep still ticked, and none that was untucked", () => {
    expect(brief).toContain("a wristwatch on the left wrist");
    expect(composeRecastBrief({ ...base, job: "scene", keeps: [] })).not.toContain("wristwatch");
  });

  it("puts the person's own direction last, as a note on top of the order", () => {
    const withDirection = composeRecastBrief({ ...base, job: "scene", direction: "Keep it cold and blue." });
    expect(withDirection).toContain("DIRECTION");
    expect(withDirection.indexOf("DIRECTION")).toBeGreaterThan(withDirection.indexOf("KEEP EXACTLY"));
    expect(withDirection.trimEnd().endsWith("Keep it cold and blue.")).toBe(true);
  });

  it("still reads as an order when there was no read at all", () => {
    const blind = composeRecastBrief({ ...base, job: "motion", read: null });
    expect(blind).toContain("TASK");
    expect(blind).toContain("One continuous clip of 8 seconds.");
  });

  it("keeps its headings on their own lines — the layout is the point", () => {
    // cleanText would have flattened the whole thing into one paragraph.
    const lines = brief.split("\n");
    expect(lines).toContain("TASK");
    expect(lines).toContain("THE SOURCE");
    expect(lines).toContain("KEEP EXACTLY");
    expect(lines.filter((l) => l.startsWith("- ")).length).toBeGreaterThanOrEqual(4);
    // A blank line between blocks, never two.
    expect(brief).not.toMatch(/\n\n\n/);
  });

  it("stays inside the smallest prompt either engine takes", () => {
    const huge = composeRecastBrief({
      ...base,
      job: "scene",
      direction: "x".repeat(4000),
      keeps: Array.from({ length: 6 }, (_, i) => ({ what: `keep number ${i} `.repeat(10), kind: "object" as const })),
    });
    expect(huge.length).toBeLessThanOrEqual(RECAST_BRIEF_MAX_CHARS);
  });
});

describe("a restyle's brief", () => {
  const brief = composeRecastBrief({ ...base, job: "world", casting: null, direction: "The same street at night, rain and neon." });

  it("keeps the performance, asks for a new look, and casts nobody", () => {
    expect(brief).toContain("THE NEW LOOK");
    expect(brief).toContain("The same street at night, rain and neon.");
    expect(brief).toContain("Every person's performance, gestures and timing, frame for frame.");
    // Nobody is replaced here, so no character is named.
    expect(brief).not.toContain("THE CHARACTER");
    expect(brief).not.toContain("Eva");
  });

  it("never asks this engine to keep a face, because it was measured not to", () => {
    // Three probes on 2026-09-18 (flex_2, adhere_2, adhere_3) all returned
    // the same motion with a different person in it. A KEEP line about
    // faces would be a promise the engine cannot meet.
    const keepBlock = brief.slice(brief.indexOf("KEEP EXACTLY"));
    expect(keepBlock).not.toMatch(/\bface|likeness|who they are|the same person\b/i);
  });

  it("tells it where the clip is set, so the change is a change FROM something", () => {
    expect(brief).toContain("A white studio under flat daylight.");
  });
});

describe("what a brief may never say", () => {
  it("never describes anyone in the footage", () => {
    // The read is forbidden to produce such words (recast-read.ts's rules),
    // and the brief only ever repeats the read's `where` and `does`.
    const brief = composeRecastBrief({ ...base, job: "scene" });
    for (const line of brief.split("\n").filter((l) => l.startsWith("Person "))) {
      expect(line).not.toMatch(/\b(blonde|brunette|young|old|tall|short|skin|wearing|dressed)\b/i);
    }
  });
});
