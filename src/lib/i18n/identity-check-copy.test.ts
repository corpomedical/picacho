import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { LOCALIZED_PATHS } from "./routing";
import { LOCALES } from "./locales";
import en from "./messages/en";
import es from "./messages/es";
import pt from "./messages/pt";
import itMessages from "./messages/it";

// The free checker is the one page a stranger can use with no account, and
// since 2026-09-23 it is translated and carries a locale prefix. Three things
// can silently un-translate it, and each one has a test here:
//
// 1. The route answers an error with a `code`; the page turns that code into a
//    sentence from the catalog. A new code on the server with no entry in the
//    page's map shows the English fallback to a Spanish reader.
// 2. A locale left on the English string is worse than no translation: it is
//    the thin duplicate that LOCALIZED_PATHS exists to avoid.
// 3. Dropping the path out of LOCALIZED_PATHS would leave /es/tools/... 404ing
//    while the sitemap still advertises it.

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("the free checker's copy", () => {
  it("gives the page a catalog sentence for every error code the route can answer", () => {
    const route = read("../../app/api/tools/identity-check/route.ts");
    const tool = read("../../components/marketing/identity-check-tool.tsx");

    const codes = [...route.matchAll(/code: "([a-z-]+)"/g)].map((m) => m[1]).sort();
    expect(codes.length).toBeGreaterThan(3);

    // The map in the component: keys are quoted or bare (busy, unreadable).
    const mapBody = tool.match(/const byCode: Record<string, string> = \{([\s\S]*?)\};/)?.[1] ?? "";
    const mapped = [...mapBody.matchAll(/^\s*"?([a-z-]+)"?:/gm)].map((m) => m[1]).sort();

    expect(mapped, "every code the route answers needs a line in the page's byCode map").toEqual(codes);
  });

  it("translates every string, in every language", () => {
    const catalogs = { es, pt, it: itMessages } as const;
    const keys = Object.keys(en.identityCheckPage) as (keyof typeof en.identityCheckPage)[];
    expect(keys.length).toBeGreaterThan(30);

    for (const [code, catalog] of Object.entries(catalogs)) {
      for (const key of keys) {
        const english = en.identityCheckPage[key];
        const translated = catalog.identityCheckPage[key];
        expect(translated, `${code}.identityCheckPage.${key} is empty`).toBeTruthy();
        expect(
          translated === english,
          `${code}.identityCheckPage.${key} is still the English sentence`,
        ).toBe(false);
      }
    }
  });

  it("keeps the page on a locale-prefixed URL", () => {
    expect(LOCALIZED_PATHS).toContain("/tools/identity-check");
    // The scorer is asked for its sentence by the locale's own label, so a
    // label rename must not silently stop reaching it.
    for (const l of LOCALES) expect(l.label.length).toBeGreaterThan(1);
  });
});
