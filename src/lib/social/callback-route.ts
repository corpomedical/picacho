import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Network } from "@/lib/press-tour/publish-types";
import { DEFAULT_RETURN, siteOrigin } from "./oauth";
import { completeConnect } from "./publish-service";
import { callbackDeps } from "./runtime";

// The four connect callbacks (GET /api/social/<network>/callback), one
// handler. The network sends the person back here with ?code&state (or
// ?error): the state must be one this person pressed Connect for, in the
// last 10 minutes, never used before (publish-service.ts completeConnect);
// the code is exchanged on the server as a confidential client, the keys
// are sealed (vault.ts) and the person lands back in the app with
// ?connected=<network> or ?connect_error=<code> (messages.ts
// CONNECT_ERROR_CODES). The code and state never reach a page: the answer
// is a redirect with no-store and no referrer.

export async function handleSocialCallback(network: Network, request: Request): Promise<Response> {
  const url = new URL(request.url);
  let sessionUserId: string | null = null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    sessionUserId = typeof data.user?.id === "string" ? data.user.id : null;
  } catch {
    sessionUserId = null;
  }
  let redirect = `${DEFAULT_RETURN}?connect_error=failed&network=${network}`;
  try {
    redirect = (await completeConnect(callbackDeps(), { network, params: url.searchParams, sessionUserId })).redirect;
  } catch (err) {
    console.error(`[social] ${network} callback failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const origin = siteOrigin(process.env) ?? url.origin;
  const res = NextResponse.redirect(new URL(redirect, origin), 303);
  res.headers.set("cache-control", "no-store");
  res.headers.set("referrer-policy", "no-referrer");
  return res;
}
