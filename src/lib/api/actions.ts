"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
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
  //
  // The cap is enforced atomically by create_api_key_capped (supabase/
  // pending-2026-08-19/auth-admin.sql): count-and-insert under a per-user
  // advisory lock (key 41), same pattern as reserve_generation and friends.
  // The old count-then-insert here was two separate statements, so a
  // concurrent burst all counted 4 and all inserted — an unbounded pile of
  // live credentials past the documented ceiling. Service-role RPC (EXECUTE
  // is revoked from authenticated); fails CLOSED with a retry message until
  // the SQL file is applied.
  const { key, hash, prefix } = generateApiKey();

  const admin = createAdminClient();
  const { data: created, error } = await admin.rpc("create_api_key_capped", {
    p_user_id: userData.user.id,
    p_max: MAX_ACTIVE_KEYS,
    p_name: name,
    p_prefix: prefix,
    p_key_hash: hash,
  });

  if (error) return { error: "Couldn't create that key — try again." };
  if (created !== true) {
    return {
      error: `You already have ${MAX_ACTIVE_KEYS} active keys — revoke one before creating another.`,
    };
  }

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
