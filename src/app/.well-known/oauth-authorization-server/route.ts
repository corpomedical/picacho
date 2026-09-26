import { NextResponse } from "next/server";
import { getOrigin } from "@/lib/origin";
import { createAdminClient } from "@/lib/supabase/server";
import { METADATA_HEADERS, authorizationServerMetadata } from "@/lib/mcp/oauth/metadata";
import { OAUTH_CORS, oauthEnabled } from "@/lib/mcp/oauth/runtime";

// RFC 8414 authorization-server metadata (Press Tour Cut 8): issuer
// https://picacho.ai, its endpoints, S256 only, client metadata documents
// supported, `iss` on every authorization response. 404 while
// press_tour_mcp is off.

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await oauthEnabled(createAdminClient()))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(authorizationServerMetadata(await getOrigin()), { headers: { ...METADATA_HEADERS, ...OAUTH_CORS } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: OAUTH_CORS });
}
