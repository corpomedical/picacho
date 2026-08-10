import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { GenerateForm } from "@/components/generate-form";
import { getGenerateWorkspaceData } from "@/lib/generations/workspace-data";
import { getServerMessages } from "@/lib/i18n/server";
import { formatMsg } from "@/lib/i18n/format";

// This page hosts the same GenerateForm composer as /app/generate (hero
// mode — see the comment on GenerateForm below), so a generation can be
// kicked off from here too. It needs the same run-time ceiling as
// /app/generate/page.tsx — see the longer comment there for why 300 (not
// the 800 we'd actually want) is what's set here.
export const maxDuration = 300;

export default async function AppHome() {
  const { t } = await getServerMessages();
  const d = t.dashboard;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  const [{ data: profile }, workspace] = await Promise.all([
    supabase
      .from("profiles")
      .select("username, plan, role, has_completed_onboarding")
      .eq("id", data.user?.id ?? "")
      .single(),
    getGenerateWorkspaceData(supabase, data.user?.id),
  ]);

  const {
    hasCharacter,
    charactersForForm,
    videoModels,
    defaultVideoModelId,
    elitePlanActive,
    multiAngleAvailable,
    approachingLimit,
    voiceModeEnabled,
    creditsUsed,
    creditsLimit,
    purchasedCredits,
    currentPeriodEnd,
  } = workspace;
  const name = profile?.username ?? (data.user?.email ?? "").split("@")[0];

  if (!hasCharacter) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
        <h1 className="text-2xl font-semibold text-neutral-900">{formatMsg(d.greeting, { name })}</h1>
        <p className="mt-2 max-w-sm text-sm text-neutral-500">{d.setupCharacterBody}</p>
        <Link href="/app/character/new" className="mt-6">
          <Button>{d.setupCharacterCta}</Button>
        </Link>
      </div>
    );
  }

  return (
    <div>
      {!elitePlanActive && (
        <div className="flex justify-end">
          <Link href="/app/settings?tab=usage">
            <Button size="sm">{t.settings.upgrade}</Button>
          </Link>
        </div>
      )}
      {/* Same component /app/generate uses, just starting in hero mode —
          a plain greeting + composer with no header/character-picker/card
          chrome. The instant the first message is sent it docks into the
          exact Generate layout in place, no navigation involved. See
          isHero in generate-form.tsx. */}
      <GenerateForm
        characters={charactersForForm}
        videoModels={videoModels}
        defaultVideoModelId={defaultVideoModelId}
        elitePlanActive={elitePlanActive}
        multiAngleAvailable={multiAngleAvailable}
        approachingLimit={approachingLimit}
        voiceModeEnabled={voiceModeEnabled}
        creditsUsed={creditsUsed}
        creditsLimit={creditsLimit}
        purchasedCredits={purchasedCredits}
        currentPeriodEnd={currentPeriodEnd}
        heroMode
        greeting={formatMsg(d.greetingWithPrompt, { name })}
        startOnboarding={profile?.has_completed_onboarding !== true}
      />
    </div>
  );
}
