import { createClient } from "@/lib/supabase/server";
import { addVoicePreset, deleteVoicePreset } from "@/lib/admin/actions";
import { Card } from "@/components/ui/card";
import { Label, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { AdminErrorBanner } from "@/components/admin-error-banner";
import { VoicePreviewButton } from "@/components/voice-preview-button";

export default async function AdminVoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error: actionError } = await searchParams;
  const supabase = await createClient();
  const { data: voices } = await supabase
    .from("voice_presets")
    .select("*")
    .order("sort_order", { ascending: true });

  return (
    <div>
      <AdminErrorBanner error={actionError} />
      <h1 className="text-lg font-semibold text-neutral-900">Character voices</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Curated ElevenLabs voices users can assign to a character for lip-synced dialogue (runs
        through the same fal.ai key as video/image generation — no new secret needed). Preview and
        pick voices on{" "}
        <a
          href="https://elevenlabs.io/app/voice-library"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          ElevenLabs&apos; Voice Library
        </a>{" "}
        or mint a new one with Voice Design, then paste its permanent voice_id below. Don&apos;t use
        ElevenLabs&apos; legacy named &quot;Default voices&quot; (Rachel, Bella, Antoni, etc.) — those
        are being retired on December 31, 2026, and any character relying on one would silently
        break.
      </p>

      <Card className="mt-6">
        <h2 className="text-sm font-semibold text-neutral-900">Add a voice</h2>
        <form action={addVoicePreset} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="label">Label</Label>
            <Input id="label" name="label" required placeholder="Warm narrator" />
          </div>
          <div>
            <Label htmlFor="description">Description</Label>
            <Input id="description" name="description" placeholder="Calm, mid-range, American" />
          </div>
          <div>
            <Label htmlFor="elevenlabs_voice_id">ElevenLabs voice_id</Label>
            <Input id="elevenlabs_voice_id" name="elevenlabs_voice_id" required placeholder="21m00Tcm4TlvDq8ikWAM" />
          </div>
          <div className="sm:col-span-3">
            <SubmitButton size="sm">Add voice</SubmitButton>
          </div>
        </form>
      </Card>

      <div className="mt-6 overflow-hidden rounded-[18px] border border-neutral-100 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03),0_12px_28px_-12px_rgba(0,0,0,0.06)]">
        {!voices || voices.length === 0 ? (
          <p className="p-6 text-sm text-neutral-500">
            No voices yet — characters won&apos;t be able to add dialogue until at least one is added
            above.
          </p>
        ) : (
          <div className="divide-y divide-neutral-100">
            {voices.map((voice) => (
              <div key={voice.id} className="flex items-center justify-between gap-4 p-5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-neutral-900">{voice.label}</p>
                  {voice.description && (
                    <p className="mt-0.5 text-xs text-neutral-500">{voice.description}</p>
                  )}
                  <p className="mt-0.5 font-mono text-xs text-neutral-400">
                    {voice.elevenlabs_voice_id}
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <VoicePreviewButton voicePresetId={voice.id} label={`Preview ${voice.label}`} />
                  <form action={deleteVoicePreset}>
                    <input type="hidden" name="id" value={voice.id} />
                    <SubmitButton variant="secondary" size="sm">
                      Remove
                    </SubmitButton>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
