import { notFound, redirect } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { isPressTourEnabled, pressTourEmailError, readPressTourSwitches } from "@/lib/press-tour/enabled";
import { getPressTourHome } from "@/lib/press-tour/door-data";
import { networkStates } from "@/lib/press-tour/door-view";
import type { CampaignActions } from "@/lib/press-tour/campaign-types";
import {
  approveStill,
  cancelCampaign,
  getCampaign,
  keepStill,
  paintStills,
  planCampaign,
  repaintStill,
  undoStill,
} from "@/lib/press-tour/campaign-actions";
import { PressTourDoor } from "@/components/press-tour/press-tour-door";

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

export default async function PressTourPage() {
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
  };

  return (
    <PressTourDoor
      characters={home.characters}
      products={home.products}
      brandKits={home.brandKits}
      openCampaignId={home.openCampaignId}
      emailConfirmed={pressTourEmailError(userData.user) === null}
      networks={networkStates(switches)}
      actions={actions}
    />
  );
}
