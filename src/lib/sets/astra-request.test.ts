import { describe, expect, it } from "vitest";
import { setAstraRequest } from "./astra-request";
import { SET_BUILDER_INSTRUCTIONS, SET_SPEC_JSON_SCHEMA, photoBuildInput, setBuildInput } from "./set-builder-prompt";

// Both kinds of build send the one cached prefix — the same instructions and
// schema OBJECTS — and differ only in the input and the caps (2026-09-11).

describe("setAstraRequest", () => {
  const text = setAstraRequest(setBuildInput("a harbour at dawn"), "sid", "text");
  const photo = setAstraRequest(photoBuildInput("data:image/jpeg;base64,/9j/AAAA", ""), "sid", "photo");

  it("sends both kinds the same instructions and schema, so they share the cached prefix", () => {
    expect(text.instructions).toBe(SET_BUILDER_INSTRUCTIONS);
    expect(photo.instructions).toBe(SET_BUILDER_INSTRUCTIONS);
    expect(text.schema).toBe(SET_SPEC_JSON_SCHEMA);
    expect(photo.schema).toBe(SET_SPEC_JSON_SCHEMA);
    expect(photo.schemaName).toBe(text.schemaName);
  });

  it("gives a photo build its own cap: 16,000 output tokens at effort low", () => {
    // One measured photo build wrote 12,834 output tokens; the text cap would cut it off.
    expect(photo.maxOutputTokens).toBe(16_000);
    expect(photo.effort).toBe("low");
  });

  it("leaves a text build's cap exactly as it was: 10,000 at effort low", () => {
    expect(text.maxOutputTokens).toBe(10_000);
    expect(text.effort).toBe("low");
    expect(text.input).toBe("Brief: a harbour at dawn");
  });

  it("carries the safety identifier it is given", () => {
    expect(text.safetyIdentifier).toBe("sid");
    expect(setAstraRequest("Brief: x", undefined, "photo").safetyIdentifier).toBeUndefined();
  });
});
