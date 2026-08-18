"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { stripe } from "@/lib/stripe/client";
import { requireAdmin } from "@/lib/admin/require-admin";

// Promo code management. Design rule: Stripe owns the discount, we own the
// bookkeeping. Creating a code here creates a real Stripe coupon + promotion
// code, so the discount a client sees at checkout is computed by Stripe —
// never by us — and deactivating here deactivates it in Stripe, so a dead
// code can't be redeemed through any path.

const CODE_RE = /^[A-Z0-9]{3,24}$/;

export async function createPromoCode(formData: FormData) {
  const { supabase } = await requireAdmin();

  const code = ((formData.get("code") as string) ?? "").trim().toUpperCase();
  const repName = ((formData.get("rep_name") as string) ?? "").trim();
  const discountPercent = Number(formData.get("discount_percent"));
  const durationMonths = Number(formData.get("duration_months"));
  const commissionPercent = Number(formData.get("commission_percent"));
  const notes = ((formData.get("notes") as string) ?? "").trim() || null;

  const fail = (msg: string) => redirect(`/admin/promo?error=${encodeURIComponent(msg)}`);

  if (!CODE_RE.test(code)) {
    fail("Code must be 3-24 letters/numbers (e.g. MARIA20).");
  }
  if (!repName) fail("Salesperson name is required.");
  if (!Number.isInteger(discountPercent) || discountPercent < 1 || discountPercent > 100) {
    fail("Discount must be 1-100%.");
  }
  if (!Number.isInteger(durationMonths) || durationMonths < 0 || durationMonths > 36) {
    fail("Duration must be 0-36 months (0 = forever).");
  }
  if (!Number.isInteger(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) {
    fail("Commission must be 0-100%.");
  }

  // Row first, Stripe second, ids patched in after. If Stripe fails the row
  // is removed again — a code that exists here but not in Stripe would look
  // manageable while being unredeemable, the most confusing possible state.
  const { data: row, error: insertError } = await supabase
    .from("promo_codes")
    .insert({
      code,
      rep_name: repName,
      discount_percent: discountPercent,
      duration_months: durationMonths,
      commission_percent: commissionPercent,
      notes,
    })
    .select("id")
    .single();

  if (insertError || !row) {
    fail(
      insertError?.code === "23505"
        ? `The code ${code} already exists.`
        : (insertError?.message ?? "Couldn't save the code."),
    );
    return;
  }

  // Every failure below must end with NO live discount in Stripe and NO row
  // here — the states this block may not produce are:
  //   • coupon alive in Stripe with no promotion code / no row (silent
  //     dangling discount an old promotionCodes.create failure used to leave
  //     behind), and
  //   • promotion code live in Stripe while our row has no Stripe ids (the
  //     write-back at the end used to go unchecked, so a failed patch left a
  //     code that redeems real money at checkout while this page shows it as
  //     broken/unmanageable — live-in-Stripe, dead-in-DB).
  // Compensation is collected into `failMessage` and the redirect happens
  // OUTSIDE the try/catch — fail() throws NEXT_REDIRECT, and throwing it
  // inside the try would run the catch's cleanup a second time.
  let failMessage: string | null = null;
  try {
    const coupon = await stripe.coupons.create({
      percent_off: discountPercent,
      ...(durationMonths === 0
        ? { duration: "forever" as const }
        : durationMonths === 1
          ? // Stripe rejects repeating-for-1-month; "once" is its spelling
            // of exactly that for monthly subscriptions.
            { duration: "once" as const }
          : { duration: "repeating" as const, duration_in_months: durationMonths }),
      name: `${code} — ${repName}`,
      metadata: { promo_code: code, rep_name: repName },
    });

    let promotionCode;
    try {
      promotionCode = await stripe.promotionCodes.create({
        promotion: { type: "coupon", coupon: coupon.id },
        code,
        // A closing tool for NEW clients: Stripe itself refuses the code for
        // customers who have already paid us before, so a rep can't collect
        // commission on someone who was already a paying customer.
        restrictions: { first_time_transaction: true },
        metadata: { rep_name: repName },
      });
    } catch (err) {
      // The coupon exists but nothing points at it — delete it, or it sits
      // in Stripe as an orphaned live discount forever.
      try {
        await stripe.coupons.del(coupon.id);
      } catch (cleanupErr) {
        console.error("createPromoCode: orphaned-coupon cleanup failed", coupon.id, cleanupErr);
      }
      throw err;
    }

    const { error: patchError } = await supabase
      .from("promo_codes")
      .update({ stripe_coupon_id: coupon.id, stripe_promotion_code_id: promotionCode.id })
      .eq("id", row.id);
    if (patchError) {
      // The write-back failed, so nothing here knows the Stripe ids — undo
      // Stripe (deactivate the code, delete the coupon) so no discount can
      // exist that this page can't see or turn off. Cleanup failures are
      // logged loudly with the ids, because at that point the Stripe
      // dashboard is the only place left that knows them.
      try {
        await stripe.promotionCodes.update(promotionCode.id, { active: false });
        await stripe.coupons.del(coupon.id);
      } catch (cleanupErr) {
        console.error(
          "createPromoCode: Stripe rollback after failed id write-back ALSO failed — deactivate promotion code and delete coupon by hand",
          { promotionCodeId: promotionCode.id, couponId: coupon.id, cleanupErr },
        );
      }
      failMessage = `Couldn't record the Stripe ids (${patchError.message.slice(0, 160)}) — the Stripe side was rolled back, nothing was saved. Try again.`;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stripe rejected the code.";
    failMessage = `Stripe couldn't create the code: ${message.slice(0, 200)}`;
  }

  if (failMessage) {
    await supabase.from("promo_codes").delete().eq("id", row.id);
    fail(failMessage);
  }

  revalidatePath("/admin/promo");
  redirect("/admin/promo");
}

export async function setPromoCodeActive(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = formData.get("id") as string;
  const active = formData.get("active") === "true";

  const { data: promo } = await supabase
    .from("promo_codes")
    .select("id, stripe_promotion_code_id")
    .eq("id", id)
    .single();
  if (!promo) redirect(`/admin/promo?error=${encodeURIComponent("Code not found.")}`);

  // Stripe FIRST, then our row. If the Stripe call fails, our page keeps
  // showing the code as it really is (still live), instead of showing it
  // off while Stripe happily keeps redeeming it.
  if (promo!.stripe_promotion_code_id) {
    try {
      await stripe.promotionCodes.update(promo!.stripe_promotion_code_id, { active });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Stripe update failed.";
      redirect(`/admin/promo?error=${encodeURIComponent(message.slice(0, 200))}`);
    }
  }

  await supabase.from("promo_codes").update({ active }).eq("id", id);
  revalidatePath("/admin/promo");
}

// Editing a live code: only the fields WE own.
//
// Stripe deliberately makes a coupon's percent_off and duration immutable,
// and a promotion code's code string too — a discount someone is already
// subscribed under can't be quietly rewritten underneath them. So this edits
// the rep's name, the commission rate and the notes; changing the actual
// discount means turning this code off and issuing a new one, which is also
// the honest thing to hand a salesperson ("your old code still honours what
// you promised").
//
// Commission edits apply to FUTURE sales only. Past redemptions carry the
// rate they were closed at (promo_redemptions.commission_percent), so a rate
// change can't retroactively alter what a rep is owed.
export async function updatePromoCode(formData: FormData) {
  const { supabase } = await requireAdmin();

  const id = (formData.get("id") as string) ?? "";
  const repName = ((formData.get("rep_name") as string) ?? "").trim();
  const commissionPercent = Number(formData.get("commission_percent"));
  const notes = ((formData.get("notes") as string) ?? "").trim() || null;

  const fail = (msg: string) => redirect(`/admin/promo?error=${encodeURIComponent(msg)}`);

  if (!repName) fail("Salesperson name is required.");
  if (!Number.isInteger(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) {
    fail("Commission must be 0-100%.");
  }

  const { data: promo } = await supabase
    .from("promo_codes")
    .select("id, code, stripe_coupon_id, stripe_promotion_code_id")
    .eq("id", id)
    .single();
  if (!promo) fail("Code not found.");

  const { error } = await supabase
    .from("promo_codes")
    .update({ rep_name: repName, commission_percent: commissionPercent, notes })
    .eq("id", id);
  if (error) fail(error.message);

  // Keep Stripe's own labelling in step, so the dashboard doesn't show a name
  // that stopped being true here. Best-effort: the rename is cosmetic, and
  // failing the whole edit over it would be worse than a stale label.
  try {
    if (promo!.stripe_coupon_id) {
      await stripe.coupons.update(promo!.stripe_coupon_id, {
        name: `${promo!.code} — ${repName}`,
        metadata: { promo_code: promo!.code, rep_name: repName },
      });
    }
    if (promo!.stripe_promotion_code_id) {
      await stripe.promotionCodes.update(promo!.stripe_promotion_code_id, {
        metadata: { rep_name: repName },
      });
    }
  } catch (err) {
    console.error("Promo code Stripe rename failed", err);
  }

  revalidatePath("/admin/promo");
  redirect("/admin/promo");
}

// Deleting a code.
//
// Stripe's two objects behave differently and both matter here:
//   • the coupon CAN be deleted, and deleting it is what actually stops the
//     discount being applied to anything new. Subscriptions already carrying
//     it keep it — Stripe honours a discount someone already bought, which is
//     the correct behaviour and not something to fight.
//   • the promotion code CANNOT be deleted, only deactivated. So it's
//     deactivated first: a live promotion code pointing at a deleted coupon
//     is the one state that would 500 a customer at checkout.
//
// Sales history survives on purpose. promo_redemptions stores the code, the
// rep's name and the rate the sale closed at as plain columns (the foreign
// key is ON DELETE SET NULL), so deleting a code never destroys the record of
// commission owed on business it already brought in.
export async function deletePromoCode(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = (formData.get("id") as string) ?? "";

  const { data: promo } = await supabase
    .from("promo_codes")
    .select("id, code, stripe_coupon_id, stripe_promotion_code_id")
    .eq("id", id)
    .single();
  if (!promo) redirect(`/admin/promo?error=${encodeURIComponent("Code not found.")}`);

  // Stripe first — if it fails, our row stays and the page keeps telling the
  // truth about a code that is still redeemable.
  try {
    if (promo!.stripe_promotion_code_id) {
      await stripe.promotionCodes.update(promo!.stripe_promotion_code_id, { active: false });
    }
    if (promo!.stripe_coupon_id) {
      await stripe.coupons.del(promo!.stripe_coupon_id);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stripe delete failed.";
    redirect(
      `/admin/promo?error=${encodeURIComponent(
        `Couldn't remove the code from Stripe, so nothing was deleted: ${message.slice(0, 160)}`,
      )}`,
    );
  }

  const { error } = await supabase.from("promo_codes").delete().eq("id", id);
  if (error) redirect(`/admin/promo?error=${encodeURIComponent(error.message)}`);

  revalidatePath("/admin/promo");
  redirect("/admin/promo");
}
