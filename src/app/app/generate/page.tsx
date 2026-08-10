import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getReliabilityStats, reapAbandonedGenerations } from "@/lib/generations/actions";
import { getGenerateWorkspaceData } from "@/lib/generations/workspace-data";
import { GenerateForm } from "@/components/generate-form";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getServerMessages } from "@/lib/i18n/server";

// No longer the constraint it used to be.
//
// This page used to hold a single server action open for an entire video
// render. A Kling job takes six to ten minutes and dialogue post-processing
// (ElevenLabs speech + Sync Labs lipsync) added up to three more, against a
// hard 300s ceiling Vercel enforces on the Hobby plan — confirmed by a failed
// deploy on 2026-08-08, where Vercel rejected 800 outright with "must have a
// maxDuration between 1 and 300 for plan hobby". Long jobs were therefore run
// and billed on fal.ai's side and then killed on ours before the result could
// be saved. Multi-angle and storyboard, the longest jobs of all, had never
// once completed.
//
// Renders are now handed to fal.ai's queue and advanced by short polls
// instead (see lib/generations/job-runner.ts), so nothing here runs for more
// than a few seconds and the ceiling stops mattering. 300 is kept purely as
// headroom for the prompt-refinement calls that still happen inline, which
// take tens of seconds at worst.
//
// The upgrade to Vercel Pro is consequently no longer needed to make long
// generations work.
export const maxDuration = 300;

export default async function GeneratePage() {
  const { t } = await getServerMessages();
  const g = t.generate;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();

  // Tidy up renders that were abandoned mid-flight — tab closed, phone died,
  // person walked away. Cancels them on fal.ai so we stop paying for output
  // nobody will collect, and refunds the credits.
  //
  // Done here on page load rather than from a cron because Vercel's Hobby plan
  // allows only one cron run per day, which is far too coarse. Deliberately
  // not awaited: this is housekeeping for jobs that are already half an hour
  // stale, and it must never delay rendering the page.
  void reapAbandonedGenerations();

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
    // max-w-5xl matches both the app layout's container and the width the
    // composer settles at after docking from /app. It used to be max-w-2xl,
    // which meant this page was 672px when visited directly but 1024px when
    // reached by submitting from the home page — the same screen at two
    // different widths depending on how you got there.
    <div className="mx-auto max-w-5xl">
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
        purchasedCredits={purchasedCredits}
        currentPeriodEnd={currentPeriodEnd}
      />
    </div>
  );
}
