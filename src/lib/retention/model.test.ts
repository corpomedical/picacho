import { describe, expect, it } from "vitest";
import { toolForPath, RETENTION_TOOLS } from "./tools";
import {
  computeRetention,
  weekStart,
  QUIET_AFTER_DAYS,
  type PersonIn,
  type RetentionInput,
} from "./model";
import { cancelPush, quietPush, stalledPush, morePush, MAX_PUSHES_PER_RUN } from "./alerts";

// "Now" is Saturday 3 October 2026, 12:00 UTC: this week began Monday 28 Sep.
const NOW = Date.parse("2026-10-03T12:00:00Z");
const DAY = 86_400_000;
const ago = (days: number, hour = 10) => new Date(NOW - days * DAY).toISOString().slice(0, 10) + `T${String(hour).padStart(2, "0")}:00:00Z`;

function person(id: string, joinedDaysAgo: number, extra: Partial<PersonIn> = {}): PersonIn {
  return {
    id,
    name: id,
    email: `${id}@example.com`,
    createdAt: ago(joinedDaysAgo),
    plan: "none",
    planStatus: null,
    lastSeenAt: null,
    role: "user",
    optedOut: false,
    ...extra,
  };
}

function input(over: Partial<RetentionInput>): RetentionInput {
  return {
    people: [],
    renders: [],
    made: [],
    opens: [],
    subEvents: [],
    paid: [],
    madeKnown: new Set(RETENTION_TOOLS.map((t) => t.key)),
    now: NOW,
    ...over,
  };
}

describe("toolForPath", () => {
  it("maps app pages to tools and nothing else", () => {
    expect(toolForPath("/app/generate")).toBe("generate");
    expect(toolForPath("/app/generate?model=x")).toBe("generate");
    expect(toolForPath("/app/mystique/abc")).toBe("recast");
    expect(toolForPath("/app/edit/123")).toBe("cut");
    expect(toolForPath("/app/character/new")).toBe("characters");
    expect(toolForPath("/app/press-tour")).toBe("pressTour");
    expect(toolForPath("/app")).toBeNull();
    expect(toolForPath("/app/history")).toBeNull();
    expect(toolForPath("/app/generated")).toBeNull();
    expect(toolForPath("/pricing")).toBeNull();
    expect(toolForPath(42)).toBeNull();
    expect(toolForPath("/app/generate" + "x".repeat(400))).toBeNull();
  });

  it("keeps every key within the database's tool check", () => {
    for (const t of RETENTION_TOOLS) expect(t.key).toMatch(/^[a-z][a-zA-Z0-9]{0,31}$/);
  });
});

describe("weekStart", () => {
  it("is the Monday of the week, UTC", () => {
    expect(weekStart("2026-10-03T23:59:00Z")).toBe("2026-09-28");
    expect(weekStart("2026-09-28T00:00:00Z")).toBe("2026-09-28");
    expect(weekStart("2026-09-27T23:59:00Z")).toBe("2026-09-21");
  });
});

describe("computeRetention", () => {
  it("groups people by sign-up week with their four steps", () => {
    // Joined Tue 22 Sep (11 days ago). Rendered that day, back on 30 Sep.
    const r = computeRetention(
      input({
        people: [person("back", 11), person("once", 11), person("never", 11), person("new", 2)],
        renders: [
          { userId: "back", at: ago(11, 11), ok: true, failed: false, refused: false },
          { userId: "back", at: ago(3), ok: true, failed: false, refused: false },
          { userId: "once", at: ago(11, 11), ok: true, failed: false, refused: false },
          { userId: "new", at: ago(2, 11), ok: true, failed: false, refused: false },
        ],
      }),
    );
    expect(r.weeks.map((w) => [w.week, w.joined, w.rendered, w.cameBack])).toEqual([
      ["2026-09-28", 1, 1, null],
      ["2026-09-21", 3, 2, 1],
    ]);
    expect(r.paths.get("back")!.steps).toEqual([1, 1, 1, 0]);
    expect(r.paths.get("once")!.steps).toEqual([1, 1, 0, 0]);
    expect(r.paths.get("never")!.steps).toEqual([1, 0, 0, 0]);
    expect(r.paths.get("new")!.cameBack).toBe("too-early");
    expect(r.cameBack).toBe(1);
    expect(r.cameBackOf).toBe(3);
    expect(r.rendered).toBe(3);
  });

  it("leaves admins out of everything", () => {
    const r = computeRetention(
      input({
        people: [person("me", 30, { role: "admin", plan: "starter", planStatus: "active", lastSeenAt: ago(20) })],
        renders: [{ userId: "me", at: ago(1), ok: true, failed: false, refused: false }],
        made: [{ userId: "me", at: ago(1), tool: "generate" }],
      }),
    );
    expect(r.totalPeople).toBe(0);
    expect(r.quiet).toEqual([]);
    expect(r.tools.find((t) => t.tool === "generate")!.opened).toBe(0);
  });

  it("calls a paying customer quiet after 7 days, not before", () => {
    const quiet = person("q", 20, { plan: "basic", planStatus: "active", lastSeenAt: ago(QUIET_AFTER_DAYS) });
    const fine = person("f", 20, { plan: "basic", planStatus: "active", lastSeenAt: ago(QUIET_AFTER_DAYS - 1) });
    const r = computeRetention(input({ people: [quiet, fine] }));
    expect(r.quiet.map((q) => [q.id, q.kind])).toEqual([["q", "paying"]]);
    expect(r.paths.get("q")!.note).toBe(`Paying, quiet for ${QUIET_AFTER_DAYS} days`);
    expect(r.paths.get("f")!.quietDays).toBe(QUIET_AFTER_DAYS - 1);
  });

  it("counts any visit, render or tool day as being back", () => {
    const p = person("p", 20, { plan: "basic", planStatus: "active", lastSeenAt: ago(12) });
    const r = computeRetention(input({ people: [p], opens: [{ userId: "p", day: ago(1).slice(0, 10), tool: "recast" }] }));
    expect(r.quiet).toEqual([]);
    expect(r.paths.get("p")!.quietDays).toBe(1);
  });

  it("calls a refused first render with nothing since stalled after 3 days", () => {
    const r = computeRetention(
      input({
        people: [
          person("stuck", 5, { lastSeenAt: ago(5, 11) }),
          person("retried", 5, { lastSeenAt: ago(1) }),
          person("fresh", 1, { lastSeenAt: ago(1, 11) }),
        ],
        renders: [
          { userId: "stuck", at: ago(5, 11), ok: false, failed: true, refused: true },
          { userId: "retried", at: ago(5, 11), ok: false, failed: true, refused: false },
          { userId: "fresh", at: ago(1, 11), ok: false, failed: true, refused: true },
        ],
      }),
    );
    expect(r.quiet.map((q) => q.id)).toEqual(["stuck"]);
    expect(r.quiet[0].title).toBe("stuck’s first render was refused, and nothing since");
    expect(r.paths.get("stuck")!.steps).toEqual([1, -1, 0, 0]);
    expect(r.paths.get("retried")!.stalled).toBe(false);
    expect(r.paths.get("fresh")!.stalled).toBe(false);
  });

  it("lists a cancellation for 14 days, and forgets one taken back", () => {
    const r = computeRetention(
      input({
        people: [
          person("left", 40, { plan: "basic", planStatus: "active", lastSeenAt: ago(1) }),
          person("stayed", 40, { plan: "basic", planStatus: "active", lastSeenAt: ago(1) }),
          person("old", 90, { lastSeenAt: ago(1) }),
        ],
        subEvents: [
          { userId: "left", kind: "cancel_scheduled", plan: "basic", endsAt: "2026-10-27T00:00:00Z", at: ago(2) },
          { userId: "stayed", kind: "cancel_scheduled", plan: "basic", endsAt: null, at: ago(3) },
          { userId: "stayed", kind: "cancel_undone", plan: "basic", endsAt: null, at: ago(2) },
          { userId: "old", kind: "ended", plan: "starter", endsAt: null, at: ago(20) },
        ],
      }),
    );
    expect(r.quiet.map((q) => [q.id, q.kind])).toEqual([["left", "cancelled"]]);
    expect(r.quiet[0].sub).toContain("Still active until 27 Oct");
    expect(r.paths.get("old")!.paid).toEqual({ at: null, plan: "starter" });
    expect(r.paths.get("old")!.note).toBe("Starter ended 13 Sep");
  });

  it("counts tools opened and made, and a dash where made can't be read", () => {
    const r = computeRetention(
      input({
        people: [person("a", 30), person("b", 30), person("c", 30)],
        opens: [
          { userId: "a", day: ago(1).slice(0, 10), tool: "live" },
          { userId: "b", day: ago(2).slice(0, 10), tool: "live" },
          { userId: "c", day: ago(9).slice(0, 10), tool: "recast" },
        ],
        made: [
          { userId: "a", at: ago(1), tool: "generate" },
          { userId: "a", at: ago(2), tool: "generate" },
          { userId: "b", at: ago(10), tool: "generate" },
        ],
        madeKnown: new Set(["generate", "recast"]),
      }),
    );
    const tool = (k: string) => r.tools.find((t) => t.tool === k)!;
    expect(tool("generate")).toMatchObject({ opened: 1, made: 1, openedBefore: 1 });
    expect(tool("live")).toMatchObject({ opened: 2, made: null });
    expect(tool("recast")).toMatchObject({ opened: 0, made: 0, openedBefore: 1 });
    expect(r.nobodyOpened).toContain("Recast");
    expect(r.openedNothingMade).toEqual([]);
    expect(r.activeNow).toBe(2);
  });

  it("folds sign-up weeks past the eighth into Earlier", () => {
    const people = Array.from({ length: 10 }, (_, i) => person(`w${i}`, i * 7));
    const r = computeRetention(input({ people }));
    expect(r.weeks).toHaveLength(9);
    expect(r.weeks[8].week).toBe("earlier");
    expect(r.weeks[8].joined).toBe(2);
  });
});

describe("alerts", () => {
  it("words each push and points its buttons at the person", () => {
    const r = computeRetention(
      input({
        people: [person("Nadia", 20, { plan: "basic", planStatus: "active", lastSeenAt: ago(8) })],
        renders: [{ userId: "Nadia", at: ago(9), ok: true, failed: false, refused: false }],
      }),
    );
    const push = quietPush(r.paths.get("Nadia")!);
    expect(push.title).toBe("Paying customer went quiet");
    expect(push.body).toContain("Nadia (Basic) hasn’t been back in 8 days");
    expect(push.actions?.map((a) => a.path)).toEqual(["#people/Nadia?write=1", "#people/Nadia"]);

    const cancel = cancelPush({ userId: "u", name: "Leo", kind: "cancel_scheduled", plan: "basic", endsAt: "2026-10-27T00:00:00Z", source: "stripe" });
    expect(cancel.body).toBe("Leo cancelled Basic. Still active until 27 Oct.");
    expect(cancelPush({ userId: "u", name: "Leo", kind: "ended", plan: "basic", endsAt: null, source: "play" }).body).toContain("on Google Play");
    expect(morePush(3).title).toBe("3 more people are going quiet");
    expect(MAX_PUSHES_PER_RUN).toBeGreaterThan(0);
  });

  it("says a stalled first render was refused", () => {
    const r = computeRetention(
      input({
        people: [person("Karim", 10, { lastSeenAt: ago(10, 11) })],
        renders: [{ userId: "Karim", at: ago(10, 11), ok: false, failed: true, refused: true }],
      }),
    );
    expect(stalledPush(r.paths.get("Karim")!).body).toBe("Karim joined 23 Sep. The first render was refused, and nothing since.");
  });
});
