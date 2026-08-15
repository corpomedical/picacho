import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { isMediaBucket, mediaSig } from "@/lib/media/url";
import crypto from "crypto";

// Streams private-bucket media addressed by stable capability URLs — see
// lib/media/url.ts for the scheme and why. The immutable cache header is
// the entire point: the browser keeps a file after the first view and the
// CDN serves repeat visitors without touching this function at all.

export const runtime = "nodejs";

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key } = await params;
  const [bucket, ...pathParts] = key ?? [];
  if (!bucket || pathParts.length === 0 || !isMediaBucket(bucket)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const path = pathParts.map(decodeURIComponent).join("/");

  // Constant-time signature check — the sig is what makes this URL a
  // capability rather than an open proxy over the private buckets.
  const provided = new URL(request.url).searchParams.get("v") ?? "";
  const expected = mediaSig(bucket, path);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const admin = createAdminClient();
    const { data: blob, error } = await admin.storage.from(bucket).download(path);
    if (error || !blob) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    return new NextResponse(blob.stream(), {
      headers: {
        "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
