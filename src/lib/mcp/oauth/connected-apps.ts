// Settings › Security › Connected apps, the server side (Press Tour Cut 8;
// spec §4.2 "Connected apps"): the person's live app connections, read with
// the service role (oauth_grants has no policies) and filtered to them.
//
// The section shows whenever the person has a connection — turning
// press_tour_mcp off must never hide a way to disconnect — and, with no
// connection yet, only while connecting apps is open to them. A list that
// couldn't be read counts as "no connection" for that rule (integration,
// 2026-09-26): before, it always showed, so a database hiccup (or a push
// ahead of press-tour-07-mcp-oauth.sql) put a "couldn't load" Connected
// apps box in front of every customer, for a feature only admins have.

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { mayConnectApps, oauthEnabled } from "./runtime";
import { listGrants, type GrantView } from "./store";

export type ConnectedApps = { show: boolean; apps: GrantView[]; unavailable: boolean };

export async function loadConnectedApps(personal: SupabaseClient, user: Pick<User, "id" | "email_confirmed_at">): Promise<ConnectedApps> {
  const admin = createAdminClient();
  const apps = await listGrants(admin, user.id);
  if (apps !== "unavailable" && apps.length > 0) return { show: true, apps, unavailable: false };
  // Nothing listed, or the list couldn't be read: shown only while
  // connecting apps is open to this person (a check that fails is closed).
  const open = await Promise.resolve()
    .then(async () => (await oauthEnabled(admin)) && (await mayConnectApps(personal, user)))
    .catch(() => false);
  return { show: open, apps: [], unavailable: apps === "unavailable" };
}
