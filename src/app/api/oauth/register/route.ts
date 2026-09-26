import { NextResponse } from "next/server";
import { handleRegister } from "@/lib/mcp/oauth/endpoints";
import { OAUTH_CORS, endpointDeps, requestIp } from "@/lib/mcp/oauth/runtime";

// POST /api/oauth/register — dynamic client registration (RFC 7591), the
// fallback to client metadata documents (Press Tour Cut 8). At most 10 per
// address per hour; a client's trust comes from its redirect addresses
// alone (verified hosts and this computer: every scope; anything else: read
// only). Public clients only: no secret is ever issued.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const answer = await handleRegister({ body, ip: await requestIp() }, await endpointDeps());
  return NextResponse.json(answer.body, { status: answer.status, headers: { ...answer.headers, ...OAUTH_CORS } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: OAUTH_CORS });
}
