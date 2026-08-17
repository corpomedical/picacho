import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { authenticateApiRequest } from "@/lib/api/keys";

// GET /api/v1/characters — the ids you need in order to generate anything.
//
// First call any integration makes: a character_id is required to get a
// consistent face, and there is no other way to discover one programmatically.

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = createAdminClient();

  const { caller, error: authError } = await authenticateApiRequest(
    supabase,
    request.headers.get("authorization"),
  );
  if (!caller) {
    return NextResponse.json(
      { error: { code: authError.code, message: authError.message } },
      { status: authError.status },
    );
  }

  const { data } = await supabase
    .from("character_profiles")
    .select("id, name, traits, reference_image_urls, created_at")
    .eq("user_id", caller.userId)
    .order("created_at", { ascending: false });

  return NextResponse.json({
    characters: (data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      traits: c.traits ?? {},
      // Whether it can hold a face, without exposing storage paths: an
      // identity photo is what makes consistency work, so an integration
      // needs to know which characters have one.
      has_identity_photo: ((c.reference_image_urls ?? []) as string[]).length > 0,
      created_at: c.created_at,
    })),
  });
}
