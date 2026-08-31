import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { SHOWCASE, resolveShowcaseItem } from "@/lib/showcase";

// Serves the homepage hero grid images. WHICH rows back the grid — the
// character/owner ids, the tile list, and the bucket/path resolution — lives
// in lib/showcase.ts, shared with the homepage itself (hero score chips +
// "Try it" widget read the same rows' match_score/prompt), so the page and
// this route can never drift apart. See that module for the full story.
//
// Both buckets are private and their signed URLs expire, so this route
// streams bytes server-side with immutable cache headers and lets Vercel's
// CDN serve them like static files.

export const revalidate = 86400;

// The only widths anything on the site actually renders these at. A fixed
// menu, not a free ?w= parameter, for two separate reasons found in the
// 2026-08-31 inspection: (1) the raw originals are 1.9-2.5MB PNGs, and the
// hero grid was shipping 13.5MB of them into six ~170px tiles; (2) Vercel's
// CDN caches by FULL URL including the query string, so any free-form
// parameter is an infinite family of cache keys — ?zz=1, ?zz=2, ... — each
// one a fresh origin invocation that re-downloads the original from
// storage. A menu of two sizes is at most (tiles x 2) cache entries, ever.
const WIDTHS = { grid: 480, full: 1280 } as const;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ index: string }> },
) {
  const { index } = await params;
  const i = Number(index);
  const item = Number.isInteger(i) ? SHOWCASE[i] : undefined;
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Unknown or junk query strings collapse onto the canonical URL instead of
  // minting new cache keys. A redirect is itself cacheable, so even a
  // deliberate ?cachebust=N loop stops reaching storage after the first hop.
  const url = new URL(request.url);
  const size = url.searchParams.get("size");
  const canonicalQuery = size === "full" ? "?size=full" : "";
  const canonical = `${url.pathname}${canonicalQuery}`;
  if (url.search !== canonicalQuery) {
    return NextResponse.redirect(new URL(canonical, url.origin), {
      status: 301,
      headers: { "cache-control": "public, max-age=31536000, immutable" },
    });
  }

  try {
    const admin = createAdminClient();

    const { bucket, path } = await resolveShowcaseItem(admin, item);
    if (!path) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { data: blob, error } = await admin.storage.from(bucket).download(path);
    if (error || !blob) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Downscale + webp on the way through. ~2.2MB PNG -> ~30-60KB at grid
    // width; the CDN then serves the small file for a year. sharp is already
    // a dependency (upload measuring, the style classifier).
    const sharp = (await import("sharp")).default;
    const width = size === "full" ? WIDTHS.full : WIDTHS.grid;
    const bytes = await sharp(Buffer.from(await blob.arrayBuffer()))
      .resize(width, width, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": "image/webp",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
