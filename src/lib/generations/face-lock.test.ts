import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  castScores,
  characterVideoLock,
  faceMoments,
  faceRecord,
  identityPhotoFor,
  isFirstFrameLane,
  judgesFace,
  NO_FACE_NOTE,
  recastTakeLock,
  recordOnlyLock,
  scoringCast,
  TAKE_REPORT_DETAIL,
  TAKE_REPORT_STEP,
  takeReportStep,
  withinBudget,
  type FaceRead,
  type FaceVerdict,
  type IdentityLock,
} from "./face-lock";
import { MODEL_CAPABILITIES } from "./send-plan";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");

describe("isFirstFrameLane", () => {
  it("follows the capability matrix, not a list of its own", () => {
    for (const [id, caps] of Object.entries(MODEL_CAPABILITIES)) {
      expect(isFirstFrameLane(id)).toBe(caps.identity.mechanism === "first-frame");
    }
  });

  it("knows the lanes whose frame one is a photo", () => {
    expect(isFirstFrameLane("kling-o3")).toBe(true);
    expect(isFirstFrameLane("kling-2.5")).toBe(true);
    expect(isFirstFrameLane("kling-o3-pro")).toBe(false);
    expect(isFirstFrameLane("gemini-omni")).toBe(false);
  });

  it("says no for a model it has never heard of", () => {
    expect(isFirstFrameLane("not-a-model")).toBe(false);
  });
});

describe("characterVideoLock", () => {
  it("gives a characterless render no lock — there is no face to judge", () => {
    expect(
      characterVideoLock({ hasCharacter: false, modelId: "kling-o3-pro", threshold: 70, refundOn: true }),
    ).toBeUndefined();
  });

  it("judges an elements lane from the first frame on", () => {
    expect(
      characterVideoLock({ hasCharacter: true, modelId: "kling-o3-pro", threshold: 70, refundOn: false }),
    ).toEqual({ threshold: 70, refund: false });
  });

  it("skips frame one on a first-frame lane, where its face is already known", () => {
    expect(
      characterVideoLock({ hasCharacter: true, modelId: "kling-o3", threshold: 70, refundOn: false }),
    ).toEqual({ threshold: 70, refund: false, skipFirst: true });
  });

  it("refunds a miss only when the switch is on", () => {
    expect(
      characterVideoLock({ hasCharacter: true, modelId: "minimax-h3", threshold: 70, refundOn: true })?.refund,
    ).toBe(true);
    expect(
      characterVideoLock({ hasCharacter: true, modelId: "minimax-h3", threshold: 70, refundOn: false })?.refund,
    ).toBe(false);
  });

  it("never refunds with the gate off: a threshold of 0 is no bar at all", () => {
    expect(
      characterVideoLock({ hasCharacter: true, modelId: "minimax-h3", threshold: 0, refundOn: true }),
    ).toEqual({ threshold: 0, refund: false });
  });
});

describe("wiring", () => {
  it("every character video path hands its lock to saveVideoJob", () => {
    const actions = read("actions.ts");
    const single = actions.indexOf("await saveVideoJob({\n          generationId: placeholder.id");
    expect(single).toBeGreaterThan(-1);
    expect(actions.slice(single, single + 1200)).toContain("identityLock: characterVideoLock({");
    const angle = actions.indexOf("await saveVideoJob({\n              generationId: rowId");
    expect(angle).toBeGreaterThan(-1);
    expect(actions.slice(angle, angle + 900)).toContain("identityLock: angleFaceLock");
  });

  it("a frame with no face in it is never counted as a miss", () => {
    // The rule itself is faceRecord's and judgesFace's (tested below); the
    // runner records what faceRecord decides.
    const runner = read("job-runner.ts");
    expect(runner).toContain("const record = faceRecord({ lock, reads, worstScore });");
    const scorer = read("providers/openai.ts");
    expect(scorer).toContain("never because less of the face can be seen");
    expect(scorer).toContain("faceVisible: parsed.faceVisible !== false,");
    // The image gate reads a faceless picture as "not measured", which it passes.
    expect(read("identity-gate-run.ts")).toContain("if (verdict.faceVisible === false) {");
  });

  it("the runner does not read frame one when the lock says skip it", () => {
    const runner = read("job-runner.ts");
    expect(runner).toContain("lock.skipFirst\n          ? Promise.resolve(null)");
  });
});

// --- 2026-09-22: every Recast take read whole, each character on their own,
// against the photo that was sent; the lock refund bounded as a settlement.

const V = (score: number, extra: Partial<FaceVerdict> = {}): FaceVerdict => ({
  score,
  notes: `note ${score}`,
  unusable: false,
  faceVisible: true,
  ...extra,
});
const read1 = (verdicts: (FaceVerdict | null)[], characterId = "eva", name = "Eva"): FaceRead => ({ characterId, name, verdicts });
/** The runner's call, reduction included: castScores, then Math.min. */
const rec = (lock: IdentityLock | null, reads: FaceRead[]) => {
  const lockScores = castScores(reads);
  return faceRecord({ lock, reads, worstScore: lockScores.length > 0 ? Math.min(...lockScores) : null });
};

describe("recastTakeLock (the lane's side of the contract)", () => {
  it("locks every take with a character in it, whatever the switch says", () => {
    expect(recastTakeLock({ cast: [{ characterId: "eva", photoPath: "u/eva-3.jpg" }], threshold: 60, lockOn: false })).toEqual({
      threshold: 60,
      refund: false,
      photoPath: "u/eva-3.jpg",
      cast: [{ characterId: "eva", photoPath: "u/eva-3.jpg" }],
    });
  });

  it("refunds a miss only with the switch on, and only where one face is cast", () => {
    const one = [{ characterId: "eva", photoPath: "u/eva.jpg" }];
    const two = [...one, { characterId: "ra", photoPath: "u/ra.jpg" }];
    expect(recastTakeLock({ cast: one, threshold: 60, lockOn: true })?.refund).toBe(true);
    expect(recastTakeLock({ cast: two, threshold: 60, lockOn: true })?.refund).toBe(false);
    expect(recastTakeLock({ cast: one, threshold: 0, lockOn: true })?.refund).toBe(false);
  });

  it("is undefined with nobody cast, and drops what isn't a character with a photo", () => {
    expect(recastTakeLock({ cast: [], threshold: 60, lockOn: true })).toBeUndefined();
    const lock = recastTakeLock({
      cast: [
        { characterId: "eva", photoPath: "u/eva.jpg" },
        { characterId: "eva", photoPath: "u/eva-2.jpg" },
        { characterId: "", photoPath: "u/x.jpg" },
        { characterId: "ra" } as never,
      ],
      threshold: 60,
      lockOn: true,
    });
    expect(lock?.cast).toEqual([{ characterId: "eva", photoPath: "u/eva.jpg" }]);
  });
});

describe("scoringCast", () => {
  it("reads the lane's cast, with the row's own character first", () => {
    const lock = recastTakeLock({
      cast: [
        { characterId: "ra", photoPath: "u/ra.jpg" },
        { characterId: "eva", photoPath: "u/eva-2.jpg" },
      ],
      threshold: 60,
      lockOn: false,
    })!;
    expect(scoringCast({ lock, characterProfileId: "eva", characterProfileIds: ["eva", "ra"], wholeCast: true })).toEqual([
      { characterId: "eva", photoPath: "u/eva-2.jpg" },
      { characterId: "ra", photoPath: "u/ra.jpg" },
    ]);
  });

  it("reads every character a lockless video lists (a Recast take with its switch off, an ensemble)", () => {
    expect(
      scoringCast({ lock: recordOnlyLock(), characterProfileId: "eva", characterProfileIds: ["eva", "ra", "eva"], wholeCast: true }),
    ).toEqual([
      { characterId: "eva", photoPath: null },
      { characterId: "ra", photoPath: null },
    ]);
  });

  it("reads only the row's own character everywhere else, exactly as before", () => {
    const lock = characterVideoLock({ hasCharacter: true, modelId: "kling-o3-pro", threshold: 70, refundOn: false })!;
    expect(scoringCast({ lock, characterProfileId: "eva", characterProfileIds: ["eva", "friend"], wholeCast: false })).toEqual([
      { characterId: "eva", photoPath: null },
    ]);
    expect(scoringCast({ lock: null, characterProfileId: null, characterProfileIds: [], wholeCast: false })).toEqual([]);
  });

  it("carries a single sent photo onto the row's own character", () => {
    expect(
      scoringCast({ lock: { threshold: 60, refund: false, photoPath: "u/eva-3.jpg" }, characterProfileId: "eva", characterProfileIds: [], wholeCast: false }),
    ).toEqual([{ characterId: "eva", photoPath: "u/eva-3.jpg" }]);
  });
});

describe("identityPhotoFor", () => {
  it("reads against the photo that was sent, not photo #1", () => {
    expect(identityPhotoFor(["u/1.jpg", "u/2.jpg", "u/3.jpg"], "u/3.jpg")).toBe("u/3.jpg");
  });

  it("falls back to photo #1 when nothing was recorded, or the photo is no longer theirs", () => {
    expect(identityPhotoFor(["u/1.jpg", "u/2.jpg"], null)).toBe("u/1.jpg");
    expect(identityPhotoFor(["u/1.jpg", "u/2.jpg"], "someone-else/9.jpg")).toBe("u/1.jpg");
  });

  it("has nothing to read against when the character has no photo", () => {
    expect(identityPhotoFor([], "u/1.jpg")).toBeNull();
    expect(identityPhotoFor(null, null)).toBeNull();
  });
});

describe("faceRecord", () => {
  const lock = { threshold: 60, refund: true };

  it("records nothing when the middle frame of the row's own character never came back", () => {
    expect(rec(lock, [read1([V(40), null, V(90)])])).toEqual({
      write: false,
      matchScore: null,
      matchNotes: null,
      refund: false,
    });
  });

  it("without a lock, records the middle frame exactly as before", () => {
    expect(rec(null, [read1([null, V(81), null])])).toEqual({
      write: true,
      matchScore: 81,
      matchNotes: "note 81",
      refund: false,
    });
    expect(rec(null, [read1([null, V(81, { faceVisible: false }), null])]).matchScore).toBeNull();
    expect(rec(null, [read1([null, V(12, { unusable: true, notes: "" }), null])]).matchNotes).toBe(
      "Scored from the middle frame. (Frame read as blank or unusable.)",
    );
  });

  it("under a lock, records the worst frame that showed a face, with its note", () => {
    const r = rec({ threshold: 60, refund: false }, [read1([V(88), V(92), V(71)])]);
    expect(r).toEqual({ write: true, matchScore: 71, matchNotes: "Lowest of 3 frames with a face. note 71", refund: false });
  });

  it("never counts a faceless or unusable frame as a miss", () => {
    const r = rec(lock, [read1([V(5, { faceVisible: false }), V(90), V(3, { unusable: true })])]);
    expect(r.matchScore).toBe(90);
    expect(r.refund).toBe(false);
    const none = rec(lock, [read1([V(5, { faceVisible: false }), V(9, { faceVisible: false }), null])]);
    expect(none).toEqual({ write: true, matchScore: null, matchNotes: NO_FACE_NOTE, refund: false });
  });

  it("refunds a miss only when the lock asks, and only with ONE character", () => {
    expect(rec(lock, [read1([V(88), V(55), V(90)])]).refund).toBe(true);
    expect(rec({ threshold: 60, refund: false }, [read1([V(88), V(55), V(90)])]).refund).toBe(false);
    const two = rec(lock, [read1([V(88), V(90), V(91)]), read1([V(40), V(90), V(91)], "ra", "Ra")]);
    expect(two.matchScore).toBe(40);
    expect(two.matchNotes).toBe("Lowest of 6 readings with a face, across 2 characters. note 40");
    expect(two.refund).toBe(false);
  });
});

describe("the take report", () => {
  it("is exactly the step the door reads: each character, their three moments, the lowest", () => {
    const step = takeReportStep([read1([V(88), V(92), V(71)]), read1([null, V(64, { faceVisible: false }), V(80)], "ra", "Ra")]);
    expect(step).toEqual({
      step: "take-report",
      detail: TAKE_REPORT_DETAIL,
      report: {
        faces: [
          { characterId: "eva", name: "Eva", lowest: 71, scores: [88, 92, 71] },
          { characterId: "ra", name: "Ra", lowest: 80, scores: [null, null, 80] },
        ],
      },
    });
    expect(TAKE_REPORT_STEP).toBe("take-report");
  });

  it("says 'not checked' — lowest null — when no face was judged", () => {
    expect(faceMoments(read1([null, null, null], "eva", ""))).toEqual({ characterId: "eva", name: "", lowest: null, scores: [null, null, null] });
  });

  it("carries a sentence History can show and translate", () => {
    expect(TAKE_REPORT_DETAIL).toBe("Each face was checked at the start, the middle and the end of the take.");
  });
});

describe("judgesFace", () => {
  it("judges a visible, usable face and nothing else", () => {
    expect(judgesFace(V(50))).toBe(true);
    expect(judgesFace(V(50, { faceVisible: false }))).toBe(false);
    expect(judgesFace(V(50, { unusable: true }))).toBe(false);
    expect(judgesFace(null)).toBe(false);
  });
});

describe("withinBudget", () => {
  it("hands back the work's answer when it lands in time", async () => {
    await expect(withinBudget(Promise.resolve(7), 1000, 0)).resolves.toBe(7);
  });

  it("stops waiting past the ceiling, and swallows a failure", async () => {
    vi.useFakeTimers();
    try {
      const slow = new Promise<number>(() => {});
      const settled = withinBudget(slow, 75_000, -1);
      await vi.advanceTimersByTimeAsync(75_000);
      await expect(settled).resolves.toBe(-1);
    } finally {
      vi.useRealTimers();
    }
    await expect(withinBudget(Promise.reject(new Error("scorer down")), 1000, null)).resolves.toBeNull();
  });
});

describe("the runner, 2026-09-22", () => {
  const runner = read("job-runner.ts");

  it("stays lane-neutral: the lane hands the cast over, the runner names no lane", () => {
    // recast-actions.test.ts pins the same rule from the lane's side.
    expect(runner).not.toMatch(/recast/i);
    expect(runner).toContain("const laneLock = jobRow?.payload?.identityLock ?? null;");
  });

  it("reads a character video that came without a lock whole anyway, recording and never refunding", () => {
    expect(runner).toContain("const lock: IdentityLock | null = laneLock ?? (gen?.character_profile_id ? recordOnlyLock() : null);");
    expect(runner).toContain("const wholeCast = laneLock === null;");
    expect(recordOnlyLock()).toEqual({ threshold: 0, refund: false });
  });

  it("reads against the photo that was sent, each character on their own", () => {
    expect(runner).toContain("identityPhotoFor(byId.get(m.characterId)?.reference_image_urls, m.photoPath)");
    expect(runner).toContain("input.cast.map(async (member, i): Promise<ScoredRead> => {");
    // The frames are pulled once for the whole cast, not once per character.
    const faces = runner.slice(runner.indexOf("async function readFaces("));
    expect(faces.indexOf('extractVideoFrame(providerDownloadUrl(outcome.resultUrl), "last")')).toBeLessThan(
      faces.indexOf("input.cast.map(async (member, i)"),
    );
  });

  it("records the worst frame of the whole cast, the number the refund decision reads", () => {
    expect(runner).toContain("const lockScores = castScores(reads);");
    expect(runner).toContain("const worstScore = lockScores.length > 0 ? Math.min(...lockScores) : null;");
    expect(runner).toContain("const record = faceRecord({ lock, reads, worstScore });");
    expect(runner).toContain("...(record.write ? { match_score: record.matchScore, match_notes: record.matchNotes } : {}),");
  });

  it("writes the take report into the log whether or not a face could be read", () => {
    expect(runner).toContain("const reportsTake = wholeCast || Boolean(laneLock?.cast?.length);");
    expect(runner).toContain("if (middle || reportsTake) {");
    expect(runner).toContain("steps: [...(last.steps ?? []), takeReportStep(reads) as unknown as PipelineStepLog]");
  });

  it("fails open and is bounded: a slow or broken reading records 'not checked', never holds up delivery", () => {
    expect(runner).toContain("readFaces(admin, { cast, lock, outcome, middleFrameUrl: frameUrl }),\n                FACE_READ_BUDGET_MS,");
    expect(Number(runner.match(/const FACE_READ_BUDGET_MS = ([\d_]+);/)?.[1].replace(/_/g, ""))).toBeLessThanOrEqual(90_000);
    // The reading runs after the terminal write: the take is already delivered.
    expect(runner.indexOf("const record = faceRecord({ lock, reads, worstScore });")).toBeGreaterThan(
      runner.indexOf('.eq("status", "generating")\n    .select("id");'),
    );
  });

  it("the lock refund is a settlement: stamped with the score, capped daily", () => {
    expect(runner).toContain("...(record.refund ? { identity_gated_at: new Date().toISOString() } : {}),");
    expect(runner).toContain("await refundGenerationCosts(generationId, { force: true, settlement: true });");
    const settle = runner.slice(runner.indexOf("if (record.refund) {"));
    expect(settle.slice(0, 400)).toContain("if (scoreError) {");
    // No lock refund anywhere is force alone any more.
    expect(runner.slice(runner.indexOf("async function finish("), runner.indexOf("async function readFaces("))).not.toContain(
      "refundGenerationCosts(generationId, { force: true });\n              } catch (refundErr) {\n                console.error(`identity-lock",
    );
  });
});
