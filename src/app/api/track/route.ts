import { NextResponse, type NextRequest } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// Fires on every page load (marketing + app, logged in or not) from
// PageViewTracker. Logs one row per view, and — if the visitor is signed
// in — also stamps profiles.last_seen_at so Admin > Stats can show who's
// online right now. Never allowed to break the page it's called from, so
// every failure is swallowed after being logged server-side.

// What PageViewTracker actually sends: a Next.js pathname. No scheme, no
// host, no spaces — a leading slash and URL path characters. Anything else
// is a hand-crafted request, and letting it through meant an anonymous
// endpoint that inserts arbitrary strings straight into the table every
// admin traffic chart renders from.
const PATH_PATTERN = /^\/[a-zA-Z0-9\-._~/%?=&]*$/;
// visitorId is always crypto.randomUUID() from the tracker.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Best-effort per-IP rate limit for an unauthenticated insert endpoint.
// In-memory ON PURPOSE, with known limits: the map lives per serverless
// instance, so a burst spread across N warm instances gets N× this budget,
// and every cold start forgets everything. That's fine — this route runs on
// a single instance per concurrent load in practice, and the goal is to
// blunt one dumb loop hammering the table, not to be a billing-grade meter
// (api_rate_check exists for that; a DB round-trip per anonymous page view
// to enforce a limit on DB writes would be self-defeating). A real person
// navigates a handful of pages a minute; 60 is far above any legitimate
// client and far below what makes an insert flood interesting.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 60;
const rateByIp = new Map<string, { windowStart: number; count: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  // Bounded memory: a scan flooding from many spoofed IPs would otherwise
  // grow the map forever. Dropping it wholesale resets everyone's window —
  // acceptable for best-effort.
  if (rateByIp.size > 10_000) rateByIp.clear();
  const entry = rateByIp.get(ip);
  if (!entry || now - entry.windowStart >= RATE_WINDOW_MS) {
    rateByIp.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_MAX_PER_WINDOW;
}

export async function POST(request: NextRequest) {
  try {
    // Cheap same-origin guard to blunt drive-by abuse of this anonymous
    // endpoint. Only reject when an Origin header is present AND clearly
    // cross-site — legitimate same-origin beacons (and requests with no
    // Origin header at all) still pass through.
    const origin = request.headers.get("origin");
    if (origin) {
      const host = request.headers.get("host");
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = null;
      }
      if (!originHost || originHost !== host) {
        return new Response(null, { status: 204 });
      }
    }

    // Every rejection below is a bare 204, not a 4xx with a reason — an
    // abuser probing this endpoint learns nothing about which check tripped,
    // and the honest tracker never reads the response anyway.
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
    if (rateLimited(ip)) {
      return new Response(null, { status: 204 });
    }

    let body: { path?: unknown; visitorId?: unknown; referrer?: unknown };
    try {
      body = await request.json();
    } catch {
      // Malformed JSON is only ever a probe or a bug — same silent 204 as
      // every other rejection, not a distinguishable 4xx/500.
      return new Response(null, { status: 204 });
    }
    const path = typeof body.path === "string" ? body.path.slice(0, 300) : "/";
    const visitorId = typeof body.visitorId === "string" ? body.visitorId.slice(0, 100) : null;
    const referrer = typeof body.referrer === "string" ? body.referrer.slice(0, 300) || null : null;

    if (!visitorId || !UUID_PATTERN.test(visitorId) || !PATH_PATTERN.test(path)) {
      return new Response(null, { status: 204 });
    }

    // Set by Vercel's edge network on every request once deployed — absent
    // in local dev, which is fine, country just stays null until then.
    const country = request.headers.get("x-vercel-ip-country");

    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();

    // Keep the team's own activity out of the traffic analytics. Admin
    // dashboard pages were the 4th most-viewed "page" on the site (104
    // views of /admin/*), which made every traffic chart a mirror of the
    // admins refreshing their own dashboard rather than real visitors.
    // Admin *users* browsing the public site are skipped too — while the
    // audience is this small, team browsing drowns out the signal.
    if (path.startsWith("/admin")) {
      return NextResponse.json({ ok: true });
    }
    if (userData.user) {
      const { data: viewerProfile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userData.user.id)
        .maybeSingle();
      if (viewerProfile?.role === "admin") {
        // Still stamp last_seen_at so "online now" keeps working for admins.
        // Service role: last_seen_at is an observability column the admin
        // dashboard reports on, so it is not writable by the account itself.
        await createAdminClient()
          .from("profiles")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("id", userData.user.id);
        return NextResponse.json({ ok: true });
      }
    }

    await supabase.from("page_views").insert({
      path,
      visitor_id: visitorId,
      user_id: userData.user?.id ?? null,
      country,
      referrer,
    });

    if (userData.user) {
      await createAdminClient()
        .from("profiles")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", userData.user.id);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to log page view:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
