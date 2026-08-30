import { describe, expect, it } from "vitest";
import { localizedHref, matchLocalePrefix, PREFIXED_LOCALES } from "./routing";

// Locale-prefixed marketing URLs (2026-08-30). Every case here is a URL that
// must keep working exactly as it does today, or a shadow URL that must never
// come into existence.

describe("matchLocalePrefix", () => {
  it("matches the translated pages under each non-English locale", () => {
    expect(matchLocalePrefix("/es/pricing")).toEqual({ locale: "es", basePath: "/pricing" });
    expect(matchLocalePrefix("/pt/gallery")).toEqual({ locale: "pt", basePath: "/gallery" });
    expect(matchLocalePrefix("/it/compare/heygen")).toEqual({
      locale: "it",
      basePath: "/compare/heygen",
    });
  });

  it("treats /es and /es/ as the Spanish homepage", () => {
    expect(matchLocalePrefix("/es")).toEqual({ locale: "es", basePath: "/" });
    expect(matchLocalePrefix("/es/")).toEqual({ locale: "es", basePath: "/" });
  });

  it("REGRESSION: never matches /app — the suspension check depends on that path", () => {
    // supabase/middleware.ts and signed-out-nav.ts both test startsWith("/app").
    // A locale segment in front would silently defeat the account-suspension
    // check, which is this product's actual revocation mechanism.
    expect(matchLocalePrefix("/es/app")).toBeNull();
    expect(matchLocalePrefix("/es/app/generate")).toBeNull();
  });

  it("REGRESSION: never matches auth routes, which are robots-disallowed", () => {
    for (const p of ["/es/login", "/es/signup", "/es/auth/callback", "/es/reset-password"]) {
      expect(matchLocalePrefix(p)).toBeNull();
    }
  });

  it("REGRESSION: never matches /api", () => {
    expect(matchLocalePrefix("/es/api/v1/generations")).toBeNull();
  });

  it("REGRESSION: never matches guides, whose bodies are English-only", () => {
    // Prefixing these would publish English prose under Spanish URLs — thin
    // duplicates, which rank worse than not ranking.
    expect(matchLocalePrefix("/es/guides")).toBeNull();
    expect(matchLocalePrefix("/es/guides/seedance-2")).toBeNull();
  });

  it("REGRESSION: /en is never a URL — English lives on the bare path", () => {
    // /en/pricing existing would split the indexed English page in two.
    expect(matchLocalePrefix("/en")).toBeNull();
    expect(matchLocalePrefix("/en/pricing")).toBeNull();
    expect(PREFIXED_LOCALES).not.toContain("en");
  });

  it("leaves every bare English URL alone", () => {
    for (const p of ["/", "/pricing", "/gallery", "/compare/heygen", "/guides", "/app", "/login"]) {
      expect(matchLocalePrefix(p)).toBeNull();
    }
  });

  it("ignores a two-letter segment that is not one of our locales", () => {
    expect(matchLocalePrefix("/fr/pricing")).toBeNull();
    expect(matchLocalePrefix("/de")).toBeNull();
  });
});

describe("localizedHref", () => {
  it("prefixes non-English and leaves English bare", () => {
    expect(localizedHref("/pricing", "en")).toBe("/pricing");
    expect(localizedHref("/pricing", "es")).toBe("/es/pricing");
    expect(localizedHref("/", "en")).toBe("/");
    expect(localizedHref("/", "it")).toBe("/it");
  });

  it("round-trips with matchLocalePrefix for every localized path and locale", () => {
    for (const locale of PREFIXED_LOCALES) {
      for (const base of ["/", "/pricing", "/compare/hedra"]) {
        const href = localizedHref(base, locale as "es" | "pt" | "it");
        expect(matchLocalePrefix(href)).toEqual({ locale, basePath: base });
      }
    }
  });

  it("returns unlocalized paths untouched, so callers can pass anything", () => {
    expect(localizedHref("/guides", "es")).toBe("/guides");
    expect(localizedHref("/app", "es")).toBe("/app");
  });
});
