import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chainMinutes } from "../generations/chain";
import { RECAST_ENGINES, RECAST_JOB_ORDER, recastEnginesOf, recastMissing, type RecastJob } from "./recast";
import { recastWindowCredits } from "./trim";
import type { RecastPerson, RecastRead } from "./recast-read";
import {
  RECAST_STOPPED_STEP,
  recastBlocker,
  recastCreditsLeft,
  recastFitWindow,
  recastJobPromise,
  recastLengthChoices,
  recastLengthFloor,
  recastLocalLengthProblem,
  recastMinutes,
  recastSlotOffer,
  recastSuggestJob,
  recastTakeOutcome,
  recastTakeReport,
  recastTierIsSofter,
  recastWait,
  type RecastDoorState,
} from "./door-truth";

// What the door may say (2026-09-22). Each answer is computed once, from the
// rules the server runs on, so the header, the price line and the cards can
// no longer disagree with one another or with the take.

describe("how long a take waits", () => {
  it("times Into the clip by the long take's own rule, one piece or several", () => {
    // chain.ts: about a minute a rendered second, the re-rendered second of
    // each later part included — the same number the long-take line says.
    for (const s of [5, 10, 15, 16, 28, 30]) expect(recastMinutes("kling-edit", s)).toBe(chainMinutes(s));
    expect(recastMinutes("kling-edit", 30)).toBe(35);
  });

  it("times the other jobs from their measured renders, never under three minutes", () => {
    // Kling V3 Motion Control Pro: 3 s in 152 s.
    expect(recastMinutes("kling-pro", 3)).toBe(3);
    expect(recastMinutes("kling-pro", 30)).toBe(26);
    // Luma: a 5 s or a 10 s slot, whatever the window — 3 s in 153 s.
    expect(recastMinutes("luma-720", 4)).toBe(3);
    expect(recastMinutes("luma-720", 5.2)).toBe(recastMinutes("luma-720", 10));
    expect(recastMinutes("luma-720", 10)).toBe(6);
    // H3: 5 s in 31 s — the floor holds it at three.
    expect(recastMinutes("h3-768", 15)).toBe(3);
  });

  it("never replaces the estimate with a flat range", () => {
    // The old card said "3–20 min" for a take the page itself put at 35.
    expect(recastMinutes("kling-edit", 30)).toBeGreaterThan(20);
  });
});

describe("where a rendering take stands", () => {
  const at = (minutes: number) => Date.parse("2026-09-22T10:00:00Z") + minutes * 60_000;
  const take = { engine: "kling-edit" as const, seconds: 28, createdAt: "2026-09-22T10:00:00Z" };

  it("counts from the take's own start, and says what is left", () => {
    // 28 s is about 30 minutes.
    expect(recastWait(take, at(0))).toEqual({ elapsed: 0, left: 30, late: false });
    expect(recastWait(take, at(14.2))).toEqual({ elapsed: 14, left: 16, late: false });
    expect(recastWait(take, at(29.9))).toEqual({ elapsed: 29, left: 1, late: false });
  });

  it("says it is late past the estimate, never a negative count", () => {
    expect(recastWait(take, at(31))).toEqual({ elapsed: 31, left: null, late: true });
    expect(recastWait(take, at(300)).left).toBeNull();
  });

  it("says nothing about what is left when it cannot know", () => {
    expect(recastWait({ ...take, engine: null }, at(5))).toEqual({ elapsed: 5, left: null, late: false });
    expect(recastWait({ ...take, createdAt: "not a date" }, at(5)).elapsed).toBe(0);
    // A clock a little behind the server's never counts backwards.
    expect(recastWait(take, at(-2)).elapsed).toBe(0);
  });
});

describe("how a take that did not deliver ended", () => {
  const log = (...details: string[]) => [{ attempt: 1, steps: details.map((detail) => ({ step: "generate", detail })), passed: false, issues: [], compiledPrompt: "" }];

  it("reads a stop as a stop, not a failure", () => {
    expect(recastTakeOutcome({ credits_used: 9, pipeline_log: log("Submitted.", RECAST_STOPPED_STEP) })).toEqual({ stopped: true, reason: null, charged: true });
    // The runner's own words for it (job-runner.ts, the cancel path).
    expect(RECAST_STOPPED_STEP).toBe("Stopped.");
  });

  it("says whether the credits came back: a refund zeroes credits_used", () => {
    expect(recastTakeOutcome({ credits_used: 0, pipeline_log: log(RECAST_STOPPED_STEP) }).charged).toBe(false);
    expect(recastTakeOutcome({ credits_used: 0, pipeline_log: log("That take was already started.") }).charged).toBe(false);
    expect(recastTakeOutcome({ credits_used: 12, pipeline_log: [] }).charged).toBe(true);
    // A legacy NULL is counted as spent, the way the monthly sum counts it.
    expect(recastTakeOutcome({ credits_used: null, pipeline_log: [] }).charged).toBe(true);
  });

  it("gives the last thing the runner said as the reason — never a raw provider reply", () => {
    expect(recastTakeOutcome({ credits_used: 6, pipeline_log: log("Rendering.", "Couldn't start this take — nothing was charged. Try again.") }).reason).toBe(
      "Couldn't start this take — nothing was charged. Try again.",
    );
    expect(recastTakeOutcome({ credits_used: 6, pipeline_log: log('Kling error (422): {"detail":"bad"}') }).reason).toBeNull();
    expect(recastTakeOutcome({ credits_used: 6, pipeline_log: "nonsense" }).reason).toBeNull();
    expect(recastTakeOutcome({ credits_used: 6, pipeline_log: undefined }).reason).toBeNull();
  });
});

describe("the take report the runner writes", () => {
  const withReport = (report: unknown, more: unknown[] = []) => [
    { attempt: 1, steps: [{ step: "generate", detail: "Rendered." }, { step: "take-report", report }, ...more], passed: true, issues: [], compiledPrompt: "" },
  ];

  it("reads one line per face: the lowest score and how many moments it is the lowest of", () => {
    const report = { faces: [{ characterId: "c1", name: "Eva", lowest: 88, scores: [91, 88, 94] }] };
    expect(recastTakeReport(withReport(report))).toEqual(report);
  });

  it("takes the LAST report on the log", () => {
    const first = { faces: [{ characterId: "c1", name: "Eva", lowest: 40, scores: [40] }] };
    const last = { faces: [{ characterId: "c1", name: "Eva", lowest: 77, scores: [77, 80] }] };
    expect(recastTakeReport(withReport(first, [{ step: "take-report", report: last }]))).toEqual(last);
  });

  it("drops what does not have the contract's shape, and is null with nothing left", () => {
    const report = {
      faces: [
        { characterId: "c1", name: "Eva", lowest: 88, scores: [88, "x", 90] },
        { characterId: "c2", name: "Anubis", lowest: "high" },
        { name: "no id", lowest: 50, scores: [] },
      ],
    };
    expect(recastTakeReport(withReport(report))).toEqual({ faces: [{ characterId: "c1", name: "Eva", lowest: 88, scores: [88, 90] }] });
    expect(recastTakeReport(withReport({ faces: [] }))).toBeNull();
    expect(recastTakeReport(withReport(null))).toBeNull();
    expect(recastTakeReport([])).toBeNull();
    expect(recastTakeReport(null)).toBeNull();
  });
});

describe("what each job promises", () => {
  const keepsSound = (job: RecastJob) => recastEnginesOf(job).every((e) => RECAST_ENGINES[e].keepsSound);

  it("says the sound is kept exactly when every engine the job offers keeps it", () => {
    for (const job of RECAST_JOB_ORDER) {
      const promise = recastJobPromise(job);
      expect(promise.keeps.includes("sound"), job).toBe(keepsSound(job));
      expect(promise.silent, job).toBe(!keepsSound(job));
    }
    // Today: Into the clip and Photo to life keep it; Restage and Restyle come back silent.
    expect(recastJobPromise("scene").silent).toBe(false);
    expect(recastJobPromise("motion").silent).toBe(false);
    expect(recastJobPromise("restage").silent).toBe(true);
    expect(recastJobPromise("world").silent).toBe(true);
  });

  it("is derived from the flags, so a flag that changes changes the promise", () => {
    const spec = RECAST_ENGINES["kling-edit"];
    const was = spec.keepsSound;
    try {
      spec.keepsSound = false;
      expect(recastJobPromise("scene").silent).toBe(true);
      expect(recastJobPromise("scene").keeps).not.toContain("sound");
    } finally {
      spec.keepsSound = was;
    }
    expect(recastJobPromise("scene").keeps).toContain("sound");
  });

  it("says what each job changes", () => {
    expect(recastJobPromise("scene")).toEqual({ keeps: ["moves", "sound", "camera", "place"], changes: ["cast"], silent: false });
    // Restaged: the clip is a reference, so the moves and the camera are new.
    expect(recastJobPromise("restage")).toEqual({ keeps: ["place"], changes: ["moves", "camera", "cast"], silent: true });
    // The frame is built from the picture: no promise about the camera at all.
    expect(recastJobPromise("motion")).toEqual({ keeps: ["moves", "sound"], changes: ["picturePlace", "cast"], silent: false });
    expect(recastJobPromise("world")).toEqual({ keeps: ["moves", "camera"], changes: ["place", "everyone"], silent: true });
  });
});

describe("why Take is grey", () => {
  const base: RecastDoorState = {
    starting: false,
    clip: "ready",
    rights: true,
    job: "scene",
    missing: null,
    rolesUnsaid: false,
    hasWords: true,
    imageUploading: 0,
    groupNeedsOnePart: false,
    credits: 9,
    balance: { left: 140, unlimited: false },
  };
  // The door's old nine-condition canTake, restated from the page as it was
  // before 2026-09-22 — the blocker must agree with it on every state, and
  // add only the credits.
  const oldCanTake = (s: RecastDoorState) =>
    s.clip === "ready" &&
    s.rights &&
    !s.starting &&
    s.imageUploading === 0 &&
    !s.groupNeedsOnePart &&
    (s.missing ?? (s.rolesUnsaid ? "words" : null)) === null &&
    (s.job !== "world" || s.hasWords);
  const affordable = (s: RecastDoorState) => s.credits === null || !s.balance || s.balance.unlimited || s.credits <= s.balance.left;

  const table: [string, Partial<RecastDoorState>][] = [
    ["everything in place", {}],
    ["pressing", { starting: true }],
    ["no clip", { clip: "none" }],
    ["still uploading", { clip: "busy" }],
    ["rights not ticked", { rights: false }],
    ["nobody cast and no words", { missing: recastMissing("scene", { characters: 0, images: 0, words: false }), hasWords: false }],
    ["Photo to life with no picture", { job: "motion", missing: recastMissing("motion", { characters: 0, images: 0, words: true }) }],
    ["together, a role unsaid", { rolesUnsaid: true, hasWords: false }],
    ["Restyle with no words", { job: "world", hasWords: false }],
    ["image 2 uploading", { imageUploading: 2 }],
    ["a group over parts", { groupNeedsOnePart: true }],
    ["short of credits", { credits: 21, balance: { left: 20, unlimited: false } }],
    ["no limit", { credits: 400, balance: { left: 0, unlimited: true } }],
    ["balance unread", { credits: 400, balance: null }],
  ];

  it("enables Take exactly when there is nothing to name", () => {
    expect(table.length).toBeGreaterThanOrEqual(12);
    for (const [name, patch] of table) {
      const s = { ...base, ...patch };
      expect(recastBlocker(s) === null, name).toBe(oldCanTake(s) && affordable(s));
    }
  });

  it("names the FIRST thing missing, in the order the page is met", () => {
    const all = { ...base, rights: false, missing: "words" as const, imageUploading: 1, groupNeedsOnePart: true, credits: 999 };
    expect(recastBlocker({ ...all, clip: "none" })).toEqual({ kind: "clip" });
    expect(recastBlocker({ ...all, clip: "busy" })).toEqual({ kind: "reading" });
    expect(recastBlocker(all)).toEqual({ kind: "rights" });
    expect(recastBlocker({ ...all, rights: true })).toEqual({ kind: "words", why: "change" });
    expect(recastBlocker({ ...all, rights: true, missing: null })).toEqual({ kind: "image", n: 1 });
    expect(recastBlocker({ ...all, rights: true, missing: null, imageUploading: 0 })).toEqual({ kind: "group" });
    expect(recastBlocker({ ...all, rights: true, missing: null, imageUploading: 0, groupNeedsOnePart: false })).toEqual({
      kind: "credits",
      need: 999,
      left: 140,
    });
    expect(recastBlocker({ ...base, job: "world", hasWords: false })).toEqual({ kind: "words", why: "look" });
    expect(recastBlocker({ ...base, rolesUnsaid: true })).toEqual({ kind: "words", why: "roles" });
    expect(recastBlocker({ ...base, starting: true, clip: "none" })).toEqual({ kind: "starting" });
  });
});

describe("what an account has left", () => {
  const who = { isAdmin: false, plan: "growth", planStatus: "active", bonus: 0, purchased: 0, used: 0 };

  it("is the allowance left this period plus what was bought — checkGenerationAllowance's sum", () => {
    expect(recastCreditsLeft({ ...who, used: 100, purchased: 5 })).toEqual({ left: 45, unlimited: false });
    expect(recastCreditsLeft({ ...who, used: 100, bonus: 20 })).toEqual({ left: 60, unlimited: false });
    // Already over the allowance: only what was bought is left.
    expect(recastCreditsLeft({ ...who, used: 200, purchased: 7 })).toEqual({ left: 7, unlimited: false });
  });

  it("counts no allowance while a payment has failed, and none without a plan", () => {
    expect(recastCreditsLeft({ ...who, planStatus: "past_due", purchased: 3 })).toEqual({ left: 3, unlimited: false });
    expect(recastCreditsLeft({ ...who, planStatus: null })).toEqual({ left: 140, unlimited: false });
    expect(recastCreditsLeft({ ...who, plan: "none", purchased: 9 })).toEqual({ left: 9, unlimited: false });
    expect(recastCreditsLeft({ ...who, plan: null })).toEqual({ left: 0, unlimited: false });
  });

  it("never limits an admin", () => {
    expect(recastCreditsLeft({ ...who, isAdmin: true, plan: "none" }).unlimited).toBe(true);
  });
});

describe("lengths that cost what they say", () => {
  it("starts Restage at its own shortest take, or at the whole of a shorter clip", () => {
    expect(recastLengthFloor("restage", 28)).toBe(5);
    expect(recastLengthFloor("restage", 4.2)).toBe(4.2);
    expect(recastLengthFloor("scene", 28)).toBe(3);
    expect(recastLengthFloor("motion", 2.9)).toBe(2.9);
    expect(recastFitWindow({ start: 0, end: 3 }, 28, "restage")).toEqual({ start: 0, end: 5 });
    expect(recastFitWindow({ start: 26, end: 29 }, 28, "restage")).toEqual({ start: 23, end: 28 });
    // Every other job keeps the window it was given.
    expect(recastFitWindow({ start: 2, end: 5 }, 28, "scene")).toEqual({ start: 2, end: 5 });
  });

  it("offers a 5.2 s Restyle the cut to 5 s at 4 credits instead of charging the 10 s slot's 8", () => {
    const clip = { seconds: 12, frames: null };
    const offer = recastSlotOffer("luma-720", clip, { start: 0, end: 5.2 });
    expect(offer).toEqual({
      credits: 8,
      cut: { window: { start: 0, end: 5 }, credits: 4 },
      full: { window: { start: 0, end: 10 }, seconds: 10, credits: 8 },
    });
    // The door's own pricing call, nothing else.
    expect(offer!.cut.credits).toBe(recastWindowCredits("luma-720", clip, { start: 0, end: 5 }));
    expect(offer!.credits).toBe(recastWindowCredits("luma-720", clip, { start: 0, end: 5.2 }));
  });

  it("offers it across the whole 5–10 s range, and only as far as the clip goes", () => {
    const clip = { seconds: 12, frames: null };
    expect(recastSlotOffer("luma-540", clip, { start: 3, end: 11.4 })?.cut.window).toEqual({ start: 3, end: 8 });
    expect(recastSlotOffer("luma-720", clip, { start: 0, end: 9.9 })?.full?.window).toEqual({ start: 0, end: 10 });
    // A 7 s clip used whole: the cut is offered, and there is no more to use.
    const short = recastSlotOffer("luma-720", { seconds: 7, frames: null }, { start: 0, end: 7 });
    expect(short?.cut).toEqual({ window: { start: 0, end: 5 }, credits: 4 });
    expect(short?.full).toBeNull();
    // Nothing to offer inside the small slot, on the whole large one, or on any other job.
    expect(recastSlotOffer("luma-720", clip, { start: 0, end: 5 })).toBeNull();
    expect(recastSlotOffer("luma-720", clip, { start: 0, end: 10 })).toBeNull();
    expect(recastSlotOffer("kling-edit", clip, { start: 0, end: 5.2 })).toBeNull();
  });
});

describe("the door's first line", () => {
  it("mentions the sound only when every job keeps it", () => {
    const en = readFileSync(join(__dirname, "..", "i18n", "messages", "en.ts"), "utf8");
    const sub = en.match(/\n  mystique: \{[\s\S]*?\n    sub: "([^"]+)"/)?.[1] ?? "";
    expect(sub.length).toBeGreaterThan(40);
    const everyJobKeepsSound = RECAST_JOB_ORDER.every((j) => recastJobPromise(j).keeps.includes("sound"));
    if (!everyJobKeepsSound) expect(sub).not.toMatch(/sound/i);
  });
});

describe("which job suits a clip", () => {
  const person = (tag: string, lead = false, many = false): RecastPerson => ({ tag, where: "centre", does: "moves", lead, many });
  const read = (patch: Partial<RecastRead>): RecastRead => ({
    title: "a clip",
    motion: "someone moves",
    world: "a room",
    people: [person("A", true)],
    keeps: [],
    cuts: [],
    framing: "medium",
    sound: "ambient",
    headVisible: true,
    confidence: "high",
    ...patch,
  });
  // Any style of footage, not one test clip: each is described only by the
  // read's own fields.
  const clips: [string, RecastRead, number][] = [
    ["an animated character singing", read({ sound: "music" }), 12],
    ["a product turning on a table, no people", read({ people: [], sound: "music", framing: "close_up" }), 8],
    ["two people talking", read({ people: [person("A", true), person("B")], sound: "speech" }), 14],
    ["a wide dance", read({ framing: "wide", sound: "music" }), 9],
    ["a dance troupe, wide, long", read({ people: [person("A", true, true)], framing: "wide", sound: "music" }), 26],
    ["a screen recording with cuts and a narrator", read({ people: [], cuts: [2.1, 5.4], sound: "speech" }), 20],
    ["one person to camera, long", read({ framing: "close_up", sound: "speech" }), 25],
    ["one person to camera, short", read({ framing: "close_up", sound: "speech" }), 10],
    ["a full-body walk", read({ framing: "full" }), 7],
  ];

  it("reads each clip by its own fields", () => {
    const got = Object.fromEntries(clips.map(([name, r, s]) => [name, recastSuggestJob(r, s)]));
    expect(got).toEqual({
      "an animated character singing": "scene",
      "a product turning on a table, no people": "scene",
      "two people talking": "scene",
      "a wide dance": "world",
      "a dance troupe, wide, long": "world",
      "a screen recording with cuts and a narrator": "scene",
      // Into the clip would make it in parts; Photo to life does 30 s in one.
      "one person to camera, long": "motion",
      "one person to camera, short": "scene",
      "a full-body walk": "scene",
    });
  });

  it("never suggests Photo to life for a wide, full or several-person read, and never Restage", () => {
    for (const [name, r, s] of clips) {
      const job = recastSuggestJob(r, s);
      if (r.framing === "wide" || r.framing === "full" || r.people.length !== 1 || r.people.some((p) => p.many)) expect(job, name).not.toBe("motion");
      expect(job, name).not.toBe("restage");
    }
  });

  it("suggests nothing from an unsure read, or none", () => {
    expect(recastSuggestJob(read({ confidence: "low" }), 10)).toBeNull();
    expect(recastSuggestJob(null, 10)).toBeNull();
  });
});

describe("quality that says what it trades", () => {
  it("calls Lighter a softer picture only where its resolution is lower", () => {
    expect(recastTierIsSofter("h3-480")).toBe(true);
    expect(recastTierIsSofter("luma-540")).toBe(true);
    // Photo to life's two carry no resolution: nothing is claimed.
    expect(recastTierIsSofter("kling-std")).toBe(false);
    for (const full of ["h3-768", "luma-720", "kling-pro", "kling-edit"] as const) expect(recastTierIsSofter(full)).toBe(false);
  });
});

describe("one piece, or all of it", () => {
  const clip = { seconds: 28, frames: 672 };

  it("prices a 28 s clip at 15 s for 9 credits in one piece, and all 28 s for 19 in two parts", () => {
    // 15 × $0.168 = $2.52 → 9 credits; 31 billed s × $0.168 = $5.21 → 19 (chain.ts).
    const choices = recastLengthChoices("kling-edit", clip, { start: 0, end: 28 });
    expect(choices).toEqual({
      one: { window: { start: 0, end: 15 }, seconds: 15, credits: 9, minutes: 15, parts: 1 },
      all: { window: { start: 0, end: 28 }, seconds: 28, credits: 19, minutes: 30, parts: 2 },
    });
    expect(choices!.all.credits).toBe(recastWindowCredits("kling-edit", clip, { start: 0, end: 28 }));
  });

  it("keeps the chosen start where it can, and offers nothing where there is no choice", () => {
    expect(recastLengthChoices("kling-edit", clip, { start: 6, end: 21 })?.one.window).toEqual({ start: 6, end: 21 });
    expect(recastLengthChoices("kling-edit", clip, { start: 20, end: 28 })?.one.window).toEqual({ start: 13, end: 28 });
    expect(recastLengthChoices("kling-edit", { seconds: 15, frames: 360 }, { start: 0, end: 15 })).toBeNull();
    expect(recastLengthChoices("kling-pro", clip, { start: 0, end: 28 })).toBeNull();
  });
});

describe("a length the server will refuse, said before the upload", () => {
  it("refuses a clip plainly past the server's own limits, in the server's own terms", () => {
    // recastClipProblem, the rule inspectRecastClip refuses with: 3–30 s.
    expect(recastLocalLengthProblem(181)).toBe("too-long");
    expect(recastLocalLengthProblem(31)).toBe("too-long");
    expect(recastLocalLengthProblem(1.2)).toBe("too-short");
    expect(recastLocalLengthProblem(2.4)).toBe("too-short");
  });

  it("leaves anything within half a second of a limit to the server, which measures the file itself", () => {
    // The browser's length and ffprobe's can differ by a fraction of a second.
    for (const s of [2.6, 2.97, 3, 10, 29.9, 30, 30.3, 30.5]) expect(recastLocalLengthProblem(s), String(s)).toBeNull();
  });

  it("refuses nothing it could not measure", () => {
    for (const s of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(recastLocalLengthProblem(s)).toBeNull();
  });
});
