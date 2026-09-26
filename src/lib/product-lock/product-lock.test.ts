import { describe, expect, it } from "vitest";
import type { Verdict } from "../press-tour/campaign-types";
import {
  REASON_BLURRED,
  REASON_FACE_DIFFERENT,
  REASON_FACE_NOT_CHECKED,
  REASON_FACE_NOT_SEEN,
  REASON_LABEL_DIFFERENT,
  REASON_LABEL_UNREADABLE,
  REASON_NOT_CHECKED,
  REASON_NOT_IN_PLAN,
  REASON_NOT_YOUR_PRODUCT,
  REASON_PRODUCT_MISSING,
  REASON_TOO_SMALL,
  REASON_UNSURE,
} from "./messages";
import {
  LOW_CONFIDENCE,
  MAX_ESCALATIONS_PER_AD,
  MIN_COVERAGE,
  VERDICT_SEVERITY,
  adVerdict,
  effectiveMinConfidence,
  escalationPriority,
  faceVerdict,
  frameVerdict,
  parseProductVisibility,
  shotVerdict,
  visibilityForCard,
  worseVerdict,
  type CardText,
  type EscalationReading,
  type FrameOutcome,
  type FrameSignals,
  type JudgeReading,
  type LocateReading,
} from "./product-lock";
import { readLabel, type LabelReadout } from "./text-match";

// The verdict rules, pure (spec §1.8 as corrected by v2 #7, #15, #16, N2).
// Every rule the spec states has a test named after it: a match needs the
// words or a label out of view; a miss needs two independent signals; blur
// is never a miss; product_missing only for shots whose plan needs the
// product, and only when the absence is backed; the worst moment decides.

const CARD: CardText = { expected: ["SOLSTAD", "Cold Brew"], noReadableText: false };
const NO_TEXT: CardText = { expected: [], noReadableText: true };

const LOCATED: LocateReading = { present: "yes", box: { x: 0.3, y: 0.3, w: 0.4, h: 0.5 }, boxConfidence: "high", blurred: false };

function judge(over: Partial<JudgeReading> = {}): JudgeReading {
  return {
    verdict: "match",
    shape: "ok",
    label: "ok",
    logo: "ok",
    colour: "ok",
    labelInView: true,
    blurred: false,
    confidence: 90,
    note: "",
    ...over,
  };
}

function second(over: Partial<EscalationReading> = {}): EscalationReading {
  return { ...judge(), present: "yes", ...over };
}

function words(over: Partial<LabelReadout> = {}): LabelReadout {
  return { best: 1, bestString: "SOLSTAD", matched: true, conflict: null, lines: ["SOLSTAD"], ...over };
}

const SILENT = words({ best: 0.4, bestString: "SOLSTAD", matched: false, conflict: null, lines: [] });
const CONFLICT = words({ best: 0.2, matched: false, conflict: "MOUNTAIN DEW", lines: ["MOUNTAIN DEW"] });

function frame(over: Partial<FrameSignals> = {}): FrameSignals {
  return { locate: LOCATED, coverage: 0.2, label: words(), judge: judge(), ...over };
}

function outcomeOf(verdict: FrameOutcome["verdict"], over: Partial<FrameOutcome> = {}): FrameOutcome {
  return { verdict, reason: null, absenceConfirmed: false, labelRead: verdict === "match", words: "match", resolved: null, ...over };
}

describe("one frame: MATCH", () => {
  it("the judge says match and a confirmed string is read", () => {
    expect(frameVerdict(frame(), CARD)).toMatchObject({ verdict: "match", reason: null, labelRead: true });
  });

  it("the judge says match and the label is out of view (spec: 'the label is not in view')", () => {
    const out = frameVerdict(frame({ judge: judge({ labelInView: false }), label: SILENT }), CARD);
    expect(out).toMatchObject({ verdict: "match", labelRead: false });
  });

  it("the judge says match and the card has no confirmed strings", () => {
    expect(frameVerdict(frame({ label: SILENT }), NO_TEXT).verdict).toBe("match");
  });

  it("the label in view but no confirmed word read is NOT a match: not readable", () => {
    expect(frameVerdict(frame({ label: SILENT }), CARD)).toMatchObject({ verdict: "not_readable", reason: REASON_LABEL_UNREADABLE });
  });

  it("the right words plus a foreign line (mixed) still matches when the judge says match", () => {
    expect(frameVerdict(frame({ label: words({ conflict: "ZORBLAX" }) }), CARD)).toMatchObject({ verdict: "match", words: "mixed" });
  });
});

describe("one frame: a miss needs TWO independent signals", () => {
  it("T2 mismatch + a conflicting line → didnt_match (the words came out different)", () => {
    const out = frameVerdict(frame({ judge: judge({ verdict: "mismatch" }), label: CONFLICT }), CARD);
    expect(out).toMatchObject({ verdict: "didnt_match", reason: REASON_LABEL_DIFFERENT });
  });

  it("T2 mismatch + an escalated mismatch → didnt_match (not your product)", () => {
    const out = frameVerdict(frame({ judge: judge({ verdict: "mismatch", labelInView: false }), label: SILENT, escalation: second({ verdict: "mismatch" }) }), CARD);
    expect(out).toMatchObject({ verdict: "didnt_match", reason: REASON_NOT_YOUR_PRODUCT });
  });

  it("T2 mismatch ALONE never fails a frame, however confident", () => {
    const out = frameVerdict(frame({ judge: judge({ verdict: "mismatch", confidence: 100 }), label: SILENT }), CARD);
    expect(out).toMatchObject({ verdict: "not_readable", reason: REASON_UNSURE });
  });

  it("a conflicting line ALONE never fails a frame", () => {
    const out = frameVerdict(frame({ judge: judge({ verdict: "not_readable" }), label: CONFLICT }), CARD);
    expect(out.verdict).toBe("not_readable");
  });

  it("T2 match vs a conflicting line, settled by a second reading that sides with the words → didnt_match", () => {
    const out = frameVerdict(frame({ label: CONFLICT, escalation: second({ verdict: "mismatch" }) }), CARD);
    expect(out).toMatchObject({ verdict: "didnt_match", resolved: "mismatch", reason: REASON_LABEL_DIFFERENT });
  });

  it("T2 match vs a conflicting line, second reading sides with T2 → no miss; no confirmed word read → not readable", () => {
    const out = frameVerdict(frame({ label: CONFLICT, escalation: second({ verdict: "match" }) }), CARD);
    expect(out).toMatchObject({ verdict: "not_readable", resolved: "match", reason: REASON_LABEL_UNREADABLE });
  });

  it("T2 mismatch vs the right words read, second reading says match → match", () => {
    const out = frameVerdict(frame({ judge: judge({ verdict: "mismatch" }), label: words(), escalation: second({ verdict: "match" }) }), CARD);
    expect(out).toMatchObject({ verdict: "match", resolved: "match" });
  });

  it("T2 mismatch vs a second reading that says match, words silent → unresolved → not readable", () => {
    const out = frameVerdict(frame({ judge: judge({ verdict: "mismatch" }), label: SILENT, escalation: second({ verdict: "match" }) }), CARD);
    expect(out).toMatchObject({ verdict: "not_readable", resolved: "unresolved", reason: REASON_UNSURE });
  });

  it("a second reading asked for but unanswered leaves a disagreement open → not readable (spec: once the cap is hit…)", () => {
    const out = frameVerdict(frame({ judge: judge({ verdict: "mismatch" }), label: words(), escalation: null }), CARD);
    expect(out).toMatchObject({ verdict: "not_readable", resolved: "unresolved" });
  });
});

describe("one frame: mixed words are not a signal (PT-02)", () => {
  // The finding's probe: the confirmed string read at full strength beside a
  // stray line (AI stills often garble secondary text), and one T2 mismatch.
  const mixed = readLabel({ lines: ["SOLSTAD", "XQZLORB"], expected: ["SOLSTAD"], referenceText: [] });
  const card: CardText = { expected: ["SOLSTAD"], noReadableText: false };

  it("the probe reads as mixed: the label read, and a conflict beside it", () => {
    expect(mixed).toMatchObject({ matched: true, conflict: "XQZLORB" });
  });

  it("T2 mismatch + mixed words is not a miss: one signal, not two", () => {
    const out = frameVerdict(frame({ judge: judge({ verdict: "mismatch", confidence: 55 }), label: mixed }), card);
    expect(out.verdict).not.toBe("didnt_match");
    expect(out).toMatchObject({ verdict: "not_readable", reason: REASON_UNSURE, words: "mixed", labelRead: true });
  });

  it("…and it is sent for a second reading first, like any disagreement", () => {
    expect(escalationPriority(frame({ judge: judge({ verdict: "mismatch", confidence: 55 }), label: mixed }), card)).toBe(1);
  });

  it("the second reading settles it: a mismatch makes two signals, a match clears it", () => {
    const miss = frameVerdict(frame({ judge: judge({ verdict: "mismatch" }), label: mixed, escalation: second({ verdict: "mismatch" }) }), card);
    expect(miss).toMatchObject({ verdict: "didnt_match", reason: REASON_NOT_YOUR_PRODUCT });
    const fine = frameVerdict(frame({ judge: judge({ verdict: "mismatch" }), label: mixed, escalation: second({ verdict: "match" }) }), card);
    expect(fine.verdict).not.toBe("didnt_match");
  });

  it("unmixed conflicting words still count (the two-signal miss stands)", () => {
    expect(frameVerdict(frame({ judge: judge({ verdict: "mismatch" }), label: CONFLICT }), CARD)).toMatchObject({ verdict: "didnt_match", reason: REASON_LABEL_DIFFERENT });
  });
});

describe("one frame: BLUR IS NEVER A MISS", () => {
  it("a blurred frame where nothing was found is excluded, never absent (PT-03)", () => {
    const blurredAbsent = frame({ locate: { ...LOCATED, present: "no", box: null, blurred: true }, label: undefined, judge: undefined });
    expect(frameVerdict(blurredAbsent, CARD)).toMatchObject({ verdict: "excluded", reason: REASON_BLURRED });
    // A second reading that also sees blur and nothing: still excluded.
    expect(frameVerdict({ ...blurredAbsent, locate: { ...LOCATED, present: "no", box: null, blurred: false }, escalation: second({ present: "no", blurred: true }) }, CARD)).toMatchObject({
      verdict: "excluded",
      reason: REASON_BLURRED,
    });
    // And it is never sent for a second reading.
    expect(escalationPriority(blurredAbsent, CARD, { confirmAbsence: true })).toBeNull();
  });

  it("three blurred moments with nothing found are not a missing product; a still's blurred absence neither (PT-03)", () => {
    const blurredAbsent = frameVerdict(frame({ locate: { ...LOCATED, present: "no", box: null, blurred: true }, label: undefined, judge: undefined }), CARD);
    expect(shotVerdict([blurredAbsent, blurredAbsent, blurredAbsent], "required_label")).toMatchObject({ verdict: "not_readable", reason: REASON_BLURRED });
    expect(shotVerdict([blurredAbsent], "required_shape").verdict).not.toBe("product_missing");
    // Two sharp absences still back a missing product, whatever a blurred third says.
    const sharpAbsent = frameVerdict(frame({ locate: { ...LOCATED, present: "no", box: null }, label: undefined, judge: undefined }), CARD);
    expect(shotVerdict([sharpAbsent, sharpAbsent, blurredAbsent], "required_label").verdict).toBe("product_missing");
  });

  it("two signals of a miss on a blurred frame → not readable (blurred)", () => {
    const out = frameVerdict(frame({ judge: judge({ verdict: "mismatch", blurred: true }), label: CONFLICT }), CARD);
    expect(out).toMatchObject({ verdict: "not_readable", reason: REASON_BLURRED });
  });

  it("blur seen by the locate reading counts too", () => {
    const out = frameVerdict(frame({ locate: { ...LOCATED, blurred: true }, judge: judge({ verdict: "mismatch" }), label: CONFLICT }), CARD);
    expect(out).toMatchObject({ verdict: "not_readable", reason: REASON_BLURRED });
  });

  it("blur seen by the second reading counts too", () => {
    const out = frameVerdict(frame({ judge: judge({ verdict: "mismatch" }), label: SILENT, escalation: second({ verdict: "mismatch", blurred: true }) }), CARD);
    expect(out.verdict).toBe("not_readable");
  });

  it("a blurred frame the judge calls a match, with the words read, is still a match", () => {
    expect(frameVerdict(frame({ judge: judge({ blurred: true }) }), CARD).verdict).toBe("match");
  });
});

describe("one frame: T0 (is a product in the role, and is it big enough)", () => {
  it("nothing in the role → absent, not a miss by itself", () => {
    const out = frameVerdict(frame({ locate: { ...LOCATED, present: "no", box: null }, label: undefined, judge: undefined }), CARD);
    expect(out).toMatchObject({ verdict: "absent", reason: REASON_PRODUCT_MISSING, absenceConfirmed: false });
  });

  it("a second reading that also finds nothing confirms the absence", () => {
    const out = frameVerdict(frame({ locate: { ...LOCATED, present: "no", box: null }, judge: undefined, escalation: second({ present: "no" }) }), CARD);
    expect(out).toMatchObject({ verdict: "absent", absenceConfirmed: true });
  });

  it("a second reading that finds a product refutes the absence → not readable", () => {
    const out = frameVerdict(frame({ locate: { ...LOCATED, present: "no", box: null }, judge: undefined, escalation: second({ present: "yes" }) }), CARD);
    expect(out).toMatchObject({ verdict: "not_readable", reason: REASON_UNSURE });
  });

  it("a confirmed word read on the whole frame means the product IS there → not readable, never missing", () => {
    const out = frameVerdict(frame({ locate: { ...LOCATED, present: "no", box: null }, judge: undefined, wholeFrameLabel: words() }), CARD);
    expect(out).toMatchObject({ verdict: "not_readable", labelRead: true });
  });

  it(`a product under ${MIN_COVERAGE * 100}% of the frame is excluded, never a miss`, () => {
    const out = frameVerdict(frame({ coverage: MIN_COVERAGE - 0.001, judge: judge({ verdict: "mismatch" }), label: CONFLICT }), CARD);
    expect(out).toMatchObject({ verdict: "excluded", reason: REASON_TOO_SMALL });
  });

  it("exactly the minimum coverage is judged", () => {
    expect(frameVerdict(frame({ coverage: MIN_COVERAGE }), CARD).verdict).toBe("match");
  });

  it("an unclear presence is excluded", () => {
    expect(frameVerdict(frame({ locate: { ...LOCATED, present: "unclear" } }), CARD).verdict).toBe("excluded");
  });

  it("a product said to be there with no box is excluded (too small to find)", () => {
    expect(frameVerdict(frame({ locate: { ...LOCATED, box: null }, coverage: null }), CARD)).toMatchObject({ verdict: "excluded", reason: REASON_TOO_SMALL });
  });
});

describe("one frame: NOT CHECKED (a reader unreachable)", () => {
  it("no locate answer", () => {
    expect(frameVerdict(frame({ locate: null }), CARD)).toMatchObject({ verdict: "not_checked", reason: REASON_NOT_CHECKED });
  });

  it("no judge answer", () => {
    expect(frameVerdict(frame({ judge: null }), CARD).verdict).toBe("not_checked");
  });

  it("no words answer, when the card has confirmed strings", () => {
    expect(frameVerdict(frame({ label: null }), CARD).verdict).toBe("not_checked");
  });

  it("a card with no readable text can do without the words", () => {
    expect(frameVerdict(frame({ label: null }), NO_TEXT).verdict).toBe("match");
  });
});

describe("one frame: the minimum confidence (read only once calibrated)", () => {
  it("record-only: 0, so a low-confidence T2 mismatch still counts as a signal", () => {
    expect(frameVerdict(frame({ judge: judge({ verdict: "mismatch", confidence: 20 }), label: CONFLICT }), CARD).verdict).toBe("didnt_match");
  });

  it("calibrated with a bar: a T2 mismatch below it is not a signal", () => {
    const out = frameVerdict(frame({ judge: judge({ verdict: "mismatch", confidence: 20 }), label: CONFLICT }), CARD, { minConfidence: 50 });
    expect(out.verdict).toBe("not_readable");
  });

  it("effectiveMinConfidence ignores the setting until calibrated, and bounds it", () => {
    expect(effectiveMinConfidence(false, "80")).toBe(0);
    expect(effectiveMinConfidence(true, "80")).toBe(80);
    expect(effectiveMinConfidence(true, "250")).toBe(100);
    expect(effectiveMinConfidence(true, "nope")).toBe(0);
    expect(effectiveMinConfidence(true, 42.6)).toBe(43);
  });
});

describe("which frames get a second reading", () => {
  it("1: T2 mismatch while the right words were read (strong disagreement)", () => {
    expect(escalationPriority(frame({ judge: judge({ verdict: "mismatch" }) }), CARD)).toBe(1);
  });

  it("2: T2 match while a foreign line was read and no confirmed word", () => {
    expect(escalationPriority(frame({ label: CONFLICT }), CARD)).toBe(2);
  });

  it("3: T2 mismatch with nothing to back it; the less confident first", () => {
    const low = escalationPriority(frame({ judge: judge({ verdict: "mismatch", confidence: LOW_CONFIDENCE - 30 }), label: SILENT }), CARD)!;
    const high = escalationPriority(frame({ judge: judge({ verdict: "mismatch", confidence: 95 }), label: SILENT }), CARD)!;
    expect(Math.floor(low)).toBe(3);
    expect(low).toBeLessThan(high);
  });

  it("no second reading when two signals already agree on a miss", () => {
    expect(escalationPriority(frame({ judge: judge({ verdict: "mismatch" }), label: CONFLICT }), CARD)).toBeNull();
  });

  it("no second reading for a match the words confirm", () => {
    expect(escalationPriority(frame(), CARD)).toBeNull();
  });

  it("never for a blurred frame: blur can't become a miss", () => {
    expect(escalationPriority(frame({ judge: judge({ verdict: "mismatch", blurred: true }), label: words() }), CARD)).toBeNull();
  });

  it("never for an excluded or unchecked frame", () => {
    expect(escalationPriority(frame({ coverage: 0.01, judge: judge({ verdict: "mismatch" }) }), CARD)).toBeNull();
    expect(escalationPriority(frame({ judge: null }), CARD)).toBeNull();
    expect(escalationPriority(frame({ locate: null }), CARD)).toBeNull();
  });

  it("4: a single still with nothing in the role, only when asked (moments back each other instead)", () => {
    const absent = frame({ locate: { ...LOCATED, present: "no", box: null }, judge: undefined, label: undefined });
    expect(escalationPriority(absent, CARD)).toBeNull();
    expect(escalationPriority(absent, CARD, { confirmAbsence: true })).toBe(4);
    expect(escalationPriority({ ...absent, wholeFrameLabel: words() }, CARD, { confirmAbsence: true })).toBeNull();
  });

  it("the allowance is 2 per ad", () => {
    expect(MAX_ESCALATIONS_PER_AD).toBe(2);
  });
});

describe("one shot: THE WORST MOMENT", () => {
  it("all moments match → match", () => {
    expect(shotVerdict([outcomeOf("match"), outcomeOf("match"), outcomeOf("match")], "required_label")).toMatchObject({ verdict: "match", worst: null, judged: 3 });
  });

  it("one miss among matches → didnt_match, pointing at that moment", () => {
    const shot = shotVerdict([outcomeOf("match"), outcomeOf("didnt_match", { reason: REASON_LABEL_DIFFERENT }), outcomeOf("match")], "required_label");
    expect(shot).toMatchObject({ verdict: "didnt_match", worst: 1, reason: REASON_LABEL_DIFFERENT });
  });

  it("one not-readable moment among matches → not_readable (the worst judged moment)", () => {
    const shot = shotVerdict([outcomeOf("match"), outcomeOf("match"), outcomeOf("not_readable", { reason: REASON_BLURRED })], "required_shape");
    expect(shot).toMatchObject({ verdict: "not_readable", worst: 2, reason: REASON_BLURRED });
  });

  it("excluded and absent moments are not judged: the rest decide", () => {
    const shot = shotVerdict([outcomeOf("excluded"), outcomeOf("absent"), outcomeOf("match")], "required_label");
    expect(shot).toMatchObject({ verdict: "match", judged: 1 });
  });

  it("the order is didnt_match > product_missing > not_checked > not_readable > match", () => {
    const order: Verdict[] = ["didnt_match", "product_missing", "not_checked", "not_readable", "match"];
    for (let i = 0; i < order.length - 1; i++) expect(VERDICT_SEVERITY[order[i]]).toBeGreaterThan(VERDICT_SEVERITY[order[i + 1]]);
    expect(worseVerdict("match", "not_readable")).toBe("not_readable");
    expect(worseVerdict("didnt_match", "not_checked")).toBe("didnt_match");
  });

  it("a miss outranks a moment that could not be checked", () => {
    expect(shotVerdict([outcomeOf("not_checked"), outcomeOf("didnt_match")], "required_label").verdict).toBe("didnt_match");
  });

  it("an unchecked moment keeps a shot from claiming Match", () => {
    expect(shotVerdict([outcomeOf("match"), outcomeOf("not_checked"), outcomeOf("match")], "required_label")).toMatchObject({ verdict: "not_checked", worst: 1 });
  });

  it("no moments at all → not checked", () => {
    expect(shotVerdict([], "required_label").verdict).toBe("not_checked");
  });
});

describe("one shot: PRODUCT MISSING (v2 #16), only for shots whose plan needs the product", () => {
  it("no moment shows it, backed by two moments → product_missing", () => {
    const shot = shotVerdict([outcomeOf("absent"), outcomeOf("absent"), outcomeOf("absent")], "required_label");
    expect(shot).toMatchObject({ verdict: "product_missing", reason: REASON_PRODUCT_MISSING, worst: 0 });
  });

  it("required_shape too", () => {
    expect(shotVerdict([outcomeOf("absent"), outcomeOf("absent")], "required_shape").verdict).toBe("product_missing");
  });

  it("a single still with nothing found is product_missing only when a second reading agreed", () => {
    expect(shotVerdict([outcomeOf("absent")], "required_label")).toMatchObject({ verdict: "not_readable", reason: REASON_UNSURE });
    expect(shotVerdict([outcomeOf("absent", { absenceConfirmed: true })], "required_label").verdict).toBe("product_missing");
  });

  it("some moments show it: the absent ones are simply not judged", () => {
    expect(shotVerdict([outcomeOf("absent"), outcomeOf("match"), outcomeOf("absent")], "required_shape").verdict).toBe("match");
  });

  it("absent moments beside an unchecked one → not checked, not missing", () => {
    expect(shotVerdict([outcomeOf("absent"), outcomeOf("not_checked"), outcomeOf("absent")], "required_label").verdict).toBe("not_checked");
  });

  it("a shot planned WITHOUT the product is never checked, never missing", () => {
    expect(shotVerdict([outcomeOf("absent"), outcomeOf("absent")], "absent")).toMatchObject({ verdict: "not_checked", reason: REASON_NOT_IN_PLAN, productExpected: false });
  });

  it("spec: a required shot with no judged moments (all too small) is not readable", () => {
    expect(shotVerdict([outcomeOf("excluded", { reason: REASON_TOO_SMALL }), outcomeOf("excluded", { reason: REASON_TOO_SMALL })], "required_label")).toMatchObject({
      verdict: "not_readable",
      reason: REASON_TOO_SMALL,
    });
  });
});

describe("one shot: a required_label shot must have READ its label somewhere", () => {
  it("every moment matched only because the label was out of view → not readable", () => {
    const shot = shotVerdict([outcomeOf("match", { labelRead: false }), outcomeOf("match", { labelRead: false })], "required_label");
    expect(shot).toMatchObject({ verdict: "not_readable", reason: REASON_LABEL_UNREADABLE });
  });

  it("one moment read it → match", () => {
    expect(shotVerdict([outcomeOf("match", { labelRead: false }), outcomeOf("match", { labelRead: true })], "required_label").verdict).toBe("match");
  });

  it("required_shape doesn't need it", () => {
    expect(shotVerdict([outcomeOf("match", { labelRead: false })], "required_shape").verdict).toBe("match");
  });

  it("a product with no readable text is judged like required_shape", () => {
    expect(visibilityForCard("required_label", NO_TEXT)).toBe("required_shape");
    expect(visibilityForCard("required_label", CARD)).toBe("required_label");
    expect(visibilityForCard("absent", NO_TEXT)).toBe("absent");
  });
});

describe("the ad: the worst shot that shows the product", () => {
  it("counts only shots whose plan shows the product", () => {
    expect(
      adVerdict([
        { verdict: "match", productExpected: true },
        { verdict: "not_checked", productExpected: false },
        { verdict: "not_readable", productExpected: true },
      ]),
    ).toBe("not_readable");
  });

  it("null when no shot shows the product", () => {
    expect(adVerdict([{ verdict: "not_checked", productExpected: false }])).toBeNull();
  });

  it("a miss anywhere is the ad's verdict", () => {
    expect(adVerdict([{ verdict: "didnt_match", productExpected: true }, { verdict: "product_missing", productExpected: true }])).toBe("didnt_match");
  });
});

describe("the face, by face-lock.ts's rule (lowest judged moment)", () => {
  const face = (score: number, over: { unusable?: boolean; faceVisible?: boolean } = {}) => ({ score, unusable: false, faceVisible: true, ...over });

  it("the lowest judged score against the bar", () => {
    expect(faceVerdict([face(90), face(72), face(88)], { threshold: 70 })).toMatchObject({ verdict: "match", lowest: 72, judged: 3 });
    expect(faceVerdict([face(90), face(60)], { threshold: 70 })).toMatchObject({ verdict: "didnt_match", lowest: 60, reason: REASON_FACE_DIFFERENT });
  });

  it("moments without a face (or unusable) are not judged, never a miss", () => {
    expect(faceVerdict([face(10, { faceVisible: false }), face(85), face(5, { unusable: true })], { threshold: 70 })).toMatchObject({ verdict: "match", lowest: 85, judged: 1 });
  });

  it("no moment showed the face → not readable", () => {
    expect(faceVerdict([face(10, { faceVisible: false })], { threshold: 70 })).toMatchObject({ verdict: "not_readable", reason: REASON_FACE_NOT_SEEN });
  });

  it("no reading answered → not checked", () => {
    expect(faceVerdict([null, null], { threshold: 70 })).toMatchObject({ verdict: "not_checked", reason: REASON_FACE_NOT_CHECKED });
  });

  it("with the identity gate off (bar 0) there is nothing to pass: not checked, score kept", () => {
    expect(faceVerdict([face(95)], { threshold: 0 })).toMatchObject({ verdict: "not_checked", lowest: 95 });
  });
});

describe("visibility words", () => {
  it("parses only the spec's three", () => {
    expect(parseProductVisibility("required_label")).toBe("required_label");
    expect(parseProductVisibility("absent")).toBe("absent");
    expect(parseProductVisibility("optional")).toBeNull();
    expect(parseProductVisibility(null)).toBeNull();
  });
});
