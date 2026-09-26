import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { FRAME_VERDICTS, PRODUCT_VISIBILITIES, type FrameOutcome } from "./product-lock";
import {
  FRAME_CHECK_BUCKET,
  FRAME_CHECK_COLUMNS,
  FRAME_CHECK_SOURCES,
  FRAME_CHECK_TABLE,
  FRAME_LABELS,
  SIGNALS_MAX_BYTES,
  frameCheckRow,
  framePathFor,
  frameSignals,
  parseFrameLabel,
  writeFrameChecks,
  type FrameCheckDraft,
  type RecordContext,
} from "./records";

// product_frame_checks: the admin-only record of every frame read. The
// table itself is the campaign engine's SQL (press-tour-03-campaigns.sql);
// these tests pin the shape this side writes, so the two can be held
// together, and the privacy rule that customer frames keep no picture.

const USER = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "33333333-3333-4333-8333-333333333333";

const OUTCOME: FrameOutcome = { verdict: "didnt_match", reason: "The words on the label came out different.", absenceConfirmed: false, labelRead: false, words: "conflict", resolved: "mismatch" };

function draft(over: Partial<FrameCheckDraft> = {}): FrameCheckDraft {
  return {
    moment: 1,
    atSeconds: 2.5,
    visibility: "required_label",
    outcome: OUTCOME,
    shotVerdict: "didnt_match",
    locate: { present: "yes", box: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, boxConfidence: "high", blurred: false },
    coverage: 0.123456,
    label: { best: 0.2, bestString: "SOLSTAD", matched: false, conflict: "MOUNTAIN DEW", lines: ["MOUNTAIN DEW"] },
    judge: { verdict: "mismatch", shape: "ok", label: "off", logo: "off", colour: "ok", labelInView: true, blurred: false, confidence: 77.4, note: "Other logo." },
    escalation: undefined,
    faceScore: 88.6,
    usd: 0.0034567891,
    scorerVersion: "gemini-3.1-flash-lite+claude-sonnet-5/p1",
    frame: Buffer.from([0xff, 0xd8, 0xff]),
    ...over,
  };
}

const CTX: RecordContext = { userId: USER, productId: PRODUCT, campaignId: "not-a-uuid", source: "moment", shot: 2, lane: "kling-o3" };

describe("the row", () => {
  it("writes exactly FRAME_CHECK_COLUMNS", () => {
    expect(Object.keys(frameCheckRow(CTX, draft(), null)).sort()).toEqual([...FRAME_CHECK_COLUMNS].sort());
  });

  it("carries the verdicts, the readings and the stamp, rounded and bounded", () => {
    const row = frameCheckRow(CTX, draft(), null);
    expect(row).toMatchObject({
      user_id: USER,
      product_id: PRODUCT,
      campaign_id: null, // not a uuid: never written as one
      source: "moment",
      shot: 2,
      moment: 1,
      at_seconds: 2.5,
      frame_verdict: "didnt_match",
      shot_verdict: "didnt_match",
      presence: "yes",
      coverage: 0.1235,
      judge_verdict: "mismatch",
      judge_confidence: 77,
      escalated: false,
      escalation_verdict: null,
      ocr_best: 0.2,
      ocr_conflict: "MOUNTAIN DEW",
      face_score: 89,
      lane: "kling-o3",
      cost_usd: 0.003457,
      scorer_version: "gemini-3.1-flash-lite+claude-sonnet-5/p1",
    });
  });

  it("an asked-for second reading is marked escalated even when it did not answer", () => {
    expect(frameCheckRow(CTX, draft({ escalation: null }), null).escalated).toBe(true);
  });

  it("signals stay under the bound however much was read", () => {
    const d = draft({ label: { best: 0, bestString: null, matched: false, conflict: null, lines: Array.from({ length: 200 }, () => "W".repeat(80)) } });
    const sig = frameSignals(d);
    expect(new TextEncoder().encode(JSON.stringify(sig)).length).toBeLessThanOrEqual(SIGNALS_MAX_BYTES);
    expect((sig.read as string[]).length).toBeLessThanOrEqual(24);
  });

  it("the lists the SQL's CHECKs must hold", () => {
    expect(FRAME_CHECK_SOURCES).toEqual(["still", "moment", "self_test", "bakeoff", "seeded"]);
    expect(FRAME_LABELS).toEqual(["correct", "wrong", "not_readable"]);
    expect(FRAME_VERDICTS).toEqual(["match", "didnt_match", "not_readable", "absent", "excluded", "not_checked"]);
    expect(PRODUCT_VISIBILITIES).toEqual(["required_label", "required_shape", "absent"]);
    expect(FRAME_CHECK_TABLE).toBe("product_frame_checks");
  });

  it("labels parse only as the three words", () => {
    expect(parseFrameLabel("wrong")).toBe("wrong");
    expect(parseFrameLabel("WRONG")).toBeNull();
    expect(parseFrameLabel(undefined)).toBeNull();
  });

  it("a kept frame lives in the owner's own folder", () => {
    expect(framePathFor(USER, "abc", new Date("2026-09-26T10:00:00Z"))).toBe(`${USER}/checks/2026-09-26/abc.jpg`);
  });
});

function fakeDb(opts: { insertError?: string } = {}) {
  const inserted: unknown[] = [];
  const uploads: string[] = [];
  const removed: string[] = [];
  const db = {
    from: vi.fn((table: string) => ({
      insert: vi.fn(async (rows: unknown[]) => {
        expect(table).toBe(FRAME_CHECK_TABLE);
        if (opts.insertError) return { error: { message: opts.insertError } };
        inserted.push(...rows);
        return { error: null };
      }),
    })),
    storage: {
      from: vi.fn((bucket: string) => ({
        upload: vi.fn(async (path: string) => {
          expect(bucket).toBe(FRAME_CHECK_BUCKET);
          uploads.push(path);
          return { error: null };
        }),
        remove: vi.fn(async (paths: string[]) => {
          removed.push(...paths);
          return { error: null };
        }),
      })),
    },
  } as unknown as SupabaseClient;
  return { db, inserted, uploads, removed };
}

describe("writing (service role)", () => {
  it("v2 #32: a customer's frames keep their numbers, never their picture", async () => {
    const f = fakeDb();
    expect(await writeFrameChecks(f.db, { ...CTX, keepFrames: false }, [draft(), draft({ moment: 2 })])).toBe(2);
    expect(f.uploads).toHaveLength(0);
    expect(f.inserted.every((r) => (r as { frame_path: unknown }).frame_path === null)).toBe(true);
  });

  it("an admin's (or a bake-off's) frames keep their picture for labelling", async () => {
    const f = fakeDb();
    let n = 0;
    await writeFrameChecks(f.db, { ...CTX, keepFrames: true }, [draft()], { newId: () => `id${n++}`, now: () => new Date("2026-09-26T00:00:00Z") });
    expect(f.uploads).toEqual([`${USER}/checks/2026-09-26/id0.jpg`]);
    expect((f.inserted[0] as { frame_path: unknown }).frame_path).toBe(`${USER}/checks/2026-09-26/id0.jpg`);
  });

  it("a failed insert never throws, and takes back the pictures it kept", async () => {
    const f = fakeDb({ insertError: 'relation "product_frame_checks" does not exist' });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await writeFrameChecks(f.db, { ...CTX, keepFrames: true }, [draft()], { newId: () => "x" })).toBe(0);
    expect(f.removed).toHaveLength(1);
    spy.mockRestore();
  });

  it("nothing is written for an owner that is not a uuid, or with no frames", async () => {
    const f = fakeDb();
    expect(await writeFrameChecks(f.db, { ...CTX, userId: "someone" }, [draft()])).toBe(0);
    expect(await writeFrameChecks(f.db, CTX, [])).toBe(0);
    expect(f.inserted).toHaveLength(0);
  });
});
