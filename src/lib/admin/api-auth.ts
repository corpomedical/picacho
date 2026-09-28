// The phone admin app's door into the admin (2026-09-28 admin redesign,
// operator picked "Both": the website admin AND the home-screen admin app,
// picacho-admin, get real actions). picacho-admin is a static app on its own
// Vercel origin, signed in with Supabase like everyone else; it holds no
// service key and never will. To act, it calls /api/admin/* here with the
// admin's own access token, and each call is checked the way requireAdmin
// checks the website: a valid session, role admin, and — once the admin has
// enrolled a second factor — a session that presented it (aal2).
//
// The browser answers only for the app's own origin (ADMIN_APP_ORIGINS,
// comma-separated; default the Vercel address below). CORS is not the lock —
// the token is — but it keeps other sites' pages from even trying.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";

const DEFAULT_ORIGINS = ["https://picacho-admin.vercel.app"];

export function adminAppOrigins(): string[] {
  const configured = (process.env.ADMIN_APP_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  const list = configured.length ? configured : DEFAULT_ORIGINS;
  // The app served locally (launch.json "admin-pwa") while developing.
  return process.env.NODE_ENV === "production" ? list : [...list, "http://localhost:4173"];
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  const headers: Record<string, string> = { Vary: "Origin" };
  if (origin && adminAppOrigins().includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "authorization, content-type";
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Max-Age"] = "600";
  }
  return headers;
}

export function preflight(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export function json(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...corsHeaders(request) },
  });
}

/** The JWT's claims, read only AFTER getUser has verified the token with the auth server. */
function claims(token: string): { aal?: string } {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

export async function requireAdminFromRequest(
  request: Request,
): Promise<{ admin: SupabaseClient; userId: string } | Response> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return json(request, { error: "Sign in again." }, 401);

  const admin = createAdminClient();
  const { data, error } = await admin.auth.getUser(token);
  const user = data?.user;
  if (error || !user) return json(request, { error: "Your session expired. Sign in again." }, 401);

  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return json(request, { error: "Admin access required." }, 403);

  // Second factor: the same rule as requireAdmin — enforced only once a
  // factor is enrolled, so it can never lock out an admin who has none.
  const enrolled = (user.factors ?? []).some((f) => f.status === "verified");
  if (enrolled && claims(token).aal !== "aal2") {
    return json(request, { error: "Two-factor verification required. Enter your code in the app." }, 403);
  }

  return { admin, userId: user.id };
}
