import { describe, expect, it } from "vitest";
import { isProviderFault } from "./provider-fault";

// The breaker exists for outages. Counting rejected REQUESTS toward it let
// one user's refused photos walk a healthy model toward being silently
// swapped out for everyone — observed at consecutive_failures = 20 in
// production on 2026-08-31, one distinct user short of tripping.
describe("isProviderFault", () => {
  it("does not count fal's real rejection tokens as model faults", () => {
    // Verbatim shapes from the production model_health.last_error column.
    expect(
      isProviderFault(
        'fal.ai (Seedance 2.5) error (422): {"detail":[{"loc":["body","image_urls"],"msg":"The images or videos provided may contain likenesses of real people","type":"content_policy_violation"}]}',
      ),
    ).toBe(false);
    expect(
      isProviderFault(
        'fal.ai (Kling O3 Pro) error (422): {"detail":[{"type":"image_aspect_ratio_error","msg":"image aspect ratio invalid"}]}',
      ),
    ).toBe(false);
    expect(
      isProviderFault(
        'fal.ai (Kling) error (422): {"detail":[{"loc":["body"],"msg":"Invalid parameters in input, please check inputs and try again."}]}',
      ),
    ).toBe(false);
  });

  it("treats any non-429 4xx as the request's fault, not the model's", () => {
    expect(isProviderFault("fal.ai (Veo) error (400): bad request")).toBe(false);
    expect(isProviderFault("fal.ai (Veo) error (403): forbidden")).toBe(false);
    expect(isProviderFault("fal.ai (Veo) error (422): unprocessable")).toBe(false);
  });

  it("still counts what the breaker is actually for", () => {
    expect(isProviderFault("fal.ai (Veo) error (429): too many requests")).toBe(true);
    expect(isProviderFault("fal.ai (Veo) error (500): internal error")).toBe(true);
    expect(isProviderFault("fal.ai (Veo) error (503): unavailable")).toBe(true);
    expect(isProviderFault("Request timed out after 30s — try again.")).toBe(true);
    expect(isProviderFault("fetch failed")).toBe(true);
  });

  it("keeps the original prose matches working", () => {
    expect(isProviderFault("blocked by content policy")).toBe(false);
    expect(isProviderFault("nsfw content detected")).toBe(false);
  });
});
