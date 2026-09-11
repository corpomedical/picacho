import { describe, expect, it } from "vitest";
import type { AstraInput, AstraJobRequest } from "../generations/providers/astra";
import { photoBuildRequest, retryBuildRequest, setAstraRequest, type SetRetry } from "./astra-request";
import { closeRetryFeedback, closeRetryInput, RETRY_SMALLER, RETRY_SMALLER_PHOTO } from "./build-retry";
import {
  SET_BUILDER_INSTRUCTIONS,
  SET_PHOTO_RULES,
  SET_SPEC_JSON_SCHEMA,
  photoBuildInput,
  setBuildInput,
} from "./set-builder-prompt";
import { SET_BUILD_MAX_OUTPUT_TOKENS, SET_PHOTO_BUILD_MAX_OUTPUT_TOKENS, SET_RESERVED_BRIEF } from "./set-config";
import { normaliseSetSpec, type SetSpec } from "./set-spec";
import showroomOpen from "./fixtures-showroom-open.json";

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

// Every request a photo build sends, first attempt and retry, carries the
// photo and the photo caps; a retry never turns a photo build into a text
// build of its notes (2026-09-11).

const PHOTO = "data:image/jpeg;base64,/9j/STORED";
const parts = (input: AstraInput) => {
  if (typeof input === "string") throw new Error("a photo build's input is never a bare string");
  return input.flatMap((m) => m.content);
};
const images = (req: AstraJobRequest) => parts(req.input).filter((p) => p.type === "input_image");
const texts = (req: AstraJobRequest) =>
  parts(req.input).flatMap((p) => (p.type === "input_text" ? [p.text] : []));
const previous = (() => {
  const r = normaliseSetSpec(showroomOpen);
  if (!r.ok) throw new Error("fixture");
  return r.spec;
})() satisfies SetSpec;
const SIDES = ["the +Z side (around z = 10)"];
const RETRIES: [string, SetRetry][] = [
  ["a failed answer", { why: "again", tooLong: false }],
  ["an answer that ran out of room", { why: "again", tooLong: true }],
  ["an open set", { why: "close", openSides: SIDES, previous }],
];

describe("photoBuildRequest — a photo build's first attempt", () => {
  const req = photoBuildRequest(PHOTO, "It's night.", "sid");

  it("sends the photo inline with the rules and the notes, at the photo caps", () => {
    expect(req.maxOutputTokens).toBe(SET_PHOTO_BUILD_MAX_OUTPUT_TOKENS);
    expect(req.maxOutputTokens).toBeGreaterThan(12_834);
    expect(req.instructions).toBe(SET_BUILDER_INSTRUCTIONS);
    expect(images(req)).toEqual([{ type: "input_image", image_url: PHOTO, detail: "high" }]);
    expect(texts(req)).toEqual([SET_PHOTO_RULES, "Notes from the photographer: It's night."]);
    expect(req.safetyIdentifier).toBe("sid");
  });

  it("sends no notes part when there are none", () => {
    expect(texts(photoBuildRequest(PHOTO, "", "sid"))).toEqual([SET_PHOTO_RULES]);
  });
});

describe("retryBuildRequest — a photo build", () => {
  for (const [name, retry] of RETRIES) {
    it(`resends the stored photo after ${name}, at the photo caps, never the notes as a brief`, () => {
      const req = retryBuildRequest({ kind: "photo", notes: "the back wall is a long bar", photo: PHOTO }, retry, "sid");
      expect(req).not.toBeNull();
      if (!req) return;
      expect(req.maxOutputTokens).toBe(SET_PHOTO_BUILD_MAX_OUTPUT_TOKENS);
      expect(images(req)).toEqual([{ type: "input_image", image_url: PHOTO, detail: "high" }]);
      const said = texts(req);
      expect(said[0]).toBe(SET_PHOTO_RULES);
      expect(said[1]).toBe("Notes from the photographer: the back wall is a long bar");
      expect(JSON.stringify(req.input)).not.toContain("Brief:");
      expect(req.safetyIdentifier).toBe("sid");
    });

    it(`sends nothing after ${name} when the photo may not be resent`, () => {
      // Switch off, bytes changed, or unreadable (photo.ts photoForRetry):
      // no retry, rather than a text build of the notes.
      expect(retryBuildRequest({ kind: "photo", notes: "the back wall is a long bar", photo: null }, retry, "sid")).toBeNull();
      expect(retryBuildRequest({ kind: "photo", notes: "", photo: null }, retry, "sid")).toBeNull();
    });
  }

  it("says what went wrong after the photo: too long, or the sides to close", () => {
    const smaller = retryBuildRequest({ kind: "photo", notes: "", photo: PHOTO }, { why: "again", tooLong: true }, "sid");
    expect(smaller && texts(smaller)).toEqual([SET_PHOTO_RULES, RETRY_SMALLER_PHOTO]);
    const again = retryBuildRequest({ kind: "photo", notes: "", photo: PHOTO }, { why: "again", tooLong: false }, "sid");
    expect(again && texts(again)).toEqual([SET_PHOTO_RULES]);
    const close = retryBuildRequest({ kind: "photo", notes: "", photo: PHOTO }, { why: "close", openSides: SIDES, previous }, "sid");
    expect(close && texts(close)).toEqual([SET_PHOTO_RULES, closeRetryFeedback(SIDES, previous)]);
  });
});

describe("retryBuildRequest — a text build, byte for byte what it was before photos", () => {
  const BRIEF = "A modern sports car on a dealership floor";

  it("resends the brief, smaller when the answer ran out of room, at the text caps", () => {
    const again = retryBuildRequest({ kind: "text", brief: BRIEF }, { why: "again", tooLong: false }, "sid");
    expect(again?.input).toBe(setBuildInput(BRIEF));
    expect(again?.maxOutputTokens).toBe(SET_BUILD_MAX_OUTPUT_TOKENS);
    const smaller = retryBuildRequest({ kind: "text", brief: BRIEF }, { why: "again", tooLong: true }, "sid");
    expect(smaller?.input).toBe(setBuildInput(BRIEF) + RETRY_SMALLER);
  });

  it("sends an open set back with its brief", () => {
    const close = retryBuildRequest({ kind: "text", brief: BRIEF }, { why: "close", openSides: SIDES, previous }, "sid");
    expect(close?.input).toBe(closeRetryInput(BRIEF, SIDES, previous));
    expect(close?.maxOutputTokens).toBe(SET_BUILD_MAX_OUTPUT_TOKENS);
  });

  it("never sends the reserved placeholder as a brief", () => {
    for (const [, retry] of RETRIES) {
      expect(retryBuildRequest({ kind: "text", brief: SET_RESERVED_BRIEF }, retry, "sid")).toBeNull();
    }
  });
});
