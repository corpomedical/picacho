import { describe, expect, it } from "vitest";
import { chainMinutes } from "../generations/chain";
import { RECAST_STOPPED_STEP, recastMinutes, recastTakeOutcome, recastTakeReport, recastWait } from "./door-truth";

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
