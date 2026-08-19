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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ index: string }> },
) {
  const { index } = await params;
  const i = Number(index);
  const item = Number.isInteger(i) ? SHOWCASE[i] : undefined;
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const admin = createAdminClient();

    const { bucket, path } = await resolveShowcaseItem(admin, item);
    if (!path) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { data: blob, error } = await admin.storage.from(bucket).download(path);
    if (error || !blob) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return new NextResponse(blob.stream(), {
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
