import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import itMsgs from "../i18n/messages/it";

// Helios's public surface (launch prep cut 2, 2026-09-19): the guide, the
// guides-index card, the sitemap line and the home section all exist today
// and all key off SETS_OPEN_TO_PLANS — the flip commit turns one constant
// and the whole surface appears; until then nothing public says Helios.

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");

describe("the surface rides the launch switch", () => {
  it("the guide page is 404 while Helios is closed", () => {
    const page = read("../../app/guides/helios/page.tsx");
    expect(page).toContain("if (!SETS_OPEN_TO_PLANS) notFound();");
    // The plans section reads the enforced table, never copied numbers.
    expect(page).toContain("SET_BUILDS_MONTHLY_LIMITS[plan]");
  });

  it("the guides index, the sitemap and the home section are behind the same switch", () => {
    const index = read("../../app/guides/page.tsx");
    expect(index).toContain('...(SETS_OPEN_TO_PLANS');
    expect(index).toContain('"/guides/helios"');
    const sitemap = read("../../app/sitemap.ts");
    expect(sitemap).toContain('...(SETS_OPEN_TO_PLANS ? ["/guides/helios"] : [])');
    const home = read("../../app/page.tsx");
    expect(home).toContain("{SETS_OPEN_TO_PLANS && (");
    expect(home).toContain('href="/guides/helios"');
    expect(read("../page-dates.ts")).toContain('"/guides/helios": "2026-09-19"');
  });

  it("the screenshots the guide and the home section embed are in the repo", () => {
    for (const f of ["workspace.jpg", "film.jpg"]) {
      expect(existsSync(join(__dirname, "../../../public/guides/helios", f)), f).toBe(true);
    }
  });

  it("the home section's words exist in every locale", () => {
    for (const m of [en, es, pt, itMsgs]) {
      const h = m.marketing.home;
      for (const key of ["heliosEyebrow", "heliosTitle", "heliosCopy", "heliosB1", "heliosB2", "heliosB3", "heliosCta"] as const) {
        expect(h[key], key).toBeTruthy();
      }
      expect(h.heliosCta).toContain("Helios");
    }
  });
});
