import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { mediaUrl } from "@/lib/media/url";
import { LAYERS_MODEL_ID, newestLayers, parseLayerBox } from "@/lib/generations/layers";
import { LayerStack, type StackLayer } from "@/components/layer-stack";
import { LayersProgress } from "@/components/layers-progress";
import { getServerMessages } from "@/lib/i18n/server";

// One split: the stack page. Reads the parent generation (owner's, a split)
// and its layer rows; while the job runs it polls, when it lands it shows
// the composite and the stack with per-layer PNG downloads.
export default async function LayerStackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t } = await getServerMessages();
  const L = t.layers;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  // Both reads are RLS-scoped to the owner and independent — one round trip.
  const [{ data: gen }, { data: rows }] = await Promise.all([
    supabase
      .from("generations")
      .select("id, status, model_id, prompt_input, created_at, source_generation_id")
      .eq("id", id)
      .eq("user_id", userData.user.id)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("generation_layers")
      .select("id, z_index, version, prompt, name, description, bbox, storage_path, width, height, identity_score")
      .eq("generation_id", id)
      .order("z_index", { ascending: true })
      .order("version", { ascending: true }),
  ]);
  if (!gen || gen.model_id !== LAYERS_MODEL_ID) notFound();

  // Every version is fetched, then the newest of each layer is what the
  // stack shows — an edit adds a row rather than replacing one, so the
  // original stays downloadable and the change stays reversible.
  const layers: StackLayer[] = newestLayers(
    (rows ?? []).map((r) => ({
      id: r.id as string,
      zIndex: r.z_index as number,
      version: (r.version as number | null) ?? 1,
      prompt: (r.prompt as string | null) ?? null,
      name: (r.name as string | null) ?? null,
      description: (r.description as string | null) ?? null,
      url: mediaUrl("generated-images", r.storage_path as string),
      width: (r.width as number | null) ?? null,
      height: (r.height as number | null) ?? null,
      identityScore: (r.identity_score as number | null) ?? null,
      box: parseLayerBox(r.bbox),
    })),
  );

  // The resolution label is the measured truth — the stored base's long
  // side — not a parse of the prompt line above it.
  const base = layers[0];
  const long = Math.max(base?.width ?? 0, base?.height ?? 0);
  const tierLabel = long > 1536 ? "2K" : long > 0 ? "1K" : "";
  const ready = gen.status === "succeeded" && layers.length > 0;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-widest text-atelier-muted">
            <Link href="/app/layers" className="hover:text-atelier-ink">{t.nav.layers}</Link>
            <span className="mx-1.5 text-atelier-muted/50">/</span>
            {L.stackTitle}
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-atelier-ink">{(gen.prompt_input as string | null) ?? L.stackTitle}</h1>
        </div>
        <Link href="/app/history" className="text-xs text-atelier-muted underline-offset-2 hover:text-atelier-ink hover:underline">
          {L.viewInHistory}
        </Link>
      </div>

      <div className="mt-6">
        {ready ? (
          <LayerStack layers={layers} tierLabel={tierLabel} generationId={id} />
        ) : gen.status === "failed" ? (
          <div className="rounded-control border border-atelier-rule bg-atelier-surface p-6 text-center text-sm text-atelier-ink">{L.failed}</div>
        ) : (
          <LayersProgress generationId={id} />
        )}
      </div>
    </div>
  );
}
