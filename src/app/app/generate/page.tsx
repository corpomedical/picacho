import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getReliabilityStats } from "@/lib/generations/actions";
import { getGenerateWorkspaceData } from "@/lib/generations/workspace-data";
import { GenerateForm } from "@/components/generate-form";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getServerMessages } from "@/lib/i18n/server";

// Video generation (Kling, via fal.ai) now polls fal.ai's queue API for up
// to 10 minutes per attempt (see MAX_WAIT_MS in providers/fal.ts) before
// giving up and cancelling — raised from a 180s client timeout after that
// shorter timeout caused us to abandon (and re-bill) jobs that were still
// running server-side. On top of that, optional dialogue post-processing
// (ElevenLabs speech + Sync Labs lipsync) can add up to another 3 minutes.
// 800s is Vercel's own ceiling for a Pro plan with Fluid Compute enabled —
// set this to the max allowed rather than a number we picked, since a
// generation that's legitimately still running must never be killed by our
// own platform config.
//
// IMPORTANT before deploying to Vercel: Fluid Compute must be turned on for
// this project. Without it, Hobby caps at 10s and Pro caps at 300s (5 min)
// — both well under what a real video generation needs, which would bring
// back the exact "killed while still running, billed anyway" problem this
// was meant to fix.
export const maxDuration = 800;

export default async function GeneratePage() {
  const { t } = await getServerMessages();
  const g = t.generate;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();

  const { hasCharacter, charactersForForm, videoModels, defaultVideoModelId, elitePlanActive, approachingLimit } =
    await getGenerateWorkspaceData(supabase, userData.user?.id);

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
        approachingLimit={approachingLimit}
      />
    </div>
  );
}
