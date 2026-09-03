import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { LAYERS_MODEL_ID, layerFileName } from "@/lib/generations/layers";
import { zipStoreStream, type ZipEntry } from "@/lib/media/zip-store";

// "Download all": every layer of one split as a ZIP of the stored PNGs,
// verbatim (alpha intact), named by z-order and the provider's label. The
// export Higgsfield's page does not offer. Owner-only, read through the
// service role AFTER the owner check so bucket RLS is not the only wall.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return new NextResponse("Unauthorized", { status: 401 });

  const { data: gen } = await supabase
    .from("generations")
    .select("id, model_id, status")
    .eq("id", id)
    .eq("user_id", userData.user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!gen || gen.model_id !== LAYERS_MODEL_ID || gen.status !== "succeeded") {
    return new NextResponse("Not found", { status: 404 });
  }

  const { data: rows } = await supabase
    .from("generation_layers")
    .select("z_index, name, storage_path")
    .eq("generation_id", id)
    .order("z_index", { ascending: true });
  if (!rows || rows.length === 0) return new NextResponse("Not found", { status: 404 });

  // Streamed, not buffered: a 2K split is 20–80 MB and the platform caps a
  // buffered response at 4.5 MB (the media route's own note on multi-MB
  // originals). Storage reads run three ahead of the writer so the stream
  // never waits on a cold download.
  const admin = createAdminClient();
  const ordered = rows.map((r) => ({
    name: layerFileName(r.z_index as number, (r.name as string | null) ?? null),
    path: r.storage_path as string,
  }));
  async function* layerEntries() {
    const ahead = 3;
    const pending: Promise<ZipEntry>[] = [];
    const load = async (l: { name: string; path: string }): Promise<ZipEntry> => {
      const { data: blob, error } = await admin.storage.from("generated-images").download(l.path);
      if (error || !blob) throw new Error(`Couldn't read ${l.name}`);
      return { name: l.name, bytes: new Uint8Array(await blob.arrayBuffer()) };
    };
    for (let i = 0; i < ordered.length; i++) {
      pending.push(load(ordered[i]));
      if (pending.length > ahead) yield await pending.shift()!;
    }
    while (pending.length) yield await pending.shift()!;
  }
  return new Response(zipStoreStream(layerEntries()), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="picacho-layers-${id.slice(0, 8)}.zip"`,
      "cache-control": "private, no-store",
    },
  });
}
