import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Deleting a promo code whose row delete failed (2026-09-19). By then Stripe
// has switched the code off and deleted its coupon, and the banner used to
// say only "try again". Deleting again then stopped at Stripe every time, on
// the coupon that was already gone, with a notice that nothing had been
// deleted: the code stayed on the list for good. Now each Stripe step looks
// before it acts, and the banner says what Stripe already did
// (admin-error-banner.test.ts).
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

// Stripe, as far as this code sees it: one promotion code and its coupon.
const stripeSide = { promotionCodeActive: true, couponExists: true, couponDeleteFails: false };
vi.mock("@/lib/stripe/client", () => ({
  stripe: {
    promotionCodes: {
      retrieve: async () => ({ active: stripeSide.promotionCodeActive }),
      update: async (_id: string, params: { active: boolean }) => {
        stripeSide.promotionCodeActive = params.active;
      },
    },
    coupons: {
      del: async (id: string) => {
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

// Our side: the code's row, and whether deleting it fails.
const ourSide = { rowExists: true, rowDeleteError: null as { message: string } | null };
vi.mock("@/lib/admin/require-admin", () => ({
  requireAdmin: async () => ({
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: ourSide.rowExists
                ? { id: "p1", code: "MARIA20", stripe_coupon_id: "co_1", stripe_promotion_code_id: "promo_1" }
                : null,
            }),
          }),
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

import { deletePromoCode } from "./promo-actions";

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

beforeEach(() => {
  events.length = 0;
  Object.assign(stripeSide, { promotionCodeActive: true, couponExists: true, couponDeleteFails: false });
  Object.assign(ourSide, { rowExists: true, rowDeleteError: null });
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
