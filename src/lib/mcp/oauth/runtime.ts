// The authorization server's real dependencies (server-only): the service
// role, the host the request came in on, the press_tour_mcp switch (read
// fail-closed), the rate limiter, and press-tour/safe-fetch.ts for client
// metadata documents. The route files under app/api/oauth, app/oauth and
// app/.well-known build their dependencies here and nowhere else.

import { headers } from "next/headers";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getOrigin } from "@/lib/origin";
import { hashedRateKey, rateLimited } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/server";
import { pressTourCaller } from "@/lib/press-tour/card-service";
import { readPressTourSwitches } from "@/lib/press-tour/enabled";
import { safeFetch } from "@/lib/press-tour/safe-fetch";
import type { DocumentFetcher } from "./clients";
import type { EndpointDeps } from "./endpoints";

/** press_tour_mcp, fail-closed (off while press_tour is off, a provider key is missing, or the read fails). */
export async function oauthEnabled(db: SupabaseClient): Promise<boolean> {
  return (await readPressTourSwitches(db)).press_tour_mcp;
}

/** A client metadata document, through the one door the server fetches a person-supplied address by. */
export const fetchClientMetadata: DocumentFetcher = async (url, opts) => {
  const res = await safeFetch(url, { kind: "json", maxBytes: opts.maxBytes, timeoutMs: opts.timeoutMs, maxRedirects: 0 });
  return { status: res.status, text: res.text };
};

export async function endpointDeps(): Promise<EndpointDeps> {
  const db = createAdminClient();
  const [origin, enabled] = await Promise.all([getOrigin(), oauthEnabled(db)]);
  return { db, origin, enabled, rateLimited, hashKey: hashedRateKey, fetchDocument: fetchClientMetadata };
}

/** The requesting address, for rate limits only (hashed there, never kept raw). */
export async function requestIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

/**
 * Whether this account may connect apps: Press Tour open to it (admins
 * first; the plans once press_tour_plans is on) with a confirmed email.
 * The free trial alone is not enough (it is claimed on picacho.ai only).
 */
export async function mayConnectApps(db: SupabaseClient, user: Pick<User, "id" | "email_confirmed_at"> | null): Promise<boolean> {
  if (!user) return false;
  const who = await pressTourCaller(db, user);
  return who.error === null && who.caller.via !== "trial";
}

/** The secret the consent form's anti-forgery value is keyed with (never sent anywhere). */
export function consentSecret(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
}

/** CORS for the endpoints a browser-based client (the MCP Inspector) may call; no credentials ever. */
export const OAUTH_CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, mcp-protocol-version",
  "access-control-max-age": "86400",
};
