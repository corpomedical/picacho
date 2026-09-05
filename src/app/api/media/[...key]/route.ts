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
  // The chat-attachments bucket accepts image/*, video/*, pdf, txt and doc
  // (user-actions.sql), and the composer's file input advertises exactly
  // those — but everything below used to fall out of this map and ship as
  // application/octet-stream under nosniff. SVG was the sharpest case:
  // browsers never sniff SVG, so every SVG attachment rendered as a broken
  // image. (SVG also gets a script-neutralizing CSP below — an inline
  // user-supplied SVG on our origin is an XSS vector when opened directly.)
  svg: "image/svg+xml",
  avif: "image/avif",
  heic: "image/heic",
  mov: "video/quicktime",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  mp3: "audio/mpeg",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

// A user-uploaded SVG served inline from our origin executes its scripts on
// direct navigation (never inside <img>, which is why serving it at all is
// fine). This CSP neutralizes that without breaking rendering — the same
// defense the big user-content hosts use.
const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'";

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
  // Next has ALREADY percent-decoded catch-all params by the time they reach
  // a handler, so the segments are the raw storage path as minted by
  // mediaUrl() (which encoded each segment exactly once). The previous
  // decodeURIComponent here was a second decode: harmless for the UUID-named
  // keys generation produces (nothing decodable in them — which is also why
  // no working URL changes behaviour under this fix), but any key with a
  // literal "%" arrived as "%" and either threw (URIError → 404) or mangled
  // into the wrong path, so its signature never matched its own file.
  const path = pathParts.join("/");

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

  // Canonicalize the query string (2026-08-31 inspection). Vercel's edge
  // caches by FULL URL, so any parameter beyond the two this route reads —
  // ?v=sig&zz=1, zz=2, ... — was an infinite family of cache keys, each one
  // a fresh lambda + storage download of the same immutable file. The width
  // whitelist above closed that hole for w and left it open for everything
  // else. A 301 is itself cached, so even a deliberate busting loop stops
  // reaching storage after the first hop per key.
  const url = new URL(request.url);
  const canonicalQuery = `?v=${encodeURIComponent(provided)}${width ? `&w=${width}` : ""}`;
  if (url.search !== canonicalQuery) {
    return NextResponse.redirect(new URL(url.pathname + canonicalQuery, url.origin), {
      status: 301,
      headers: { "cache-control": "public, max-age=31536000, s-maxage=31536000, immutable" },
    });
  }

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
        // 50MP ceiling (was 24MP, which modern providers exceed — those
        // renders failed resize, fell back to multi-MB originals, and the
        // biggest broke entirely on the platform's response limit).
        // animated: WebP can carry animation (the reason GIF is excluded
        // from RESIZABLE entirely) — without the flag sharp reads only the
        // first frame, so the same file animated at full size and froze at
        // ?w=320. The flag is a no-op for still images.
        const resized = await sharp(input, { limitInputPixels: 50_000_000, animated: ext === "webp" })
          .rotate() // honour EXIF orientation, which resizing would otherwise drop
          .resize({ width, withoutEnlargement: true })
          .webp({ quality: 78 })
          .toBuffer();

        return new NextResponse(new Uint8Array(resized), {
          headers: {
            "content-type": "image/webp",
            // s-maxage is what lets Vercel's EDGE cache this — max-age alone
            // only caches in the browser, so every first view per user was
            // a full lambda + storage download + resize (2026-08-22,
            // operator: "pictures take forever to load"). Immutable content
            // behind capability URLs is the ideal CDN citizen.
            "cache-control": "public, max-age=31536000, s-maxage=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
          },
        });
      } catch (err) {
        console.error("media thumbnail failed, serving original", { path, width, err });
      }
    }

    // Range support (2026-08-31 inspection). iOS Safari will not play a
    // <video> from a server that answers a Range request with a plain 200 —
    // it probes with "bytes=0-1" and treats the full-body answer as a
    // broken source. Video attachments are served through this route, so
    // they were poster frames that never played on iPhones. Only the
    // passthrough branch needs this; thumbnails are images.
    const range = request.headers.get("range");
    const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
    const baseHeaders: Record<string, string> = {
      "content-type": contentType,
      // Same edge-cache note as the thumbnail branch above.
      "cache-control": "public, max-age=31536000, s-maxage=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "accept-ranges": "bytes",
    };
    if (ext === "svg") baseHeaders["content-security-policy"] = SVG_CSP;

    if (range) {
      const m = range.match(/^bytes=(\d*)-(\d*)$/);
      const size = blob.size;
      if (m && (m[1] || m[2])) {
        const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
        const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
        if (start <= end && start < size) {
          const slice = blob.slice(start, end + 1);
          return new NextResponse(slice.stream(), {
            status: 206,
            headers: {
              ...baseHeaders,
              "content-range": `bytes ${start}-${end}/${size}`,
              "content-length": String(end - start + 1),
            },
          });
        }
      }
      return new NextResponse(null, {
        status: 416,
        headers: { "content-range": `bytes */${size}` },
      });
    }

    return new NextResponse(blob.stream(), {
      headers: { ...baseHeaders, "content-length": String(blob.size) },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
