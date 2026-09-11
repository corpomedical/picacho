import { describe, expect, it } from "vitest";
import type { AttemptRecord, BuildRecord } from "./build-flow.mts";
import { dPhotoOutcomeOf, dPhotoRow } from "../parts/d.mts";

// What a finished photo build means for D's photo leg: where it stopped,
// and, for a delivered set, its marks and whether Astra placed them.

const attempt = (over: Partial<AttemptRecord> = {}): AttemptRecord => ({ attempt: 1, kind: "first", transport: "background", outcome: "valid", usage: null, billedUsd: 0.6, standardUsd: 0.6, ...over });
const rec = (over: Partial<BuildRecord> = {}): BuildRecord =>
  ({ type: "build", status: "delivered", failure: null, notRun: null, words: "allowed", notes: [], attempts: [attempt({ words: "allowed" })], ...over }) as BuildRecord;

describe("dPhotoOutcomeOf", () => {
  it("a delivered set records its marks, and whether they are Astra's own", () => {
    expect(dPhotoOutcomeOf(rec(), 3)).toEqual({ outcome: "set_delivered", note: null, marks: 3, marksFromAstra: true });
    expect(dPhotoOutcomeOf(rec({ notes: ["default_mark"] }), 1)).toMatchObject({ marks: 1, marksFromAstra: false });
    expect(dPhotoOutcomeOf(rec({ words: "unavailable" }), 2)).toMatchObject({ outcome: "set_delivered", note: "words gate unavailable: unjudged" });
  });

  it("tells our words gate's refusal from Astra's, and a build that never ran from one that failed", () => {
    expect(dPhotoOutcomeOf(rec({ status: "failed", failure: "refused", attempts: [attempt({ words: { refused: "sexual" } })] }), null).outcome).toBe("words_refused");
    expect(dPhotoOutcomeOf(rec({ status: "failed", failure: "refused", attempts: [attempt({ outcome: "refused" })] }), null).outcome).toBe("astra_refused");
    expect(dPhotoOutcomeOf(rec({ status: "failed", failure: "invalid" }), null)).toMatchObject({ outcome: "no_set", note: "invalid", marks: null });
    expect(dPhotoOutcomeOf(rec({ status: "failed", failure: "not_run:budget", notRun: "budget" }), null)).toMatchObject({ outcome: "undetermined", note: "build not run (budget)" });
    expect(dPhotoOutcomeOf(null, null).outcome).toBe("undetermined");
  });

  it("names the gate that stopped a photo before Astra from its verdicts", () => {
    const row = (notesGate: string, pictureCheck: string) => dPhotoRow({ outcome: "refused_before_astra", notesGate: notesGate as never, pictureCheck: pictureCheck as never, marks: null, marksFromAstra: null }).stoppedBy;
    expect(row("refused:sexual", "not-reached")).toBe("notes gate");
    expect(row("none", "refused:minors")).toBe("picture check");
    expect(row("allowed", "unavailable")).toBeNull();
  });
});
