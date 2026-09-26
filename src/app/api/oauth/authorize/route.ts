import { NextResponse } from "next/server";
import { handleAuthorize } from "@/lib/mcp/oauth/endpoints";
import { endpointDeps, requestIp } from "@/lib/mcp/oauth/runtime";

// GET /api/oauth/authorize — the authorization endpoint (Press Tour Cut 8;
// OAuth 2.1 §4.1, PKCE S256 only, `resource` required per RFC 8707).
//
// Nothing about the request travels through sign-in: a good request is
// stored as a pending authorization (15 minutes, answered once) and the
// browser goes to the consent page with only its id (synthesis v2 #29). A
// bad one goes back to the app with error, state and iss — but only once the
// app and its redirect address are known good; before that, to our own page.

export const dynamic = "force-dynamic";

async function authorize(params: Record<string, unknown>) {
  const deps = await endpointDeps();
  const answer = await handleAuthorize({ params, ip: await requestIp() }, deps);
  if (answer.status === 404) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (answer.status === 429 || !answer.location) {
    return new NextResponse("Too many requests. Try again in a minute.", { status: 429, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  const location = answer.location.startsWith("/") ? `${deps.origin}${answer.location}` : answer.location;
  return NextResponse.redirect(location, { status: 303, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

export async function GET(request: Request) {
  return authorize(Object.fromEntries(new URL(request.url).searchParams));
}

// RFC 6749 lets the endpoint take a form POST too.
export async function POST(request: Request) {
  let params: Record<string, unknown> = {};
  try {
    params = Object.fromEntries(new URLSearchParams(await request.text()));
  } catch {
    params = {};
  }
  return authorize(params);
}
