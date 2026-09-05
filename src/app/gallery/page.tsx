import Link from "next/link";
import type { Metadata } from "next";
import { MarketingHeader } from "@/components/marketing/header";
import { MarketingFooter } from "@/components/marketing/footer";
import { createAdminClient } from "@/lib/supabase/server";
import { getServerMessages } from "@/lib/i18n/server";
import { toMediaUrl, isRenderableUrl } from "@/lib/media/url";
import { localeAlternates, marketingSocial } from "@/lib/i18n/metadata";
import { GalleryShowcase, type ShowcaseItem } from "@/components/gallery-showcase";

// The public "Made with Picacho" gallery: real featured renders, anonymous-
// readable. Rows get here ONLY through the admin Feature toggle
// (setGenerationFeatured in lib/admin/actions.ts), which enforces the v1
// content-rights rule — only generations owned by an ADMIN account may be
// featured, because customer content is never publishable without a consent
// mechanism (deliberately out of scope for v1). The read below re-checks the
// same rule (owner role = admin), so a featured_at that lands on a customer
// row by any other route still never renders publicly.

// Renders as "Gallery | Picacho" via the title.template in the root layout —
// same reasoning as /pricing: without a page title, the tab and the search
// result link are just "Picacho". Static English metadata, matching the
// convention on the other marketing pages (the visible page copy is fully
// localized via marketing.gallery).
// generateMetadata rather than a static object (2026-08-30): the canonical
// depends on which locale URL is being served, and the hreflang set must be
// emitted on all four. The static canonical this replaces would have pinned
// every locale to the English page — the standard way to make Google discard
// the translations as duplicates.
const TITLE = "Gallery";
const DESCRIPTION =
  "Real renders made with Picacho — AI character images and video, generated, validated, and identity-scored by the same pipeline every plan gets. Every score shown is a real measurement.";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: await localeAlternates("/gallery"),
    ...marketingSocial("/gallery", TITLE, DESCRIPTION),
  };
}

// Always render fresh, never serve a CDN-cached copy. These marketing/legal
// pages were getting stuck: after a deploy, one hostname (picacho.ai) kept
// serving a weeks-old prerendered copy while others served the new build,
// because the pages were statically cacheable and a stale per-host edge copy
// never got evicted. force-dynamic makes every request render on the server,
// so a stale copy can't be served and the content always matches the deploy.
// (Here it also means a newly featured render shows up on the next request.)
export const dynamic = "force-dynamic";

// Service-client read — the rows belong to their (admin) owners, not to the
// anonymous visitor, exactly how lib/showcase.ts serves the homepage proof.
// Best-effort by design: this page must render with or without data (and
// before the featured_at migration is applied), so any failure returns an
// empty list and the localized empty state shows — never an error page.
async function getFeaturedItems(): Promise<ShowcaseItem[]> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("generations")
      .select(
        "id, prompt_input, result_url, poster_url, content_type, match_score, featured_at, profiles!inner(role)",
      )
      .eq("status", "succeeded")
      .not("featured_at", "is", null)
      // Deleting a render removes its FILE but soft-deletes its row — a
      // featured-then-deleted render would 404 on the public gallery.
      .is("deleted_at", null)
      // The v1 content-rights re-check (see the header comment): the inner
      // join on the owner's profile drops any row not owned by an admin.
      .eq("profiles.role", "admin")
      .order("featured_at", { ascending: false })
      .limit(60);
    if (error || !data) return [];

    const items: ShowcaseItem[] = [];
    for (const row of data) {
      // toMediaUrl re-signs stored /api/media and legacy signed URLs under
      // the current key and passes provider URLs (fal.media video results)
      // through untouched; anything not renderable is skipped, never a
      // broken tile.
      const url = toMediaUrl(row.result_url);
      if (!url || !isRenderableUrl(url)) continue;
      const rawScore = row.match_score;
      items.push({
        id: row.id,
        prompt: typeof row.prompt_input === "string" ? row.prompt_input.trim() : "",
        url,
        posterUrl: toMediaUrl(row.poster_url),
        contentType: row.content_type === "video" ? "video" : "image",
        score:
          typeof rawScore === "number" && Number.isFinite(rawScore) ? Math.round(rawScore) : null,
      });
    }
    return items;
  } catch {
    return [];
  }
}

export default async function GalleryPage() {
  const { t } = await getServerMessages();
  const m = t.marketing.gallery;
  const items = await getFeaturedItems();

  // The 2026-09-05 redesign: the gallery is a DARKROOM, matching the
  // homepage's own dark shell — renders glow on warm charcoal instead of
  // sitting on office white, the score chips read like printed labels, and
  // every video opens in a real viewer (GalleryShowcase) instead of the v1
  // page's inert first-frame tiles.
  return (
    <div className="min-h-screen bg-[#17150f]">
      <MarketingHeader />

      <section className="mx-auto max-w-6xl px-6 pb-4 pt-20 sm:px-8">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ochre">
          Picacho
        </p>
        <h1 className="mt-2 max-w-2xl font-display text-3xl font-bold tracking-[-0.03em] text-[#f7f6f4] sm:text-4xl">
          {m.title}
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-[#a39a88]">{m.subtitle}</p>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24 pt-10 sm:px-8">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-[18px] border border-dashed border-onmedia/15 py-20 text-center">
            <p className="text-sm text-[#a39a88]">{m.emptyState}</p>
            <Link
              href="/"
              className="mt-3 text-sm font-medium text-[#f7f6f4] underline decoration-[#a39a88]/50 underline-offset-4 transition-colors hover:decoration-[#f7f6f4]"
            >
              {m.backHome}
            </Link>
          </div>
        ) : (
          <>
            <GalleryShowcase items={items} />
            <p className="mt-10 text-center text-xs text-[#a39a88]/70">{m.realNote}</p>
          </>
        )}
      </section>

      <MarketingFooter />
    </div>
  );
}
