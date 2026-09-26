"use server";

// Admin's hand labels on the product checker's frames (spec §1.8: "hand
// labels (correct / wrong / not readable) … used for calibration").
//
// requireAdmin first (session, role and — once enrolled — the second
// factor: a server action commits without the admin layout ever running).
// Then the service role, because product_frame_checks has no policies at
// all (synthesis v2 #30).
//
// ONLY FRAMES THAT KEPT THEIR PICTURE CAN BE LABELLED: an admin's own, the
// bake-off's, the seeded ones (records.ts keepFrames). A customer's frame
// keeps its numbers only and is refused here, whatever the form says, until
// the privacy page discloses human review of sampled frames (v2 #32).

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/require-admin";
import { FRAME_CHECK_TABLE, parseFrameLabel } from "./records";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = "/admin/product-checks";

function back(error: string, filter: string | null): never {
  const q = new URLSearchParams({ error });
  if (filter) q.set("show", filter);
  redirect(`${PAGE}?${q.toString()}`);
}

/** Sets (or, with label "clear", removes) the hand label on one frame. */
export async function labelFrameCheck(formData: FormData) {
  const { admin, userId } = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const raw = String(formData.get("label") ?? "");
  const filter = typeof formData.get("show") === "string" ? String(formData.get("show")) : null;
  const label = raw === "clear" ? null : parseFrameLabel(raw);
  if (!UUID.test(id) || (raw !== "clear" && !label)) back("That label can't be saved.", filter);

  const { data, error } = await admin
    .from(FRAME_CHECK_TABLE)
    .update({ label, labelled_by: label ? userId : null, labelled_at: label ? new Date().toISOString() : null })
    .eq("id", id)
    .not("frame_path", "is", null)
    .select("id");
  if (error) {
    console.error("labelFrameCheck: update failed", error.message);
    back(error.message, filter);
  }
  if (!data || data.length === 0) back("Only frames that kept their picture can be labelled (customer frames wait for the privacy page).", filter);

  revalidatePath(PAGE);
}
