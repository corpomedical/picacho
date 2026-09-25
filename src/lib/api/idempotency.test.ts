import { describe, expect, it, vi } from "vitest";
import type { FollowOutcome } from "../generations/repeat-send";
import {
  apiRepeatAnswer,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_NOT_A_STRING,
  IDEMPOTENCY_KEY_TOO_LONG,
  idempotentGenerationId,
  isSameRequest,
  parseIdempotencyKey,
} from "./idempotency";

// ONE REQUEST, CHARGED ONCE (Press Tour cut 0, 2026-09-25). The pieces
// runApiImageGeneration builds its repeat handling from; generate.test.ts
// runs them together against the reservation.

vi.stubEnv("MEDIA_SIGNING_SECRET", "test-only");

const SECRET = "server-secret";
const UUID_V8 = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("parseIdempotencyKey", () => {
  it("no key is not an error: absent, null and blank all mean none", () => {
    // A host that fills every optional field with "" must not have every
    // call refused.
    for (const none of [undefined, null, "", "   "]) {
      expect(parseIdempotencyKey(none), String(none)).toEqual({ key: null, error: null });
    }
  });

  it("trims, so a stray space names the same request", () => {
    expect(parseIdempotencyKey("  img-1 ")).toEqual({ key: "img-1", error: null });
  });

  it("refuses a key it cannot use, before anything runs", () => {
    expect(parseIdempotencyKey(42)).toEqual({ key: null, error: IDEMPOTENCY_KEY_NOT_A_STRING });
    expect(parseIdempotencyKey({ k: 1 })).toEqual({ key: null, error: IDEMPOTENCY_KEY_NOT_A_STRING });
    expect(parseIdempotencyKey("x".repeat(IDEMPOTENCY_KEY_MAX_LENGTH))).toEqual({
      key: "x".repeat(IDEMPOTENCY_KEY_MAX_LENGTH),
      error: null,
    });
    expect(parseIdempotencyKey("x".repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1))).toEqual({
      key: null,
      error: IDEMPOTENCY_KEY_TOO_LONG,
    });
  });
});

describe("idempotentGenerationId", () => {
  it("is a row id: a version-8 UUID, the same every time for one user and key", () => {
    const a = idempotentGenerationId({ userId: "u1", key: "img-1" }, SECRET);
    expect(a).toMatch(UUID_V8);
    expect(idempotentGenerationId({ userId: "u1", key: "img-1" }, SECRET)).toBe(a);
  });

  it("SECURITY: two people sending the same low-entropy key never meet one row", () => {
    // A model picks "img-1" for everyone. Keyed by the user as well, or the
    // second person is handed the first person's picture.
    expect(idempotentGenerationId({ userId: "u1", key: "img-1" }, SECRET)).not.toBe(
      idempotentGenerationId({ userId: "u2", key: "img-1" }, SECRET),
    );
    expect(idempotentGenerationId({ userId: "u1", key: "img-1" }, SECRET)).not.toBe(
      idempotentGenerationId({ userId: "u1", key: "img-2" }, SECRET),
    );
  });

  it("SECURITY: no two inputs concatenate to the same bytes", () => {
    expect(idempotentGenerationId({ userId: "u1", key: "2x" }, SECRET)).not.toBe(
      idempotentGenerationId({ userId: "u12", key: "x" }, SECRET),
    );
  });

  it("SECURITY: nobody without the server's secret can compute someone's id", () => {
    // The composer takes its row id from the client, so a predictable id
    // could be reserved first by someone else and block the real request.
    expect(idempotentGenerationId({ userId: "u1", key: "img-1" }, SECRET)).not.toBe(
      idempotentGenerationId({ userId: "u1", key: "img-1" }, "another-secret"),
    );
    expect(() => idempotentGenerationId({ userId: "u1", key: "img-1" }, "")).toThrow();
  });
});

describe("isSameRequest", () => {
  const row = { prompt_input: "Eva on a rooftop", character_profile_id: "c1", deleted_at: null, credits_used: 1 };

  it("the same prompt and character is the same request", () => {
    expect(isSameRequest(row, { prompt: "Eva on a rooftop", characterId: "c1" })).toBe(true);
    expect(
      isSameRequest({ ...row, character_profile_id: null }, { prompt: "Eva on a rooftop", characterId: null }),
    ).toBe(true);
  });

  it("a key reused for another picture is not", () => {
    expect(isSameRequest(row, { prompt: "Eva in a kitchen", characterId: "c1" })).toBe(false);
    expect(isSameRequest(row, { prompt: "Eva on a rooftop", characterId: "c2" })).toBe(false);
    expect(isSameRequest(row, { prompt: "Eva on a rooftop", characterId: null })).toBe(false);
  });

  it("a character id written in capitals is the same character (F8: Postgres answers uuids in lowercase)", () => {
    const id = "3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b";
    const stored = { ...row, character_profile_id: id };
    expect(isSameRequest(stored, { prompt: "Eva on a rooftop", characterId: id.toUpperCase() })).toBe(true);
    expect(isSameRequest({ ...stored, character_profile_id: id.toUpperCase() }, { prompt: "Eva on a rooftop", characterId: id })).toBe(true);
    // Case is all it forgives: another id, or no id, is still another request.
    expect(isSameRequest(stored, { prompt: "Eva on a rooftop", characterId: id.replace("3f2a", "3F2B").toUpperCase() })).toBe(false);
    expect(isSameRequest(stored, { prompt: "Eva on a rooftop", characterId: null })).toBe(false);
  });
});

describe("apiRepeatAnswer", () => {
  const origin = "https://picacho.ai";
  const take = {
    id: "g1",
    angle: null,
    succeeded: true,
    attempts: [],
    finalPrompt: "the prompt that ran",
    resultUrl: "/api/media/generated-images/u1/a.png?v=sig",
    matchScore: 88,
    pending: false,
  };

  it("not a repeat → null, and the caller goes on to render", () => {
    expect(apiRepeatAnswer({ kind: "none" }, null, origin)).toBeNull();
  });

  it("answers with the first delivery's take, its URL absolute", () => {
    expect(apiRepeatAnswer({ kind: "settled", takes: [take] }, 1, origin)).toEqual({
      error: null,
      id: "g1",
      status: "succeeded",
      prompt: "the prompt that ran",
      imageUrl: "https://picacho.ai/api/media/generated-images/u1/a.png?v=sig",
      matchScore: 88,
      creditsUsed: 1,
    });
  });

  it("a failed take that was refunded says so: 0 credits, no image", () => {
    const failed = { ...take, succeeded: false, resultUrl: null, matchScore: null };
    expect(apiRepeatAnswer({ kind: "settled", takes: [failed] }, 0, origin)).toMatchObject({
      status: "failed",
      imageUrl: null,
      creditsUsed: 0,
    });
  });

  it("MONEY: still rendering is 'generating' with its id — never a failure that invites a second charge", () => {
    const running: FollowOutcome = { kind: "running", ids: ["g1"] };
    expect(apiRepeatAnswer(running, 1, origin)).toEqual({
      error: null,
      id: "g1",
      status: "generating",
      prompt: "",
      imageUrl: null,
      matchScore: null,
      creditsUsed: 1,
    });
  });
});
