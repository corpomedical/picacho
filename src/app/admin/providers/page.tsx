import { createClient } from "@/lib/supabase/server";
import { toggleFeatureFlag, setVideoModel, setImageModel, restoreModel, suspendModel } from "@/lib/admin/actions";
import { getAllModelHealth } from "@/lib/generations/model-health";
import { VIDEO_MODELS, pricingAudit, COST_BASIS_USD_PER_CREDIT } from "@/lib/generations/providers/video-models";
import { IMAGE_MODELS } from "@/lib/generations/providers/image-models";
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

  const activeModel = modelSetting?.value ?? "kling";
  const activeImageModel = imageModelSetting?.value ?? "gpt-image";

  const keyStatus = [
    { name: "Anthropic (draft)", present: Boolean(process.env.ANTHROPIC_API_KEY) },
    { name: "OpenAI (review)", present: Boolean(process.env.OPENAI_API_KEY) },
    { name: "fal.ai (video + image)", present: Boolean(process.env.FAL_KEY) },
    { name: "OpenAI (voice command — Whisper + TTS)", present: Boolean(process.env.OPENAI_API_KEY) },
    { name: "fal.ai (character dialogue — ElevenLabs + Sync Labs)", present: Boolean(process.env.FAL_KEY) },
  ];

  return (
    <div>
      <AdminErrorBanner error={actionError} />
      <h1 className="text-lg font-semibold text-neutral-900">AI providers</h1>
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

      <Card className="mt-6">
        <h2 className="text-sm font-semibold text-neutral-900">Video model</h2>
        <p className="mt-1 text-xs text-neutral-500">
          All models run through the same fal.ai key — switching is instant, no new keys needed.
        </p>

        <div className="mt-4 flex gap-2 border-b border-neutral-100">
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

        <div className="mt-4 flex gap-2 border-b border-neutral-100">
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
