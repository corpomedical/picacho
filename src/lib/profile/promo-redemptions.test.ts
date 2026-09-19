import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { erasePromoRedemptionEmail } from "./promo-redemptions";

// The buyer's email on a promo sale, erased when their account is deleted
// (2026-09-19). user_id is ON DELETE SET NULL, so the sale outlived the
// account as a rep's commission record, and so did the email on it.

type Sale = {
  id: number;
  user_id: string | null;
  user_email: string | null;
  rep_name: string;
  amount_subtotal: number;
  commission_percent: number;
  stripe_session_id: string;
};

const sale = (id: number, userId: string, email: string): Sale => ({
  id,
  user_id: userId,
  user_email: email,
  rep_name: "Maria G.",
  amount_subtotal: 1900,
  commission_percent: 10,
  stripe_session_id: `cs_test_${id}`,
});

/** promo_redemptions as PostgREST answers the one call the erase makes. */
function fakeTable(rows: Sale[], fail: { update?: string; throws?: boolean } = {}) {
  const client = {
    from(table: string) {
      expect(table).toBe("promo_redemptions");
      if (fail.throws) throw new Error("network down");
      return {
        update(values: Partial<Sale>) {
          return {
            async eq(column: keyof Sale, value: unknown) {
              if (fail.update) return { data: null, error: { message: fail.update } };
              for (const row of rows) if (row[column] === value) Object.assign(row, values);
              return { data: null, error: null };
            },
          };
        },
      };
    },
  };
  return client as unknown as SupabaseClient;
}

describe("erasePromoRedemptionEmail", () => {
  it("erases the email on every sale of the deleted account, and on nobody else's", async () => {
    const rows = [
      sale(1, "gone", "gone@example.com"),
      sale(2, "stays", "stays@example.com"),
      // Paid with a different address than the account's: found by id, not by email.
      sale(3, "gone", "work-card@example.com"),
    ];
    expect(await erasePromoRedemptionEmail(fakeTable(rows), "gone")).toBeNull();
    expect(rows.map((r) => r.user_email)).toEqual([null, "stays@example.com", null]);
  });

  it("keeps the sale itself: the rep, the amount, the rate and Stripe's checkout id", async () => {
    const row = sale(1, "gone", "gone@example.com");
    await erasePromoRedemptionEmail(fakeTable([row]), "gone");
    expect(row).toEqual({ ...sale(1, "gone", "gone@example.com"), user_email: null });
  });

  it("answers null for an account with no promo sales", async () => {
    expect(await erasePromoRedemptionEmail(fakeTable([sale(1, "stays", "stays@example.com")]), "gone")).toBeNull();
  });

  it("never throws, and answers what went wrong for the caller to stop on", async () => {
    await expect(erasePromoRedemptionEmail(fakeTable([], { update: "permission denied" }), "gone")).resolves.toBe(
      "permission denied",
    );
    await expect(erasePromoRedemptionEmail(fakeTable([], { throws: true }), "gone")).resolves.toBe("network down");
  });
});

describe("both deletion paths erase it", () => {
  const read = (p: string) => readFileSync(join(__dirname, "..", "..", "..", p), "utf8");

  for (const file of ["src/lib/profile/actions.ts", "src/lib/admin/actions.ts"]) {
    it(`${file}: after the Play guard, before Stripe and the auth delete, and a failure stops the deletion`, () => {
      const source = read(file);
      const playGuard = source.indexOf('billingProfile?.plan_source === "play"');
      const erase = source.indexOf("const promoEmailError = await erasePromoRedemptionEmail(admin, userId);");
      const stripe = source.indexOf("await cancelStripeCustomerBilling(");
      // Once the account is gone its sales no longer carry its id.
      const authDelete = source.indexOf("await admin.auth.admin.deleteUser(userId);");
      expect(playGuard, file).toBeGreaterThan(-1);
      // An account the Play guard turns away keeps everything, email included.
      expect(erase, file).toBeGreaterThan(playGuard);
      // Nothing irreversible has happened when the erase fails.
      expect(stripe, file).toBeGreaterThan(erase);
      expect(authDelete, file).toBeGreaterThan(stripe);
      expect(source.slice(erase, stripe), file).toMatch(/if \(promoEmailError\) \{[\s\S]*?redirect\(/);
    });
  }

  it("the admin page shows the admin path's stop notice as it is written", () => {
    const notice = /"(Couldn't erase their email from the promo sales[^"]*)"/.exec(read("src/lib/admin/actions.ts"))?.[1];
    expect(notice).toBeDefined();
    // Anything not listed there collapses to a generic line.
    expect(read("src/components/admin-error-banner.tsx")).toContain(`"${notice}"`);
  });
});
