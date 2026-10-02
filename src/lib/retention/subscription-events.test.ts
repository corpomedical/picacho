import { beforeEach, describe, expect, it, vi } from "vitest";

const notifyAdmins = vi.fn();
vi.mock("@/lib/push/web-push", () => ({ notifyAdmins }));

const { cancelTransition, noteSubscriptionEvent } = await import("./subscription-events");

describe("cancelTransition", () => {
  it("sees Cancel pressed, and taken back", () => {
    expect(cancelTransition({ cancel_at_period_end: false }, { cancel_at_period_end: true, cancel_at: null })).toBe("cancel_scheduled");
    expect(cancelTransition({ cancel_at: null }, { cancel_at_period_end: false, cancel_at: 1_790_000_000 })).toBe("cancel_scheduled");
    expect(cancelTransition({ cancel_at_period_end: true }, { cancel_at_period_end: false, cancel_at: null })).toBe("cancel_undone");
  });

  it("ignores updates that didn't touch the cancellation", () => {
    expect(cancelTransition(undefined, { cancel_at_period_end: true, cancel_at: null })).toBeNull();
    expect(cancelTransition({}, { cancel_at_period_end: true, cancel_at: null })).toBeNull();
    // cancel_at moved while still scheduled: no new event.
    expect(cancelTransition({ cancel_at: 1 }, { cancel_at_period_end: false, cancel_at: 2 })).toBeNull();
  });
});

type Insert = Record<string, unknown>;

function fakeAdmin(opts: { insertError?: { code?: string; message: string }; announced?: boolean }) {
  const inserts: Insert[] = [];
  const admin = {
    from(table: string) {
      if (table === "subscription_events") {
        return {
          insert: async (row: Insert) => {
            inserts.push(row);
            return { error: opts.insertError ?? null };
          },
          select: () => ({
            eq: () => ({ eq: () => ({ gte: () => ({ limit: async () => ({ data: opts.announced ? [{ id: "x" }] : [] }) }) }) }),
          }),
        };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { full_name: "Leo B.", email: "leo@example.com" } }) }) }),
      };
    },
  };
  return { admin: admin as never, inserts };
}

const base = {
  userId: "u1",
  source: "stripe" as const,
  plan: "basic",
  subscriptionId: "sub_1",
  endsAt: "2026-10-27T00:00:00Z",
  externalId: "evt_1",
};

describe("noteSubscriptionEvent", () => {
  beforeEach(() => notifyAdmins.mockReset());

  it("records a cancellation and buzzes the phone once", async () => {
    const { admin, inserts } = fakeAdmin({});
    await noteSubscriptionEvent(admin, { ...base, kind: "cancel_scheduled" });
    expect(inserts[0]).toMatchObject({ user_id: "u1", kind: "cancel_scheduled", external_id: "evt_1" });
    expect(notifyAdmins).toHaveBeenCalledTimes(1);
    expect(notifyAdmins.mock.calls[0][0].body).toBe("Leo B. cancelled Basic. Still active until 27 Oct.");
  });

  it("stays quiet on a redelivered event", async () => {
    const { admin } = fakeAdmin({ insertError: { code: "23505", message: "duplicate" } });
    await noteSubscriptionEvent(admin, { ...base, kind: "cancel_scheduled" });
    expect(notifyAdmins).not.toHaveBeenCalled();
  });

  it("doesn't announce an end that a cancellation already announced", async () => {
    const { admin } = fakeAdmin({ announced: true });
    await noteSubscriptionEvent(admin, { ...base, kind: "ended", externalId: "evt_2" });
    expect(notifyAdmins).not.toHaveBeenCalled();
  });

  it("announces an end nobody saw coming", async () => {
    const { admin } = fakeAdmin({ announced: false });
    await noteSubscriptionEvent(admin, { ...base, kind: "ended", externalId: "evt_3" });
    expect(notifyAdmins.mock.calls[0][0].title).toBe("Subscription ended");
  });

  it("never throws, even when the table is missing", async () => {
    const { admin } = fakeAdmin({ insertError: { code: "42P01", message: "relation does not exist" } });
    await expect(noteSubscriptionEvent(admin, { ...base, kind: "cancel_scheduled" })).resolves.toBeUndefined();
    expect(notifyAdmins).not.toHaveBeenCalled();
  });
});
