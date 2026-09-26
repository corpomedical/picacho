import { NextResponse } from "next/server";
import { formFields, handleToken } from "@/lib/mcp/oauth/endpoints";
import { OAUTH_CORS, endpointDeps, requestIp } from "@/lib/mcp/oauth/runtime";

// POST /api/oauth/token — authorization_code (PKCE S256) and refresh_token
// (rotation; a reused refresh token revokes its whole family), both bound
// to the resource they were minted for (RFC 8707). Opaque tokens, stored
// hashed: an hour for access, 30 days for refresh (Press Tour Cut 8).

export const dynamic = "force-dynamic";
// The hosts expect an answer within 10 s (spec §4.2); nothing here is slow.
export const maxDuration = 10;

async function fields(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const body = await request.json();
      return body && typeof body === "object" ? formFields(body as Record<string, unknown>) : {};
    }
    return Object.fromEntries(new URLSearchParams(await request.text()));
  } catch {
    return {};
  }
}

export async function POST(request: Request) {
  const answer = await handleToken({ form: await fields(request), ip: await requestIp() }, await endpointDeps());
  return NextResponse.json(answer.body, { status: answer.status, headers: { ...answer.headers, ...OAUTH_CORS } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: OAUTH_CORS });
}
