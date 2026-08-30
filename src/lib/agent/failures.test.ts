import { describe, expect, it } from "vitest";
import { classifyTurnFailure, unitsForFailedTurn } from "./failures";

describe("classifyTurnFailure", () => {
  it("reads a spend limit we set as ours, not a bad request", () => {
    // The exact shape Anthropic documents for a limit set in the Console.
    expect(
      classifyTurnFailure(400, "You have reached your specified API usage limits."),
    ).toBe("provider_unavailable");
    expect(
      classifyTurnFailure(400, "You have reached your specified workspace API usage limits."),
    ).toBe("provider_unavailable");
  });

  it("still treats an ordinary 400 as worth retrying", () => {
    // Otherwise a genuinely malformed request would be silently written off as
    // a billing problem and never investigated.
    expect(classifyTurnFailure(400, "messages: at least one message is required")).toBe(
      "transient",
    );
  });

  it("reads a revoked, expired or missing key as ours", () => {
    expect(classifyTurnFailure(401, "authentication_error: invalid x-api-key")).toBe(
      "provider_unavailable",
    );
    expect(classifyTurnFailure(403, "permission_error")).toBe("provider_unavailable");
  });

  it("separates the tier's own spend cap from ordinary rate limiting", () => {
    expect(
      classifyTurnFailure(429, 'rate_limit_error {"error_code":"enforced_spend_limit_reached"}'),
    ).toBe("provider_unavailable");
    // A plain 429 is a burst, and the next attempt may well work.
    expect(classifyTurnFailure(429, "rate_limit_error: too many requests")).toBe("transient");
  });

  it("reads a wrong model id as ours", () => {
    expect(classifyTurnFailure(404, "model: claude-opus-9 not found")).toBe(
      "provider_unavailable",
    );
  });

  it("falls back to transient for overloads, timeouts and the unknown", () => {
    expect(classifyTurnFailure(529, "overloaded_error")).toBe("transient");
    expect(classifyTurnFailure(500, "internal server error")).toBe("transient");
    expect(classifyTurnFailure(undefined, "socket hang up")).toBe("transient");
    expect(classifyTurnFailure(undefined, "")).toBe("transient");
  });
});

describe("unitsForFailedTurn", () => {
  it("charges nothing when the request never reached the model", () => {
    // A budget WE set, or a key WE broke, must not come out of their allowance.
    expect(unitsForFailedTurn("provider_unavailable")).toBe(0);
  });

  it("charges one when tokens may have been spent", () => {
    expect(unitsForFailedTurn("transient")).toBe(1);
  });
});
