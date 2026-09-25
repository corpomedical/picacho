import { describe, expect, it } from "vitest";
import { failureRates, type FinishedRender } from "./failure-rate";

// Admin > System's render failure rate (2026-09-25). It read 20% all-time
// while nothing was breaking; these pin the three things that were wrong
// with that number, and that the fix explains it rather than shrinking it.

const NOW = new Date("2026-09-25T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

let n = 0;
const render = (status: "succeeded" | "failed", age: number, stopped = false): FinishedRender => ({
  id: `g${++n}`,
  status,
  created_at: daysAgo(age),
  cancel_requested: stopped,
});
const refusedLog = [
  { attempt: 1, passed: false, compiledPrompt: "", issues: [], steps: [{ step: "generate", detail: 'fal.ai (Seedance 2.5) error (422): {"detail":[{"msg":"may contain likenesses of real people","type":"content_policy_violation"}]}' }] },
];
const brokeLog = [
  { attempt: 1, passed: false, compiledPrompt: "", issues: [], steps: [{ step: "generate", detail: "fal.ai (Kling O3) error (500): Internal Server Error" }] },
];

describe("the render failure rate", () => {
  it("a Stop is not a failure: left out of the count and the total, and shown", () => {
    const rows = [render("succeeded", 1), render("succeeded", 1), render("failed", 1, true)];
    const r = failureRates(rows, new Map(), NOW);
    expect(r.week).toMatchObject({ finished: 2, failed: 0, stopped: 1, rate: 0 });
  });

  it("a fix shows up: old failures stay in all time and leave the recent windows", () => {
    const old = render("failed", 32);
    const rows = [old, render("succeeded", 20), render("succeeded", 2), render("succeeded", 1)];
    const r = failureRates(rows, new Map([[old.id, refusedLog]]), NOW);
    expect(r.week).toMatchObject({ finished: 2, failed: 0, rate: 0 });
    expect(r.month).toMatchObject({ finished: 3, failed: 0, rate: 0 });
    expect(r.all).toMatchObject({ finished: 4, failed: 1, refused: 1, rate: 25 });
  });

  it("splits broke from refused, and the headline still counts both", () => {
    const a = render("failed", 3);
    const b = render("failed", 4);
    const rows = [a, b, ...Array.from({ length: 8 }, () => render("succeeded", 5))];
    const r = failureRates(rows, new Map<string, unknown>([[a.id, refusedLog], [b.id, brokeLog]]), NOW);
    expect(r.week).toMatchObject({ finished: 10, failed: 2, broke: 1, refused: 1, rate: 20 });
  });

  it("a failure with no readable log counts as broke, never as refused", () => {
    const f = render("failed", 1);
    expect(failureRates([f, render("succeeded", 1)], new Map(), NOW).week).toMatchObject({ broke: 1, refused: 0, rate: 50 });
  });

  it("rounds to one decimal, and says nothing rather than 0% when nothing finished", () => {
    const f = render("failed", 1);
    const rows = [f, ...Array.from({ length: 67 }, () => render("succeeded", 1))];
    expect(failureRates(rows, new Map([[f.id, brokeLog]]), NOW).week.rate).toBe(1.5);
    expect(failureRates([], new Map(), NOW).week.rate).toBeNull();
    expect(failureRates([render("failed", 1, true)], new Map(), NOW).week.rate).toBeNull();
  });
});
