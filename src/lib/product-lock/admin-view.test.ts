import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { distributions, parseQueueFilter, pct, queueCard, type AdminFrameRow } from "./admin-view";

// Admin → Product checks: the numbers the page prints (pure), and the
// labelling action's two guards, read as source (it needs a session).

function row(over: Partial<AdminFrameRow> = {}): AdminFrameRow {
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    created_at: "2026-09-26T10:00:00Z",
    user_id: "u",
    product_id: "p1",
    source: "bakeoff",
    shot: 2,
    moment: 1,
    at_seconds: 2.5,
    visibility: "required_label",
    frame_verdict: "match",
    shot_verdict: "match",
    reason: null,
    presence: "yes",
    coverage: 0.2,
    judge_verdict: "match",
    judge_confidence: 88,
    escalated: false,
    escalation_verdict: null,
    ocr_best: 0.93,
    ocr_conflict: null,
    face_score: 91,
    lane: "kling-o3",
    frame_path: "u/checks/2026-09-26/x.jpg",
    scorer_version: "gemini-3.1-flash-lite+claude-sonnet-5/p1",
    cost_usd: "0.003500",
    signals: { box: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, read: ["SOLSTAD", 7, "COLD BREW"] },
    label: null,
    labelled_at: null,
    ...over,
  };
}

describe("distributions", () => {
  it("counts verdicts, bins confidence and word similarity, sums the cost", () => {
    const d = distributions([
      row(),
      row({ frame_verdict: "didnt_match", judge_confidence: 35, ocr_best: 0.2, escalated: true, cost_usd: 0.0145 }),
      row({ frame_verdict: "not_readable", judge_confidence: 100, ocr_best: null, frame_path: null, source: "moment" }),
    ]);
    expect(d.total).toBe(3);
    expect(d.labelable).toBe(2);
    expect(d.customerFrames).toBe(1);
    expect(d.toLabel).toBe(2);
    expect(d.byVerdict.find((v) => v.verdict === "didnt_match")?.count).toBe(1);
    expect(d.confidence.find((c) => c.verdict === "match")?.bins[8]).toBe(1);
    expect(d.confidence.find((c) => c.verdict === "didnt_match")?.bins[3]).toBe(1);
    expect(d.confidence.find((c) => c.verdict === "not_readable")?.bins[9]).toBe(1);
    expect(d.ocr[9]).toBe(1);
    expect(d.ocr[2]).toBe(1);
    expect(d.escalated).toBe(1);
    expect(d.costUsd).toBeCloseTo(0.0215);
    expect(d.bySource[0]).toEqual({ value: "bakeoff", count: 2 });
  });

  it("feeds the labels to the calibration report", () => {
    const d = distributions([row({ label: "correct" }), row({ frame_verdict: "didnt_match", label: "wrong" }), row({ label: "bogus" })]);
    expect(d.report.trueMatches).toBe(2);
    expect(d.report.falseMismatch).toMatchObject({ k: 1, n: 2 });
    expect(d.report.unlabelled).toBe(1);
  });
});

describe("a queue card", () => {
  it("says where the frame is, what each reader said, and keeps the box", () => {
    const c = queueCard(row({ escalated: true, escalation_verdict: "mismatch", ocr_conflict: "MOUNTAIN DEW", ocr_best: 0.3 }));
    expect(c.where).toBe("shot 2 · 2.5 s · required_label");
    expect(c.judge).toBe("match · 88");
    expect(c.second).toBe("mismatch");
    expect(c.words).toBe("best 0.30 · foreign “MOUNTAIN DEW”");
    expect(c.read).toEqual(["SOLSTAD", "COLD BREW"]);
    expect(c.box).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
  });

  it("a second reading that never answered says so; a bad box is dropped", () => {
    const c = queueCard(row({ escalated: true, escalation_verdict: null, signals: { box: { x: 0, y: 0, w: 0, h: 1 } } }));
    expect(c.second).toBe("no answer");
    expect(c.box).toBeNull();
  });

  it("filters default to the frames still to label", () => {
    expect(parseQueueFilter("misses")).toBe("misses");
    expect(parseQueueFilter("everything")).toBe("todo");
    expect(pct(0.0312)).toBe("3.1%");
    expect(pct(null)).toBe("—");
  });
});

describe("the labelling action (source)", () => {
  const source = readFileSync(join(__dirname, "admin-actions.ts"), "utf8");
  const body = source.slice(source.indexOf("export async function labelFrameCheck"));

  it("is a server-actions file whose one export is the action", () => {
    expect(source.startsWith('"use server";\n')).toBe(true);
    expect([...source.matchAll(/^export (\w+ \w+)/gm)].map((m) => m[1])).toEqual(["async function"]);
  });

  it("asks requireAdmin before anything else", () => {
    expect(body.indexOf("await requireAdmin()")).toBeGreaterThan(-1);
    expect(body.indexOf("await requireAdmin()")).toBeLessThan(body.indexOf(".from(FRAME_CHECK_TABLE)"));
  });

  it("v2 #32: labels only frames that kept their picture, and checks a row was actually labelled", () => {
    expect(body).toContain('.not("frame_path", "is", null)');
    expect(body).toContain("data.length === 0");
  });
});
