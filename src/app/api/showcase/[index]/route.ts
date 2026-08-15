import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// Serves the homepage showcase images: the hero grid shows a real character
// (Eva) — her identity photo plus genuinely generated scenes — instead of
// placeholder art. The reference bucket is private and its signed URLs
// expire, so this route streams the bytes server-side with immutable cache
// headers; Vercel's CDN then serves them like static files.
//
// To change the showcase face, point this at a different character id. To go
// fully static instead, drop images into public/showcase/ and swap the hero
// <img> srcs — this route is just the zero-manual-steps way.
const SHOWCASE_CHARACTER_ID = "15486a3c-4203-43e9-b80d-ab476f842404"; // Eva

export const revalidate = 86400;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ index: string }> },
) {
  const { index } = await params;
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i > 11) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const admin = createAdminClient();
    const { data: character } = await admin
      .from("character_profiles")
      .select("reference_image_urls")
      .eq("id", SHOWCASE_CHARACTER_ID)
      .single();

    const path = character?.reference_image_urls?.[i];
    if (!path) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { data: blob, error } = await admin.storage.from("character-references").download(path);
    if (error || !blob) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return new NextResponse(blob.stream(), {
      headers: {
        "content-type": "image/png",
        // Immutable at the CDN for a year; the route's own revalidate keeps
        // the origin honest if the gallery ever changes.
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
