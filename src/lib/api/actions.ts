"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { generateApiKey } from "@/lib/api/keys";
import type { PlanId } from "@/lib/plans";

// Creating and revoking the caller's own API keys, from Settings.
//
// The plaintext key is returned exactly once, by createApiKey, and never
// stored — only its SHA-256 hash goes to the database. If it's lost, the only
// remedy is a new key, which the UI says plainly.

const MAX_ACTIVE_KEYS = 5;

export async function createApiKey(
  formData: FormData,
): Promise<{ error: string | null; key?: string }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  const name = String(formData.get("name") ?? "").trim() || "API key";
  if (name.length > 60) return { error: "That name is too long." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("plan, role, api_access")
    .eq("id", userData.user.id)
    .single();

  const plan = (profile?.plan ?? "none") as PlanId;
  const allowed = plan === "elite" || profile?.api_access === true || profile?.role === "admin";
  if (!allowed) {
    return {
      error: "API access is included with the Elite plan. Get in touch and we'll switch it on.",
    };
  }

  // A handful is plenty for rotating keys and separating integrations;
  // unlimited keys are just unlimited things to leak.
  const { count } = await supabase
    .from("api_keys")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userData.user.id)
    .is("revoked_at", null);

  if ((count ?? 0) >= MAX_ACTIVE_KEYS) {
    return {
      error: `You already have ${MAX_ACTIVE_KEYS} active keys — revoke one before creating another.`,
    };
  }

  const { key, hash, prefix } = generateApiKey();

  const { error } = await supabase.from("api_keys").insert({
    user_id: userData.user.id,
    name,
    prefix,
    key_hash: hash,
  });

  if (error) return { error: "Couldn't create that key — try again." };

  revalidatePath("/app/settings");
  // The one and only time this value exists outside the caller's own machine.
  return { error: null, key };
}

export async function revokeApiKey(formData: FormData): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Nothing to revoke." };

  // Revoked, not deleted: a key that made forty thousand calls is part of
  // this account's history, and "which key did that?" has to stay answerable.
  const { error } = await supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userData.user.id)
    .is("revoked_at", null);

  if (error) return { error: "Couldn't revoke that key — try again." };

  revalidatePath("/app/settings");
  return { error: null };
}
