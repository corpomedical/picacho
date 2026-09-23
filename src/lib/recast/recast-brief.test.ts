import { describe, expect, it } from "vitest";
import {
  composeRecastBrief,
  RECAST_BRIEF_MAX_CHARS,
  RECAST_MARK_MAX_CHARS,
  recastBriefNames,
  recastCastTokens,
  recastCharacterToken,
  recastImageTokens,
  recastRestageTokens,
  recastSentBriefs,
} from "./recast-brief";
import { CHAIN_CLIP_PLACEHOLDER, CHAIN_LOOK_PLACEHOLDER } from "../generations/chain";
import {
  RECAST_ENGINE_ORDER,
  RECAST_ENGINES,
  RECAST_JOB_ORDER,
  recastChainFits,
  recastImageRoom,
  recastRequestBody,
  recastRestageImageRoom,
  type RecastEngine,
} from "./recast";
import { reboundRecastRead, type RecastRead } from "./recast-read";
import { recastRow } from "./store";

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
    // The line Genjutsu's own recipes end on, and the reason they work —
    // scoped, since 2026-09-23, to whoever and whatever the TASK does not
    // name: read as a blanket promise it ordered the replaced man KEPT.
    expect(brief).toContain("Everyone and everything the TASK does not name stays exactly as it is in the source video.");
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

  // THE DIRECTION ARRIVES WITH THE ORDER (2026-09-23). It used to land last,
  // as a note on top of the order — and on the take that failed it was 29
  // characters at position 1,933 of a 1,963-character brief, read after the
  // cast lines, the keep list and nine "unless the direction changes it"
  // clauses. The engine added the character beside the man and ignored the
  // wardrobe twice; the same clip and window, re-run with the direction inside
  // the instruction, replaced him in place and dressed him as asked.
  it("puts the person's own direction with the TASK, where the order is given", () => {
    const withDirection = composeRecastBrief({ ...base, job: "scene", direction: "Keep it cold and blue." });
    expect(withDirection).toContain("DIRECTION");
    expect(withDirection.indexOf("DIRECTION")).toBeLessThan(withDirection.indexOf("THE CHARACTER"));
    expect(withDirection.indexOf("DIRECTION")).toBeLessThan(withDirection.indexOf("\nKEEP"));
    // Said once, not twice: a second copy costs up to 600 of Kling's 2,500,
    // which the heaviest take the door can send does not have to spare.
    expect(withDirection.split("Keep it cold and blue.")).toHaveLength(2);
    expect(withDirection.split("\n").indexOf("DIRECTION")).toBe(withDirection.split("\n").lastIndexOf("DIRECTION"));
    // The other jobs keep the person's words last, where their own takes were
    // measured with them there.
    for (const job of ["restage", "motion"] as const) {
      const other = composeRecastBrief({ ...base, job, direction: "Keep it cold and blue." });
      expect(other.trimEnd().endsWith("Keep it cold and blue."), job).toBe(true);
    }
  });

  it("still reads as an order when there was no read at all, and claims nothing it cannot know", () => {
    const blind = composeRecastBrief({ ...base, job: "motion", read: null });
    expect(blind).toContain("TASK");
    // With no read, nothing says the clip is continuous — only how long it is
    // (review, 2026-09-22).
    expect(blind).toContain("A clip of 8 seconds.");
    expect(blind).not.toContain("continuous");
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
    expect(many).toContain("Everyone and everything the TASK does not name stays exactly as it is in @Video1.");
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
    expect(later).toContain(direction.trim());
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
    // The scene list's closing line, whatever it says today (2026-09-23: it
    // names what the TASK does not) — none of it belongs here.
    expect(brief).not.toContain("stays exactly as it is in the source video.");
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
    // "the direction", not "the direction below": their words stand above this
    // line now (2026-09-23), and the block they are in is headed DIRECTION.
    expect(composeRecastBrief({ ...base, job: "scene", casting })).toContain("unless the direction says otherwise");
    expect(composeRecastBrief({ ...base, job: "scene", casting })).not.toContain("the direction below says otherwise");
  });
});

describe("a take with nobody cast — words, and images of their own", () => {
  // 2026-09-19: "make it that the user can upload an image and that they can
  // only use prompt to change whatever they want. Do not lock it just on
  // characters".
  const words = { ...base, job: "scene" as const, casting: null, direction: "Make it snow, and dress everyone in red." };

  it("changes what the words say, keeps the performance, and replaces nobody", () => {
    const brief = composeRecastBrief(words);
    // Held until the words change it (2026-09-22) — on a take of one piece.
    expect(brief).toContain(
      "Change @Video1 exactly as the direction below says, and nothing more. Keep the performance exactly as it is, unless the direction changes it.",
    );
    expect(composeRecastBrief({ ...words, longTake: true })).toContain(
      "Change @Video1 exactly as the direction below says, and nothing more. Keep the performance exactly as it is.",
    );
    // Nobody is replaced here, so nothing is named in the TASK and the
    // closing catch-all is the one it always was.
    expect(brief).toContain("Everything the direction does not change stays exactly as it is in @Video1.");
    expect(brief).not.toContain("Replace");
    expect(brief).not.toContain("THE CHARACTER");
    // No blanket "keep the setting" to argue with a direction that changes it.
    expect(brief).not.toContain("The lighting, the setting and everyone else in the shot.");
    // Their words sit directly under the TASK they qualify — and "the
    // direction below" in that sentence is still true of the block below it.
    expect(brief).toContain("TASK\nChange @Video1 exactly as the direction below says, and nothing more.");
    expect(brief).toContain("\n\nDIRECTION\nMake it snow, and dress everyone in red.\n");
    expect(brief.indexOf("DIRECTION")).toBeLessThan(brief.indexOf("THE SOURCE"));
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
    expect(brief).toContain(direction);
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
    expect(brief).toContain("\n\nDIRECTION\nAnubis replaces every student.\n");
    // The negative is for the person actually going out; the character who is
    // only PUT into the clip takes nobody's place.
    expect(brief).toContain("The person @Element1 replaces appears in no frame of @Video1");
    expect(brief).not.toContain("@Element1 and @Image1 replace");
  });

  it("carries both across a long take's joins", () => {
    const later = composeRecastBrief({ ...base, job: "scene", casting: ensemble, continuing: true });
    expect(later).toContain("it shows @Element1 and @Image1 exactly as they must look");
  });
});

describe("several characters in one Restage take", () => {
  // 2026-09-21: "Still when selecting two characters in Restage it gives me 2 takes".
  const names = recastRestageTokens([4, 1]);
  const ensemble = [
    { tag: "A", characterName: "Eva", token: names.tokens[0] },
    { tag: "B", characterName: "Anubis", token: names.tokens[1], many: true },
  ];

  it("names each by the pictures the request carries, in the order it carries them", () => {
    expect(names).toEqual({ tokens: ["Images 1–4", "Image 5"], used: 5 });
  });

  it("gives each their own part, in one video, and the added image the next number", () => {
    const brief = composeRecastBrief({ ...base, job: "restage", casting: ensemble, images: [`Image ${names.used + 1}`] });
    expect(brief).toContain("- Eva is the person in Images 1–4 — their face, hair and build come from those pictures, and they take the place of Person A.");
    expect(brief).toContain("- Anubis is the person in Image 5 — their face, hair and build come from those pictures, and they take the place of every person in Person B's group.");
    expect(brief).toContain("They all appear together in this one video");
    expect(brief).toContain('- Image 6 — "image 1" in the direction.');
  });

  it("says nothing about 'together' when one character is cast", () => {
    const brief = composeRecastBrief({ ...base, job: "restage", casting: ensemble[0] });
    expect(brief).not.toContain("together");
  });

  it("lets the read give way before the person's words, never the other way round", () => {
    const direction = "Eva stands with her arms crossed as the camera starts close on her and slowly pulls back. ".repeat(6).trim();
    // The most the action lets through: six keeps of 120 characters.
    const keeps = Array.from({ length: 6 }, (_, i) => ({ what: `${"a detail of the courtyard that must survive ".repeat(3)}${i}`.slice(0, 120), kind: "object" as const }));
    const longRead = { ...read, motion: "Rows of students bow and sway in unison around one central figure. ".repeat(20).trim() };
    const brief = composeRecastBrief({ ...base, read: longRead, job: "restage", casting: ensemble, keeps, direction });
    expect(Array.from(brief).length).toBeLessThanOrEqual(RECAST_BRIEF_MAX_CHARS);
    expect(brief.endsWith(direction)).toBe(true);
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
      // The place by name, from the read — not "the setting" in the abstract.
      expect(brief).toContain("The place it happens in, unchanged: A white studio under flat daylight.");
      expect(brief).toContain("The lighting.");
      // The bystanders are promised by the closing line now, which draws the
      // boundary where the engine can check it — the TASK's own names
      // (2026-09-23). "Everyone not named above" covered everything written
      // earlier, THE SOURCE's account of Person C and Person D included, so
      // the people who most needed the promise were the ones it let out.
      expect(brief).not.toContain("Everyone in @Video1 who is not named above stays exactly as they are.");
      expect(brief).toContain("Everyone and everything the TASK does not name stays exactly as it is in @Video1.");
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

// EVERY WORD YOU WRITE REACHES THE TAKE (2026-09-22). The brief sent on every
// single-piece take was the recipe's copy, cut at 2,000 characters from the
// end — where the direction stands: a 400-character direction beside three
// keeps, two images and a four-person read lost 336 of its characters. And
// the door composed what it showed from the whole clip, not the stretch sent.

/** A busy clip's read, the scouts' measuring fixture: four people, one of them a group. */
const busy: RecastRead = {
  title: "walk and turn",
  motion: "A person walks across a courtyard toward the camera, stops, turns to look back at a group, then walks out of frame to the right.",
  world: "An outdoor school courtyard in daylight with trees, benches and a low wall; soft overcast light and a handheld phone camera.",
  people: [
    { tag: "A", where: "centre, facing camera", does: "walks forward, stops, turns and walks out right", lead: true, many: false },
    { tag: "B", where: "left background", does: "a group standing and talking, some turn to watch", lead: false, many: true },
    { tag: "C", where: "right edge", does: "sits on a bench and looks at a phone", lead: false, many: false },
    { tag: "D", where: "behind, walks in at 0:04", does: "crosses the frame from left to right carrying a bag", lead: false, many: false },
  ],
  keeps: [],
  cuts: [4, 20],
  framing: "medium",
  sound: "ambient",
  headVisible: true,
  confidence: "high",
};
const sentence = "She keeps her arms crossed for the first three seconds and then smiles at the camera; the light gets warmer. ";
const directionOf = (length: number) => sentence.repeat(10).slice(0, length).trim();
const keepsOf = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ what: `a silver wristwatch on the left wrist of the lead performer, item ${i + 1} that must survive`, kind: "accessory" as const }));

describe("the brief for the stretch that is sent", () => {
  const window = { start: 10, end: 25 };
  const casting = { tag: "A", characterName: "Eva", token: "@Element1" };

  it("says the window's own length and only the cuts inside it, on its own clock", () => {
    const brief = composeRecastBrief({ job: "scene", engine: "kling-edit", read: busy, window, casting, keeps: [], direction: "" });
    expect(brief).toContain("15 seconds, cutting at 10s.");
    expect(brief).not.toContain("28 seconds");
    expect(brief).not.toContain("4s");
    // The same words the older call made from a read already cut to the window.
    expect(brief).toBe(composeRecastBrief({ job: "scene", engine: "kling-edit", read: { ...busy, cuts: [10] }, seconds: 15, casting, keeps: [], direction: "" }));
  });

  it("is byte-equal on the door and on the server: the read survives its round trip through the browser", () => {
    // The door composes from the read inspect handed it; the action from the
    // same read sent back and bounded again (reboundRecastRead).
    const door = composeRecastBrief({ job: "scene", engine: "kling-edit", read: busy, window, casting, keeps: keepsOf(2), direction: directionOf(200), images: ["@Image1"] });
    const returned = reboundRecastRead(JSON.parse(JSON.stringify(busy)), 28);
    const server = composeRecastBrief({ job: "scene", engine: "kling-edit", read: returned, window, casting, keeps: keepsOf(2), direction: directionOf(200), images: ["@Image1"] });
    expect(server).toBe(door);
  });

  it("loses none of the measured case's direction, where the recipe's copy lost 336 characters", () => {
    const direction = directionOf(400);
    const brief = composeRecastBrief({
      job: "scene",
      engine: "kling-edit",
      read: busy,
      window: { start: 0, end: 15 },
      casting,
      keeps: keepsOf(3),
      direction,
      images: ["@Image1", "@Image2"],
    });
    expect(brief).toContain(direction);
    expect(Array.from(brief).length).toBeLessThanOrEqual(RECAST_ENGINES["kling-edit"].promptMax);
    // Over the 2,000 the recipe used to cut at — and its kept copy is whole now.
    expect(Array.from(brief).length).toBeGreaterThan(2000);
    const recipe = recastRow({
      source: { kind: "upload", clipId: "c", container: "mp4" },
      job: "scene",
      engine: "kling-edit",
      keeps: [],
      direction,
      castTag: "A",
      brief,
      lock: false,
      groupId: null,
      window: null,
      fromClipId: null,
    });
    expect(recipe.brief).toBe(brief);
  });

  it("fits each engine's own prompt, and gives Luma and Restage their 6,000", () => {
    const direction = directionOf(600);
    const long = { ...busy, motion: `${busy.motion} `.repeat(8).trim() };
    for (const engine of ["luma-720", "h3-768"] as const) {
      const brief = composeRecastBrief({ job: RECAST_ENGINES[engine].job, engine, read: long, window, casting: engine === "luma-720" ? null : casting, keeps: keepsOf(6), direction });
      // Nothing of the read had to give way inside 6,000.
      expect(brief).toContain(long.motion);
      if (engine === "luma-720") expect(brief).toContain("Person D:");
      expect(brief).toContain(direction);
      expect(Array.from(brief).length).toBeGreaterThan(2500);
    }
  });
});

describe("what gives way when a brief is too long — ours, never theirs", () => {
  const casting = { tag: "B", many: true, characterName: "Anubis", token: "@Image1" };
  const compose = (directionLength: number, keeps = 6, engine: RecastEngine = "kling-edit") =>
    composeRecastBrief({
      job: "scene",
      engine,
      read: busy,
      window: { start: 0, end: 15 },
      casting,
      keeps: keepsOf(keeps),
      direction: directionOf(directionLength),
      images: ["@Image2", "@Image3"],
      continuing: true,
      look: "@Image4",
    });
  const continuityOf = (brief: string) => brief.slice(brief.indexOf("CONTINUITY\n"), brief.indexOf("\n\nKEEP"));

  it("never cuts the direction, and never shortens a later part's continuity words", () => {
    // Uncut: the same take composed inside Restage's 6,000.
    const whole = continuityOf(compose(600, 6, "h3-768"));
    expect(whole).toContain("IS that finished frame.");
    for (let length = 0; length <= 600; length += 25) {
      const brief = compose(length);
      expect(Array.from(brief).length).toBeLessThanOrEqual(2500);
      // Whole, wherever it stands: with the TASK on a scene take (2026-09-23).
      expect(brief).toContain(directionOf(length));
      expect(continuityOf(brief)).toBe(whole);
    }
  });

  it("lets the other people go, then our own wording, then the account, then the ticked keeps, and the read last of all", () => {
    const stages = new Set<string>();
    for (const keeps of [0, 3, 6]) {
      for (let length = 0; length <= 600; length += 10) {
        const brief = compose(length, keeps);
        const spare = ["A", "C", "D"].filter((tag) => brief.includes(`Person ${tag}:`)).length;
        const account = brief.includes(busy.motion);
        const ticked = (brief.match(/wristwatch/g) ?? []).length;
        const shortKeeps = brief.includes("Everyone and everything the TASK does not name, as it is in @Video1.");
        const who = brief.includes("Person B:");
        // STILL NEVER (review, 2026-09-22): the window's cuts and the place by
        // name. A window with a cut in it is never called one continuous shot,
        // and "the setting" in the abstract let the engine build an Egyptian
        // field where a school courtyard had been.
        expect(brief).toContain("cutting at");
        expect(brief).toContain(busy.world);
        // Our own wording shortens only after the other people have gone.
        if (shortKeeps) expect(spare).toBe(0);
        // The account goes only after our own wording has shortened.
        if (!account) expect(shortKeeps).toBe(true);
        // The person's ticked keeps go last of our own material.
        if (ticked < keeps) expect(account).toBe(false);
        // WHO THE CAST REPLACES GOES LAST (review, 2026-09-22; re-pinned
        // 2026-09-23). It used to go never — and the TASK's negative costs
        // 160 characters on a brief that had none to spare at Kling's 2,500,
        // so at the top of the range this heaviest fixture gives up the read's
        // own line for Person B. It gives it up only when everything of ours
        // has gone and every ticked keep with it, and the TASK still says who
        // is replaced (by their mark, where the read gave one). This fixture —
        // a cast over a group in a LATER PART — is not a take the door will
        // send: it refuses that one outright (actions.ts, RECAST_GROUP_ONE_PART).
        if (!who) expect(ticked).toBe(0);
        if (!who) expect(account).toBe(false);
        stages.add(
          spare === 3
            ? "whole"
            : spare > 0
              ? "others going"
              : !shortKeeps
                ? "others gone"
                : account
                  ? "ours short"
                  : !who
                    ? "who gone"
                    : ticked === keeps
                      ? "account gone"
                      : "ticks going",
        );
      }
    }
    // Every step was reached somewhere on the way.
    expect([...stages].sort()).toEqual(["account gone", "ours short", "others going", "others gone", "ticks going", "who gone", "whole"].sort());
  });

  it("fits every shape of take the door can send without ever dropping a line of the keep list", () => {
    // The last resort (whole keep lines from the end) is for shapes the door
    // cannot make; every real one ends its keep list on its closing line.
    const direction = directionOf(600);
    for (const n of [1, 2, 3]) {
      for (const continuing of [false, true]) {
        const photos = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 4 : 1));
        const names = recastBriefNames({ job: "scene", engine: "kling-edit", photos, images: Math.min(3, recastImageRoom(n, continuing)) });
        const castings = photos.map((_, i) => ({ tag: ["A", "B", "C"][i], characterName: `Cast ${i + 1}`, token: names.cast[i] }));
        const brief = composeRecastBrief({
          job: "scene",
          engine: "kling-edit",
          read: busy,
          window: { start: 0, end: 15 },
          casting: n === 1 ? castings[0] : castings,
          keeps: keepsOf(6),
          direction,
          images: names.images,
          continuing,
          ...(continuing && names.look ? { look: names.look } : {}),
        });
        expect(brief, `${n} cast, continuing ${continuing}`).toContain(direction);
        // The keep list is the end of a scene brief now, and its closing line
        // is still the last line there is: the last resort never ran.
        expect(brief.split("\n").at(-1), `${n} cast, continuing ${continuing}`).toMatch(
          /^- Everyone and everything the TASK does not name(,| stays exactly as it is in @Video1)/,
        );
      }
    }
  });
});

describe("every job, every cast, every length: the whole direction is in the body that is sent", () => {
  // Every job × one, two and four characters × no images and three × a
  // single piece and a long take, with the most a person can write.
  const direction = directionOf(600);
  const clipUrl = "https://x/clip.mp4";
  const photoOf = (who: number, n: number) => ({ front: `https://x/${who}-0.jpg`, more: Array.from({ length: n - 1 }, (_, i) => `https://x/${who}-${i + 1}.jpg`) });

  for (const job of RECAST_JOB_ORDER) {
    for (const engine of RECAST_ENGINE_ORDER.filter((e) => RECAST_ENGINES[e].job === job)) {
      for (const characters of [1, 2, 4]) {
        for (const asked of [0, 3]) {
          for (const long of [false, true]) {
            it(`${engine} · ${characters} cast · ${asked} images · ${long ? "long take" : "one piece"}`, () => {
              const spec = RECAST_ENGINES[engine];
              const chained = long && spec.chains === true;
              // What one take carries, the action's own rules.
              const inTake = job === "world" ? 0 : job === "motion" ? 1 : characters;
              const photos = Array.from({ length: inTake }, (_, i) => (i % 2 === 0 ? 4 : 1));
              const images =
                job === "world" || job === "motion"
                  ? 0
                  : spec.restages
                    ? Math.min(asked, recastRestageImageRoom(photos))
                    : Math.min(asked, recastImageRoom(inTake, chained));
              const names = recastBriefNames({ job, engine, photos, images });
              const castings = photos.map((_, i) => ({ tag: ["A", "B", "C", "D"][i], characterName: `Cast ${i + 1}`, ...(names.cast[i] ? { token: names.cast[i] } : {}) }));
              const parts = chained ? 3 : 1;
              for (let k = 0; k < parts; k++) {
                const brief = composeRecastBrief({
                  job,
                  engine,
                  read: busy,
                  window: long ? { start: k * 9, end: k * 9 + 11 } : { start: 0, end: Math.min(15, job === "world" ? 10 : 15) },
                  casting: castings.length === 0 ? null : castings.length === 1 ? castings[0] : castings,
                  keeps: job === "scene" ? keepsOf(3) : [],
                  direction,
                  images: names.images,
                  continuing: k > 0,
                  ...(k > 0 && names.look ? { look: names.look } : {}),
                });
                const people = photos.map((n, i) => photoOf(i, n));
                const body = recastRequestBody(engine, {
                  clipUrl,
                  ...(people.length === 1 ? { characterImageUrl: people[0].front, morePhotoUrls: people[0].more } : {}),
                  ...(people.length > 1 ? { ensemble: people } : {}),
                  imageUrls: Array.from({ length: images }, (_, i) => `https://x/added-${i}.jpg`),
                  brief,
                  clip: { seconds: 11 },
                });
                if (!spec.takesDirection) {
                  expect(body).not.toHaveProperty("prompt");
                  continue;
                }
                const prompt = String(body.prompt);
                expect(prompt).toBe(brief);
                expect(prompt).toContain(direction);
                expect(Array.from(prompt).length).toBeLessThanOrEqual(spec.promptMax);
              }
            });
          }
        }
      }
    }
  }
});

// YOUR WORDS WIN OVER OUR OWN KEEP LIST (2026-09-22): "start close on her
// face and pull out", "arms crossed", "dress her as Cleopatra" were sent
// beside KEEP EXACTLY the camera, the performance and everything else.
describe("your words win over our own keep list — on a take of one piece", () => {
  // "the direction", not "the direction below", since their words moved up to
  // sit with the TASK (2026-09-23): one word out, and the block they are in is
  // headed DIRECTION wherever it stands.
  const UNLESS = "unless the direction changes it";
  const direction = "Start close on her face and slowly pull out; she stands with her arms crossed.";
  const keepBlock = (brief: string) => {
    const lines = brief.split("\n");
    const at = lines.findIndex((l) => l === "KEEP" || l === "KEEP EXACTLY");
    const end = lines.indexOf("", at);
    return { heading: lines[at], bullets: lines.slice(at + 1, end === -1 ? undefined : end) };
  };
  const shapes = {
    element: { tag: "A", characterName: "Eva", token: "@Element1" },
    image: { tag: "A", characterName: "Eva", token: "@Image1" },
    group: { tag: "B", many: true, characterName: "Anubis", token: "@Image1" },
    together: [
      { tag: "A", characterName: "Eva", token: "@Element1" },
      { tag: "B", many: true, characterName: "Anubis", token: "@Image1" },
    ],
    nobody: null,
  };
  const released = (casting: (typeof shapes)[keyof typeof shapes], more: Partial<{ keeps: number; direction: string; longTake: boolean; continuing: boolean }> = {}) =>
    composeRecastBrief({
      job: "scene",
      engine: "kling-edit",
      read: busy,
      window: { start: 0, end: 12 },
      casting,
      keeps: keepsOf(more.keeps ?? 2),
      direction: more.direction ?? direction,
      images: ["@Image2"],
      ...(more.longTake ? { longTake: true } : {}),
      ...(more.continuing ? { continuing: true, look: "@Image3" } : {}),
    });

  it("holds every keep line only until the direction changes it — none stays unconditional", () => {
    for (const [name, casting] of Object.entries(shapes)) {
      // A light take, and one long enough that our own keep wording goes short.
      for (const brief of [released(casting), released(casting, { keeps: 6, direction: directionOf(600) })]) {
        const { heading, bullets } = keepBlock(brief);
        expect(heading, name).toBe("KEEP");
        expect(bullets.length, name).toBeGreaterThan(2);
        for (const line of bullets) {
          if (line === "- Everything the direction does not change stays exactly as it is in @Video1.") continue;
          expect(line, `${name}: ${line}`).toContain(UNLESS);
        }
        // The task's own promise about the performance, too.
        expect(brief, name).toContain(`Keep the performance exactly as it is, ${UNLESS}.`);
        expect(brief, name).not.toContain("KEEP EXACTLY");
        expect(brief, name).not.toContain("unchanged:");
      }
    }
  });

  it("still keeps whatever the words do not change: the place by name, the ticked keeps, and the rest", () => {
    const brief = released(shapes.element);
    expect(brief).toContain(`- The place it happens in — ${UNLESS}: ${busy.world}`);
    expect(brief).toContain(`- a silver wristwatch on the left wrist of the lead performer, item 1 that must survive — ${UNLESS}.`);
    expect(brief).toContain(`- Everyone and everything the TASK does not name stays exactly as it is in @Video1 — ${UNLESS}.`);
    // The character is still the character: face, hair and build are not keep lines.
    expect(brief).toContain("Their face, hair and build come from those photos and must stay the same in every frame.");
    expect(brief).toContain(direction);
    // Nobody cast, nobody named in the TASK: that shape's closing line is the
    // one it always was.
    expect(released(shapes.nobody)).toContain("- Everything the direction does not change stays exactly as it is in @Video1.");
  });

  it("is word for word today's brief when there is no direction", () => {
    for (const [name, casting] of Object.entries(shapes)) {
      if (casting === null) continue; // Words alone always have a direction.
      const plain = released(casting, { direction: "" });
      expect(plain, name).toBe(released(casting, { direction: "", longTake: true }));
      expect(keepBlock(plain).heading, name).toBe("KEEP EXACTLY");
      expect(plain, name).not.toContain(UNLESS);
    }
  });

  it("never reaches a long take's parts — the first or the later ones", () => {
    // Released there, "start close and pull out" could restart at the top of
    // every part, and a later part follows the footage it is handed again
    // (21175109, 825c6f53). Every part keeps today's lines exactly.
    for (const [name, casting] of Object.entries(shapes)) {
      for (const continuing of [false, true]) {
        const part = released(casting, { longTake: true, continuing });
        expect(keepBlock(part).heading, `${name} ${continuing}`).toBe("KEEP EXACTLY");
        for (const line of keepBlock(part).bullets) {
          // A take with NOBODY cast has always held its one place line only
          // until the words move it (2026-09-19: their words are the whole
          // task there, and the place is the first thing they change). It
          // reads as a released line now only because UNLESS lost the word
          // "below" when the direction moved up — the line itself is the one
          // every part was always sent.
          if (casting === null && line.startsWith("- The place it happens in,")) continue;
          expect(line, `${name} ${continuing}`).not.toContain(UNLESS);
        }
        expect(part, `${name} ${continuing}`).toContain("Keep the performance exactly as it is.");
        expect(part, `${name} ${continuing}`).not.toContain(`exactly as it is, ${UNLESS}`);
      }
      // A later part is never released, even if nobody said it was a long take.
      expect(released(casting, { continuing: true }), name).not.toContain(`exactly as it is, ${UNLESS}`);
    }
  });

  it("belongs to Into the clip alone — the other jobs' briefs are as they were", () => {
    for (const job of ["restage", "motion", "world"] as const) {
      const brief = composeRecastBrief({ job, read: busy, window: { start: 0, end: 10 }, casting: job === "world" ? null : shapes.element, keeps: keepsOf(2), direction });
      expect(brief, job).not.toContain(UNLESS);
    }
  });
});

// THE BRIEF SAYS REPLACE (2026-09-23). One 15 s window of a school courtyard,
// paid for twice: the brief that sent the person's direction last put the
// character BESIDE the man and ignored the wardrobe twice; the same clip with
// the direction inside the instruction replaced him in place, dressed him as
// asked and kept the real crowd. What neither wording fixed is the load limit
// — a lead swap and a whole-crowd swap in one render still duplicate — and no
// line here pretends otherwise.
describe("the TASK says the person is gone", () => {
  const scene = (casting: Parameters<typeof composeRecastBrief>[0]["casting"], more: Partial<{ direction: string; keeps: number; continuing: boolean }> = {}) =>
    composeRecastBrief({
      job: "scene",
      engine: "kling-edit",
      read: busy,
      window: { start: 0, end: 15 },
      casting,
      keeps: keepsOf(more.keeps ?? 0),
      direction: more.direction ?? "",
      images: [],
      ...(more.continuing ? { continuing: true, look: "@Image1" } : {}),
    });
  const eva = { tag: "A", characterName: "Eva", token: "@Element1" };

  it("says all three things the paid re-run said, beside the order to replace", () => {
    const brief = scene(eva);
    expect(brief).toContain("The person @Element1 replaces appears in no frame of @Video1");
    expect(brief).toContain("how many people are in the shot, and where each of them stands, never changes");
    expect(brief).toContain("@Element1 stands in their exact position, doing exactly what they did.");
    // In the TASK, where the order is — not somewhere after the keep list.
    expect(brief.indexOf("appears in no frame")).toBeLessThan(brief.indexOf("THE CHARACTER"));
    expect(brief.split("\n")[1].startsWith("Replace Person A in @Video1 with @Element1.")).toBe(true);
    expect(brief.split("\n")[2].startsWith("The person @Element1 replaces")).toBe(true);
  });

  it("borrows the head count from the restyle, which has said it that way all along", () => {
    expect(composeRecastBrief({ ...base, job: "world", casting: null, direction: "Night and neon." })).toContain(
      "How many people are in the shot, and where each of them stands.",
    );
    expect(scene(eva)).toContain("how many people are in the shot, and where each of them stands, never changes");
  });

  it("counts both sides: a group is places, several characters are people", () => {
    const group = scene({ tag: "B", many: true, characterName: "Anubis", token: "@Image1" });
    expect(group).toContain("The people @Image1 replaces appear in no frame of @Video1");
    expect(group).toContain("@Image1 stands in their exact positions, doing exactly what they did.");
    const both = scene([eva, { tag: "B", characterName: "Anubis", token: "@Image1" }]);
    expect(both).toContain("The people @Element1 and @Image1 replace appear in no frame of @Video1");
    expect(both).toContain("@Element1 and @Image1 stand in their exact positions, doing exactly what they did.");
  });

  it("is said only where someone is actually replaced", () => {
    // Words alone, a character only PUT into the clip, and the other jobs:
    // nobody goes out, so there is no head count to promise.
    expect(scene(null, { direction: "Make it snow." })).not.toContain("in no frame of");
    expect(scene({ tag: null, characterName: "Eva", token: "@Element1" }, { direction: "Put her at the back." })).not.toContain("in no frame of");
    for (const job of ["restage", "motion", "world"] as const) {
      const brief = composeRecastBrief({ ...base, job, casting: job === "world" ? null : eva, direction: "Night and neon." });
      expect(brief, job).not.toContain("in no frame of");
    }
  });

  it("gives up its last clause before the brief gives up anything of the person's own", () => {
    // Under pressure our own wording goes short (composeRecastBrief's second
    // step) and the negative goes with it: the clause that drops is the one
    // "where each of them stands never changes" already says.
    const tight = scene(eva, { direction: directionOf(600), keeps: 6, continuing: true });
    expect(Array.from(tight).length).toBeLessThanOrEqual(RECAST_ENGINES["kling-edit"].promptMax);
    expect(tight).toContain("The person @Element1 replaces appears in no frame of @Video1");
    expect(tight).toContain("how many people are in the shot, and where each of them stands, never changes.");
    expect(tight).not.toContain("stands in their exact position, doing exactly what they did");
    expect(tight).toContain(directionOf(600));
  });
});

describe("the keep list's last line", () => {
  const casting = { tag: "A", characterName: "Eva", token: "@Element1" };
  const closing = (brief: string) => brief.split("\n").filter((l) => l.startsWith("- ")).at(-1) ?? "";

  it("no longer reads as an order to keep the person the TASK replaces", () => {
    // The catch-all was the last line the engine saw, and "everything else"
    // includes the man in the white shirt.
    for (const brief of [
      composeRecastBrief({ ...base, job: "scene", casting }),
      composeRecastBrief({ ...base, job: "scene", casting, direction: "Dress her as Cleopatra." }),
      composeRecastBrief({ job: "scene", engine: "kling-edit", read: busy, window: { start: 0, end: 15 }, casting, keeps: keepsOf(6), direction: directionOf(600), images: [], continuing: true, look: "@Image1" }),
    ]) {
      expect(brief).not.toContain("Everything else stays exactly as it is in @Video1.");
      expect(brief).not.toContain("Everyone not named above, and everything else in @Video1, as it is.");
      expect(closing(brief)).toMatch(/^- Everyone and everything the TASK does not name/);
    }
  });

  it("still promises everyone the TASK does not name, which is the whole rest of the shot", () => {
    const brief = composeRecastBrief({ job: "scene", engine: "kling-edit", read: busy, window: { start: 0, end: 15 }, casting, keeps: [], direction: "", images: [] });
    // The crowd that collapsed back to real schoolboys at the hard bow is
    // exactly who this line is for, and none of them is named in the TASK.
    expect(brief).toContain("Everyone and everything the TASK does not name stays exactly as it is in @Video1.");
    expect(brief).toContain("Person B: left background");
  });
});

// A tag is ours, not the picture's: "Person A" means nothing to a model
// looking at a courtyard with forty schoolboys in it. The read lane gives the
// people a take REPLACES a plain-words mark, and the TASK leads with it.
describe("the mark for the person being replaced", () => {
  const marked = (tag: string, mark: string): RecastRead => ({
    ...busy,
    people: busy.people.map((p) => (p.tag === tag ? { ...p, mark } : p)),
  });
  const scene = (read: RecastRead, casting: Parameters<typeof composeRecastBrief>[0]["casting"]) =>
    composeRecastBrief({ job: "scene", engine: "kling-edit", read, window: { start: 0, end: 15 }, casting, keeps: [], direction: "Dress her as Cleopatra.", images: [] });

  it("leads the TASK, with the tag beside it so THE SOURCE still ties to the same person", () => {
    const brief = scene(marked("A", "the man in the white shirt"), { tag: "A", characterName: "Eva", token: "@Element1" });
    expect(brief).toContain("Replace the man in the white shirt (Person A) in @Video1 with @Element1.");
    expect(brief).toContain("Person A: centre, facing camera");
  });

  it("says the tag alone when the read gave no mark, or gave no read at all", () => {
    expect(scene(busy, { tag: "A", characterName: "Eva", token: "@Element1" })).toContain("Replace Person A in @Video1 with @Element1.");
    expect(composeRecastBrief({ ...base, job: "scene", read: null, casting: { tag: "A", characterName: "Eva", token: "@Element1" } })).toContain(
      "Replace Person A in @Video1 with @Element1.",
    );
  });

  it("marks a group as a group, every one of them", () => {
    const brief = scene(marked("B", "the schoolboys in the rows behind him"), { tag: "B", many: true, characterName: "Anubis", token: "@Image1" });
    expect(brief).toContain("Replace every single one of the schoolboys in the rows behind him (Person B’s group) in @Video1 with @Image1.");
  });

  it("gives every replaced character their own, in a take of several", () => {
    const read: RecastRead = {
      ...busy,
      people: busy.people.map((p) => (p.tag === "A" ? { ...p, mark: "the man in the white shirt" } : p.tag === "B" ? { ...p, mark: "the students in the rows" } : p)),
    };
    const brief = scene(read, [
      { tag: "A", characterName: "Eva", token: "@Element1" },
      { tag: "B", many: true, characterName: "Anubis", token: "@Image1" },
    ]);
    expect(brief).toContain(
      "Replace the man in the white shirt (Person A) in @Video1 with @Element1, and every single one of the students in the rows (Person B’s group) with @Image1.",
    );
  });

  it("is used for nobody else — not for a character only put into the clip, and not for the people who stay", () => {
    // Person C stays in the shot. Nothing about how they look travels onward:
    // that is the read's rule (recast-read.ts) and this is where it would leak.
    const brief = scene(marked("C", "the girl with the red bag"), { tag: "A", characterName: "Eva", token: "@Element1" });
    expect(brief).not.toContain("the girl with the red bag");
    expect(brief).toContain("Person C: right edge");
    const placed = scene(marked("A", "the man in the white shirt"), [
      { tag: "A", characterName: "Eva", token: "@Element1" },
      { tag: null, characterName: "Anubis", token: "@Image1" },
    ]);
    expect(placed).toContain("Put @Image1 into @Video1 as the direction below says.");
    expect(placed.match(/the man in the white shirt/g)).toHaveLength(1);
  });

  it("is bounded like the read's own fields, so the door and the server compose the same words", () => {
    // The read makes a round trip through a browser between the two calls.
    const brief = scene(marked("A", "y".repeat(RECAST_MARK_MAX_CHARS + 40)), { tag: "A", characterName: "Eva", token: "@Element1" });
    expect(brief).toContain(`Replace ${"y".repeat(RECAST_MARK_MAX_CHARS)} (Person A) in @Video1`);
  });
});

describe("the names a take's words use", () => {
  it("are the ones the door names them with, for every cast", () => {
    // The door composes its names from the same three pieces (mystique-door.tsx);
    // the action from recastBriefNames. Pinned equal, shape by shape.
    for (const photos of [[], [1], [4], [4, 1], [1, 1, 2], [2, 3, 1, 1]]) {
      for (const images of [0, 1, 3]) {
        const scene = recastBriefNames({ job: "scene", engine: "kling-edit", photos, images });
        expect(scene.cast).toEqual(recastCastTokens(photos));
        expect(scene.images).toEqual(recastImageTokens(recastCastTokens(photos), images));
        const restage = recastBriefNames({ job: "restage", engine: "h3-768", photos, images });
        const { tokens, used } = recastRestageTokens(photos);
        expect(restage.cast).toEqual(tokens);
        expect(restage.images).toEqual(Array.from({ length: images }, (_, i) => `Image ${used + 1 + i}`));
        expect(restage.look).toBeNull();
      }
    }
    // The engines that read no names are given none.
    expect(recastBriefNames({ job: "motion", engine: "kling-pro", photos: [4], images: 1 })).toEqual({ cast: [], images: [], look: null });
  });

  it("name a later part's still after every other picture", () => {
    expect(recastBriefNames({ job: "scene", engine: "kling-edit", photos: [4], images: 2 }).look).toBe("@Image3");
    expect(recastBriefNames({ job: "scene", engine: "kling-edit", photos: [1, 4], images: 1 }).look).toBe("@Image3");
  });
});

// A LONG TAKE'S LATER PARTS GET EVERY PICTURE THEY ARE TOLD ABOUT (2026-09-22).
// Four characters past 15 s left the still no room, and the body dropped it
// without a word — a part told to follow a finished frame it was never sent.
describe("every picture a part's words name is in that part's body", () => {
  const clipUrl = CHAIN_CLIP_PLACEHOLDER;
  // Every cast of one to four, each character sent as an element (four
  // photos) or as one photo, beside none to three added images, in a take
  // made in parts and in one of one piece.
  const casts: number[][] = [];
  for (let n = 1; n <= 4; n++) {
    for (let mask = 0; mask < 2 ** n; mask++) casts.push(Array.from({ length: n }, (_, i) => ((mask >> i) & 1 ? 4 : 1)));
  }

  for (const photos of casts) {
    for (const asked of [0, 1, 2, 3]) {
      for (const long of [true, false]) {
        it(`${photos.map((p) => (p > 1 ? "element" : "photo")).join("+")} · ${asked} images · ${long ? "long take" : "one piece"}`, () => {
          if (long && !recastChainFits(photos.length)) {
            // Turned away before any credit moves (actions.ts), and the body
            // refuses a part without its still rather than send it.
            expect(photos.length).toBe(4);
            expect(() =>
              recastRequestBody("kling-edit", {
                clipUrl,
                ensemble: photos.map((p, i) => ({ front: `https://x/c${i}.jpg`, more: Array.from({ length: p - 1 }, (_, k) => `https://x/c${i}-${k}.jpg`) })),
                imageUrls: [CHAIN_LOOK_PLACEHOLDER],
                brief: "x",
              }),
            ).toThrow();
            return;
          }
          const images = Math.min(asked, recastImageRoom(photos.length, long));
          const names = recastBriefNames({ job: "scene", engine: "kling-edit", photos, images });
          const people = photos.map((p, i) => ({ front: `https://x/c${i}.jpg`, more: Array.from({ length: p - 1 }, (_, k) => `https://x/c${i}-${k}.jpg`) }));
          const added = Array.from({ length: images }, (_, i) => `https://x/added-${i}.jpg`);
          const castings = photos.map((_, i) => ({ tag: ["A", "B", "C", "D"][i], characterName: `Cast ${i + 1}`, token: names.cast[i] }));
          for (let k = 0; k < (long ? 3 : 1); k++) {
            const look = k > 0 && names.look ? names.look : undefined;
            const brief = composeRecastBrief({
              job: "scene",
              engine: "kling-edit",
              read: busy,
              window: long ? { start: k * 9, end: k * 9 + 11 } : { start: 0, end: 15 },
              casting: castings.length === 1 ? castings[0] : castings,
              keeps: [],
              direction: "Everyone waves in image 1.",
              images: names.images,
              continuing: k > 0,
              ...(look ? { look } : {}),
              longTake: long,
            });
            // The action's own body for this part (actions.ts: the still's place from the second part on).
            const body = recastRequestBody("kling-edit", {
              clipUrl,
              ...(people.length === 1 ? { characterImageUrl: people[0].front, morePhotoUrls: people[0].more } : { ensemble: people }),
              imageUrls: k > 0 ? [...added, CHAIN_LOOK_PLACEHOLDER] : added,
              brief,
            });
            const imageUrls = (body.image_urls as string[] | undefined) ?? [];
            const elements = (body.elements as { frontal_image_url: string }[] | undefined) ?? [];
            // Every name the words use is a picture the body carries…
            for (const [, kind, index] of brief.matchAll(/@(Image|Element)(\d+)/g)) {
              const list: unknown[] = kind === "Image" ? imageUrls : elements;
              expect(list[Number(index) - 1], `part ${k + 1}: @${kind}${index}`).toBeDefined();
            }
            // …and the RIGHT picture: each character's own, each added image, the still.
            names.cast.forEach((token, i) => {
              const at = Number(token.replace(/\D/g, "")) - 1;
              if (token.startsWith("@Element")) expect(elements[at].frontal_image_url).toBe(people[i].front);
              else expect(imageUrls[at]).toBe(people[i].front);
            });
            names.images.forEach((token, i) => expect(imageUrls[Number(token.replace(/\D/g, "")) - 1]).toBe(added[i]));
            if (look) {
              expect(brief).toContain(`${look} IS that finished frame.`);
              expect(imageUrls[Number(look.replace(/\D/g, "")) - 1]).toBe(CHAIN_LOOK_PLACEHOLDER);
            } else {
              expect(imageUrls).not.toContain(CHAIN_LOOK_PLACEHOLDER);
            }
            expect(imageUrls.length + elements.length).toBeLessThanOrEqual(4);
          }
        });
      }
    }
  }
});

describe("the words a take was sent, read back from its log", () => {
  it("gives every part's words for a long take, and the one brief for a take of one piece", () => {
    expect(recastSentBriefs([{ attempt: 1, compiledPrompt: "one", partBriefs: ["one", "two", "three"], steps: [] }]).parts).toEqual(["one", "two", "three"]);
    expect(recastSentBriefs([{ attempt: 1, compiledPrompt: "only", steps: [] }]).parts).toEqual(["only"]);
  });

  it("reads Restage's own rewrite where one was recorded", () => {
    expect(recastSentBriefs([{ compiledPrompt: "ours" }, { compiledPrompt: "ours", expandedPrompt: "theirs" }]).expanded).toBe("theirs");
    expect(recastSentBriefs([{ compiledPrompt: "ours" }]).expanded).toBeNull();
  });

  it("reads anything else as nothing", () => {
    for (const log of [null, undefined, "x", 3, {}, [], [null], [{ partBriefs: [1, 2] }], [{ compiledPrompt: 4 }]]) {
      expect(recastSentBriefs(log)).toEqual({ parts: [], expanded: null });
    }
  });
});
