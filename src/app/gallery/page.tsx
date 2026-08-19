import Link from "next/link";
import type { Metadata } from "next";
import type { SVGProps } from "react";
import { MarketingHeader } from "@/components/marketing/header";
import { MarketingFooter } from "@/components/marketing/footer";
import { createAdminClient } from "@/lib/supabase/server";
import { getServerMessages } from "@/lib/i18n/server";
import { formatMsg } from "@/lib/i18n/format";
import { toMediaUrl, thumbUrl, isRenderableUrl } from "@/lib/media/url";

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
export const metadata: Metadata = {
  title: "Gallery",
  description:
    "Real renders made with Picacho — AI character images and video, generated, validated, and identity-scored by the same pipeline every plan gets. Every score shown is a real measurement.",
  alternates: { canonical: "/gallery" },
};

// Always render fresh, never serve a CDN-cached copy. These marketing/legal
// pages were getting stuck: after a deploy, one hostname (picacho.ai) kept
// serving a weeks-old prerendered copy while others served the new build,
// because the pages were statically cacheable and a stale per-host edge copy
// never got evicted. force-dynamic makes every request render on the server,
// so a stale copy can't be served and the content always matches the deploy.
// (Here it also means a newly featured render shows up on the next request.)
export const dynamic = "force-dynamic";

// Same generic play-in-a-circle glyph the app's own galleries pin on video
// tiles (see media-gallery.tsx PlayIcon) — hand-rolled inline SVG, the
// house convention, not a new icon dependency.
function PlayIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M8 5v14l11-7Z" />
    </svg>
  );
}

type FeaturedItem = {
  id: string;
  prompt: string;
  /** Re-signed /api/media capability URL, or a provider URL — always renderable. */
  url: string;
  contentType: "image" | "video";
  /** The row's REAL match_score (0-100, rounded), or null — never invented. */
  score: number | null;
};

// Service-client read — the rows belong to their (admin) owners, not to the
// anonymous visitor, exactly how lib/showcase.ts serves the homepage proof.
// Best-effort by design: this page must render with or without data (and
// before the featured_at migration is applied), so any failure returns an
// empty list and the localized empty state shows — never an error page.
async function getFeaturedItems(): Promise<FeaturedItem[]> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("generations")
      .select(
        "id, prompt_input, result_url, content_type, match_score, featured_at, profiles!inner(role)",
      )
      .eq("status", "succeeded")
      .not("featured_at", "is", null)
      // The v1 content-rights re-check (see the header comment): the inner
      // join on the owner's profile drops any row not owned by an admin.
      .eq("profiles.role", "admin")
      .order("featured_at", { ascending: false })
      .limit(60);
    if (error || !data) return [];

    const items: FeaturedItem[] = [];
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

  return (
    <div className="min-h-screen bg-neutral-50">
      <MarketingHeader />

      <section className="mx-auto max-w-3xl px-8 pb-4 pt-20 text-center">
        <h1 className="font-display text-3xl font-bold tracking-[-0.03em] text-neutral-900 sm:text-4xl">
          {m.title}
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm text-neutral-500">{m.subtitle}</p>
      </section>

      <section className="mx-auto max-w-6xl px-8 pb-24 pt-10">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-[18px] border border-dashed border-neutral-200 py-20 text-center">
            <p className="text-sm text-neutral-500">{m.emptyState}</p>
            <Link
              href="/"
              className="mt-3 text-sm font-medium text-neutral-900 underline decoration-neutral-300 underline-offset-4 transition-colors hover:decoration-neutral-500"
            >
              {m.backHome}
            </Link>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {items.map((item) => {
                // Full-sentence score title/aria — the chip itself shows the
                // house signature (white/95 chip, ochre number; same words as
                // the homepage score band, key reused rather than duplicated).
                const scoreTitle =
                  item.score !== null
                    ? formatMsg(t.generate.identityMatch, { n: item.score })
                    : undefined;
                return (
                  <figure key={item.id} className="min-w-0">
                    {/* Darkroom stage, same as the app's own galleries
                        (media-gallery.tsx): every render sits on the same
                        warm charcoal, mounted-slide ground. The atelier
                        tokens are defined globally in globals.css, so they
                        carry to marketing pages too. */}
                    <div className="relative aspect-square overflow-hidden rounded-media border border-[#eae6dc]/10 bg-atelier-stage">
                      {item.contentType === "image" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={thumbUrl(item.url, 640) ?? item.url}
                          alt={item.prompt}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        // Cheap v1 video treatment: first frame via
                        // preload="metadata" plus the play glyph — the same
                        // treatment the app's video grid uses. No autoplay,
                        // no hover-play client component, no controls.
                        <video
                          src={item.url}
                          muted
                          playsInline
                          preload="metadata"
                          className="h-full w-full object-cover"
                        />
                      )}

                      {item.contentType === "video" && (
                        // Fixed near-white/95 chip on the fixed stage —
                        // constant across themes, like media-gallery.tsx.
                        <span
                          aria-hidden
                          className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-[#faf8f3]/95 text-[#211d16] shadow-sm"
                        >
                          <PlayIcon className="h-3 w-3" />
                        </span>
                      )}

                      {item.score !== null && (
                        // The REAL identity score, straight off the row —
                        // white/95 + ochre, the house signature. The label
                        // hides on the tightest (2-col phone) tiles; the
                        // full sentence stays in title/aria either way.
                        <span
                          title={scoreTitle}
                          aria-label={scoreTitle}
                          className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-semibold text-neutral-800 shadow-sm"
                        >
                          <span className="hidden sm:inline">{t.marketing.home.scoreBandMatch}</span>
                          <span className="text-ochre">{item.score}%</span>
                        </span>
                      )}
                    </div>
                    <figcaption
                      title={item.prompt}
                      className="mt-2 truncate text-xs text-neutral-500"
                    >
                      {item.prompt}
                    </figcaption>
                  </figure>
                );
              })}
            </div>
            <p className="mt-10 text-center text-xs text-neutral-400">{m.realNote}</p>
          </>
        )}
      </section>

      <MarketingFooter />
    </div>
  );
}
