import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { PAGE_UPDATED, UNDATED_PAGES, pageUpdated, type DatedPage } from "./page-dates";
import privacy from "./i18n/legal/privacy";
import terms from "./i18n/legal/terms";
import contentPolicy from "./i18n/legal/content-policy";

// Holds the page dates (page-dates.ts) to the three things that make a
// lastmod worth reading: every listed page has one, each is a real day, and
// wherever the same date is shown elsewhere — a legal page's "last updated",
// a guide's structured data — it is the same date.

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

// "September 1, 2026" -> "2026-09-01", without Date's time-zone guesswork.
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function isoFromProse(prose: string): string {
  const m = prose.match(/^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/);
  const month = m ? MONTHS.indexOf(m[1]) + 1 : 0;
  if (!m || month === 0) throw new Error(`unrecognised "last updated" date: ${prose}`);
  return `${m[3]}-${String(month).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

describe("page dates", () => {
  it("every page in the sitemap has a date, or is undated on purpose", () => {
    // Read as text: sitemap.ts imports through "@/", which vitest can't resolve.
    const block = src("../app/sitemap.ts").match(/const PUBLIC_ROUTES = \[([\s\S]*?)\];/)?.[1] ?? "";
    const routes = [...block.matchAll(/"(\/[^"]*|)"/g)].map((m) => m[1] || "/");
    expect(routes.length, "PUBLIC_ROUTES could not be read from sitemap.ts").toBeGreaterThan(10);
    const undated: readonly string[] = UNDATED_PAGES;
    for (const route of routes) {
      if (undated.includes(route)) continue;
      expect(pageUpdated(route), `${route} is in the sitemap with no date in page-dates.ts`).toBeDefined();
    }
    for (const page of Object.keys(PAGE_UPDATED)) {
      expect(routes, `${page} has a date but is not in the sitemap`).toContain(page);
    }
  });

  it("every date is a real day, and none is in the future", () => {
    // One day's grace: dates are written in the operator's time zone (+3),
    // which runs ahead of UTC for three hours after midnight.
    const latest = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    for (const [page, date] of Object.entries(PAGE_UPDATED)) {
      expect(date, page).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10), `${page}: ${date} is not a calendar day`).toBe(
        date,
      );
      expect(date <= latest, `${page}: ${date} is in the future`).toBe(true);
    }
  });

  it("a legal page's date is the one it shows its readers", () => {
    const docs: Array<[DatedPage, { en: { updated: string } }]> = [
      ["/privacy", privacy],
      ["/terms", terms],
      ["/content-policy", contentPolicy],
    ];
    for (const [page, doc] of docs) {
      expect(PAGE_UPDATED[page], `${page}: page-dates.ts must match the page's own "last updated"`).toBe(
        isoFromProse(doc.en.updated),
      );
    }
  });

  it("structured data takes its dateModified from here, never a literal", () => {
    // A hard-coded dateModified is how the consistency guide came to say
    // 21 August for a guide rewritten on 3 September.
    const withDates: string[] = [];
    const walk = (dir: URL) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(new URL(`${entry.name}/`, dir));
        else if (entry.name.endsWith(".tsx")) {
          const file = new URL(entry.name, dir);
          const text = readFileSync(file, "utf8");
          if (!text.includes("dateModified")) continue;
          withDates.push(file.pathname);
          expect(text, `${file.pathname} hard-codes dateModified`).not.toMatch(/dateModified:\s*["'`]/);
          const route = text.match(/dateModified: PAGE_UPDATED\["([^"]+)"\]/)?.[1];
          const published = text.match(/datePublished: "(\d{4}-\d{2}-\d{2})"/)?.[1];
          expect(route && published, `${file.pathname}: dateModified must read PAGE_UPDATED`).toBeTruthy();
          expect(pageUpdated(route!)! >= published!, `${route} was modified before it was published`).toBe(true);
        }
      }
    };
    walk(new URL("../app/", import.meta.url));
    expect(withDates.length, "no page carries structured-data dates any more — is the walk still pointed at app/?").toBeGreaterThan(0);
  });

  it("the sitemap never stamps the time of the request", () => {
    expect(src("../app/sitemap.ts")).not.toMatch(/lastModified:\s*new Date\(/);
  });
});
