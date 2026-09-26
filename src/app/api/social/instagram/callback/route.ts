import { handleSocialCallback } from "@/lib/social/callback-route";

// The instagram connect callback: the exact redirect address registered at instagram is
// NEXT_PUBLIC_SITE_URL + /api/social/instagram/callback (lib/social/oauth.ts
// redirectUri). Everything it does is in lib/social/callback-route.ts.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleSocialCallback("instagram", request);
}
