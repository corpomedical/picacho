"use server";

// Disconnecting an app, from Settings › Security › Connected apps (Press
// Tour Cut 8). The session says WHO; the write goes through the service role
// filtered to this person's own connection, and counts what it changed
// (oauth/store.ts revokeGrant): "done" only when it was. Every token under
// the connection goes with it, and /api/mcp re-checks the connection on
// every call, so nothing it issued keeps working.
//
// Every export of a "use server" file must be an async function.

import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { CONNECTED_APPS_FAILED, CONNECTED_APPS_NOT_FOUND, CONNECTED_APPS_SESSION } from "./messages";
import { revokeGrant } from "./store";

export async function disconnectApp(formData: FormData): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: CONNECTED_APPS_SESSION };
  const id = String(formData.get("id") ?? "");
  const outcome = await revokeGrant(createAdminClient(), data.user.id, id);
  if (outcome === "not_found") return { error: CONNECTED_APPS_NOT_FOUND };
  if (outcome === "failed") return { error: CONNECTED_APPS_FAILED };
  revalidatePath("/app/settings");
  return { error: null };
}
