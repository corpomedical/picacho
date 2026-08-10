import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getReliabilityStats } from "@/lib/generations/actions";
import { getGenerateWorkspaceData } from "@/lib/generations/workspace-data";
import { GenerateForm } from "@/components/generate-form";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getServerMessages } from "@/lib/i18n/server";

// Video generation (Kling, via fal.ai) polls fal.ai's queue API for up to
// 10 minutes per attempt (see MAX_WAIT_MS in providers/fal.ts) before giving
// up and cancelling. On top of that, optional dialogue post-processing
// (ElevenLabs speech + Sync Labs lipsync) can add up to another 3 minutes —
// so the real worst case is close to 13 minutes.
//
// 300 is set here because that's the hard ceiling Vercel enforces on the
// Hobby plan (confirmed by an actual failed deploy on 2026-08-08 — Vercel
// rejected 800 outright with "must have a maxDuration between 1 and 300 for
// plan hobby"). This covers the common case (a single video, no dialogue)
// but a long multi-angle or dialogue-heavy generation can still get killed
// mid-flight without warning the user, and fal.ai's side of the job keeps
// running (and billing) even after we've abandoned it.
//
// Upgrading to Vercel Pro + enabling Fluid Compute raises the ceiling back
// to 800s — worth doing once there's real usage, or sooner if "generation
// timed out" reports start coming in from longer jobs.
export const maxDuration = 300;

export default async function GeneratePage() {
  const { t } = await getServerMessages();
  const g = t.generate;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();

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
    currentPeriodEnd,
  } = await getGenerateWorkspaceData(supabase, userData.user?.id);

  if (!hasCharacter) {
    return (
      <div className="mx-auto max-w-md text-center">
        <Card>
          <h1 className="text-lg font-semibold text-neutral-900">{g.noCharacterTitle}</h1>
          <p className="mt-2 text-sm text-neutral-500">{g.noCharacterBody}</p>
          <Link href="/app/character/new" className="mt-6 block">
            <Button className="w-full">{g.noCharacterCta}</Button>
          </Link>
        </Card>
      </div>
    );
  }

  const stats = userData.user
    ? await getReliabilityStats(userData.user.id)
    : { firstTryRate: null, avgAttempts: null, total: 0 };

  return (
    <div className="mx-auto max-w-2xl">
      {!elitePlanActive && (
        <div className="mb-3 flex justify-end">
          <Link href="/app/settings?tab=usage">
            <Button size="sm">{t.settings.upgrade}</Button>
          </Link>
        </div>
      )}
      <div className="mb-7 flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900">Generate</h1>
        {stats.total > 0 && (
          <div className="flex gap-2">
            <div className="rounded-[14px] border border-neutral-100 bg-neutral-50 px-3.5 py-2 text-right">
              <p className="text-base font-semibold text-neutral-900">{stats.firstTryRate}%</p>
              <p className="text-[11px] text-neutral-500">first-try success</p>
            </div>
            <div className="rounded-[14px] border border-neutral-100 bg-neutral-50 px-3.5 py-2 text-right">
              <p className="text-base font-semibold text-neutral-900">{stats.avgAttempts}</p>
              <p className="text-[11px] text-neutral-500">avg. attempts</p>
            </div>
          </div>
        )}
      </div>

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
        currentPeriodEnd={currentPeriodEnd}
      />
    </div>
  );
}
