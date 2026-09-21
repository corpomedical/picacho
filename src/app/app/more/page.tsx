import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getServerMessages } from "@/lib/i18n/server";
import { isNativeApp } from "@/lib/native/server";
import { isSetsEnabled } from "@/lib/sets/enabled";
import { setsEligible } from "@/lib/sets/set-config";
import { PLAN_LABELS, type PlanId } from "@/lib/plans";
import { MoreView } from "@/components/more-view";

// The app bar's fifth tab (2026-09-21): see components/more-view.tsx.
export default async function MorePage() {
  const { t } = await getServerMessages();
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, username, plan, role")
    .eq("id", data.user.id)
    .maybeSingle();

  const plan = ((profile?.plan as PlanId | null) ?? "none") as PlanId;
  const isAdmin = profile?.role === "admin";
  // Helios 3D is listed only where the sidebar lists it: its flag on, and a
  // plan (or an admin) that includes it. Admins skip nothing here; the flag
  // read happens only for accounts that could see it.
  const setsVisible = setsEligible(plan, isAdmin) && (await isSetsEnabled(supabase));
  const native = await isNativeApp();

  const username = profile?.username ?? null;
  const name = profile?.full_name?.trim() || username || (data.user.email ?? "").split("@")[0];
  const planLabel = plan === "none" ? t.moreHub.noPlan : PLAN_LABELS[plan];

  return (
    <MoreView
      t={t}
      identity={{ name, username, planLabel }}
      native={native}
      setsVisible={setsVisible}
      shareUrl={username ? `https://picacho.ai/r/${username}` : "https://picacho.ai"}
    />
  );
}
