import { notFound, redirect } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { isPressTourEnabled, pressTourEmailError, readPressTourSwitches } from "@/lib/press-tour/enabled";
import { getPressTourHome } from "@/lib/press-tour/door-data";
import { networkStates } from "@/lib/press-tour/door-view";
import type { CampaignActions } from "@/lib/press-tour/campaign-types";
import { isNetwork, type PublishActions } from "@/lib/press-tour/publish-types";
import type { WaitlistActions } from "@/lib/press-tour/waitlist";
import { CONNECT_ERROR_CODES, type ConnectErrorCode } from "@/lib/social/messages";
import {
  approveStill,
  assembleNow,
  cancelCampaign,
  cutShot,
  filmShots,
  getCampaign,
  keepStill,
  keepTake,
  paintStills,
  planCampaign,
  refilmShot,
  repaintStill,
  undoStill,
} from "@/lib/press-tour/campaign-actions";
import {
  cancelPost,
  connectStart,
  consentAndPost,
  consentAndSchedule,
  disconnect,
  listConnections,
  listPosts,
  prepareTikTokSheet,
  previewPost,
} from "@/lib/press-tour/publish-actions";
import { readWaitlist, setWaitlist } from "@/lib/press-tour/waitlist-actions";
import { PressTourDoor } from "@/components/press-tour/press-tour-door";
import type { ConnectNote } from "@/components/press-tour/press-line";

// PRESS TOUR (2026-09-26; operator, 2026-09-25: "Lets build this, and break
// the internet with what we offer."): an ad for the person's product,
// starring their character. Its own page, a pinned row under Tools on the
// web and a choice in the phone's lamp beside Generate Video and Recast.
//
// Admins only while it is built, behind the press_tour switch
// (lib/press-tour/enabled.ts, which also needs every provider key it calls);
// to anyone else this page does not exist. The plans and the free trial ad
// open in later cuts, through pressTourAllowed, once their own switches are
// on. The order is the rule: who, then the switch, then any read.
//
// The door carries no purchase path (reader mode inside the app): prices
// are the server's quote, printed as it is sent.
//
// The door's actions run inside this route: reading a product from its page
// (up to 16 pictures, the product read and the label reading in turn) and
// planning an ad. The route declares the budget that needs.
export const maxDuration = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Search = { campaign?: string | string[]; connected?: string | string[]; connect_error?: string | string[]; network?: string | string[] };
const one = (v: string | string[] | undefined): string | null => (typeof v === "string" ? v : null);

/**
 * The address's own words, read as codes and never as text: the ad a link
 * names (the card inside Claude or ChatGPT links ?campaign=<id>; the engine
 * still checks it is the person's own), and a connect's answer on the way
 * back from a network (?connected=<network> or ?connect_error=<code>).
 */
function fromAddress(sp: Search): { campaignId: string | null; connectNote: ConnectNote | null } {
  const campaign = one(sp.campaign);
  const campaignId = campaign && UUID_RE.test(campaign) ? campaign.toLowerCase() : null;
  const connected = one(sp.connected);
  if (isNetwork(connected)) return { campaignId, connectNote: { network: connected, outcome: "connected" } };
  const code = one(sp.connect_error);
  const network = one(sp.network);
  if (code && isNetwork(network) && (CONNECT_ERROR_CODES as readonly string[]).includes(code)) {
    return { campaignId, connectNote: { network, outcome: code as ConnectErrorCode } };
  }
  return { campaignId, connectNote: null };
}

export default async function PressTourPage({ searchParams }: { searchParams: Promise<Search> }) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");
  const userId = userData.user.id;

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (profile?.role !== "admin") notFound();
  if (!(await isPressTourEnabled(supabase))) notFound();

  const [home, switches] = await Promise.all([
    getPressTourHome({ db: supabase, admin: createAdminClient() }, userId),
    readPressTourSwitches(supabase),
  ]);

  // The engine's server actions, by the contract's names (campaign-types.ts
  // CampaignActions): the door is written against the contract alone.
  const actions: CampaignActions = {
    planCampaign,
    paintStills,
    approveStill,
    keepStill,
    undoStill,
    repaintStill,
    getCampaign,
    cancelCampaign,
    // Cut 4 (film -> press wall -> cut), behind press_tour_film.
    filmShots,
    keepTake,
    refilmShot,
    cutShot,
    assembleNow,
  };

  // Posting's actions (Cut 5), by publish-types.ts's names; every one checks
  // its own switch and the person again on the server.
  const publish: PublishActions = {
    listConnections,
    connectStart,
    disconnect,
    prepareTikTokSheet,
    previewPost,
    consentAndPost,
    consentAndSchedule,
    cancelPost,
    listPosts,
  };
  const waitlist: WaitlistActions = { readWaitlist, setWaitlist };
  const address = fromAddress(await searchParams);

  return (
    <PressTourDoor
      characters={home.characters}
      products={home.products}
      brandKits={home.brandKits}
      openCampaignId={address.campaignId ?? home.openCampaignId}
      emailConfirmed={pressTourEmailError(userData.user) === null}
      networks={networkStates(switches)}
      actions={actions}
      publish={publish}
      waitlist={waitlist}
      connectNote={address.connectNote}
    />
  );
}
