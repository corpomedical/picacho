import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { toMediaUrl, isRenderableUrl } from "@/lib/media/url";
import {
  availableUpscaleTiers,
  takeSourceHeight,
  takeUpscaleIneligibility,
  upscaleCreditCost,
  UPSCALE_TIERS,
} from "@/lib/generations/upscale";
import { UpscaleUpload } from "@/components/upscale-upload";
import { UpscaleButton } from "@/components/upscale-button";
import { QuietVideo } from "@/components/quiet-video";
import { getServerMessages } from "@/lib/i18n/server";
import { formatMsg } from "@/lib/i18n/format";

// The Upscale page (operator placement pick, 2026-09-03): nested under
// Generate in the sidebar, and the permanent home of the upload lane —
// which used to hide behind a History-header button nobody passed. Content
// is design board B: the upload well first, then a grid of recent takes
// each quoting both honest tiers before a single tap. Every entry point
// opens the same receipt sheet; eligibility and prices come from the same
// module the server action re-runs before taking money.
export default async function UpscalePage() {
  const { t } = await getServerMessages();
  const h = t.history;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  // Recent finished videos that could be upscale sources. Over-fetch a bit,
  // then run the real eligibility rule — cheaper than teaching PostgREST
  // the duration cap and the no-upscaling-an-upscale rule separately.
  const { data: recent } = await supabase
    .from("generations")
    .select(
      "id, prompt_input, status, content_type, video_duration_seconds, video_model_id, result_url, source_generation_id, created_at",
    )
    .eq("user_id", userData.user.id)
    .eq("content_type", "video")
    .eq("status", "succeeded")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(16);

  const takes = (recent ?? [])
    .filter((g) => takeUpscaleIneligibility(g) === null)
    .map((g) => ({
      id: g.id as string,
      prompt: (g.prompt_input as string | null) ?? "",
      seconds: g.video_duration_seconds as number,
      url: toMediaUrl(g.result_url as string | null),
      tiers: availableUpscaleTiers(takeSourceHeight(g.video_model_id as string | null)),
    }))
    .filter((g) => g.tiers.length > 0 && isRenderableUrl(g.url))
    .slice(0, 8);

  return (
    <div className="mx-auto max-w-4xl">
      <p className="text-[11px] font-medium uppercase tracking-widest text-atelier-muted">
        {h.upscalePageEyebrow}
      </p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight text-atelier-ink">{t.nav.upscale}</h1>
      <p className="mt-1 text-sm text-atelier-muted">{h.upscalePageSub}</p>

      <div className="mt-6">
        <UpscaleUpload variant="well" />
      </div>

      {takes.length > 0 && (
        <>
          <div className="mt-8 flex items-center gap-3.5">
            <p className="whitespace-nowrap text-[11px] font-medium uppercase tracking-widest text-atelier-muted">
              {h.upscalePagePick}
            </p>
            <div className="h-px flex-1 bg-atelier-rule" />
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {takes.map((take) => (
              <div
                key={take.id}
                className="flex flex-col rounded-control border border-atelier-rule bg-atelier-surface p-3 shadow-[0_1px_2px_rgba(33,29,22,0.04)]"
              >
                <div className="relative aspect-video overflow-hidden rounded-[10px] bg-atelier-stage">
                  <QuietVideo
                    pending="spinner"
                    src={take.url!}
                    className="h-full w-full object-cover"
                    aria-label={take.prompt}
                  />
                  <span className="absolute bottom-1.5 right-1.5 rounded-full bg-[#1b1c20]/70 px-2 py-0.5 font-numeral text-[11px] tabular-nums text-[#f7f6f4]/85">
                    {take.seconds}s
                  </span>
                </div>
                <p className="mt-2.5 min-w-0 truncate text-xs font-medium text-atelier-ink">
                  {take.prompt}
                </p>
                <p className="mt-1 font-numeral text-[11px] tabular-nums text-atelier-muted">
                  {take.tiers
                    .map(
                      (tier) =>
                        `${UPSCALE_TIERS[tier].label} ${formatMsg(t.generate.creditsShortN, {
                          n: upscaleCreditCost(take.seconds, tier),
                        })}`,
                    )
                    .join(" · ")}
                </p>
                <div className="mt-2.5">
                  <UpscaleButton generationId={take.id} seconds={take.seconds} tiers={take.tiers} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="mt-6 text-xs text-atelier-muted">{h.upscalePageNote}</p>
    </div>
  );
}
