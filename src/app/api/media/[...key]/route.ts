import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { isMediaBucket, isThumbWidth, mediaSig } from "@/lib/media/url";
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

// Formats worth resizing. GIF is excluded on purpose — it may be animated,
// and a resize would flatten it to a single frame.
const RESIZABLE = new Set(["png", "jpg", "jpeg", "webp"]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key } = await params;
  const [bucket, ...pathParts] = key ?? [];
  if (!bucket || pathParts.length === 0 || !isMediaBucket(bucket)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  let path: string;
  try {
    path = pathParts.map(decodeURIComponent).join("/");
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const searchParams = new URL(request.url).searchParams;

  // Constant-time signature check — the sig is what makes this URL a
  // capability rather than an open proxy over the private buckets.
  const provided = searchParams.get("v") ?? "";
  const expected = mediaSig(bucket, path);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Optional thumbnail width. Not part of the signature (it grants no extra
  // access — you already hold a valid capability for this exact file), but
  // strictly whitelisted so a caller can't mint unbounded distinct URLs and
  // blow out the CDN cache with one file at ten thousand widths.
  const requestedWidth = Number(searchParams.get("w"));
  const width = isThumbWidth(requestedWidth) ? requestedWidth : null;

  try {
    const admin = createAdminClient();
    const { data: blob, error } = await admin.storage.from(bucket).download(path);
    if (error || !blob) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const ext = path.split(".").pop()?.toLowerCase() ?? "";

    if (width && RESIZABLE.has(ext)) {
      // Resize is strictly best-effort. Every failure path below falls
      // through to serving the original bytes, so the worst case is what
      // this route did before thumbnails existed — a big file, but never a
      // broken image. That matters more than the bandwidth: sharp is a
      // native module, and a native module is exactly the kind of dependency
      // that can be present in one environment and absent in another.
      try {
        const { default: sharp } = await import("sharp");
        const input = Buffer.from(await blob.arrayBuffer());
        const resized = await sharp(input, { limitInputPixels: 24000000 })
          .rotate() // honour EXIF orientation, which resizing would otherwise drop
          .resize({ width, withoutEnlargement: true })
          .webp({ quality: 78 })
          .toBuffer();

        return new NextResponse(new Uint8Array(resized), {
          headers: {
            "content-type": "image/webp",
            "cache-control": "public, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
          },
        });
      } catch (err) {
        console.error("media thumbnail failed, serving original", { path, width, err });
      }
    }

    return new NextResponse(blob.stream(), {
      headers: {
        "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream",
        "cache-control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
