import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildingHintKey, pageSetNotice, photoMetaKey, setNoticePath, setNoticeTag } from "./leaving";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import it_ from "../i18n/messages/it";

// What the Sets pages promise about leaving a build, and how the promise is
// kept (2026-09-11): the line each page shows with the finisher running or
// not, and the notification a Sets tab in the background shows for a build
// it collected itself.

const LANGS = [
  ["en", en],
  ["es", es],
  ["pt", pt],
  ["it", it_],
] as const;
const ROOT = join(__dirname, "..", "..", "..");
const readSource = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("the line under a build still running", () => {
  it("says you can leave only while the finisher can run, for both kinds of build", () => {
    expect(buildingHintKey(false, true)).toBe("statusBuildingHintFinishes");
    expect(buildingHintKey(true, true)).toBe("statusBuildingPhotoHintFinishes");
    expect(buildingHintKey(false, false)).toBe("statusBuildingHint");
    expect(buildingHintKey(true, false)).toBe("statusBuildingPhotoHint");
    expect(photoMetaKey(true)).toBe("photoMetaFinishes");
    expect(photoMetaKey(false)).toBe("photoMeta");
  });

  it("which reads, in English, as the promise each case can keep", () => {
    for (const fromPhoto of [false, true]) {
      expect(en.sets[buildingHintKey(fromPhoto, true)]).toContain("You can leave — it finishes on its own");
    }
    expect(en.sets[buildingHintKey(false, false)]).toContain("come back within ten minutes");
    expect(en.sets[buildingHintKey(true, false)]).toContain("Keep this page open");
    expect(en.sets[photoMetaKey(true)]).toContain("you can leave");
    expect(en.sets[photoMetaKey(false)]).toContain("keep this page open");
  });

  it("is the one both pages show, chosen here rather than by a copy of the choice", () => {
    const home = readSource("src/components/sets/sets-home.tsx");
    const page = readSource("src/app/app/sets/[id]/page.tsx");
    expect(home).toContain("{s[buildingHintKey(x.fromPhoto, finisherOn)]}");
    expect(home).toContain("{s[photoMetaKey(finisherOn)]}");
    expect(page).toContain("{s[buildingHintKey(data.set.fromPhoto, finisherOn)]}");
    for (const source of [home, page]) {
      expect(source).not.toMatch(/s\.(statusBuildingHint|statusBuildingPhotoHint|photoMeta)\w*/);
    }
  });
});

describe("the notification a Sets tab shows for a build it settled itself", () => {
  const SET = "00000000-0000-4000-8000-000000000001";

  it("says what the finisher's push says, opens the same page and carries the same tag, in every language", () => {
    for (const [loc, t] of LANGS) {
      expect(pageSetNotice(SET, "ready", t.push), loc).toEqual({
        title: t.push.setReadyTitle,
        body: t.push.setReadyBodyUntitled,
        path: `/app/sets/${SET}`,
        tag: `set-${SET}`,
      });
      expect(pageSetNotice(SET, "failed", t.push), loc).toEqual({
        title: t.push.setFailedTitle,
        body: t.push.setFailedBody,
        path: "/app/sets",
        tag: `set-${SET}`,
      });
    }
    // The finisher builds its push from the same two helpers (finisher.test.ts).
    expect(setNoticePath(SET, "ready")).toBe(`/app/sets/${SET}`);
    expect(setNoticeTag(SET)).toBe(`set-${SET}`);
  });

  describe("sets-home.tsx (read as source: a client component)", () => {
    const home = readSource("src/components/sets/sets-home.tsx");
    const poll = home.slice(home.indexOf("const tick = async () => {"), home.indexOf("timerRef.current = setTimeout(tick, 1500);"));
    const announce = home.slice(home.indexOf("function announceIfHidden("), home.indexOf("export function SetsHome("));

    it("announces a build its poll saw leave \"building\", under the person's own switches", () => {
      const building = poll.indexOf('if (res.state === "building") continue;');
      const gate = poll.indexOf('if (res.state === "ready" ? notifyReady : notifyFailed) {');
      const call = poll.indexOf("announceIfHidden(");
      for (const [name, at] of Object.entries({ building, gate, call })) expect(at, name).toBeGreaterThan(-1);
      expect(gate).toBeGreaterThan(building);
      expect(call).toBeGreaterThan(gate);
      expect(poll).toContain("pageSetNotice(id, res.state, { setReadyTitle, setReadyBodyUntitled, setFailedTitle, setFailedBody })");
    });

    it("only from a hidden tab, only with permission already given, never asking for it", () => {
      const hidden = announce.indexOf('if (document.visibilityState !== "hidden") return;');
      const granted = announce.indexOf('if (Notification.permission !== "granted") return;');
      const shows = announce.indexOf("showNotification(");
      for (const [name, at] of Object.entries({ hidden, granted, shows })) expect(at, name).toBeGreaterThan(-1);
      expect(shows).toBeGreaterThan(hidden);
      expect(shows).toBeGreaterThan(granted);
      expect(home).not.toContain("requestPermission");
    });

    it("tagged with the set, opening the push's page, and never over a finisher push already on screen", () => {
      expect(announce).toContain("getNotifications({ tag: notice.tag })");
      expect(announce).toContain("if (shown.length > 0) return;");
      expect(announce.indexOf("if (shown.length > 0) return;")).toBeLessThan(announce.indexOf("showNotification("));
      expect(announce).toContain("tag: notice.tag,");
      expect(announce).toContain("data: { path: notice.path },");
    });

    it("a build the finisher settled is the finisher's to announce, unless its push cannot reach this browser", () => {
      // The poll passes whether its own write settled the build (pollSetBuild's settledHere).
      expect(poll).toContain("res.settledHere === true,");
      // Not settled here: the finisher pushed to this browser's subscription, if it has one.
      const guard = announce.indexOf("if (!settledHere) {");
      const subscribed = announce.indexOf("registration.pushManager?.getSubscription()");
      const leaves = announce.indexOf("if (subscribed) return;");
      for (const [name, at] of Object.entries({ guard, subscribed, leaves })) expect(at, name).toBeGreaterThan(-1);
      expect(subscribed).toBeGreaterThan(guard);
      expect(leaves).toBeGreaterThan(subscribed);
      expect(leaves).toBeLessThan(announce.indexOf("showNotification("));
    });

    it("gets the switches from the server, as the composer does", () => {
      const page = readSource("src/app/app/sets/page.tsx");
      expect(page).toContain("readRenderNotifyPrefs(supabase, userData.user.id)");
      expect(page).toContain("notifyReady={notify.ready}");
      expect(page).toContain("notifyFailed={notify.failed}");
    });
  });

  it("and a finisher push carries the tag to the browser, which shows it with it", () => {
    const send = readSource("src/lib/push/send.ts");
    const web = send.slice(send.indexOf("async function notifyWebDevices("), send.indexOf("export async function notifyUser("));
    expect(web).toContain("...(notification.tag ? { tag: notification.tag } : {}),");
    const worker = readSource("public/push-sw.js");
    const push = worker.slice(worker.indexOf('self.addEventListener("push"'), worker.indexOf('self.addEventListener("notificationclick"'));
    expect(push).toContain("...(data.tag ? { tag: data.tag } : {}),");
    expect(push).toContain("data: { path: data.path || null },");
  });

  it("the worker that carries the tag takes over at once, not after every tab has closed", () => {
    const worker = readSource("public/push-sw.js");
    expect(worker).toContain('self.addEventListener("install", () => self.skipWaiting());');
    expect(worker).toContain('self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));');
    // Taking over at once is safe only while the worker serves no requests.
    expect(worker).not.toContain('addEventListener("fetch"');
  });

  it("a set's tap never takes an unrelated tab: the set's own tab, else a Sets tab, else a new window", () => {
    const worker = readSource("public/push-sw.js");
    const click = worker.slice(worker.indexOf('self.addEventListener("notificationclick"'));
    const sets = click.slice(click.indexOf('tag.startsWith("set-")'), click.indexOf("const win = wins.find"));
    expect(sets).toContain("pathOf(w) === path");
    expect(sets).toContain('pathOf(w).startsWith("/app/sets")');
    expect(sets).toContain("return clients.openWindow(path);");
    expect(setNoticeTag("x")).toBe("set-x");
  });
});
