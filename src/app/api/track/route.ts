import { NextResponse, type NextRequest } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// Fires on every page load (marketing + app, logged in or not) from
// PageViewTracker. Logs one row per view, and — if the visitor is signed
// in — also stamps profiles.last_seen_at so Admin > Stats can show who's
// online right now. Never allowed to break the page it's called from, so
// every failure is swallowed after being logged server-side.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const path = typeof body.path === "string" ? body.path.slice(0, 300) : "/";
    const visitorId = typeof body.visitorId === "string" ? body.visitorId.slice(0, 100) : null;
    const referrer = typeof body.referrer === "string" ? body.referrer.slice(0, 300) || null : null;

    if (!visitorId) {
      return NextResponse.json({ ok: false }, { status: 400 });
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
