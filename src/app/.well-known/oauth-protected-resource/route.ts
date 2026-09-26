import { NextResponse } from "next/server";
import { getOrigin } from "@/lib/origin";
import { createAdminClient } from "@/lib/supabase/server";
import { METADATA_HEADERS, protectedResourceMetadata } from "@/lib/mcp/oauth/metadata";
import { OAUTH_CORS, oauthEnabled } from "@/lib/mcp/oauth/runtime";

// RFC 9728 protected-resource metadata for /api/mcp (Press Tour Cut 8): the
// resource on the host this request came in on (picacho.ai or picacho.io),
// and the one authorization server, https://picacho.ai. Served here AND at
// …/api/mcp (the path-suffixed form MCP clients try first). 404 while
// press_tour_mcp is off: the document must not exist before the server it
// names does (critique #40).

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await oauthEnabled(createAdminClient()))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(protectedResourceMetadata(await getOrigin()), { headers: { ...METADATA_HEADERS, ...OAUTH_CORS } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: OAUTH_CORS });
}
