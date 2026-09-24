import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { LOCALIZED_PATHS } from "./routing";
import en from "./messages/en";
import es from "./messages/es";
import pt from "./messages/pt";
import itMessages from "./messages/it";

// Search-result titles and descriptions (2026-09-24). Until that day 33 of
// the 39 translated URLs served an English <title> and meta description over
// a translated body, and Search Console had left nearly all of them
// unindexed. Two ways it can come back:
//
// 1. A locale's seo entry copied from English — the same title on /pt and
//    on the English page is what reads as a duplicate.
// 2. A translated page (LOCALIZED_PATHS) going back to an English literal in
//    its page.tsx instead of reading the catalog.

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

function leaves(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    leaves(v, path ? `${path}.${k}` : k),
  );
}

describe("search-result copy", () => {
  const english = new Map(leaves(en.seo));

  for (const [name, messages] of [
    ["es", es],
    ["pt", pt],
    ["it", itMessages],
  ] as const) {
    it(`${name}: every title and description is translated, none left in English`, () => {
      const translated = leaves(messages.seo);
      expect(translated.map(([k]) => k).sort()).toEqual([...english.keys()].sort());
      for (const [key, text] of translated) {
        expect(text.trim().length, key).toBeGreaterThan(0);
        expect(text, key).not.toBe(english.get(key));
      }
    });
  }

  it("every translated page takes its title from the catalogs, not an English literal", () => {
    for (const path of LOCALIZED_PATHS) {
      const file = path === "/" ? "../../app/page.tsx" : `../../app${path}/page.tsx`;
      const src = read(file);
      expect(src, path).not.toMatch(/const TITLE = "/);
      expect(src, path).toMatch(/t\.seo\.|metaTitle|Doc\[locale\]\.title/);
    }
  });
});
