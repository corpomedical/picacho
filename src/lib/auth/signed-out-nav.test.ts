import { describe, expect, it } from "vitest";
import { isSignedOutAppNavigation } from "./signed-out-nav";

// The boundaries of the edge-level signed-out bounce, written down. The
// dangerous direction is FALSE POSITIVES — bouncing someone who has a
// session, or rewriting a server action — so most of these assert that the
// predicate stays out of the way.

const SB = ["sb-kmarkbifjwjhkkifvedb-auth-token"];

describe("fires", () => {
  it("on a signed-out GET of the app root", () => {
    expect(isSignedOutAppNavigation("GET", "/app", [])).toBe(true);
  });

  it("on a signed-out GET of a nested app route", () => {
    expect(isSignedOutAppNavigation("GET", "/app/generate", [])).toBe(true);
  });

  it("when only unrelated cookies are present", () => {
    expect(
      isSignedOutAppNavigation("GET", "/app", ["picacho_locale", "picacho_native"]),
    ).toBe(true);
  });
});

describe("stays out of the way", () => {
  it("when ANY Supabase cookie is present — valid, stale or malformed alike", () => {
    expect(isSignedOutAppNavigation("GET", "/app", SB)).toBe(false);
    // A chunked cookie (@supabase/ssr splits large sessions) still counts.
    expect(isSignedOutAppNavigation("GET", "/app", ["sb-x-auth-token.0"])).toBe(false);
    // Even a junk sb-* cookie falls through to the real auth path rather
    // than being judged here.
    expect(isSignedOutAppNavigation("GET", "/app", ["sb-dummy"])).toBe(false);
  });

  it("on non-GET methods, so a server action POST is never rewritten", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD"]) {
      expect(isSignedOutAppNavigation(method, "/app", [])).toBe(false);
    }
  });

  it("outside /app", () => {
    for (const path of ["/", "/pricing", "/login", "/guides/seedance-2", "/api/v1/usage"]) {
      expect(isSignedOutAppNavigation("GET", path, [])).toBe(false);
    }
  });

  it("on a path that merely starts with the letters 'app'", () => {
    // /apple-touch-icon.png must not be mistaken for an /app route.
    expect(isSignedOutAppNavigation("GET", "/apple-touch-icon.png", [])).toBe(false);
    expect(isSignedOutAppNavigation("GET", "/appointments", [])).toBe(false);
  });
});
