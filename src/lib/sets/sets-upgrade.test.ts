import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import itMsgs from "../i18n/messages/it";
import { localizeServerText } from "../i18n/server-text";
import { settingsHref } from "../settings/tabs";
import { renderProductGuide } from "../agent/product-guide";
import { SETS_NOT_OPEN } from "./messages";

// A free account at /app/sets or /app/sets/<id> (Helios Cut 3, step 3): on
// the web it gets a page saying Helios 3D is part of the paid plans, with
// "See plans", instead of "not found". In the Android shell, and while
// Helios is closed to the plans, both pages stay 404; a set that isn't
// there stays 404. Read as source: the pages need a session.

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const home = read("../../app/app/sets/page.tsx");
const setPage = read("../../app/app/sets/[id]/page.tsx");
const upgrade = read("../../components/sets/sets-upgrade.tsx");

describe("a free account gets the upgrade page on the web, and 404 in the app", () => {
  it("the Sets home: 404 for the shell or before the launch switch, the upgrade page otherwise", () => {
    expect(home).toContain(
      "if (data.error === SETS_UNAVAILABLE || (data.error === SETS_NOT_OPEN && (native || !SETS_OPEN_TO_PLANS))) notFound();",
    );
    expect(home).toContain("if (data.error === SETS_NOT_OPEN) return <SetsUpgrade t={t} native={native} />;");
    // The shell is known before the 404 that depends on it, and the page is drawn only after it.
    const nativeAt = home.indexOf("const native = await isNativeApp();");
    const notFoundAt = home.indexOf("notFound();");
    expect(nativeAt).toBeGreaterThan(-1);
    expect(nativeAt).toBeLessThan(notFoundAt);
    expect(notFoundAt).toBeLessThan(home.indexOf("<SetsUpgrade"));
    expect(home.match(/const native = /g)).toHaveLength(1);
  });

  it("a set's own page: the same rule, and a set that isn't there is still not found", () => {
    const gate = setPage.slice(setPage.indexOf("  if (\n    data.error === SETS_UNAVAILABLE"), setPage.indexOf("    notFound();") + "    notFound();".length);
    expect(gate).toContain("data.error === SETS_UNAVAILABLE ||");
    expect(gate).toContain("data.error === SET_NOT_FOUND ||");
    expect(gate).toContain("(data.error === SETS_NOT_OPEN && (native || !SETS_OPEN_TO_PLANS))");
    expect(gate).toContain("notFound();");
    expect(setPage).toContain("if (data.error === SETS_NOT_OPEN) return <SetsUpgrade t={t} native={native} />;");
    const nativeAt = setPage.indexOf("const native = await isNativeApp();");
    expect(nativeAt).toBeGreaterThan(-1);
    expect(nativeAt).toBeLessThan(setPage.indexOf("notFound();"));
    expect(setPage.indexOf("notFound();")).toBeLessThan(setPage.indexOf("<SetsUpgrade"));
    expect(setPage.match(/const native = /g)).toHaveLength(1);
    // No other error reaches the upgrade page: SET_NOT_FOUND is decided before it.
    expect(setPage.match(/<SetsUpgrade /g)).toHaveLength(1);
    expect(home.match(/<SetsUpgrade /g)).toHaveLength(1);
  });

  it("says the server's own sentence and offers the plans only outside the shell", () => {
    expect(upgrade).toContain("{localizeServerText(SETS_NOT_OPEN, t)}");
    const cta = upgrade.slice(upgrade.indexOf("{!native && ("), upgrade.indexOf("{t.stage.upgradeCta}") + "{t.stage.upgradeCta}".length);
    expect(cta).toContain('href={settingsHref("billing")}');
    expect(cta).toContain("{t.stage.upgradeCta}");
    expect(upgrade.match(/<Link\b/g)).toHaveLength(1);
    expect(upgrade.match(/upgradeCta/g)).toHaveLength(1);
    for (const heading of ["{s.eyebrow}", "{s.title}", "{s.subtitle}"]) expect(upgrade, heading).toContain(heading);
  });

  it("links to Settings → Plan & billing, in words every language has", () => {
    expect(settingsHref("billing")).toBe("/app/settings?tab=billing");
    for (const m of [en, es, pt, itMsgs]) {
      expect(m.stage.upgradeCta).toBeTruthy();
      expect(m.sets.title).toBeTruthy();
      expect(m.sets.subtitle).toBeTruthy();
    }
    for (const m of [es, pt, itMsgs]) expect(localizeServerText(SETS_NOT_OPEN, m)).not.toBe(SETS_NOT_OPEN);
    expect(localizeServerText(SETS_NOT_OPEN, en)).toBe(en.serverText.setsNotOpen);
  });

  it("the Producer's guide says where a free account is sent", () => {
    const guide = renderProductGuide();
    expect(guide).toContain('Free accounts do not have Sets; on the web, /app/sets tells them Helios 3D is part of the paid plans and links to them ("See plans").');
  });
});
