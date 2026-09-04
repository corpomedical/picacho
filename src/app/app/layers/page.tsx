import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { toMediaUrl, thumbUrl, isRenderableUrl } from "@/lib/media/url";
import { LAYERS_MODEL_ID, LAYERS_TIERS, layersCreditCost, takeLayersIneligibility } from "@/lib/generations/layers";
import { LayersUpload } from "@/components/layers-upload";
import { LayersButton } from "@/components/layers-button";
import { getServerMessages } from "@/lib/i18n/server";
import { formatMsg } from "@/lib/i18n/format";

// The Layers page (shape B, 2026-09-03), the Upscale page's shape: the
// upload well first, then a grid of recent images each quoting both tiers
// before a single tap, then the splits already made. Eligibility and prices
// come from the same module the server action re-runs before taking money.
export default async function LayersPage() {
  const { t } = await getServerMessages();
  const L = t.layers;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  // Two independent owner-scoped reads, one round trip; the eligibility
  // rule's cheap halves pushed into SQL so we do not over-fetch to filter.
  const [{ data: recent }, { data: splits }] = await Promise.all([
    supabase
      .from("generations")
      .select("id, prompt_input, status, content_type, model_id, result_url, source_generation_id, created_at, character_profile_id, match_score")
      .eq("user_id", userData.user.id)
      .eq("content_type", "image")
      .eq("status", "succeeded")
      .not("result_url", "is", null)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      // NO SQL FILTER ON model_id, and that is the whole point: `model_id
      // <> 'seedream-layerize'` is NULL — not true — for every row written
      // before that column existed, so PostgREST dropped them. It hid 45 of
      // this account's 47 images and left two to choose from (2026-09-04).
      // takeLayersIneligibility does the same comparison in JS, where
      // null === "seedream-layerize" is simply false and the row survives,
      // so the rule lives there and here we merely over-fetch a little.
      .limit(60),
    supabase
      .from("generations")
      .select("id, prompt_input, status, result_url, created_at")
      .eq("user_id", userData.user.id)
      .eq("model_id", LAYERS_MODEL_ID)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const sources = (recent ?? [])
    .filter((g) => takeLayersIneligibility(g) === null)
    .map((g) => ({
      id: g.id as string,
      prompt: (g.prompt_input as string | null) ?? "",
      url: toMediaUrl(g.result_url as string | null),
      // A split only carries identity forward if its source had a character:
      // that is what makes a later layer edit scoreable, so it is worth
      // seeing before spending rather than after.
      scored: Boolean(g.character_profile_id),
      score: (g.match_score as number | null) ?? null,
    }))
    .filter((g) => isRenderableUrl(g.url))
    // Was 8, copied from the Upscale page — where a handful of recent clips
    // genuinely is the shortlist. An image library is not: this account had
    // 47 finished images and saw eight of them. Anything older is reachable
    // from the image's own page in History, which now carries the action.
    .slice(0, 24);

  const priceLine = (["1k", "2k"] as const)
    .map((tier) => `${LAYERS_TIERS[tier].label} ${formatMsg(t.generate.creditsShortN, { n: layersCreditCost(tier) })}`)
    .join(" · ");

  return (
    <div className="mx-auto max-w-4xl">
      <p className="text-[11px] font-medium uppercase tracking-widest text-atelier-muted">{L.pageEyebrow}</p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight text-atelier-ink">{t.nav.layers}</h1>
      <p className="mt-1 text-sm text-atelier-muted">{L.pageSub}</p>

      <div className="mt-6">
        <LayersUpload />
      </div>

      {sources.length > 0 && (
        <>
          <div className="mt-8 flex items-center gap-3.5">
            <p className="whitespace-nowrap text-[11px] font-medium uppercase tracking-widest text-atelier-muted">{L.pagePick}</p>
            <div className="h-px flex-1 bg-atelier-rule" />
            <Link
              href="/app/images"
              className="whitespace-nowrap text-[11px] font-medium text-atelier-muted underline-offset-2 hover:text-atelier-ink hover:underline"
            >
              {L.pageAllImages}
            </Link>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {sources.map((src) => (
              <div key={src.id} className="flex flex-col rounded-control border border-atelier-rule bg-atelier-surface p-3 shadow-[0_1px_2px_rgba(33,29,22,0.04)]">
                <div className="relative aspect-square overflow-hidden rounded-[10px] bg-atelier-stage">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={thumbUrl(src.url, 640) ?? src.url!} alt={src.prompt} className="h-full w-full object-cover" loading="lazy" />
                </div>
                <p className="mt-2.5 min-w-0 truncate text-xs font-medium text-atelier-ink">{src.prompt}</p>
                <p className="mt-1 font-numeral text-[11px] tabular-nums text-atelier-muted">
                  {priceLine}
                  {src.scored && (
                    <span className="text-atelier-accent">
                      {" · "}
                      {L.sourceScored}
                      {src.score !== null ? ` ${src.score}` : ""}
                    </span>
                  )}
                </p>
                <div className="mt-2.5">
                  <LayersButton generationId={src.id} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {(splits ?? []).length > 0 && (
        <>
          <div className="mt-8 flex items-center gap-3.5">
            <p className="whitespace-nowrap text-[11px] font-medium uppercase tracking-widest text-atelier-muted">{L.stackTitle}</p>
            <div className="h-px flex-1 bg-atelier-rule" />
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(splits ?? []).map((g) => {
              const url = toMediaUrl(g.result_url as string | null);
              return (
                <Link
                  key={g.id as string}
                  href={`/app/layers/${g.id}`}
                  className="flex flex-col rounded-control border border-atelier-rule bg-atelier-surface p-3 shadow-[0_1px_2px_rgba(33,29,22,0.04)] transition-colors hover:border-atelier-muted"
                >
                  <div className="relative aspect-square overflow-hidden rounded-[10px] bg-atelier-stage">
                    {url && isRenderableUrl(url) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumbUrl(url, 640) ?? url} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[11px] text-atelier-muted">
                        {g.status === "failed" ? L.failed : L.working}
                      </div>
                    )}
                  </div>
                  <p className="mt-2.5 min-w-0 truncate text-xs font-medium text-atelier-ink">{(g.prompt_input as string | null) ?? ""}</p>
                </Link>
              );
            })}
          </div>
        </>
      )}

      <p className="mt-6 text-xs text-atelier-muted">{L.pageNote}</p>
    </div>
  );
}
