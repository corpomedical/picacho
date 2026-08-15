import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// Serves the homepage hero grid: one real character (Eva) across six real
// scenes. Everything here is genuine Picacho output — her uploaded identity
// photo plus images the product actually generated — which is the entire
// point of the hero: the proof IS the product.
//
// Two sources, because the good scenes live in two places:
//   • "reference"  — a slot in her character gallery (character-references)
//   • "generation" — a finished generation's stored result (generated-images)
// Both buckets are private and their signed URLs expire, so this route
// streams bytes server-side with immutable cache headers and lets Vercel's
// CDN serve them like static files.
//
// To swap a tile, change one line below — no redeploy of anything else, no
// files to copy. Storage paths come from generations.result_url (strip the
// query string) or character_profiles.reference_image_urls.
type ShowcaseItem =
  | { kind: "reference"; index: number }
  | { kind: "generation"; path: string };

const SHOWCASE_CHARACTER_ID = "15486a3c-4203-43e9-b80d-ab476f842404"; // Eva
const OWNER = "a3102bc1-2355-444a-8ade-caafd7980218";

const SHOWCASE: ShowcaseItem[] = [
  // 0 — identity photo, the one the hero badges as such.
  { kind: "reference", index: 0 },
  // 1 — snow / white winter coat (match 95%).
  { kind: "generation", path: `${OWNER}/775251a7-d43f-47f7-97fc-3e900feb1c4e.png` },
  // 2 — festival, hand raised, laughing (match 91%).
  { kind: "generation", path: `${OWNER}/36c68d55-fd40-4b31-93ca-4c975509d9e6.png` },
  // 3 — cooking show, chef whites (match 92%). Rendered chest-up on the
  //     homepage via object-position, so the face carries at tile size.
  { kind: "generation", path: `${OWNER}/97e292c7-0f39-4786-9c6d-4dc98de691e0.png` },
  // 4, 5 — remaining scenes from her gallery.
  { kind: "reference", index: 4 },
  { kind: "reference", index: 5 },
];

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

    let bucket = "generated-images";
    let path: string | null = null;

    if (item.kind === "generation") {
      path = item.path;
    } else {
      bucket = "character-references";
      const { data: character } = await admin
        .from("character_profiles")
        .select("reference_image_urls")
        .eq("id", SHOWCASE_CHARACTER_ID)
        .single();
      path = character?.reference_image_urls?.[item.index] ?? null;
    }

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
