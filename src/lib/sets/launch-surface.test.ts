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
    // Moved when the guide's words changed: photo builds and poses came out (Helios Cut 3, step 7).
    expect(read("../page-dates.ts")).toContain('"/guides/helios": "2026-09-26"');
  });

  it("the guide promises only what a customer can do (Helios Cut 3, step 7)", () => {
    const page = read("../../app/guides/helios/page.tsx");
    // A build from a photo is admins only (photoSetsOn), and poses are off (SET_POSE_WORDS_OPEN).
    expect(page).not.toMatch(/photo you upload|choose a pose/i);
    expect(page).toContain("a sitting room with a green sofa by the window");
    expect(page).toContain("Drag your character to a mark and say where they look.");
    expect(read("./set-shot-prompt.ts")).toContain("export const SET_POSE_WORDS_OPEN = false");
  });

  it("the Sets home links the guide, behind the same switch, in words every language has", () => {
    const home = read("../../components/sets/sets-home.tsx");
    const link = home.slice(home.indexOf("{SETS_OPEN_TO_PLANS && ("), home.indexOf("</Link>", home.indexOf("{SETS_OPEN_TO_PLANS && (")));
    expect(link).toContain('href="/guides/helios"');
    expect(link).toContain("{t.marketing.home.heliosCta}");
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
