import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { mediaUrl, thumbUrl } from "@/lib/media/url";
import { listProducts } from "@/lib/products/actions";
import { StudioClient } from "@/components/studio-client";
import { getServerMessages } from "@/lib/i18n/server";

// Product Studio — the "B" of "B on A" (2026-08-27): product → proven shot
// recipe → character or product-only → a contact sheet of four. Generation
// happens through the ordinary runGeneration pipeline (credits, receipts,
// History, identity scores all inherited); this page only gathers the
// shelf: the user's products and characters.

export default async function StudioPage() {
  const { t } = await getServerMessages();
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const products = await listProducts();

  const { data: characterRows } = await supabase
    .from("character_profiles")
    .select("id, name, reference_image_urls")
    .eq("user_id", userData.user.id)
    .order("created_at", { ascending: true });

  const characters = (characterRows ?? []).map((c) => {
    const paths = (c.reference_image_urls as string[] | null) ?? [];
    return {
      id: c.id as string,
      name: c.name as string,
      photoUrl: paths[0] ? thumbUrl(mediaUrl("character-references", paths[0]), 320) : null,
      hasPhoto: paths.length > 0,
    };
  });

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-display text-2xl font-semibold text-atelier-ink">{t.studio.title}</h1>
      <p className="mt-1 text-sm text-atelier-muted">{t.studio.subtitle}</p>
      <div className="mt-6">
        <StudioClient products={products} characters={characters} />
      </div>
    </div>
  );
}
