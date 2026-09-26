import { NextResponse } from "next/server";
import { handleRevoke } from "@/lib/mcp/oauth/endpoints";
import { OAUTH_CORS, endpointDeps } from "@/lib/mcp/oauth/runtime";

// POST /api/oauth/revoke — RFC 7009 (Press Tour Cut 8): revokes the token
// and its whole family. Always 200; works whatever press_tour_mcp says,
// because turning a feature off must never stop anyone disconnecting.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let form: Record<string, string> = {};
  try {
    form = Object.fromEntries(new URLSearchParams(await request.text()));
  } catch {
    form = {};
  }
  const answer = await handleRevoke({ form }, await endpointDeps());
  return new NextResponse(null, { status: answer.status, headers: { "cache-control": "no-store", ...OAUTH_CORS } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: OAUTH_CORS });
}
