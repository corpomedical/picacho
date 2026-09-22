import { after } from "next/server";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getReliabilityStats, reapAbandonedGenerations } from "@/lib/generations/actions";
import { getGenerateWorkspaceData } from "@/lib/generations/workspace-data";
import { onDailyFreeTier, freeSlotOpen } from "@/lib/plans";
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

  // Black box for the first paint (2026-09-02): when this gather throws,
  // the stream dies inside a Suspense boundary and the client files a
  // minified React #419 with no cause — so name the cause and the user
  // here, where the function log can keep it, then rethrow unchanged.
  let workspaceData;
  try {
    workspaceData = await getGenerateWorkspaceData(supabase, userData.user?.id);
  } catch (err) {
    console.error(
      `[first-paint] /app/generate SSR failed for user ${userData.user?.id ?? "anonymous"}:`,
      err,
    );
    throw err;
  }
  const {
    hasCharacter,
    charactersForForm,
    videoModels,
    defaultVideoModelId,
    defaultAspectRatio,
    defaultVideoDurationSeconds,
    notifyRenderReady,
    notifyRenderFailed,
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
  } = workspaceData;

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
  // The shared eligibility from plans.ts — this page carried its own copy
  // of the tier test AND the UTC-midnight arithmetic (the audit's
  // five-copies finding). Display only; the RPC still owns the spend.
  const dailyFreeAvailable =
    onDailyFreeTier(onboardingProfile?.plan, onboardingProfile?.bonus_credits) &&
    freeSlotOpen(onboardingProfile?.free_generation_last_at);

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

  // Hoisted OUT of the JSX below, where both of these used to be awaited
  // inline. An await inside streamed JSX that throws kills the Suspense
  // boundary mid-stream, and the client files a minified React #419 naming
  // nothing — five of those have been reported since 2026-08-23, all with the
  // same digest, and none of them could say what failed. The gather above
  // already learned this lesson; these two were the remaining black box.
  //
  // Reaching them at all is new-account-shaped: everything above returns
  // early until the person has a character, so the first render of this full
  // tree is the one right after their first character is created — which is
  // exactly when both of 2026-09-07's signups reported it. The upgrade CTA
  // additionally short-circuits on `advancedPlanActive`, so a paid account
  // never evaluates isNativeApp() here and a plan-none account always does.
  let nativeApp = false;
  let allowExternalPurchase = false;
  try {
    [nativeApp, allowExternalPurchase] = await Promise.all([
      isNativeApp(),
      allowExternalPurchaseLink(),
    ]);
  } catch (err) {
    // Named, then swallowed rather than rethrown: neither value is worth
    // failing a paint over. nativeApp=false is the safe default for review
    // gating only in the sense that it SHOWS the CTA — but a person who
    // cannot see the composer at all is the worse outcome, and the log makes
    // the cause visible instead of a digest.
    console.error(
      `[first-paint] /app/generate chrome flags failed for user ${userData.user?.id ?? "anonymous"}:`,
      err,
    );
  }

  const creditsNow = Math.max(0, creditsLimit - creditsUsed) + purchasedCredits;
  // Reader mode: no purchase entry points in the iOS/Android shell (Apple
  // 3.1.1 / Play payments policy — see lib/native/platform.ts). This CTA was
  // added with the repricing work, after the original native-gating pass,
  // and shipped ungated — caught live on the Play internal build,
  // 2026-08-20.
  const upgradeVisible = !advancedPlanActive && !nativeApp;

  // The screen's header (md and up): the same title, transcript affordance
  // and stats, drawn over the Screening Room by GenerateForm instead of
  // sitting above it. Fixed warm literals, never theme tokens — the room is
  // dark in both themes, so ink would vanish in the light one.
  const screenHeader = (
    <div className="flex items-center gap-x-5">
      <h1 className="marquee flex-shrink-0 text-[17px] leading-none text-[#f3ede4]">{g.pageTitle}</h1>
      <TranscriptToggle label={g.sessionTranscript} tone="screen" />
      <div className="ml-auto flex items-baseline gap-x-[22px]">
        {stats.total > 0 && (
          <>
            <div className="flex items-baseline gap-[7px]">
              <span className="font-numeral text-[19px] font-semibold tabular-nums text-[#f3ede4]">{stats.firstTryRate}%</span>
              <span className="whitespace-nowrap text-[10px] font-medium uppercase tracking-widest text-[#cfc6b8]">{g.firstTrySuccess}</span>
            </div>
            <div className="flex items-baseline gap-[7px]">
              <span className="font-numeral text-[19px] font-semibold tabular-nums text-[#f3ede4]">{stats.avgAttempts}</span>
              <span className="whitespace-nowrap text-[10px] font-medium uppercase tracking-widest text-[#cfc6b8]">{g.avgAttempts}</span>
            </div>
          </>
        )}
        <div
          className={`flex items-baseline gap-[7px] ${stats.total > 0 ? "border-l border-[#f3ede4]/15 pl-[22px]" : ""}`}
        >
          {/* Credits — the ochre-numeral proof idiom. Display only, same
              formula the composer's affordability check uses
              (creditsAvailable in generate-form.tsx); the server
              re-validates every spend, so this can never oversell. */}
          <span className="font-numeral text-[19px] font-semibold tabular-nums text-[#e0a468]">{creditsNow}</span>
          <span className="whitespace-nowrap text-[10px] font-medium uppercase tracking-widest text-[#cfc6b8]">{g.creditsLabel}</span>
        </div>
      </div>
      {upgradeVisible && (
        <Link
          href="/app/settings?tab=usage"
          className="flex-shrink-0 rounded-control bg-[#f3ede4] px-3.5 py-[7px] text-[12.5px] font-semibold text-[#0e0c0a] transition-colors hover:bg-white"
        >
          {t.settings.upgrade}
        </Link>
      )}
    </div>
  );

  return (
    // The Screening Room's marker: from md up, globals.css hands this page
    // the whole content column (no max width, no padding, full height) and
    // GenerateForm draws the room edge to edge. The phone keeps the column
    // it always had — max-w-5xl matches the app layout's container and the
    // width the composer settles at.
    <div data-screening-generate className="mx-auto max-w-5xl md:h-full md:max-w-none">
      {upgradeVisible && (
        <div className="mb-3 flex justify-end md:hidden">
          <Link href="/app/settings?tab=usage">
            <Button size="sm">{t.settings.upgrade}</Button>
          </Link>
        </div>
      )}
      {/* The phone's header is GenerateForm's own now (the sheet,
          2026-09-22): ONE line — title, credits, and Session transcript +
          New chat as icon keys, since New chat needs the form's state —
          and the reliability pair rides the takes caption (phoneStats).
          md and up read screenHeader, drawn over the room. */}
      <GenerateForm
        screenHeader={screenHeader}
        phoneStats={stats}
        startOnboarding={onboardingProfile?.has_completed_onboarding !== true}
        characters={charactersForForm}
        videoModels={videoModels}
        defaultVideoModelId={defaultVideoModelId}
        defaultAspectRatio={defaultAspectRatio}
        defaultVideoDurationSeconds={defaultVideoDurationSeconds}
        notifyRenderReady={notifyRenderReady}
        notifyRenderFailed={notifyRenderFailed}
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
        allowExternalPurchase={allowExternalPurchase}
        dailyFreeAvailable={dailyFreeAvailable}
        hasGeneratedBefore={stats.total > 0}
      />
    </div>
  );
}
