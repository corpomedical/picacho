// Press Tour's MCP tools, wired to the real engine (server-only). The ONE
// place service.ts's PressEngine meets campaign-service.ts and
// card-service.ts — the same entries, with the same dependencies
// (campaign-runtime.ts campaignDeps), that the door's actions use. The only
// difference is who is asking: the MCP route has no session, so the
// person's allowance is read with the service role, as the cron's paid
// retries already do (campaign-runtime.ts machineDeps).

import type { SupabaseClient } from "@supabase/supabase-js";
import { hashedRateKey, rateLimited } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/server";
import { importProductFromUrl, pressTourCaller } from "@/lib/press-tour/card-service";
import { campaignDeps } from "@/lib/press-tour/campaign-runtime";
import * as service from "@/lib/press-tour/campaign-service";
import { repaintCredits } from "@/lib/press-tour/quote";
import { PRESS_MCP_TRIAL_ONLY } from "./messages";
import type { PressDeps, PressEngine, PressMcpCaller } from "./service";

/**
 * The person behind an MCP call, as Press Tour sees them: Press Tour on and
 * open to them, a confirmed email (card-service.ts pressTourCaller, the
 * door's own check). The free trial ad is claimed on picacho.ai only
 * (spec §4.3), so an account that reaches Press Tour only through the trial
 * is refused here.
 */
export async function pressMcpCaller(
  admin: SupabaseClient,
  userId: string,
  grantId: string | null,
): Promise<{ caller: PressMcpCaller; error: null } | { caller: null; error: string }> {
  const { data } = await admin.auth.admin.getUserById(userId);
  const who = await pressTourCaller(admin, data?.user ?? null);
  if (who.error !== null) return { caller: null, error: who.error };
  if (who.caller.via === "trial") return { caller: null, error: PRESS_MCP_TRIAL_ONLY };
  return { caller: { userId: who.caller.userId, via: who.caller.via, grantId }, error: null };
}

/** Everything service.ts needs for one caller. */
export async function pressDeps(caller: PressMcpCaller, origin: string): Promise<PressDeps> {
  const admin = createAdminClient();
  const campaignCaller: service.CampaignCaller = { userId: caller.userId, via: caller.via };
  // The door's own dependencies, with the service role standing in for the
  // missing session (the person's allowance, their bonus and purchased
  // spends: core.ts already spends those through the service role).
  const deps = campaignDeps(campaignCaller, admin);
  const canSpend = service.campaignGate(campaignCaller) === null;
  // Filming from the card opens with Cut 4's own switch (press_tour_film and
  // a priced lane: film.ts readFilmOpening), read fail-closed. Closed, the
  // card's Approve records the choices and says filming continues in Picacho.
  const opening = deps.filmDoor ? await deps.filmDoor.opening().catch(() => ({ open: false })) : { open: false };
  const engine: PressEngine = {
    plan: (input) => service.planCampaign(deps, campaignCaller, { ...input, source: "mcp" }),
    paint: (input) => service.paintStills(deps, campaignCaller, input),
    approve: (input) => service.approveStill(deps, campaignCaller, input),
    keep: (input) => service.keepStill(deps, campaignCaller, input),
    get: (input) => service.getCampaign(deps, campaignCaller, input),
    film: opening.open && canSpend ? (input) => service.filmShots(deps, campaignCaller, input) : null,
    importProduct: async ({ url, brandKitId }) => {
      const read = await importProductFromUrl(
        { db: admin, rateLimited, hashKey: hashedRateKey },
        { userId: caller.userId, via: caller.via },
        { url, brandKitId },
      );
      if (read.error !== null) return { error: read.error };
      return { error: null, card: read.card, labelCandidates: read.labelCandidates };
    },
    canSpend,
  };
  return { db: admin, engine, origin, repaintCredits: repaintCredits() };
}
