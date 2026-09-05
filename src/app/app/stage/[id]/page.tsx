import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getServerMessages } from "@/lib/i18n/server";
import { getAngleStage } from "@/lib/generations/angle-stage";
import { AngleStageView } from "@/components/angle-stage-view";

// The Angle Stage page (2026-09-05): one take's 3D stage. Everything the
// client view needs — the still, the proxy, the frames, the plan facts —
// arrives from getAngleStage in one call, so the page paints its real state
// immediately instead of a loading shell.

// Server actions run under the CALLING route's function budget, and the
// render submit awaits runGeneration the same way the composer does — the
// same 300s the generate page declares, or a long Kling render would be cut
// off mid-charge. (Hobby-plan maximum; see generate/page.tsx.)
export const maxDuration = 300;
export default async function AngleStagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const { t } = await getServerMessages();
  const s = t.stage;
  const stage = await getAngleStage(id);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
          {s.eyebrow}
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-atelier-ink">{s.title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-atelier-muted">{s.subtitle}</p>
      </div>

      {stage.error !== null ? (
        <p className="text-sm text-atelier-muted">{stage.error}</p>
      ) : !stage.eligible ? (
        <div className="space-y-3 rounded-media border border-atelier-rule bg-atelier-surface p-6">
          <p className="text-sm text-atelier-ink">{s.notEligible}</p>
          <Link
            href="/app/settings?tab=usage"
            className="inline-block cursor-pointer text-sm font-medium text-atelier-accent underline underline-offset-2 hover:text-atelier-accent/80"
          >
            {s.upgradeCta}
          </Link>
        </div>
      ) : (
        <AngleStageView
          generationId={id}
          stillUrl={stage.stillUrl}
          characterProfileId={stage.characterProfileId}
          initialProxyUrl={stage.proxyUrl}
          initialFrames={stage.frames}
          framesLimit={stage.framesLimit}
          stagedThisMonth={stage.stagedThisMonth}
          monthlyLimit={stage.monthlyLimit}
        />
      )}
    </div>
  );
}
