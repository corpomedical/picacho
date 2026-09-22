import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CHAIN_GAVE_UP,
  CHAIN_GAVE_UP_ISSUE,
  CHAIN_GIVE_UP_MS,
  CHAIN_RETRY_LIMIT,
  type ChainError,
  chainGivesUp,
  chainRetryDue,
  chainRetrySpacingMs,
  nextChainError,
  reaperMayWriteOff,
} from "./chain-failure";
import { forceRefundEligible, REFUNDS } from "./refund-rules";

// NO DEAD ENDS (2026-09-22). A long take's step on our side used to be
// retried for ever: the count on the row went up and nothing read it.

const T0 = Date.parse("2026-09-22T10:00:00.000Z");
const MIN = 60_000;

describe("the give-up", () => {
  it("is six tries, or two hours from the first failure — whichever comes first", () => {
    expect(CHAIN_RETRY_LIMIT).toBe(6);
    expect(CHAIN_GIVE_UP_MS).toBe(2 * 60 * MIN);
  });

  it("gives up on the sixth failure, not before", () => {
    const at = new Date(T0).toISOString();
    for (let count = 1; count < 6; count++) {
      expect(chainGivesUp({ at, firstAt: at, count }, T0 + MIN), `after ${count}`).toBe(false);
    }
    expect(chainGivesUp({ at, firstAt: at, count: 6 }, T0 + MIN)).toBe(true);
  });

  it("gives up two hours after the first failure, however few tries it had", () => {
    const firstAt = new Date(T0).toISOString();
    const at = new Date(T0 + 90 * MIN).toISOString();
    expect(chainGivesUp({ at, firstAt, count: 2 }, T0 + 2 * 60 * MIN - 1)).toBe(false);
    expect(chainGivesUp({ at, firstAt, count: 2 }, T0 + 2 * 60 * MIN)).toBe(true);
  });

  it("counts a row from before firstAt from its last failure, and on its tries", () => {
    // The takes stuck before this shipped carry {at, message, count} only.
    const legacy = { at: new Date(T0).toISOString(), message: "joining the pieces: ffmpeg exit 1", count: 40 };
    expect(chainGivesUp(legacy, T0 + MIN)).toBe(true);
    expect(chainGivesUp({ ...legacy, count: 1 }, T0 + MIN)).toBe(false);
    expect(chainGivesUp({ ...legacy, count: 1 }, T0 + 2 * 60 * MIN)).toBe(true);
  });

  it("an unreadable time never gives up on its own — the tries still end it", () => {
    expect(chainGivesUp({ at: "not a date", count: 1 }, T0)).toBe(false);
    expect(chainGivesUp({ at: "not a date", count: 6 }, T0)).toBe(true);
  });
});

describe("the record of a failed try", () => {
  it("counts, keeps when the first failure was, and cuts a long reason", () => {
    const one = nextChainError(undefined, "couldn't store in-2.mp4: timeout", T0);
    expect(one).toEqual({
      at: new Date(T0).toISOString(),
      firstAt: new Date(T0).toISOString(),
      message: "couldn't store in-2.mp4: timeout",
      count: 1,
    });
    const two = nextChainError(one, "x".repeat(4000), T0 + 5 * MIN);
    expect(two.count).toBe(2);
    expect(two.firstAt).toBe(one.firstAt);
    expect(two.at).toBe(new Date(T0 + 5 * MIN).toISOString());
    expect(two.message).toHaveLength(1500);
  });

  it("dates a legacy row's first failure from its last recorded one", () => {
    const legacy: ChainError = { at: new Date(T0).toISOString(), message: "old", count: 3 };
    expect(nextChainError(legacy, "new", T0 + MIN).firstAt).toBe(legacy.at);
  });
});

describe("the wait between tries", () => {
  it("is a minute, then doubling, never past half an hour", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 12].map(chainRetrySpacingMs)).toEqual([
      0,
      MIN,
      2 * MIN,
      4 * MIN,
      8 * MIN,
      16 * MIN,
      30 * MIN,
      30 * MIN,
    ]);
  });

  it("lets the first try run at once, and holds a failed one until its wait is up", () => {
    expect(chainRetryDue(undefined, T0)).toBe(true);
    const failed = { at: new Date(T0).toISOString(), count: 2 };
    expect(chainRetryDue(failed, T0 + 2 * MIN - 1)).toBe(false);
    expect(chainRetryDue(failed, T0 + 2 * MIN)).toBe(true);
    expect(chainRetryDue({ at: "garbled", count: 3 }, T0)).toBe(true);
  });

  it("spends six tries over about half an hour, not six polls in half a minute", () => {
    // A door polling every 5 s used to run the failing step on every poll.
    let error: ChainError | undefined;
    let tries = 0;
    let gaveUpAt: number | null = null;
    for (let now = T0; now < T0 + 3 * 60 * MIN && gaveUpAt === null; now += 5_000) {
      if (error && !chainGivesUp(error, now) && !chainRetryDue(error, now)) continue;
      if (error && chainGivesUp(error, now)) {
        gaveUpAt = now;
        break;
      }
      tries++;
      error = nextChainError(error, "joining the pieces: ffmpeg exit 1", now);
      if (chainGivesUp(error, now)) gaveUpAt = now;
    }
    expect(tries).toBe(6);
    expect(gaveUpAt).not.toBeNull();
    // 1 + 2 + 4 + 8 + 16 minutes of waiting between the six.
    expect(gaveUpAt! - T0).toBeGreaterThanOrEqual(31 * MIN);
    expect(gaveUpAt! - T0).toBeLessThan(CHAIN_GIVE_UP_MS);
  });
});

describe("seven failures in a row end the take, never 'generating'", () => {
  // The runner's side, simulated from the same pure rules it calls: each
  // failed try records the failure, and the try on which chainGivesUp holds
  // finishes the take failed instead of keeping it for another pass.
  it("the sixth failure is the last; a seventh never runs", () => {
    let status: "generating" | "failed" = "generating";
    let error: ChainError | undefined;
    let now = T0;
    let throws = 0;
    for (let attempt = 0; attempt < 7 && status === "generating"; attempt++) {
      throws++;
      error = nextChainError(error, "couldn't fetch the finished piece (503)", now);
      if (chainGivesUp(error, now)) status = "failed";
      now += chainRetrySpacingMs(error.count);
    }
    expect(status).toBe("failed");
    expect(throws).toBe(6);
  });
});

describe("the reaper's write-off", () => {
  it("decides all eight cases the one way", () => {
    const cases: [boolean, boolean, boolean, boolean][] = [
      // needsEncoder, encoderAvailable, pieceCompleted → may write off
      [false, false, false, true],
      [false, false, true, true],
      [false, true, false, true],
      [false, true, true, true],
      // A route that cannot run the step never decides a take is stuck.
      [true, false, false, false],
      [true, false, true, false],
      // One that can: a piece the provider lost is written off…
      [true, true, false, true],
      // …a piece it finished is waiting on our step, whose give-up owns it.
      [true, true, true, false],
    ];
    for (const [needsEncoder, encoderAvailable, pieceCompleted, expected] of cases) {
      expect(reaperMayWriteOff({ needsEncoder, encoderAvailable, pieceCompleted }), JSON.stringify({ needsEncoder, encoderAvailable, pieceCompleted })).toBe(
        expected,
      );
    }
  });
});

describe("a take that gave up", () => {
  const runner = readFileSync(join(__dirname, "job-runner.ts"), "utf8");

  it("is settled as any failed take is: our fault, the switch and the cap — no rule of its own", () => {
    // The rule (2026-09-22): no new refund rule, nothing forced
    // past the daily cap. A given-up long take carries a billed part, so it
    // is not force-eligible; our_error refunds through the ordinary path.
    const log = [
      {
        steps: [
          { step: "generate", detail: "Submitted part 1 of 3 of a 30s clip to Kling O3 Edit Pro." },
          { step: "generate", detail: "Rendered the video's part 1 of 3 — part 2 opens on its last second." },
          { step: "generate", detail: CHAIN_GAVE_UP },
        ],
        issues: [CHAIN_GAVE_UP_ISSUE],
      },
    ];
    expect(forceRefundEligible(log)).toBe(false);
    expect(REFUNDS.our_error).toBe(true);
    const give = runner.slice(runner.indexOf("async function giveUpOnChain("));
    expect(give.slice(0, 700)).toContain('await finish(generationId, userId, { status: "failed", attempts, fault: "our_error" });');
    expect(give.slice(0, 700)).not.toContain("refundGenerationCosts");
  });

  it("keeps its reason on the take, not on the job row finish() deletes", () => {
    const give = runner.slice(runner.indexOf("async function giveUpOnChain("));
    expect(give.slice(0, 700)).toContain("markIssue(appendStep(row.resume.attempts ?? [], CHAIN_GAVE_UP, \"generate\"), CHAIN_GAVE_UP_ISSUE)");
    expect(give.slice(0, 700)).toContain("chainError: error");
    // And the auto-filed report reads the encoder's own words from there.
    expect(runner).toContain("`Long take gave up after ${lastAttempt.chainError.count} tries: ${lastAttempt.chainError.message}`");
  });

  it("is decided on every failed try, and before any try once it is due", () => {
    const branch = runner.slice(runner.indexOf("if (err instanceof ChainRetry)"));
    const decide = branch.indexOf("if (chainGivesUp(chainError, now)) {");
    expect(decide).toBeGreaterThan(-1);
    expect(decide).toBeLessThan(branch.indexOf("await releaseAdvanceClaim("));
    expect(branch.slice(0, 700)).toContain("const chainError = nextChainError(row.payload.chainError, err.message, now);");
    expect(runner).toContain("if (standing && chainGivesUp(standing, Date.now())) {\n        return await giveUpOnChain(");
  });

  it("waits out a try's spacing without claiming, on a route that can run it", () => {
    const encoder = runner.indexOf("if (chainStep && !chainEncoderAvailable())");
    const wait = runner.indexOf("!chainRetryDue(row.payload.chainError, now)");
    const claim = runner.indexOf("chainStep ? CHAIN_LEASE_SECONDS : ADVANCE_LEASE_SECONDS");
    expect(encoder).toBeGreaterThan(-1);
    expect(wait).toBeGreaterThan(encoder);
    expect(claim).toBeGreaterThan(wait);
  });

  it("the reaper no longer swallows the error, and asks before writing a take off", () => {
    const reaper = runner.slice(runner.indexOf("export async function reapStaleJobs("));
    expect(reaper).not.toMatch(/\} catch \{\n\s+\/\/ advanceGeneration handles fal transport errors internally/);
    expect(reaper).toContain('console.warn("[reaper] a stale job couldn\'t be advanced; left for the next pass"');
    const ask = reaper.indexOf("if (!reaperMayWriteOff({ needsEncoder, encoderAvailable, pieceCompleted })) continue;");
    expect(ask).toBeGreaterThan(-1);
    expect(ask).toBeLessThan(reaper.indexOf("await cancelQueuedJob(jobHandle(current));"));
    expect(reaper).toContain('const needsEncoder = current.stage === "video" && Boolean(current.payload?.chain);');
  });
});
