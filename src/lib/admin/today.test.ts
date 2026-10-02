import { describe, expect, it, vi } from "vitest";

// today.ts reads fal and the model catalogue at call time only; the pure
// helpers below need neither.
vi.mock("@/lib/generations/providers/fal-ledger", () => ({ getFalBalance: async () => ({ ok: false, error: "test" }) }));
vi.mock("@/lib/push/alert-rules", () => ({ falBalanceAlert: () => null }));
vi.mock("@/lib/generations/providers/video-models", () => ({
  maxSingleRenderCostUsd: () => 3,
  VIDEO_MODELS: [{ id: "kling-o3", name: "Kling O3" }],
}));
vi.mock("@/lib/generations/providers/image-models", () => ({ IMAGE_MODELS: [{ id: "flux-2-pro", name: "FLUX.2 Pro" }] }));
vi.mock("@/lib/plans", () => ({ PLAN_LABELS: { starter: "Starter" } }));
vi.mock("@/lib/retention/inbox", () => ({ loadRetentionInbox: async () => [] }));
vi.mock("@/lib/admin/payments", () => ({ loadPayments: async () => ({ payments: [], disputes: [], error: null }), OPEN_DISPUTE_STATUSES: new Set() }));

const { creditsHeld, modelName, money, queueState, sortInbox, ORPHAN_AFTER_MIN, STUCK_AFTER_MIN } = await import("./today");

describe("engine names", () => {
  it("reads the catalogue, and keeps an id the catalogue dropped", () => {
    expect(modelName("kling-o3")).toBe("Kling O3");
    expect(modelName("flux-2-pro")).toBe("FLUX.2 Pro");
    expect(modelName("retired-model")).toBe("retired-model");
    expect(modelName(null)).toBe("—");
  });
});

describe("the render queue's stuck line", () => {
  it("a render with a provider job is stuck only past STUCK_AFTER_MIN", () => {
    expect(queueState(STUCK_AFTER_MIN - 1, true)).toBe("running");
    expect(queueState(STUCK_AFTER_MIN, true)).toBe("stuck");
  });
  it("a render with no provider job is stuck sooner (the reaper's orphan)", () => {
    expect(queueState(ORPHAN_AFTER_MIN - 1, false)).toBe("running");
    expect(queueState(ORPHAN_AFTER_MIN, false)).toBe("stuck");
  });
  it("counts every kind of credit a render holds", () => {
    expect(creditsHeld({ credits_used: 10, purchased_credits_used: 12, bonus_credits_used: 2 })).toBe(24);
    expect(creditsHeld({ credits_used: null, purchased_credits_used: null, bonus_credits_used: null })).toBe(0);
  });
});

describe("Needs you", () => {
  it("puts urgent first, then the newest within a tone", () => {
    const item = (id: string, tone: "urgent" | "warn" | "info", at: string | null) => ({
      id,
      tone,
      at,
      group: "system" as const,
      kind: "x",
      title: id,
      sub: "",
      actions: [],
    });
    const sorted = sortInbox([
      item("old-info", "info", "2026-09-01T00:00:00Z"),
      item("warn", "warn", "2026-09-02T00:00:00Z"),
      item("new-info", "info", "2026-09-03T00:00:00Z"),
      item("urgent", "urgent", null),
    ]);
    expect(sorted.map((i) => i.id)).toEqual(["urgent", "warn", "new-info", "old-info"]);
  });
  it("writes money the way the admin reads it", () => {
    expect(money(1900, "eur")).toBe("€19");
    expect(money(4550, "usd")).toBe("$45.50");
    expect(money(500, "chf")).toBe("5 CHF");
  });
});
