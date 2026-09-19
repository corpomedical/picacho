import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminErrorBanner } from "../../components/admin-error-banner";

// Deleting a promo code whose row delete failed (2026-09-19). By then Stripe
// has switched the code off and deleted its coupon, and the banner used to
// say only "try again". Deleting again then stopped at Stripe every time, on
// the coupon that was already gone, with a notice that nothing had been
// deleted: the code stayed on the list for good. Now each Stripe step looks
// before it acts, and the banner says what Stripe already did
// (admin-error-banner.test.ts).
//
// The writes after Stripe in the other two actions (also 2026-09-19): the
// row update behind Turn on / Turn off went unchecked, so the list and
// Stripe could disagree with nothing on the page; and creating a code said
// "rolled back" and "nothing was saved" even when undoing Stripe, or
// clearing the row, had failed too. Each now says what Stripe and this list
// actually hold, in the banner's own words.
//
// promo-actions.ts imports through "@/", which this suite does not resolve:
// the session, the database, Stripe and Next's redirect are stood in for.

const events: string[] = [];

class Redirected extends Error {
  constructor(readonly to: string) {
    super(to);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    events.push("redirect");
    throw new Redirected(to);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// Stripe, as far as this code sees it: one promotion code and its coupon,
// and which calls fail.
const stripeSide = {
  promotionCodeActive: true,
  couponExists: true,
  couponCreateFails: false,
  couponDeleteFails: false,
  promotionCodeUpdateFails: false,
};
const stripeCalls: string[] = [];
vi.mock("@/lib/stripe/client", () => ({
  stripe: {
    promotionCodes: {
      create: async () => {
        stripeCalls.push("promotionCodes.create");
        stripeSide.promotionCodeActive = true;
        return { id: "promo_1" };
      },
      retrieve: async () => {
        stripeCalls.push("promotionCodes.retrieve");
        return { active: stripeSide.promotionCodeActive };
      },
      update: async (_id: string, params: { active: boolean }) => {
        stripeCalls.push("promotionCodes.update");
        if (stripeSide.promotionCodeUpdateFails) throw new Error("Stripe is unreachable");
        stripeSide.promotionCodeActive = params.active;
      },
    },
    coupons: {
      create: async () => {
        stripeCalls.push("coupons.create");
        if (stripeSide.couponCreateFails) throw new Error("Stripe is unreachable");
        stripeSide.couponExists = true;
        return { id: "co_1" };
      },
      del: async (id: string) => {
        stripeCalls.push("coupons.del");
        if (stripeSide.couponDeleteFails) throw new Error("Stripe is unreachable");
        if (!stripeSide.couponExists) {
          throw new Stripe.errors.StripeInvalidRequestError({
            type: "invalid_request_error",
            code: "resource_missing",
            message: `No such coupon: '${id}'`,
          });
        }
        stripeSide.couponExists = false;
      },
    },
  },
}));

// Our side: the code's row, and which of its writes fail.
const ourSide = {
  rowExists: true,
  hasStripeIds: true,
  active: true,
  rowUpdateError: null as { message: string } | null,
  rowDeleteError: null as { message: string } | null,
};
vi.mock("@/lib/admin/require-admin", () => ({
  requireAdmin: async () => ({
    supabase: {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => {
              // A new row: no Stripe ids yet, and active by default.
              Object.assign(ourSide, { rowExists: true, hasStripeIds: false, active: true });
              return { data: { id: "p1" }, error: null };
            },
          }),
        }),
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: ourSide.rowExists
                ? {
                    id: "p1",
                    code: "MARIA20",
                    stripe_coupon_id: ourSide.hasStripeIds ? "co_1" : null,
                    stripe_promotion_code_id: ourSide.hasStripeIds ? "promo_1" : null,
                  }
                : null,
            }),
          }),
        }),
        update: (values: { active?: boolean; stripe_promotion_code_id?: string }) => ({
          eq: async () => {
            if (ourSide.rowUpdateError) return { error: ourSide.rowUpdateError };
            if (values.active !== undefined) ourSide.active = values.active;
            if (values.stripe_promotion_code_id) ourSide.hasStripeIds = true;
            return { error: null };
          },
        }),
        delete: () => ({
          eq: async () => {
            if (ourSide.rowDeleteError) return { error: ourSide.rowDeleteError };
            ourSide.rowExists = false;
            return { error: null };
          },
        }),
      }),
    },
  }),
}));

import { createPromoCode, deletePromoCode, setPromoCodeActive } from "./promo-actions";

/** Presses Delete on the code; where the action sends the admin next. */
async function pressDelete(): Promise<string> {
  const form = new FormData();
  form.set("id", "p1");
  try {
    await deletePromoCode(form);
  } catch (err) {
    if (err instanceof Redirected) return decodeURIComponent(err.to);
    throw err;
  }
  throw new Error("deletePromoCode finished without redirecting");
}

/** Runs an action on a form; where it sends the admin next, or null when it finishes on the page. */
async function submit(action: (form: FormData) => Promise<void>, fields: Record<string, string>): Promise<string | null> {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  try {
    await action(form);
  } catch (err) {
    if (err instanceof Redirected) return err.to;
    throw err;
  }
  return null;
}

/** Presses Turn on (true) or Turn off (false) on the code. */
const pressSwitch = (active: boolean) => submit(setPromoCodeActive, { id: "p1", active: String(active) });

/** Fills in and submits the New code form. */
const addCode = () =>
  submit(createPromoCode, {
    code: "MARIA20",
    rep_name: "Maria G.",
    discount_percent: "20",
    duration_months: "3",
    commission_percent: "10",
    notes: "",
  });

/** The line the banner shows on the page a redirect lands on. */
function bannerAfter(to: string | null): string | undefined {
  expect(to).toMatch(/^\/admin\/promo\?error=/);
  const error = new URL(to!, "https://picacho.test").searchParams.get("error") ?? undefined;
  return AdminErrorBanner({ error })?.props.children;
}
const GENERIC = AdminErrorBanner({ error: "anything the banner doesn't know" })?.props.children;

/** What console.error was given, call by call. */
const logged = () => vi.mocked(console.error).mock.calls;

const TIMEOUT = { message: "canceling statement due to statement timeout" };

beforeEach(() => {
  vi.restoreAllMocks(); // a fresh console.error spy: logged() reads this test's calls only
  events.length = 0;
  stripeCalls.length = 0;
  Object.assign(stripeSide, {
    promotionCodeActive: true,
    couponExists: true,
    couponCreateFails: false,
    couponDeleteFails: false,
    promotionCodeUpdateFails: false,
  });
  Object.assign(ourSide, { rowExists: true, hasStripeIds: true, active: true, rowUpdateError: null, rowDeleteError: null });
  vi.spyOn(console, "error").mockImplementation(() => {
    events.push("log");
  });
});

describe("deleting a promo code again after its row delete failed", () => {
  it("first says what Stripe already did, then clears the code from the list", async () => {
    ourSide.rowDeleteError = { message: "canceling statement due to statement timeout" };
    const first = await pressDelete();
    expect(first).toMatch(/^\/admin\/promo\?error=Couldn't remove the code from this list \(canceling statement/);
    expect(stripeSide).toMatchObject({ promotionCodeActive: false, couponExists: false });
    expect(ourSide.rowExists).toBe(true);
    // The cause is in the server log before the banner points there.
    expect(events).toEqual(["log", "redirect"]);

    ourSide.rowDeleteError = null;
    events.length = 0;
    expect(await pressDelete()).toBe("/admin/promo");
    expect(ourSide.rowExists).toBe(false);
    expect(events).toEqual(["redirect"]);
  });

  it("still stops, with the row kept, when Stripe fails for any other reason", async () => {
    stripeSide.couponDeleteFails = true;
    expect(await pressDelete()).toMatch(
      /^\/admin\/promo\?error=Couldn't remove the code from Stripe, so nothing was deleted: Stripe is unreachable/,
    );
    expect(ourSide.rowExists).toBe(true);
    expect(events).toEqual(["log", "redirect"]);
  });
});

describe("Turn on / Turn off when this list can't record the change", () => {
  // Stripe goes first, so by the row update Stripe already has the new state.
  // The worst case is a code switched on in Stripe that the list shows as off.

  it("says the code IS on in Stripe, and pressing Turn on again brings the list in step", async () => {
    Object.assign(stripeSide, { promotionCodeActive: false });
    Object.assign(ourSide, { active: false, rowUpdateError: TIMEOUT });

    const line = bannerAfter(await pressSwitch(true));
    expect(line).not.toBe(GENERIC);
    expect(line).toContain("IS on in Stripe, so it can be redeemed");
    expect(line).toContain("still shows as off here");
    expect(line).toContain("Press Turn on again");
    expect(line).not.toContain("statement timeout");
    expect(stripeSide.promotionCodeActive).toBe(true);
    expect(ourSide.active).toBe(false);
    // The cause is in the server log before the banner points there.
    expect(events).toEqual(["log", "redirect"]);

    // Pressed again: Stripe's update repeats harmlessly and the list catches up.
    ourSide.rowUpdateError = null;
    events.length = 0;
    expect(await pressSwitch(true)).toBeNull();
    expect(stripeSide.promotionCodeActive).toBe(true);
    expect(ourSide.active).toBe(true);
    expect(events).toEqual([]);
  });

  it("says the code IS off in Stripe, and pressing Turn off again brings the list in step", async () => {
    ourSide.rowUpdateError = TIMEOUT;

    const line = bannerAfter(await pressSwitch(false));
    expect(line).not.toBe(GENERIC);
    expect(line).toContain("IS off in Stripe, so it can't be redeemed");
    expect(line).toContain("still shows as active here");
    expect(line).toContain("Press Turn off again");
    expect(stripeSide.promotionCodeActive).toBe(false);
    expect(ourSide.active).toBe(true);
    expect(events).toEqual(["log", "redirect"]);

    ourSide.rowUpdateError = null;
    expect(await pressSwitch(false)).toBeNull();
    expect(ourSide.active).toBe(false);
  });

  it("says only that something went wrong when the code has no Stripe ids, since nothing changed", async () => {
    Object.assign(ourSide, { hasStripeIds: false, rowUpdateError: TIMEOUT });

    expect(bannerAfter(await pressSwitch(false))).toBe(GENERIC);
    expect(stripeCalls).toEqual([]);
    expect(ourSide.active).toBe(true);
    expect(events).toEqual(["log", "redirect"]);
  });
});

describe("adding a code when saving its Stripe ids fails", () => {
  beforeEach(() => {
    // Nothing yet: no row here, no promotion code or coupon in Stripe.
    Object.assign(stripeSide, { promotionCodeActive: false, couponExists: false });
    Object.assign(ourSide, { rowExists: false, rowUpdateError: TIMEOUT });
  });

  it("says it was rolled back on both sides when it was", async () => {
    const line = bannerAfter(await addCode());
    expect(line).toContain("rolled back on both sides");
    expect(stripeSide).toMatchObject({ promotionCodeActive: false, couponExists: false });
    expect(ourSide.rowExists).toBe(false);
    expect(events).toEqual(["log", "redirect"]);
  });

  it("says it may still be live in Stripe when undoing it there fails too, and logs the ids", async () => {
    stripeSide.promotionCodeUpdateFails = true;

    const line = bannerAfter(await addCode());
    expect(line).not.toContain("rolled back");
    expect(line).toContain("may still be live there, with nothing on this list");
    expect(line).toContain("Deactivate it and delete its coupon by hand in the Stripe dashboard");
    expect(line).toContain("the ids are in the server log");
    expect(line).not.toContain("statement timeout");
    expect(stripeSide).toMatchObject({ promotionCodeActive: true, couponExists: true });
    expect(ourSide.rowExists).toBe(false);
    // The ids the dashboard needs, logged before the redirect: the failed
    // write-back, then the failed undo with both ids.
    expect(logged().some(([, detail]) => JSON.stringify(detail)?.includes('"promotionCodeId":"promo_1","couponId":"co_1"'))).toBe(true);
    expect(events).toEqual(["log", "log", "redirect"]);
  });
});

describe("adding a code when clearing its unfinished row fails", () => {
  beforeEach(() => {
    Object.assign(stripeSide, { promotionCodeActive: false, couponExists: false });
    Object.assign(ourSide, { rowExists: false, rowDeleteError: TIMEOUT });
  });

  it("says the row stays but isn't live in Stripe, and deleting it from the list clears it without touching Stripe", async () => {
    stripeSide.couponCreateFails = true;

    const line = bannerAfter(await addCode());
    expect(line).not.toContain("nothing was saved");
    expect(line).toContain("it shows here as active, but it isn't live in Stripe");
    expect(line).toContain("Delete it from this list, which won't touch Stripe");
    expect(line).not.toContain("Stripe is unreachable");
    expect(ourSide).toMatchObject({ rowExists: true, hasStripeIds: false, active: true });
    expect(stripeSide.promotionCodeActive).toBe(false);
    // Stripe's refusal, then the failed clean-up, both logged before the redirect.
    expect(events).toEqual(["log", "log", "redirect"]);

    // Delete, as the banner says: the row has no Stripe ids, so Stripe isn't called.
    ourSide.rowDeleteError = null;
    stripeCalls.length = 0;
    expect(await pressDelete()).toBe("/admin/promo");
    expect(ourSide.rowExists).toBe(false);
    expect(stripeCalls).toEqual([]);
  });

  it("says the same after a Stripe rollback that worked", async () => {
    ourSide.rowUpdateError = TIMEOUT;

    const line = bannerAfter(await addCode());
    expect(line).toContain("it shows here as active, but it isn't live in Stripe");
    expect(stripeSide).toMatchObject({ promotionCodeActive: false, couponExists: false });
    expect(ourSide.rowExists).toBe(true);
    expect(events).toEqual(["log", "log", "redirect"]);
  });

  it("says both when undoing Stripe failed as well: deactivate it there first, then delete it here", async () => {
    ourSide.rowUpdateError = TIMEOUT;
    stripeSide.promotionCodeUpdateFails = true;

    const line = bannerAfter(await addCode());
    expect(line).not.toContain("rolled back");
    expect(line).not.toContain("isn't live");
    expect(line).toContain("It may still be live in Stripe");
    expect(line).toContain("deactivate it and delete its coupon by hand in the Stripe dashboard");
    expect(line).toContain("Then delete it from this list");
    expect(stripeSide.promotionCodeActive).toBe(true);
    expect(ourSide.rowExists).toBe(true);
    expect(events).toEqual(["log", "log", "log", "redirect"]);
  });
});
