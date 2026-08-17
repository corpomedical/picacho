import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { authenticateApiRequest } from "@/lib/api/keys";
import { absolutizeMediaUrl, toMediaUrl } from "@/lib/media/url";
import { getOrigin } from "@/lib/origin";

// GET /api/v1/generations/{id} — fetch one generation.
//
// The safety net for POST: if a client's HTTP timeout fires before a slow
// generation returns, the work still completes server-side and the result is
// here. Also how a customer re-fetches an image URL later without keeping
// their own copy of it.

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const { id } = await params;

  // Scoped to the caller: with a service client the user_id filter is the
  // only thing standing between one customer and another's history.
  const { data: row } = await supabase
    .from("generations")
    .select("id, status, prompt_input, result_url, match_score, credits_used, content_type, created_at")
    .eq("id", id)
    .eq("user_id", caller.userId)
    .maybeSingle();

  if (!row) {
    return NextResponse.json(
      { error: { code: "not_found", message: "No generation with that id on this account." } },
      { status: 404 },
    );
  }

  const mediaUrl = toMediaUrl(row.result_url as string | null);

  return NextResponse.json({
    id: row.id,
    status: row.status,
    type: row.content_type,
    prompt: row.prompt_input,
    image_url: mediaUrl ? absolutizeMediaUrl(mediaUrl, await getOrigin()) : null,
    match_score: row.match_score,
    credits_used: row.credits_used,
    created_at: row.created_at,
  });
}
