import { after } from "next/server";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getReliabilityStats, reapAbandonedGenerations } from "@/lib/generations/actions";
import { getGenerateWorkspaceData } from "@/lib/generations/workspace-data";
import { GenerateForm } from "@/components/generate-form";
import { TranscriptToggle } from "@/components/transcript-toggle";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getServerMessages } from "@/lib/i18n/server";
import { isNativeApp } from "@/lib/native/server";
import { allowExternalPurchaseLink } from "@/lib/native/external-purchase";

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
  // after(), not a bare void: on Vercel the function can freeze the moment
  // the response streams out, so fire-and-forget housekeeping — which here
  // includes refund and cancel work — could be suspended mid-flight
  // (2026-08-31 inspection). after() keeps the invocation alive until the
  // promise settles, and still never delays rendering the page.
  after(
    // .catch, not a bare promise: a rejection handed to after() otherwise
    // surfaces as an unhandled error in the render's own lifetime — exactly
    // the class of invisible server-side failure behind the React #419
    // reports (the Suspense boundary dies server-side, the client re-renders,
    // and the error reporter files a minified mystery). Housekeeping must
    // never be able to poison the page render.
    reapAbandonedGenerations().catch((err) => {
      console.error("reapAbandonedGenerations failed:", err);
    }),
  );

  const {
    hasCharacter,
    charactersForForm,
    videoModels,
    defaultVideoModelId,
    advancedPlanActive,
    multiAngleAvailable,
    approachingLimit,
    voiceModeEnabled,
    chatAgentEnabled,
    chatSmarterAvailable,
    creditsUsed,
    creditsLimit,
    purchasedCredits,
    currentPeriodEnd,
    hasCompletedOnboarding,
    plan,
    bonusCredits,
    freeGenerationLastAt,
  } = await getGenerateWorkspaceData(supabase, userData.user?.id);

  // The composer walkthrough used to auto-start on /app, when the composer
  // lived there in hero mode. /app is a dashboard now, so the walkthrough's
  // home is here — the first time someone actually faces these controls.
  // The profile columns this page needs ride on getGenerateWorkspaceData's
  // own profile read now — this was a second, sequential profiles query for
  // four columns the first one could carry (2026-08-31 inspection).
  const onboardingProfile = {
    has_completed_onboarding: hasCompletedOnboarding,
    plan,
    bonus_credits: bonusCredits,
    free_generation_last_at: freeGenerationLastAt,
  };

  // Free-tier accounts get one generation per UTC day; whether today's slot
  // is still open drives the composer's "uses today's free generation"
  // notice (guardrail after the 2026-08-21 confused-new-user incident).
  // Mirrors canGenerate's read in lib/generations/core.ts — display only,
  // the RPC's guarded UPDATE remains the source of truth on spend.
  const utcDayStart = new Date();
  utcDayStart.setUTCHours(0, 0, 0, 0);
  const onDailyFreeTier =
    (onboardingProfile?.plan ?? "none") === "none" && (onboardingProfile?.bonus_credits ?? 0) === 0;
  const dailyFreeAvailable =
    onDailyFreeTier &&
    (!onboardingProfile?.free_generation_last_at ||
      new Date(onboardingProfile.free_generation_last_at) < utcDayStart);

  if (!hasCharacter) {
    return (
      <div className="mx-auto max-w-md text-center">
        <Card>
          <h1 className="text-lg font-semibold text-atelier-ink">{g.noCharacterTitle}</h1>
          <p className="mt-2 text-sm text-atelier-muted">{g.noCharacterBody}</p>
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
      {/* Reader mode: no purchase entry points in the iOS/Android shell
          (Apple 3.1.1 / Play payments policy — see lib/native/platform.ts).
          This CTA was added with the repricing work, after the original
          native-gating pass, and shipped ungated — caught live on the Play
          internal build, 2026-08-20. */}
      {!advancedPlanActive && !(await isNativeApp()) && (
        <div className="mb-3 flex justify-end">
          <Link href="/app/settings?tab=usage">
            <Button size="sm">{t.settings.upgrade}</Button>
          </Link>
        </div>
      )}
      {/* The approved board's header: title with the Session transcript
          affordance beside it, and the stats as BASELINE pairs (number,
          then its label to the right) — no rule under the row, no divider
          except the one that sets Credits apart. */}
      {/* flex-wrap + whitespace-nowrap labels: on phone widths the three
          stat pairs cannot share a line with the title, and a label that
          wraps INSIDE its pair leaves the numeral stranded against the
          first baseline — the "number aligned top" report from the native
          shell (operator, 2026-09-02). Pairs now wrap as whole units, so
          number and label always sit on one baseline; the credits divider
          only draws at sm+, where the row is genuinely one line. */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="flex items-baseline gap-3.5">
          <h1 className="text-xl font-semibold tracking-tight text-atelier-ink">{g.pageTitle}</h1>
          <TranscriptToggle label={g.sessionTranscript} />
        </div>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 sm:gap-x-[26px]">
          {stats.total > 0 && (
            <>
              <div className="flex items-baseline gap-[7px]">
                <span className="font-numeral text-[17px] font-semibold tabular-nums text-atelier-ink">{stats.firstTryRate}%</span>
                <span className="whitespace-nowrap text-[10px] font-medium uppercase tracking-widest text-atelier-muted">{g.firstTrySuccess}</span>
              </div>
              <div className="flex items-baseline gap-[7px]">
                <span className="font-numeral text-[17px] font-semibold tabular-nums text-atelier-ink">{stats.avgAttempts}</span>
                <span className="whitespace-nowrap text-[10px] font-medium uppercase tracking-widest text-atelier-muted">{g.avgAttempts}</span>
              </div>
            </>
          )}
          {/* Credits in the header — the ochre-numeral proof idiom. Display
              only, same formula the composer's affordability check uses
              (creditsAvailable in generate-form.tsx); the server
              re-validates every spend, so this can never oversell. Not a
              purchase entry point, so no native gating needed. */}
          <div className={`flex items-baseline gap-[7px] ${stats.total > 0 ? "sm:border-l sm:border-atelier-rule sm:pl-[26px]" : ""}`}>
            <span className="font-numeral text-[17px] font-semibold tabular-nums text-atelier-accent">
              {Math.max(0, creditsLimit - creditsUsed) + purchasedCredits}
            </span>
            <span className="whitespace-nowrap text-[10px] font-medium uppercase tracking-widest text-atelier-muted">{g.creditsLabel}</span>
          </div>
        </div>
      </div>

      <GenerateForm
        startOnboarding={onboardingProfile?.has_completed_onboarding !== true}
        characters={charactersForForm}
        videoModels={videoModels}
        defaultVideoModelId={defaultVideoModelId}
        advancedPlanActive={advancedPlanActive}
        multiAngleAvailable={multiAngleAvailable}
        approachingLimit={approachingLimit}
        voiceModeEnabled={voiceModeEnabled}
        chatAgentEnabled={chatAgentEnabled}
        chatSmarterAvailable={chatSmarterAvailable}
        creditsUsed={creditsUsed}
        creditsLimit={creditsLimit}
        purchasedCredits={purchasedCredits}
        currentPeriodEnd={currentPeriodEnd}
        allowExternalPurchase={await allowExternalPurchaseLink()}
        dailyFreeAvailable={dailyFreeAvailable}
        hasGeneratedBefore={stats.total > 0}
      />
    </div>
  );
}
