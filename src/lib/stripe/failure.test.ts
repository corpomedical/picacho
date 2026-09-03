import { describe, expect, it } from "vitest";
import { classifyStripeFailure, reportSurface, REPORT_MARKERS } from "./failure";

describe("classifyStripeFailure", () => {
  it("treats the 2026-09-03 outage error as config, not transient", () => {
    const f = classifyStripeFailure({
      type: "StripeInvalidRequestError",
      code: "customer_tax_location_invalid",
      statusCode: 400,
      message: "Automatic tax calculation in Checkout requires a valid address on the Customer.",
    });
    expect(f.kind).toBe("config");
    expect(f.code).toBe("customer_tax_location_invalid");
  });

  it("treats a dead or wrong-mode customer id (resource_missing, 404) as config", () => {
    expect(classifyStripeFailure({ type: "StripeInvalidRequestError", code: "resource_missing", statusCode: 404, message: "No such customer" }).kind).toBe("config");
  });

  it("treats wrong-mode or bad keys as config", () => {
    expect(classifyStripeFailure({ type: "StripeAuthenticationError", statusCode: 401, message: "Invalid API Key" }).kind).toBe("config");
  });

  it("treats rate limits as transient in both shapes stripe-node produces", () => {
    expect(classifyStripeFailure({ type: "StripeRateLimitError", statusCode: 429, message: "slow down" }).kind).toBe("transient");
    expect(classifyStripeFailure({ type: "StripeRateLimitError", code: "rate_limit", statusCode: 400, message: "slow down" }).kind).toBe("transient");
  });

  it("treats connection and API errors as transient", () => {
    expect(classifyStripeFailure({ type: "StripeConnectionError", message: "socket hang up" }).kind).toBe("transient");
    expect(classifyStripeFailure({ type: "StripeAPIError", statusCode: 500, message: "boom" }).kind).toBe("transient");
  });

  it("never throws on junk and still yields a code and message", () => {
    expect(classifyStripeFailure(undefined)).toEqual({ kind: "transient", code: "unknown", message: "unknown error" });
    expect(classifyStripeFailure(new Error("network"))).toMatchObject({ kind: "transient", code: "unknown", message: "network" });
    expect(classifyStripeFailure({ type: "StripeInvalidRequestError", message: "x".repeat(400) }).message).toHaveLength(300);
  });
});

describe("reportSurface", () => {
  it("recognises the money-path markers and nothing else", () => {
    expect(reportSurface(`${REPORT_MARKERS.checkout} customer_tax_location_invalid · pack checkout small`)).toBe("checkout");
    expect(reportSurface(`${REPORT_MARKERS.portal} resource_missing · portal customer=cus_x`)).toBe("portal");
    expect(reportSurface("Minified React error #419")).toBeNull();
    expect(reportSurface(null)).toBeNull();
    expect(reportSurface("")).toBeNull();
  });
});
