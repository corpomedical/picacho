import { readdirSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { SITE_PAGES, findPage, pageRefusal, renderSiteMap, resolvePage, type PageAccess } from "./site-map";

// Aly knows every page (site-map.ts). A page added to src/app without a line
// in SITE_PAGES fails here, and so does a line whose page is gone.

const APP_DIR = join(__dirname, "..", "..", "app");

// Pages that are steps of a flow, not places: signing in and out, the 2FA
// step, the OAuth consent screen, and the SEO comparison pages.
const NOT_PLACES = new Set([
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-2fa",
  "/admin-verify",
  "/oauth/authorize",
]);

function pages(dir: string, route: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if ((dir === APP_DIR && name === "api") || name.startsWith("_")) continue;
      // Route groups "(x)" add nothing to the path.
      const seg = /^\(.*\)$/.test(name) ? "" : `/${name.replace(/^\[[^\]]+\]$/, "[id]")}`;
      pages(full, route + seg, out);
    } else if (name === "page.tsx") {
      out.push(route || "/");
    }
  }
  return out;
}

describe("the site map", () => {
  const onDisk = pages(APP_DIR, "", []).filter((p) => !NOT_PLACES.has(p) && !p.startsWith("/compare/"));

  it("names every page in the app", () => {
    const named = new Set(SITE_PAGES.map((p) => p.path));
    expect(onDisk.filter((p) => !named.has(p))).toEqual([]);
  });

  it("names no page that doesn't exist", () => {
    const real = new Set(onDisk);
    expect(SITE_PAGES.map((p) => p.path).filter((p) => !real.has(p))).toEqual([]);
  });

  it("is deterministic and lists every openable page", () => {
    const text = renderSiteMap();
    expect(renderSiteMap()).toBe(text);
    for (const p of SITE_PAGES) expect(text).toContain(`- ${p.path} — `);
    expect(text).toContain("/app/settings?tab=billing — Plan & billing");
  });
});

describe("resolvePage", () => {
  const ok = (raw: string) => {
    const r = resolvePage(raw);
    if ("error" in r) throw new Error(r.error);
    return r;
  };

  it("keeps a page's own parameter when the value is listed", () => {
    expect(ok("/app/settings?tab=billing").href).toBe("/app/settings?tab=billing");
    expect(ok("/app/settings?tab=billing").label).toBe("Settings → Plan & billing");
    expect(ok("/app/effects?tab=photo").href).toBe("/app/effects?tab=photo");
  });

  it("drops unknown parameters and values", () => {
    expect(ok("/app/settings?tab=hax").href).toBe("/app/settings");
    expect(ok("/app/generate?prompt=x&type=video").href).toBe("/app/generate");
    expect(ok("/app/settings/?tab=preferences#notifications").href).toBe("/app/settings?tab=preferences#notifications");
    expect(ok("/app/settings#<script>").href).toBe("/app/settings");
  });

  it("accepts ids only as uuids, and exact pages before id pages", () => {
    const id = "0f5b8f0e-1234-4abc-9def-0123456789ab";
    expect(ok(`/app/history/${id}`).page.path).toBe("/app/history/[id]");
    expect(findPage("/app/chat/memory")?.name).toBe("Aly's memory");
    expect(resolvePage("/app/history/not-an-id")).toHaveProperty("error");
  });

  it("never leaves Picacho", () => {
    expect(ok("https://picacho.ai/pricing").href).toBe("/pricing");
    for (const bad of ["https://evil.example/app", "//evil.example/app", "javascript:alert(1)", "app/settings", "", null, 42]) {
      expect(resolvePage(bad)).toHaveProperty("error");
    }
  });

  it("refuses the pages that are steps, not places", () => {
    expect(resolvePage("/app/checkout?plan=elite")).toHaveProperty("error");
  });
});

describe("pageRefusal", () => {
  const base: PageAccess = {
    isAdmin: false,
    inLight: false,
    chatOpen: true,
    gates: {
      setsVisible: false,
      recceVisible: false,
      mystiqueVisible: false,
      liveVisible: false,
      cutVisible: false,
      effectsVisible: false,
      pressTourVisible: false,
    },
  };
  const page = (p: string) => findPage(p)!;

  it("keeps admin pages and closed tools closed", () => {
    expect(pageRefusal(page("/admin/users"), base)).toMatch(/team only/);
    expect(pageRefusal(page("/admin/users"), { ...base, isAdmin: true })).toBeNull();
    expect(pageRefusal(page("/app/sets"), base)).toMatch(/paid plans/);
    expect(pageRefusal(page("/app/sets"), { ...base, gates: { ...base.gates, setsVisible: true } })).toBeNull();
    expect(pageRefusal(page("/app/chat"), { ...base, chatOpen: false })).toMatch(/isn't open/);
  });

  it("keeps a Light account in Light", () => {
    const light = { ...base, inLight: true };
    expect(pageRefusal(page("/app/generate"), light)).toMatch(/Picacho Light/);
    expect(pageRefusal(page("/app/settings"), light)).toBeNull();
    expect(pageRefusal(page("/pricing"), light)).toBeNull();
  });
});
