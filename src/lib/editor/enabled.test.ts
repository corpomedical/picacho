import { describe, expect, it } from "vitest";
import { editorGate, effectsAllowed } from "./enabled";

// Who may use Director's Cut (operator, 2026-10-03: every paid plan, Live's
// rule) and Effects (admins only, his pick the same day).
describe("editorGate", () => {
  it("lets admins in whether or not it is open to plans", () => {
    expect(editorGate({ role: "admin", plan: "none" }, false)).toMatchObject({ error: null, isAdmin: true });
  });

  it("stays closed to customers until the plans switch is on", () => {
    expect(editorGate({ plan: "studio", plan_status: "active" }, false).code).toBe("notOpen");
  });

  it("opens to every paid plan in good standing", () => {
    for (const plan of ["basic", "starter", "growth", "studio", "elite"]) {
      expect(editorGate({ plan, plan_status: "active" }, true).error, plan).toBeNull();
      expect(editorGate({ plan, plan_status: null }, true).error, `${plan} comped`).toBeNull();
    }
  });

  it("sends anyone without a paid plan, or with a failed payment, to the plans", () => {
    expect(editorGate({ plan: "none" }, true).code).toBe("needsPlan");
    expect(editorGate({ plan: "starter", plan_status: "past_due" }, true).code).toBe("needsPlan");
    expect(editorGate(null, true).code).toBe("needsPlan");
  });

  it("never lets a suspended account in, admin or not", () => {
    expect(editorGate({ role: "admin", status: "suspended" }, true).code).toBe("suspended");
    expect(editorGate({ plan: "elite", plan_status: "active", status: "suspended" }, true).code).toBe("suspended");
  });
});

describe("effectsAllowed", () => {
  it("is admins only", () => {
    expect(effectsAllowed({ role: "admin" })).toBe(true);
    expect(effectsAllowed({ role: "user" })).toBe(false);
    expect(effectsAllowed({ role: "admin", status: "suspended" })).toBe(false);
  });
});
