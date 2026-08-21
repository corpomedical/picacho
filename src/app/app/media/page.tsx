import Link from "next/link";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { toMediaUrl, thumbUrl, isRenderableUrl } from "@/lib/media/url";
import { MediaGallery, type GalleryItem } from "@/components/media-gallery";
import { getServerMessages } from "@/lib/i18n/server";

// The unified media library — every finished image and video in one grid,
// filterable with the same chip group History wears (operator-directed,
// 2026-08-21). This is the native tab's landing page; the separate
// /app/images and /app/videos pages remain for the web sidebar. Tiles open
// the media directly in the gallery's viewer — the History detour is gone.

// One pill of a chip group — same recipe as History's FilterPill.
function FilterPill({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "rounded-full bg-atelier-ink px-3 py-1 text-xs font-medium text-atelier-paper"
          : "rounded-full px-3 py-1 text-xs text-atelier-muted transition-colors hover:text-atelier-ink"
      }
    >
      {children}
    </Link>
  );
}

export default async function MediaPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const raw = await searchParams;
  const type = raw.type === "video" || raw.type === "image" ? raw.type : undefined;

  const { t } = await getServerMessages();
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;

  let query = supabase
    .from("generations")
    .select(
      "id, prompt_input, status, result_url, content_type, created_at, character_profile_id, angle_group_id, angle",
    )
    .eq("user_id", userData.user.id)
    .is("deleted_at", null)
    // Finished work only — failures live in History (operator call,
    // 2026-08-20); in-flight rows keep their placeholder tile.
    .neq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(90);
  if (type) query = query.eq("content_type", type);

  const { data: generations, error } = await query;
  if (error) console.error("Failed to load media:", error);

  const visibleRows = (generations ?? []).filter(
    (g) => g.status !== "succeeded" || isRenderableUrl(toMediaUrl(g.result_url)),
  );

  const characterIds = Array.from(
    new Set(visibleRows.map((g) => g.character_profile_id).filter(Boolean)),
  );
  const { data: characters } = characterIds.length
    ? await supabase.from("character_profiles").select("id, name").in("id", characterIds)
    : { data: [] as { id: string; name: string }[] };
  const nameById = new Map((characters ?? []).map((c) => [c.id, c.name]));

  // Multi-angle requests insert one row per angle — collapse to one tile,
  // same as the Videos page.
  type Row = NonNullable<typeof generations>[number];
  const groups = new Map<string, Row[]>();
  for (const g of visibleRows) {
    const key = g.angle_group_id ?? g.id;
    const arr = groups.get(key) ?? [];
    arr.push(g);
    groups.set(key, arr);
  }

  const items: GalleryItem[] = Array.from(groups.values())
    .map((rows) => {
      const representative = rows.find((g) => g.angle === "front") ?? rows[0];
      const full = toMediaUrl(representative.result_url);
      return {
        id: representative.id,
        prompt_input: representative.prompt_input,
        status: representative.status,
        // Images ride the resizing thumb route for grid weight; videos use
        // the real file (the <video> paints its own first frame).
        result_url: representative.content_type === "image" ? thumbUrl(full, 640) : full,
        full_url: full,
        content_type: representative.content_type,
        created_at: representative.created_at,
        characterName: representative.character_profile_id
          ? (nameById.get(representative.character_profile_id) ?? t.history.unknownCharacter)
          : t.history.noCharacter,
        angleCount: rows.length > 1 ? rows.length : undefined,
      };
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const h = t.history;

  return (
    <div>
      <h1 className="text-lg font-semibold text-atelier-ink">{t.nav.media}</h1>
      <p className="mt-1 text-sm text-atelier-muted">{t.gallery.mediaSubtitle}</p>

      <nav
        aria-label={h.filterByType}
        className="mt-5 inline-flex items-center gap-0.5 rounded-full border border-atelier-rule bg-atelier-surface p-1"
      >
        <FilterPill href="/app/media" active={!type}>
          {h.filterAllTypes}
        </FilterPill>
        <FilterPill href="/app/media?type=image" active={type === "image"}>
          {t.gallery.imagesTitle}
        </FilterPill>
        <FilterPill href="/app/media?type=video" active={type === "video"}>
          {t.gallery.videosTitle}
        </FilterPill>
      </nav>

      <MediaGallery
        items={items}
        contentType={type ?? "image"}
        emptyLabel={type === "video" ? t.gallery.noVideosYet : t.gallery.noImagesYet}
        labels={{
          generateOne: t.gallery.generateOne,
          failed: t.generate.failed,
          simulated: t.generate.simulated,
          angleCountOther: t.history.angleCountOther,
        }}
      />
    </div>
  );
}
