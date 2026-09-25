// The render failure rate, as Admin > System reports it (2026-09-25,
// operator: "Fix the render failure rate").
//
// System used to show one number: failed / (succeeded + failed), over every
// render ever. It read 20% while nothing was breaking, for three reasons:
//   - It was ALL-TIME, so no fix could ever move it. Nineteen of its failures
//     were Seedance turning away real people's photos in August and early
//     September, a class the composer has headed off before sending since
//     2026-09-03.
//   - It counted a person pressing Stop as a failure: Stop saves the row as
//     "failed" with cancel_requested set. Moderation already left those out.
//   - It put a content refusal (a provider's safety or likeness filter, our
//     own gates, the account's own brand rules) in the same bucket as a
//     render that broke. A refusal is a rule working, and it is refunded.
//
// Now: the last 7 days, the last 30 and all time, stops left out, and each
// failure count split into "broke" and "refused" (failureKind,
// report-constants.ts, the same reading Moderation shows). The headline
// percentage still counts EVERY failure, refusals included: the split
// explains the number, it does not shrink it.
//
// Relative import: vitest runs with no "@/" alias.
import { failureKindFromLog } from "../generations/report-constants";

export type FinishedRender = {
  id: string;
  status: "succeeded" | "failed";
  created_at: string;
  cancel_requested: boolean | null;
};

export type FailureWindow = {
  /** Succeeded plus failed, stops left out. */
  finished: number;
  failed: number;
  broke: number;
  refused: number;
  /** Renders someone stopped on purpose: shown, never counted as failures. */
  stopped: number;
  /** failed / finished, as a percentage to one decimal; null with nothing finished. */
  rate: number | null;
};

export type FailureRates = { week: FailureWindow; month: FailureWindow; all: FailureWindow };

const DAY_MS = 86_400_000;

function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

/**
 * `logs` holds the pipeline_log of the failed renders, by id; a failed render
 * missing from it reads as "broke", since nothing on record says it was
 * refused.
 */
export function failureRates(
  renders: readonly FinishedRender[],
  logs: ReadonlyMap<string, unknown>,
  now: Date,
): FailureRates {
  const tally = (sinceMs: number): FailureWindow => {
    const w: FailureWindow = { finished: 0, failed: 0, broke: 0, refused: 0, stopped: 0, rate: null };
    for (const r of renders) {
      if (Date.parse(r.created_at) < sinceMs) continue;
      if (r.status === "succeeded") {
        w.finished += 1;
        continue;
      }
      const kind = r.cancel_requested === true ? "stopped" : failureKindFromLog(logs.get(r.id));
      if (kind === "stopped") {
        w.stopped += 1;
        continue;
      }
      w.finished += 1;
      w.failed += 1;
      w[kind] += 1;
    }
    w.rate = percent(w.failed, w.finished);
    return w;
  };
  const t = now.getTime();
  return { week: tally(t - 7 * DAY_MS), month: tally(t - 30 * DAY_MS), all: tally(-Infinity) };
}
