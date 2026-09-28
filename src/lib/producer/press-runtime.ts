// Press Tour's Producer tools, wired to the door's real engine (server-only;
// press-tools.ts holds the logic). The same entries and dependencies the MCP
// uses (mcp/press/runtime.ts): the Producer's route has the session, but the
// engine reads the person's allowance with the service role, as the MCP and
// the cron's paid retries do (campaign-runtime.ts).

import { createAdminClient } from "@/lib/supabase/server";
import { pressTourCaller } from "@/lib/press-tour/card-service";
import { campaignDeps } from "@/lib/press-tour/campaign-runtime";
import * as service from "@/lib/press-tour/campaign-service";
import type { PressToolDeps } from "./press-tools";

/** Everything press-tools.ts needs for this person: closed with the door's own sentence, or the engine's plan. */
export async function pressToolDeps(userId: string): Promise<PressToolDeps> {
  const admin = createAdminClient();
  const { data } = await admin.auth.admin.getUserById(userId);
  const who = await pressTourCaller(admin, data?.user ?? null);
  if (who.error !== null) return { db: admin, closed: who.error, plan: null };
  const caller: service.CampaignCaller = { userId: who.caller.userId, via: who.caller.via };
  const gate = service.campaignGate(caller);
  if (gate !== null) return { db: admin, closed: gate, plan: null };
  const deps = campaignDeps(caller, admin);
  return { db: admin, closed: null, plan: (input) => service.planCampaign(deps, caller, { ...input, source: "producer" }) };
}
