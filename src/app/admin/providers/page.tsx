import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { toggleFeatureFlag, setVideoModel, setImageModel, restoreModel, suspendModel } from "@/lib/admin/actions";
import { getAllModelHealth } from "@/lib/generations/model-health";
import {
  VIDEO_MODELS,
  pricingAudit,
  maxSingleRenderCostUsd,
  COST_BASIS_USD_PER_CREDIT,
} from "@/lib/generations/providers/video-models";
import { IMAGE_MODELS } from "@/lib/generations/providers/image-models";
import { isByteplusCapable, videoProviderFor } from "@/lib/generations/providers/video-provider";
import { ARK_USD_PER_MILLION_TOKENS } from "@/lib/generations/providers/byteplus";
import type { AttemptLog } from "@/lib/generations/pipeline";
import { getFalBalance, reconcileFalLedger } from "@/lib/generations/providers/fal-ledger";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AdminErrorBanner } from "@/components/admin-error-banner";
import { cn } from "@/lib/cn";

export default async function AdminProvidersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error: actionError } = await searchParams;

  // Re-checked here, not just in the admin layout: getAllModelHealth below
  // reads through the service role (model_health has no user-facing RLS
  // story), so this page verifies the caller's role itself rather than
  // trusting that the layout gate can never be sidestepped. requireAdmin()
  // can't live inside getAllModelHealth — the generation pipeline's circuit
  // breaker calls it with no admin (or any) session in scope.
  const { admin } = await requireAdmin();
  const supabase = await createClient();

  const [{ data: flag }, { data: modelSetting }, { data: imageModelSetting }] = await Promise.all([
    supabase.from("feature_flags").select("*").eq("key", "real_ai_providers").single(),
    supabase.from("app_settings").select("value").eq("key", "video_model").single(),
    supabase.from("app_settings").select("value").eq("key", "image_model").single(),
  ]);

  // Circuit breaker state for every model — see lib/generations/model-health.ts.
  // Resolved in the data layer, not here: deciding whether a tripped model is
  // still blocking or merely awaiting its trial retry depends on the current
  // time, and reading the clock during render isn't pure.
  const healthById = await getAllModelHealth();

  // fal's own billing ledger. Best-effort: returns ok:false rather than
  // throwing, so an undocumented provider endpoint moving can never take the
  // admin page down with it.
  const [ledger, balance] = await Promise.all([reconcileFalLedger(30), getFalBalance()]);

  // The balance only means something next to what a render costs. Below the
  // priciest single render in the catalogue, someone WILL hit a failure that
  // is our fault rather than theirs — that is the line worth alarming on, and
  // it is derived from the catalogue so it follows the models instead of
  // going stale as a hardcoded figure.
  const worstRenderUsd = maxSingleRenderCostUsd();
  const balanceCritical = balance.ok && balance.balanceUsd < worstRenderUsd;
  const balanceLow = balance.ok && !balanceCritical && balance.balanceUsd < worstRenderUsd * 10;

  const activeModel = modelSetting?.value ?? "kling";
  const activeImageModel = imageModelSetting?.value ?? "gpt-image";

  const keyStatus = [
    { name: "Anthropic (draft)", present: Boolean(process.env.ANTHROPIC_API_KEY) },
    { name: "OpenAI (review)", present: Boolean(process.env.OPENAI_API_KEY) },
    { name: "fal.ai (video + image)", present: Boolean(process.env.FAL_KEY) },
    { name: "OpenAI (voice command — Whisper + TTS)", present: Boolean(process.env.OPENAI_API_KEY) },
    { name: "fal.ai (character dialogue — ElevenLabs + Sync Labs)", present: Boolean(process.env.FAL_KEY) },
    { name: "BytePlus ModelArk (Seedance direct)", present: Boolean(process.env.BYTEPLUS_ARK_API_KEY) },
  ];

  // --- Seedance render lane -------------------------------------------------
  //
  // Added 2026-09-06, and the reason is the whole point of it: the operator
  // set BYTEPLUS_SEEDANCE_LANE in Vercel, redeployed, and then said "I don't
  // see it" — twice — because there was nowhere in the product where the
  // answer existed. A routing switch with no readout is a switch you have to
  // take on faith, and this one moves paying customers' renders to a provider
  // that had never carried one.
  //
  // So this resolves the routing by CALLING videoProviderFor — the same pure
  // function submitVideoJob calls — rather than re-reading the environment and
  // re-implementing the rule. If the two ever disagreed, the panel would be
  // the thing that was wrong, which is the wrong way round.
  const laneFlag = process.env.BYTEPLUS_SEEDANCE_LANE;
  const laneSwitches = [
    {
      name: "BYTEPLUS_ARK_API_KEY",
      note: "Authenticates. Without it the client throws before any request.",
      state: process.env.BYTEPLUS_ARK_API_KEY ? "detected" : "missing",
      ok: Boolean(process.env.BYTEPLUS_ARK_API_KEY),
    },
    {
      name: "BYTEPLUS_SEEDANCE_LANE",
      note: 'Routes. Must be exactly "on" — anything else, including "On", reads as off.',
      // Never the value itself: "set, but not on" is the whole diagnostic, and
      // printing environment contents into a page is how a secret escapes from
      // a panel that only meant to be helpful.
      state: laneFlag === undefined ? "not set" : laneFlag === "on" ? 'on' : 'set, but not "on"',
      ok: laneFlag === "on",
    },
  ];
  const seedanceRouting = VIDEO_MODELS.filter((m) => isByteplusCapable(m.id)).map((m) => ({
    id: m.id,
    name: m.name,
    provider: videoProviderFor(m.id),
    falCostPerSecondUsd: m.costPerSecondUsd,
  }));
  const laneLive = seedanceRouting.some((r) => r.provider === "byteplus");

  // What the lane has actually billed, from ModelArk's own usage figures
  // (job-runner stamps them onto the attempt log at collect time). Before this
  // existed the number was fetched and dropped, so the lane could be proven to
  // WORK without anyone learning what it CHARGED. Service client: these rows
  // belong to their owners, and this is an admin-only accounting view.
  const { data: recentVideos } = await admin
    .from("generations")
    .select("id, created_at, model_id, video_duration_seconds, pipeline_log")
    .eq("content_type", "video")
    .eq("status", "succeeded")
    .order("created_at", { ascending: false })
    .limit(40);

  const laneRenders = (recentVideos ?? []).flatMap((row) => {
    const attempts = Array.isArray(row.pipeline_log) ? (row.pipeline_log as AttemptLog[]) : [];
    const billed = attempts.find((a) => a?.provider === "byteplus");
    if (!billed) return [];
    const rate = ARK_USD_PER_MILLION_TOKENS[row.model_id as keyof typeof ARK_USD_PER_MILLION_TOKENS];
    const tokens = typeof billed.providerTokens === "number" ? billed.providerTokens : null;
    const usd = tokens !== null && rate ? (tokens / 1_000_000) * rate : null;
    const seconds = row.video_duration_seconds ?? null;
    return [
      {
        id: row.id as string,
        createdAt: row.created_at as string,
        modelId: row.model_id as string,
        seconds,
        tokens,
        usd,
        usdPerSecond: usd !== null && seconds ? usd / seconds : null,
      },
    ];
  });

  return (
    <div>
      <AdminErrorBanner error={actionError} />
      <div>
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">Product</p>
        <h1 className="mt-1 font-numeral text-3xl text-atelier-ink">AI providers</h1>
      </div>
      <p className="mt-1 text-sm text-neutral-500">
        Claude drafts, OpenAI reviews, fal.ai generates the clip. Voice command and voice mode
        reuse the same OpenAI key for transcription and speech. Character dialogue (spoken lines,
        lip-synced onto the video) runs on ElevenLabs + Sync Labs — both fronted by the same
        fal.ai key, no separate account needed. Manage which voices are available in{" "}
        <a href="/admin/voices" className="underline">
          Admin &gt; Voices
        </a>
        .
      </p>

      <Card className="mt-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">Real providers</h2>
            <p className="mt-1 text-xs text-neutral-500">
              {flag?.enabled
                ? "On — generations call real APIs and may incur real cost."
                : "Off — generations use the mock pipeline. No API calls, no cost."}
            </p>
          </div>
          <Badge tone={flag?.enabled ? "success" : "neutral"}>
            {flag?.enabled ? "on" : "off"}
          </Badge>
        </div>
        {flag && (
          <form action={toggleFeatureFlag} className="mt-4">
            <input type="hidden" name="key" value={flag.key} />
            <input type="hidden" name="enabled" value={String(flag.enabled)} />
            <Button variant="secondary" size="sm" type="submit">
              Turn {flag.enabled ? "off" : "on"}
            </Button>
          </form>
        )}

        <div className="mt-6 space-y-2 border-t border-neutral-100 pt-4">
          {keyStatus.map((k) => (
            <div key={k.name} className="flex items-center justify-between text-sm">
              <span className="text-neutral-600">{k.name}</span>
              <Badge tone={k.present ? "success" : "danger"}>
                {k.present ? "detected" : "missing"}
              </Badge>
            </div>
          ))}
        </div>
      </Card>

      {/* Seedance render lane — see the block that computes it above for why
          this panel exists at all. */}
      <Card className="mt-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
          <div className="min-w-0 sm:flex-1">
            <h2 className="text-sm font-semibold text-neutral-900">Seedance render lane</h2>
            <p className="mt-1 text-xs text-neutral-500">
              Where a Seedance render goes right now, answered by the same function the pipeline
              calls — not by what the environment is supposed to say. Every other model stays on
              fal regardless.
            </p>
          </div>
          <Badge
            tone={laneLive ? "success" : "neutral"}
            className="w-fit shrink-0 whitespace-nowrap"
          >
            {laneLive ? "BytePlus ModelArk" : "fal.ai"}
          </Badge>
        </div>

        {/* Stacked on a narrow admin viewport, side-by-side from sm up: the
            names are long unbreakable tokens, so sharing a row with a chip at
            phone width turns them into a two-character column. */}
        <div className="mt-4 space-y-2.5 border-t border-neutral-100 pt-4">
          {laneSwitches.map((s) => (
            <div
              key={s.name}
              className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3"
            >
              <div className="min-w-0 sm:flex-1">
                {/* break-all, not truncate: these names have no spaces to
                    wrap at, so on a narrow admin viewport the string used to
                    run straight under the badge instead of stopping. */}
                <p className="break-all font-mono text-xs text-neutral-700">{s.name}</p>
                <p className="mt-0.5 text-xs text-neutral-400">{s.note}</p>
              </div>
              <Badge
                tone={s.ok ? "success" : "danger"}
                className="w-fit shrink-0 whitespace-nowrap"
              >
                {s.state}
              </Badge>
            </div>
          ))}
        </div>

        <div className="mt-4 space-y-2 border-t border-neutral-100 pt-4">
          {seedanceRouting.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-neutral-600">{r.name}</span>
              <span
                className={cn(
                  "text-xs font-medium",
                  r.provider === "byteplus" ? "text-emerald-700" : "text-neutral-500",
                )}
              >
                {r.provider === "byteplus" ? "→ BytePlus ModelArk" : "→ fal.ai"}
              </span>
            </div>
          ))}
        </div>

        {/* What it has actually cost. Empty until a render takes the lane —
            and saying so plainly is the honest state, not a gap to fill with
            the list-price estimate. */}
        <div className="mt-4 border-t border-neutral-100 pt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-neutral-400">
            Billed on this lane
          </p>
          {laneRenders.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">
              No render has taken this lane yet — nothing has been billed to ModelArk from
              production. The saving this lane exists for is still a list-price comparison:{" "}
              <span className="font-medium text-neutral-700">$0.1528/sec</span> was measured once,
              on a 4s <em>text</em>-to-video, while BytePlus support quoted{" "}
              <span className="font-medium text-neutral-700">$0.303/sec</span> for the enhanced
              line — parity with fal. The product sends reference-to-video, whose token cost has
              never been measured on either line. One supervised render fills this panel in.
            </p>
          ) : (
            <>
              <div className="mt-2 space-y-1.5">
                {laneRenders.slice(0, 10).map((r) => (
                  <p key={r.id} className="text-sm text-neutral-700">
                    {new Date(r.createdAt).toLocaleString()} · {r.modelId}
                    {r.seconds ? ` · ${r.seconds}s` : ""} ·{" "}
                    {r.tokens !== null ? `${r.tokens.toLocaleString()} tokens` : "tokens not reported"}
                    {r.usd !== null ? ` · $${r.usd.toFixed(4)}` : ""}
                    {r.usdPerSecond !== null ? ` · $${r.usdPerSecond.toFixed(4)}/sec` : ""}
                  </p>
                ))}
              </div>
              <p className="mt-3 text-xs text-neutral-400">
                Dollars are ModelArk&apos;s reported completion tokens at their published per-million
                list price, not an invoice — which billing line this account sits on is still
                unresolved. Compare against fal&apos;s{" "}
                {seedanceRouting.map((r) => `$${r.falCostPerSecondUsd.toFixed(4)}/sec on ${r.name}`).join(", ")}.
              </p>
            </>
          )}
        </div>
      </Card>

      <Card className="mt-6">
        <h2 className="text-sm font-semibold text-neutral-900">Video model</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Every model here runs through the same fal.ai key — switching is instant, no new keys
          needed. The one exception is Seedance, which routes to BytePlus ModelArk when the lane
          above is on.
        </p>

        <div className="mt-4 flex flex-wrap gap-2 border-b border-neutral-100">
          {VIDEO_MODELS.map((model) => (
            <form key={model.id} action={setVideoModel}>
              <input type="hidden" name="model_id" value={model.id} />
              <button
                type="submit"
                className={cn(
                  "-mb-px flex items-center gap-2 border-b-2 px-4 py-3 text-sm transition-colors",
                  activeModel === model.id
                    ? "border-neutral-900 font-medium text-neutral-900"
                    : "border-transparent text-neutral-500 hover:text-neutral-900",
                )}
              >
                {model.name}
                {model.recommended && <Badge tone="success">Recommended</Badge>}
              </button>
            </form>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          {VIDEO_MODELS.filter((m) => m.id === activeModel).map((model) => (
            <div key={model.id}>
              <p className="text-sm text-neutral-700">{model.description}</p>
              <p className="mt-1 text-xs text-neutral-400">{model.falEndpoint}</p>
              <p className="mt-1 text-xs text-neutral-400">
                Costs{" "}
                {model.durations
                  .map((d) => `${d.creditWeight} credit${d.creditWeight === 1 ? "" : "s"} at ${d.seconds}s`)
                  .join(", ")}{" "}
                of a user&apos;s monthly plan allowance per video.
              </p>
            </div>
          ))}
        </div>
        <p className="mt-4 border-t border-neutral-100 pt-3 text-xs text-neutral-400">
          This is the default used when a user hasn&apos;t picked a model themselves — the composer
          now lets users choose per generation (see the model switcher next to the character
          picker in Generate), and pricier models cost more of their monthly allowance
          automatically.
        </p>
      </Card>

      <Card className="mt-6">
        <h2 className="text-sm font-semibold text-neutral-900">Image model</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Used for scene generation and character reference photos. GPT Image 2 anchors to the
          character&apos;s saved reference photo for consistency; Flux is faster and cheaper.
        </p>

        <div className="mt-4 flex flex-wrap gap-2 border-b border-neutral-100">
          {IMAGE_MODELS.map((model) => (
            <form key={model.id} action={setImageModel}>
              <input type="hidden" name="model_id" value={model.id} />
              <button
                type="submit"
                className={cn(
                  "-mb-px flex items-center gap-2 border-b-2 px-4 py-3 text-sm transition-colors",
                  activeImageModel === model.id
                    ? "border-neutral-900 font-medium text-neutral-900"
                    : "border-transparent text-neutral-500 hover:text-neutral-900",
                )}
              >
                {model.name}
                {model.recommended && <Badge tone="success">Recommended</Badge>}
              </button>
            </form>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          {IMAGE_MODELS.filter((m) => m.id === activeImageModel).map((model) => (
            <div key={model.id}>
              <p className="text-sm text-neutral-700">{model.description}</p>
              <p className="mt-1 text-xs text-neutral-400">
                {model.provider === "openai" ? "OpenAI Images API" : "fal.ai"}
              </p>
            </div>
          ))}
        </div>
      </Card>

      {/* Any model priced below what it costs to run.

          Veo shipped underpriced and stayed that way through two pricing
          reviews because the weights looked reasonable and nobody multiplied
          them out. This makes that arithmetic visible instead of trusting
          that someone remembers to do it. */}
      {/* fal balance (2026-08-30). The number that actually constrains the
          product: when it runs out every render fails at once, and it reads
          as a product outage rather than an unpaid bill. Read through an
          Admin-scope key (FAL_ADMIN_KEY) because the ordinary render key is
          not permitted on fal's billing endpoint. */}
      <Card className={cn("mt-6", balanceCritical && "border-red-300", balanceLow && "border-amber-200")}>
        <h2 className="text-sm font-semibold text-neutral-900">fal balance</h2>
        {!balance.ok ? (
          <p className="mt-1 text-sm text-neutral-500">
            Couldn&apos;t read the balance — {balance.error} Renders are unaffected; this panel is
            informational.
          </p>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap items-baseline gap-3">
              <p className={cn("text-3xl font-semibold", balanceCritical ? "text-red-600" : balanceLow ? "text-amber-700" : "text-neutral-900")}>
                ${balance.balanceUsd.toFixed(2)}
              </p>
              <span className="text-sm text-neutral-500">{balance.currency} remaining at fal</span>
            </div>
            <p className="mt-2 text-sm text-neutral-600">
              About{" "}
              <span className="font-medium">{Math.floor(balance.balanceUsd / COST_BASIS_USD_PER_CREDIT)}</span>{" "}
              credits of generation at the ${COST_BASIS_USD_PER_CREDIT.toFixed(2)} cost basis. The
              priciest single render this catalogue can produce costs ${worstRenderUsd.toFixed(2)}.
            </p>
            {balanceCritical && (
              <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
                Below the cost of one full-length render. Someone will hit a failure that is ours,
                not theirs. Top up before that happens.
              </p>
            )}
            {balanceLow && (
              <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                Running low — under ten full-length renders of headroom.
              </p>
            )}
          </>
        )}
      </Card>

      {/* Provider billing reconciliation (2026-08-30).
          Answers one question, from fal's own ledger rather than from our
          pipeline log: has a FAILED render ever actually cost money? Our
          refund policy force-refunds provider rejections on the assumption
          they consume nothing, and fal's FAQ only guarantees that for 5xx —
          a 422 "may still be charged if a runner spent GPU time before the
          error was detected". So the assumption is checked here instead of
          trusted, and it surfaces the day it stops being true. */}
      <Card className={cn("mt-6", ledger.ok && ledger.billedFailures.length > 0 && "border-red-300")}>
        <h2 className="text-sm font-semibold text-neutral-900">Provider billing reconciliation</h2>
        {!ledger.ok ? (
          <p className="mt-1 text-sm text-neutral-500">
            Couldn&apos;t read fal&apos;s request ledger{ledger.error ? ` — ${ledger.error}` : ""}. This
            panel is informational; nothing about generation depends on it.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-neutral-500">
              Every request fal has on record for the last {ledger.windowDays} days, and what it
              billed. A failed render should carry no billable units — that is the assumption the
              automatic refund of provider rejections rests on.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xl font-semibold text-neutral-900">{ledger.total}</p>
                <p className="text-xs text-neutral-500">requests on record</p>
              </div>
              <div>
                <p className="text-xl font-semibold text-neutral-900">{ledger.failed}</p>
                <p className="text-xs text-neutral-500">failed (4xx/5xx)</p>
              </div>
              <div>
                <p
                  className={cn(
                    "text-xl font-semibold",
                    ledger.billedFailures.length > 0 ? "text-red-600" : "text-emerald-700",
                  )}
                >
                  {ledger.billedFailures.length}
                </p>
                <p className="text-xs text-neutral-500">failures we were BILLED for</p>
              </div>
              <div>
                <p className="text-xl font-semibold text-neutral-900">
                  {ledger.billableUnitsOnSuccess.toFixed(2)}
                </p>
                <p className="text-xs text-neutral-500">billable units on successes</p>
              </div>
            </div>

            {ledger.billedFailures.length > 0 ? (
              <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3">
                <p className="text-sm font-semibold text-red-700">
                  A provider charged us for work that failed. The refund rule assumes this cannot
                  happen — check it before refunding any more rejections automatically.
                </p>
                <div className="mt-2 space-y-1">
                  {ledger.billedFailures.slice(0, 10).map((r) => (
                    <p key={r.request_id} className="text-xs text-red-800">
                      {r.status_code} · {r.endpoint} · {r.billable_units} units · {r.started_at}
                    </p>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-emerald-700">
                No failed request in this window carried a billable unit
                {ledger.failuresByEndpoint.length > 0
                  ? ` — including ${ledger.failuresByEndpoint
                      .map((f) => `${f.count}x ${f.endpoint}`)
                      .join(", ")}.`
                  : "."}
              </p>
            )}
            {ledger.oldest && (
              <p className="mt-3 text-xs text-neutral-400">
                Ledger covers {new Date(ledger.oldest).toLocaleDateString()} to{" "}
                {ledger.newest ? new Date(ledger.newest).toLocaleDateString() : "now"}. Read live
                from fal on each page load.
              </p>
            )}
          </>
        )}
      </Card>

      {pricingAudit().length > 0 && (
        <Card className="mt-6 border-amber-200">
          <h2 className="text-sm font-semibold text-amber-700">Credit weights out of step with cost</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Not a profitability problem — every model is well above cost at current plan
            prices. These weights have drifted relative to what the provider charges, so
            they consume less allowance per dollar than the others.
          </p>
          <div className="mt-3 space-y-1.5">
            {pricingAudit().map((row) => (
              <p key={`${row.modelId}-${row.seconds}`} className="text-sm text-neutral-700">
                <span className="font-medium">{row.name}</span> at {row.seconds}s — {row.credits}{" "}
                credits represents ${row.allowanceValueUsd.toFixed(2)} of spend but costs ${row.costUsd.toFixed(2)}. Suggest{" "}
                {Math.ceil(row.costUsd / COST_BASIS_USD_PER_CREDIT)} credits.
              </p>
            ))}
          </div>
        </Card>
      )}

      {/* Circuit breaker.

          A model that fails three times in a row, across at least two
          accounts, takes itself out of service so a broken provider stops
          costing money. It heals on its own: after a cooldown one request goes
          through as a trial, and a success clears it.

          These controls exist for the cases automation gets wrong. Restore is
          for a false trip — three failures that turned out to be bad inputs,
          where waiting out a backoff that doubles to six hours isn't
          acceptable, especially if it's the model every free trial depends on.
          Suspend is the opposite: take a model out deliberately, before it has
          failed three times, when you already know it's broken. */}
      <Card className="mt-6">
        <h2 className="text-sm font-semibold text-neutral-900">Model health</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Models take themselves out of service after 3 consecutive failures from 2 or more
          accounts, and recover automatically. Override here when that gets it wrong.
        </p>

        <div className="mt-4 space-y-2">
          {[
            ...VIDEO_MODELS.map((m) => ({ id: m.id, name: m.name, kind: "video" as const })),
            ...IMAGE_MODELS.map((m) => ({ id: m.id, name: m.name, kind: "image" as const })),
          ].map((model) => {
            const health = healthById.get(model.id);
            const state = health?.state ?? "healthy";
            return (
              <div
                key={model.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-neutral-200 px-3.5 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-neutral-900">{model.name}</p>
                    <Badge tone={state === "healthy" ? "success" : state === "trial" ? "neutral" : "danger"}>
                      {state === "healthy" ? "In service" : state === "trial" ? "Trial retry" : "Out of service"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-neutral-400">
                    {state === "healthy"
                      ? health?.lastSuccessAt
                        ? `Last success ${new Date(health.lastSuccessAt).toLocaleString()}`
                        : "No failures recorded"
                      : (health?.lastError ?? "Taken out of service")}
                  </p>
                  {state !== "healthy" && (health?.tripCount ?? 0) > 1 && (
                    <p className="mt-0.5 text-xs text-neutral-400">
                      Tripped {health?.tripCount} times in a row — backoff is lengthening.
                    </p>
                  )}
                </div>

                <form action={state === "healthy" ? suspendModel : restoreModel}>
                  <input type="hidden" name="model_id" value={model.id} />
                  <input type="hidden" name="kind" value={model.kind} />
                  <Button variant="secondary" type="submit">
                    {state === "healthy" ? "Suspend" : "Restore now"}
                  </Button>
                </form>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
