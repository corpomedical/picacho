import { describe, expect, it } from "vitest";
import raceTrack from "./fixtures-race-track.json";
import { followAstraEdit, type AstraEditRead, type AstraPressKind } from "./astra-follow";
import { countSpecChanges } from "./editor-model";
import { SET_EDIT_NOT_SAVED, SET_EDIT_UNCHECKED, SET_NOT_FOUND } from "./messages";
import { SET_EDIT_FOLLOW_CAP_MS, SET_EDIT_FOLLOW_POLL_MS } from "./set-config";
import { normaliseSetSpec, type SetSpec } from "./set-spec";

// What an Astra press saved, read back by the page (2026-09-25, Cut 1 —
// operator: "GO ahead"). A call that threw said "Couldn't reach the server
// — try again" while the server usually finished and saved; the person
// asked again and paid for a second change. Now the page follows the
// press until it has ended, and says "try again" only when nothing ever
// reached the server.

const n = normaliseSetSpec(raceTrack);
if (!n.ok) throw new Error("fixture");
const BEFORE: SetSpec = n.spec;
const AFTER: SetSpec = { ...BEFORE, objects: BEFORE.objects.map((o, i) => (i === 0 ? { ...o, color: "#aa3322" } : o)) };

type Step = AstraEditRead | { thrown: unknown };
const at = (press: AstraPressKind, spec: SetSpec = BEFORE, editsLeft?: number | null): Step =>
  editsLeft === undefined ? { error: null, press, spec } : { error: null, press, spec, editsLeft };

/** A scripted read, a clock that moves only when the follow sleeps, and the sleeps it asked for. */
function rig(script: Step[]) {
  let clock = 0;
  const sleeps: number[] = [];
  let reads = 0;
  return {
    read: async () => {
      const step = script[Math.min(reads, script.length - 1)];
      reads++;
      return step;
    },
    now: () => clock,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      clock += ms;
    },
    sleeps,
    reads: () => reads,
  };
}

const follow = (r: ReturnType<typeof rig>, extra: { stop?: (err: unknown) => boolean } = {}) =>
  followAstraEdit(r.read, { before: BEFORE, now: r.now, sleep: r.sleep, ...extra });

describe("followAstraEdit", () => {
  it("waits while the press runs, then shows what it saved, with the count the server gave", async () => {
    const r = rig([at("running"), at("running"), at("saved", AFTER, 4)]);
    expect(await follow(r)).toEqual({ kind: "saved", spec: AFTER, changed: countSpecChanges(BEFORE, AFTER), editsLeft: 4 });
    expect(countSpecChanges(BEFORE, AFTER)).toBeGreaterThan(0);
    expect(r.sleeps).toEqual([SET_EDIT_FOLLOW_POLL_MS, SET_EDIT_FOLLOW_POLL_MS]);
    expect(SET_EDIT_FOLLOW_POLL_MS).toBe(4_000);
  });

  it("says a press that did not save left the set as it was", async () => {
    expect(await follow(rig([at("unsaved", BEFORE, 2)]))).toEqual({ kind: "unsaved", error: SET_EDIT_NOT_SAVED, editsLeft: 2 });
    expect(SET_EDIT_NOT_SAVED).not.toMatch(/couldn't reach/i);
  });

  it("gives a delivery that hasn't claimed yet one more look, and says nothing reached the server only after two", async () => {
    expect((await follow(rig([at("none"), at("saved", AFTER)]))).kind).toBe("saved");
    const r = rig([at("none"), at("none"), at("saved", AFTER)]);
    expect(await follow(r)).toEqual({ kind: "none" });
    expect(r.reads()).toBe(2);
    expect(r.sleeps).toEqual([SET_EDIT_FOLLOW_POLL_MS]);
  });

  it("judges a press the platform stopped by the saved copy", async () => {
    expect(await follow(rig([at("lost", AFTER, 1)]))).toEqual({ kind: "saved", spec: AFTER, changed: countSpecChanges(BEFORE, AFTER), editsLeft: 1 });
    expect(await follow(rig([at("lost", BEFORE, 1)]))).toEqual({ kind: "unsaved", error: SET_EDIT_NOT_SAVED, editsLeft: 1 });
  });

  it("reads again after a read that threw, and lets go when a deploy has left the tab behind", async () => {
    const offline = rig([{ thrown: new TypeError("Failed to fetch") }, at("saved", AFTER)]);
    expect((await follow(offline, { stop: () => false })).kind).toBe("saved");
    expect(offline.sleeps).toEqual([SET_EDIT_FOLLOW_POLL_MS]);

    const stale = rig([{ thrown: new Error("Server Action not found") }, at("saved", AFTER)]);
    const seen: unknown[] = [];
    expect(await follow(stale, { stop: (err) => (seen.push(err), true) })).toEqual({ kind: "left" });
    expect(stale.reads()).toBe(1);
    expect(seen).toHaveLength(1);
  });

  it("says the read's own error: a session that expired, a set that is gone", async () => {
    expect(await follow(rig([{ error: SET_NOT_FOUND }]))).toEqual({ kind: "error", error: SET_NOT_FOUND });
  });

  it("stops at the cap and says to reload, never try again", async () => {
    for (const kind of ["running", "unread"] as const) {
      const r = rig([at(kind)]);
      expect(await follow(r)).toEqual({ kind: "error", error: SET_EDIT_UNCHECKED });
      // It follows for the whole cap, every 4 s, and no longer.
      expect(r.sleeps.length).toBe(Math.ceil(SET_EDIT_FOLLOW_CAP_MS / SET_EDIT_FOLLOW_POLL_MS));
    }
    const thrown = rig([{ thrown: new TypeError("Failed to fetch") }]);
    expect(await follow(thrown, { stop: () => false })).toEqual({ kind: "error", error: SET_EDIT_UNCHECKED });
    expect(SET_EDIT_UNCHECKED).not.toMatch(/try again/i);
  });
});
