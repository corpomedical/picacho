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
    const promotionCode = await stripe.promotionCodes.create({
      promotion: { type: "coupon", coupon: coupon.id },
      code,
      // A closing tool for NEW clients: Stripe itself refuses the code for
      // customers who have already paid us before, so a rep can't collect
      // commission on someone who was already a paying customer.
      restrictions: { first_time_transaction: true },
      metadata: { rep_name: repName },
    });

    await supabase
      .from("promo_codes")
      .update({ stripe_coupon_id: coupon.id, stripe_promotion_code_id: promotionCode.id })
      .eq("id", row.id);
  } catch (err) {
    await supabase.from("promo_codes").delete().eq("id", row.id);
    const message = err instanceof Error ? err.message : "Stripe rejected the code.";
    fail(`Stripe couldn't create the code: ${message.slice(0, 200)}`);
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
