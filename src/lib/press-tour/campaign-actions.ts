"use server";

// Press Tour's campaign actions, from the browser: the engine side of
// campaign-types.ts CampaignActions (spec §1.4-§1.6, §1.12; synthesis v2
// Cut 2). No UI here: the door, and later the Generate mode, call these.
//
// A thin door onto campaign-service.ts, which decides everything and is
// tested as it is (campaign-service.test.ts). Each action here does exactly
// three things, in this order, and nothing else:
//   1. who: the signed-in person, through card-service.ts pressTourCaller —
//      Press Tour switched on, the person allowed, and a CONFIRMED EMAIL
//      before anything can reach a paid call (critique #20). The service
//      then lets only admins plan or paint in this cut (admins first);
//   2. the real clients (campaign-runtime.ts): the service role for
//      press_campaigns (no policies for people, synthesis #30), the person's
//      own client for their allowance, rate-limit.ts for every budget, and
//      a kick that drives the machine after the answer is sent;
//   3. the campaign-service entry, which checks ownership, idempotency
//      (every spend carries a client-made sendId) and only then spends.
// An error nothing names is caught here, logged, and answered with one
// English sentence (every sentence is a constant i18n maps).
//
// The page that calls these needs `export const maxDuration = 300`:
// planning runs inline, and a kick paints stills after the answer.
//
// Every export of a "use server" file must be an async function; the shapes
// are imported from campaign-types.ts.

import { createClient } from "@/lib/supabase/server";
import { PRESS_TOUR_FAILED, pressTourCaller } from "./card-service";
import { campaignDeps } from "./campaign-runtime";
import * as service from "./campaign-service";
import type { CampaignResult, CampaignSource } from "./campaign-types";

type Door = { ok: true; caller: service.CampaignCaller; deps: service.CampaignDeps } | { ok: false; error: string };

async function door(): Promise<Door> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const who = await pressTourCaller(supabase, data.user);
  if (who.error !== null) return { ok: false, error: who.error };
  const caller = who.caller;
  const deps = campaignDeps(caller, supabase);
  return { ok: true, caller, deps };
}

async function behindDoor<T extends { ok: boolean }>(
  name: string,
  run: (caller: service.CampaignCaller, deps: service.CampaignDeps) => Promise<T>,
): Promise<T | { ok: false; error: string }> {
  try {
    const d = await door();
    if (!d.ok) return d;
    return await run(d.caller, d.deps);
  } catch (err) {
    console.error(`[press-tour] ${name} failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, error: PRESS_TOUR_FAILED };
  }
}

/** Only the door and the Generate mode call these from a browser; the Producer and MCP start campaigns on the server. */
function browserSource(source: CampaignSource | undefined): CampaignSource {
  return source === "generate" ? "generate" : "door";
}

/** Plan a new ad (free; counts against the day's plans). */
export async function planCampaign(input: {
  sendId: string;
  productId: string;
  characterId: string;
  brandKitId?: string | null;
  lengthSeconds?: 10 | 15 | 30;
  goal?: string;
  source?: CampaignSource;
}): Promise<CampaignResult> {
  return behindDoor("plan an ad", (caller, deps) => service.planCampaign(deps, caller, { ...input, source: browserSource(input?.source) }));
}

/** Paint the stills: charges the stills line of the quote, once, whatever the network does to the press. */
export async function paintStills(input: { sendId: string; campaignId: string }): Promise<CampaignResult> {
  return behindDoor("paint stills", (caller, deps) => service.paintStills(deps, caller, input));
}

export async function approveStill(input: { campaignId: string; shot: number }): Promise<CampaignResult> {
  return behindDoor("approve a still", (caller, deps) => service.approveStill(deps, caller, input));
}

export async function keepStill(input: { campaignId: string; shot: number }): Promise<CampaignResult> {
  return behindDoor("keep a still", (caller, deps) => service.keepStill(deps, caller, input));
}

export async function undoStill(input: { campaignId: string; shot: number }): Promise<CampaignResult> {
  return behindDoor("undo a still", (caller, deps) => service.undoStill(deps, caller, input));
}

/** Repaint one still at 1 credit (N4). */
export async function repaintStill(input: { sendId: string; campaignId: string; shot: number; note?: string }): Promise<CampaignResult> {
  return behindDoor("repaint a still", (caller, deps) => service.repaintStill(deps, caller, input));
}

export async function getCampaign(input: { campaignId: string }): Promise<CampaignResult> {
  return behindDoor("read a campaign", (caller, deps) => service.getCampaign(deps, caller, input));
}

/** Stop here: the stills stay in History; anything reserved and never painted comes back. */
export async function cancelCampaign(input: { campaignId: string }): Promise<CampaignResult> {
  return behindDoor("cancel a campaign", (caller, deps) => service.cancelCampaign(deps, caller, input));
}
