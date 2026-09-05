"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import type { BrandRule, BrandRuleKind, BrandRuleSeverity } from "@/lib/brand-rules/types";
import { getBrandRulePack } from "@/lib/brand-rules/packs";

// Account-level rules layered on top of a character's own traits. Two kinds,
// and the difference between them is the whole point of the feature:
//
//   require — "always mention the clinic's logo on the uniform". Behaves
//             exactly like a character trait: if the finished prompt lost it,
//             the missing text is appended and the generation proceeds.
//
//   forbid  — "never claim guaranteed results". Cannot be repaired by
//             appending anything, so a match blocks the generation before a
//             single provider call is made.
//
// See BRAND_RULEBOOK_DESIGN.md for the reasoning and the phased plan.
// Types live in ./types so pipeline.ts can use them without importing a
// "use server" module. Re-exporting is not allowed from a "use server" file
// (every export there must be an async function), so callers that need the
// types import them from ./types directly.
const MAX_RULES = 40;
const MAX_VALUE_LENGTH = 300;
// The label rides along into prompts and admin views the same way the value
// does (see loadActiveBrandRules), so it gets a cap in the same style — a
// short name, not a second value field.
const MAX_LABEL_LENGTH = 80;

type RuleRow = {
  id: string;
  kind: string;
  label: string;
  value: string;
  applies_to: string;
  severity: string;
  active: boolean;
};

function toBrandRule(row: RuleRow): BrandRule {
  return {
    id: row.id,
    kind: row.kind as BrandRuleKind,
    label: row.label,
    value: row.value,
    appliesTo: row.applies_to as BrandRule["appliesTo"],
    severity: row.severity as BrandRuleSeverity,
    active: row.active,
  };
}

export async function getBrandRules(): Promise<BrandRule[]> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return [];

  const { data } = await supabase
    .from("brand_rules")
    .select("id, kind, label, value, applies_to, severity, active")
    .eq("user_id", userData.user.id)
    .order("created_at", { ascending: true });

  return ((data ?? []) as RuleRow[]).map(toBrandRule);
}

export async function addBrandRule(formData: FormData): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  const kind = formData.get("kind") as string;
  const label = (formData.get("label") as string)?.trim();
  const value = (formData.get("value") as string)?.trim();
  const appliesTo = (formData.get("applies_to") as string) || "all";
  const severity = (formData.get("severity") as string) || "block";

  if (kind !== "require" && kind !== "forbid") return { error: "Pick whether this is a required or forbidden rule." };
  if (!label) return { error: "Give the rule a short name." };
  if (label.length > MAX_LABEL_LENGTH) {
    return { error: `Keep the rule name under ${MAX_LABEL_LENGTH} characters.` };
  }
  if (!value) return { error: "Describe what the rule actually requires or forbids." };
  if (value.length > MAX_VALUE_LENGTH) {
    return { error: `Keep rules under ${MAX_VALUE_LENGTH} characters.` };
  }
  if (!["all", "image", "video"].includes(appliesTo)) return { error: "Invalid content type." };
  if (!["block", "warn"].includes(severity)) return { error: "Invalid severity." };

  // A rulebook is fed to the draft model in full on every generation, so an
  // unbounded list would quietly inflate both the prompt and its cost. The
  // cap is enforced atomically (insert_brand_rules_capped, in
  // supabase/applied/2026-08-19/user-actions.sql): the old count-then-insert
  // raced, so a concurrent burst all counted under the limit and all
  // inserted. Same advisory-lock pattern as record_prompt_assist; EXECUTE
  // revoked from `authenticated`, so it runs through the service-role client.
  const { data: added, error } = await createAdminClient().rpc("insert_brand_rules_capped", {
    p_user_id: userData.user.id,
    p_cap: MAX_RULES,
    p_rules: [
      {
        kind,
        label,
        value,
        applies_to: appliesTo,
        // A "require" rule is repairable by definition, so severity is only
        // meaningful for prohibitions — pin it rather than storing something
        // that would read as configurable but do nothing.
        severity: kind === "forbid" ? severity : "warn",
      },
    ],
  });

  if (error) {
    console.error("addBrandRule failed:", error.message);
    return { error: "Couldn't save that rule — try again." };
  }
  if (added === -1) {
    return { error: `You can have up to ${MAX_RULES} rules. Delete one first.` };
  }

  revalidatePath("/app/settings");
  return { error: null };
}

// Applies a preset pack (see packs.ts) as ordinary rules the person can then
// edit or delete. Skips any rule whose label they already have, so applying
// a pack twice — or applying two packs that share a rule, which several
// deliberately do — tops up rather than duplicating.
export async function applyBrandRulePack(formData: FormData): Promise<{ error: string | null; added?: number }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  const packId = formData.get("pack") as string;
  const pack = packId ? getBrandRulePack(packId) : undefined;
  if (!pack) return { error: "That rule pack doesn't exist." };

  const { data: existing } = await supabase
    .from("brand_rules")
    .select("label")
    .eq("user_id", userData.user.id);

  const have = new Set((existing ?? []).map((r) => (r.label as string).toLowerCase()));
  const toAdd = pack.rules.filter((r) => !have.has(r.label.toLowerCase()));

  if (toAdd.length === 0) return { error: null, added: 0 };

  // Same atomic cap as addBrandRule — the whole pack counts and inserts under
  // one advisory lock, so a concurrent burst can't stack packs past MAX_RULES.
  // (The label dedupe above can still race with itself, but the worst case
  // there is a duplicate rule the person can delete — the cap is the part
  // that must hold.) -1 back means the batch wouldn't fit; nothing inserted.
  const { data: added, error } = await createAdminClient().rpc("insert_brand_rules_capped", {
    p_user_id: userData.user.id,
    p_cap: MAX_RULES,
    p_rules: toAdd.map((r) => ({
      kind: "forbid",
      label: r.label,
      value: r.value,
      applies_to: "all",
      severity: r.severity,
    })),
  });

  if (error) {
    console.error("applyBrandRulePack failed:", error.message);
    return { error: "Couldn't add those rules — try again." };
  }
  if (added === -1) {
    return { error: `That would exceed the ${MAX_RULES}-rule limit. Delete some rules first.` };
  }

  revalidatePath("/app/settings");
  return { error: null, added: toAdd.length };
}

export async function toggleBrandRule(formData: FormData): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  const id = formData.get("id") as string;
  const active = formData.get("active") === "true";
  if (!id) return { error: "Missing rule id." };

  const { error } = await supabase
    .from("brand_rules")
    .update({ active })
    .eq("id", id)
    .eq("user_id", userData.user.id);

  if (error) {
    console.error("toggleBrandRule failed:", error.message);
    return { error: "Couldn't update that rule — try again." };
  }

  revalidatePath("/app/settings");
  return { error: null };
}

export async function deleteBrandRule(formData: FormData): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  const id = formData.get("id") as string;
  if (!id) return { error: "Missing rule id." };

  const { error } = await supabase
    .from("brand_rules")
    .delete()
    .eq("id", id)
    .eq("user_id", userData.user.id);

  if (error) {
    console.error("deleteBrandRule failed:", error.message);
    return { error: "Couldn't delete that rule — try again." };
  }

  revalidatePath("/app/settings");
  return { error: null };
}
