import { describe, expect, it } from "vitest";
import { composeRecastBrief, RECAST_BRIEF_MAX_CHARS, recastCastTokens, recastCharacterToken, recastImageTokens } from "./recast-brief";
import type { RecastRead } from "./recast-read";

// The brief is what a video model is actually told. Genjutsu's works because
// it names, in writing, everything that must NOT change; these pin that it
// still does — and that nobody in the footage is described in it.

const read: RecastRead = {
  title: "slow turn to camera",
  motion: "She turns from the window and crosses her arms.",
  world: "A white studio under flat daylight.",
  people: [
    { tag: "A", where: "centre, facing camera", does: "turns and crosses her arms", lead: true, many: false },
    { tag: "B", where: "behind, walks in at 0:04", does: "walks past and exits right", lead: false, many: false },
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

describe("a brief for an engine that reads names", () => {
  it("calls the clip @Video1 and the character by the name their photos go under", () => {
    const many = composeRecastBrief({ ...base, job: "scene", casting: { tag: "A", characterName: "Eva", token: recastCharacterToken(4) } });
    expect(many).toContain("Replace Person A in @Video1 with @Element1.");
    expect(many).toContain("Everything else stays exactly as it is in @Video1.");
    const one = composeRecastBrief({ ...base, job: "scene", casting: { tag: "A", characterName: "Eva", token: recastCharacterToken(1) } });
    expect(one).toContain("with @Image1.");
  });

  it("says in so many words that the character stays themselves from behind", () => {
    // The dissolve (2026-09-19): the operator's character became the source
    // performer the moment he turned his back. Kling O3 Edit held Eva through
    // the same turn with this said.
    const brief = composeRecastBrief({ ...base, job: "scene" });
    expect(brief).toContain("including from behind");
    expect(brief).toContain("never the original performer's");
  });

  it("keeps plain words for an engine that takes no names", () => {
    const brief = composeRecastBrief({ ...base, job: "scene", casting: { tag: "A", characterName: "Eva" } });
    expect(brief).not.toContain("@");
    expect(brief).toContain("the source video");
  });
});

describe("a later piece of a long take", () => {
  // lib/generations/chain.ts: every piece after the first opens on the last
  // second of the one before, already rendered. These words are the ones
  // every passing seam test on the operator's clip was sent with.
  const casting = { tag: "A", characterName: "Eva", token: recastCharacterToken(4) };

  it("is told its first second is finished and must be carried on from", () => {
    const later = composeRecastBrief({ ...base, job: "scene", casting, continuing: true });
    expect(later).toContain("CONTINUITY");
    expect(later).toContain("The first second of @Video1 is already finished: it shows @Element1 exactly as they must look");
    expect(later).toContain("the same faces and hair on everyone beside them");
    expect(later.indexOf("CONTINUITY")).toBeLessThan(later.indexOf("KEEP EXACTLY"));
    // The first piece has nothing before it to carry on from.
    expect(composeRecastBrief({ ...base, job: "scene", casting })).not.toContain("CONTINUITY");
  });

  it("never loses the person's own words to the extra paragraph", () => {
    const direction = `She looks up at the very end. ${"Keep her calm and unhurried. ".repeat(19)}`.slice(0, 600);
    const later = composeRecastBrief({ ...base, job: "scene", casting, continuing: true, direction });
    expect(later.endsWith(direction.trim())).toBe(true);
    expect(later.length).toBeLessThanOrEqual(RECAST_BRIEF_MAX_CHARS);
  });
});

describe("a motion take's brief — the only one an engine actually reads", () => {
  const brief = composeRecastBrief({ ...base, job: "motion" });

  it("says the IMAGE is the world, not the video", () => {
    // The fault behind the operator's first real take (2026-09-18): the
    // scene brief below was sent to motion control, which builds the video
    // out of the reference image. It told the engine to keep the source
    // video's setting and that "everything else stays exactly as it is in
    // the source video" — two thousand characters arguing with the model.
    expect(brief).toContain("The reference image is the world");
    expect(brief).toContain("Only the movement comes from the video.");
    expect(brief).not.toContain("The lighting and the setting.");
    expect(brief).not.toContain("Everything else stays exactly as it is in the source video.");
    expect(brief).not.toContain("Replace Person A");
  });

  it("takes only the performance and the timing from the video", () => {
    expect(brief).toContain("TAKE FROM THE VIDEO, AND NOTHING ELSE");
    expect(brief).toContain("The performance: every gesture, every step, every expression, on the same frames.");
    expect(brief).toContain("The timing, and the way the camera moves.");
  });

  it("carries no keep list, because nothing in the clip's picture survives it", () => {
    const withKeeps = composeRecastBrief({ ...base, job: "motion", keeps: [{ what: "a wristwatch on the left wrist", kind: "accessory" }] });
    expect(withKeeps).not.toContain("wristwatch");
  });

  it("still ends on the person's own direction", () => {
    const directed = composeRecastBrief({ ...base, job: "motion", direction: "Keep it cold and blue." });
    expect(directed.trimEnd().endsWith("Keep it cold and blue.")).toBe(true);
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

describe("the clothes", () => {
  // The operator's first 30 s take (2026-09-19): face, hair and build were
  // pinned to the photos, clothes were not, and "everything else stays
  // exactly as it is" in the clip — so part 1 wore the performer's white
  // shirt and part 2 her own black dress.
  const casting = { tag: "A", characterName: "Eva", token: recastCharacterToken(4) };

  it("dresses the character from their photos, first frame to last, in every part", () => {
    for (const continuing of [false, true]) {
      const brief = composeRecastBrief({ ...base, job: "scene", casting, continuing });
      expect(brief).toContain("So do their clothes: they wear what they wear in those photos, from the first frame to the last");
    }
    expect(composeRecastBrief({ ...base, job: "scene", casting: { ...casting, token: recastCharacterToken(1) } })).toContain(
      "they wear what they wear in the image",
    );
  });

  it("still lets the person's own words dress them otherwise", () => {
    expect(composeRecastBrief({ ...base, job: "scene", casting })).toContain("unless the direction below says otherwise");
  });
});

describe("a take with nobody cast — words, and images of their own", () => {
  // 2026-09-19: "make it that the user can upload an image and that they can
  // only use prompt to change whatever they want. Do not lock it just on
  // characters".
  const words = { ...base, job: "scene" as const, casting: null, direction: "Make it snow, and dress everyone in red." };

  it("changes what the words say, keeps the performance, and replaces nobody", () => {
    const brief = composeRecastBrief(words);
    expect(brief).toContain("Change @Video1 exactly as the direction below says, and nothing more. Keep the performance exactly as it is.");
    expect(brief).toContain("Everything the direction does not change stays exactly as it is in @Video1.");
    expect(brief).not.toContain("Replace");
    expect(brief).not.toContain("THE CHARACTER");
    // No blanket "keep the setting" to argue with a direction that changes it.
    expect(brief).not.toContain("The lighting, the setting and everyone else in the shot.");
    expect(brief.endsWith("Make it snow, and dress everyone in red.")).toBe(true);
  });

  it("names each image by the engine's name and by the person's — image 1, image 2", () => {
    const brief = composeRecastBrief({ ...words, images: recastImageTokens(undefined, 2) });
    expect(brief).toContain("IMAGES");
    expect(brief).toContain('- @Image1 — "image 1" in the direction.');
    expect(brief).toContain('- @Image2 — "image 2" in the direction.');
    expect(brief.indexOf("IMAGES")).toBeLessThan(brief.indexOf("THE SOURCE"));
  });

  it("carries a long take's first second on whatever the words changed", () => {
    const later = composeRecastBrief({ ...words, continuing: true });
    expect(later).toContain("CONTINUITY");
    expect(later).toContain("every change the direction asks for");
  });
});

describe("images beside a character", () => {
  it("numbers them after a one-photo character's own @Image1, and from @Image1 beside an element", () => {
    expect(recastImageTokens("@Image1", 2)).toEqual(["@Image2", "@Image3"]);
    expect(recastImageTokens("@Element1", 2)).toEqual(["@Image1", "@Image2"]);
    expect(recastImageTokens(undefined, 1)).toEqual(["@Image1"]);
  });

  it("puts them in the brief with the character still cast", () => {
    const casting = { tag: "A", characterName: "Eva", token: recastCharacterToken(1) };
    const brief = composeRecastBrief({ ...base, job: "scene", casting, images: recastImageTokens(casting.token, 1), direction: "She wears the coat in image 1." });
    expect(brief).toContain("Replace Person A in @Video1 with @Image1.");
    expect(brief).toContain('- @Image2 — "image 1" in the direction.');
  });

  it("never loses the person's own words, with every paragraph there is", () => {
    // The longest a brief gets: a later piece, three images, six keeps, the
    // full 600 characters of direction.
    const direction = `She wears the coat in image 1. ${"Keep her calm and unhurried. ".repeat(20)}`.slice(0, 600).trim();
    const casting = { tag: "A", characterName: "Eva", token: recastCharacterToken(4) };
    const keeps = Array.from({ length: 6 }, (_, i) => ({ what: `a long described thing to keep in the shot, number ${i + 1}`, kind: "object" as const }));
    const brief = composeRecastBrief({ ...base, job: "scene", casting, keeps, continuing: true, images: recastImageTokens(casting.token, 3), direction });
    expect(brief.length).toBeLessThanOrEqual(RECAST_BRIEF_MAX_CHARS);
    expect(brief.endsWith(direction)).toBe(true);
  });
});

describe("several characters in one take", () => {
  // 2026-09-19: "Selecting two characters still makes two videos separately".
  const tokens = recastCastTokens([4, 1]);
  const ensemble = [
    { tag: "A", characterName: "Eva", token: tokens[0] },
    { tag: "B", characterName: "Anubis", token: tokens[1] },
  ];

  it("names each character the way the request binds them — elements first come, one-photo ones as images", () => {
    expect(recastCastTokens([4, 1])).toEqual(["@Element1", "@Image1"]);
    expect(recastCastTokens([1, 3, 1, 2])).toEqual(["@Image1", "@Element1", "@Image2", "@Element2"]);
    // A lone character is named exactly as before.
    expect(recastCastTokens([3])).toEqual([recastCharacterToken(3)]);
    expect(recastCastTokens([1])).toEqual([recastCharacterToken(1)]);
    // Added images follow every one-photo character's own @Image.
    expect(recastImageTokens(recastCastTokens([1, 1, 2]), 1)).toEqual(["@Image3"]);
  });

  it("gives each the person they play, all in the one video", () => {
    const brief = composeRecastBrief({ ...base, job: "scene", casting: ensemble });
    expect(brief).toContain("Replace Person A in @Video1 with @Element1, and Person B with @Image1.");
    expect(brief).toContain("They all appear together in this one video.");
    expect(brief).toContain("THE CHARACTERS");
    expect(brief).toContain("- Eva — @Element1. Their face, hair and build come from those photos, and so do their clothes");
    expect(brief).toContain("- Anubis — @Image1. Their face, hair and build come from that image, and so do their clothes");
    expect(brief).toContain("never each other's");
  });

  it("leaves a character with no person to play to the words", () => {
    const brief = composeRecastBrief({ ...base, job: "scene", casting: [ensemble[0], { ...ensemble[1], tag: null }], direction: "Anubis replaces every student." });
    expect(brief).toContain("Replace Person A in @Video1 with @Element1.");
    expect(brief).toContain("Put @Image1 into @Video1 as the direction below says.");
    expect(brief.endsWith("Anubis replaces every student.")).toBe(true);
  });

  it("carries both across a long take's joins", () => {
    const later = composeRecastBrief({ ...base, job: "scene", casting: ensemble, continuing: true });
    expect(later).toContain("it shows @Element1 and @Image1 exactly as they must look");
  });
});

// THE ANUBIS TAKE (2026-09-20, "The last generation came out bad. Worst one
// yet."): one character was cast over Person B — forty students — while the
// brief also promised to keep everyone else in the shot, and the engine
// settled the argument by redrawing the whole picture as an Egyptian field.
describe("a character cast over a whole group", () => {
  it("says every one of them becomes the character, not that one person does", () => {
    const one = composeRecastBrief({
      ...base,
      job: "scene",
      casting: { tag: "B", many: true, characterName: "Anubis", token: recastCharacterToken(1) },
    });
    expect(one).toContain("Replace every single person in Person B’s group in @Video1 with @Image1.");
    const several = composeRecastBrief({
      ...base,
      job: "scene",
      casting: [
        { tag: "A", characterName: "Eva", token: "@Element1" },
        { tag: "B", many: true, characterName: "Anubis", token: "@Image1" },
      ],
    });
    expect(several).toContain("and every single person in Person B’s group with @Image1");
  });

  it("no longer promises to keep everyone else in the shot — the line that contradicted the task", () => {
    for (const casting of [
      { tag: "A", characterName: "Eva", token: "@Element1" },
      [
        { tag: "A", characterName: "Eva", token: "@Element1" },
        { tag: "B", many: true, characterName: "Anubis", token: "@Image1" },
      ],
    ]) {
      const brief = composeRecastBrief({ ...base, job: "scene", casting });
      expect(brief).not.toContain("The lighting, the setting and everyone else in the shot.");
      expect(brief).toContain("The lighting and the setting.");
      expect(brief).toContain("Everyone in @Video1 who is not named above stays exactly as they are.");
    }
  });
});

describe("a later part's own look", () => {
  it("is pointed at the still the runner binds to it", () => {
    const casting = { tag: "A", characterName: "Eva", token: recastCharacterToken(4) };
    const later = composeRecastBrief({ ...base, job: "scene", casting, continuing: true, look: "@Image1" });
    expect(later).toContain("@Image1 IS that finished frame.");
    expect(later).toContain("even where the footage underneath still looks like it did before");
    expect(later.indexOf("@Image1 IS that finished frame.")).toBeLessThan(later.indexOf("KEEP EXACTLY"));
    // The first part has no finished frame to carry.
    expect(composeRecastBrief({ ...base, job: "scene", casting, look: "@Image1" })).not.toContain("IS that finished frame");
    // Every shape of take says it: nobody cast, and several cast.
    expect(composeRecastBrief({ ...base, job: "scene", casting: null, direction: "Make it snow.", continuing: true, look: "@Image2" })).toContain(
      "@Image2 IS that finished frame.",
    );
    expect(
      composeRecastBrief({
        ...base,
        job: "scene",
        casting: [casting, { tag: "B", characterName: "Anubis", token: "@Image1" }],
        continuing: true,
        look: "@Image2",
      }),
    ).toContain("@Image2 IS that finished frame.");
  });
});

describe("Photo to life from the person's own image", () => {
  it("does not assume the image shows a person", () => {
    const brief = composeRecastBrief({ ...base, job: "motion", casting: null });
    expect(brief).toContain("Whoever or whatever the reference image shows.");
    expect(brief).not.toContain("The character —");
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
