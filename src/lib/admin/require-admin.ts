import { createClient, createAdminClient } from "@/lib/supabase/server";

// Shared session-and-role gate for admin server actions. Lives in its own
// (non-"use server") module so importing it doesn't expose it as a callable
// action endpoint — "use server" exports are all reachable over the wire,
// and a helper that hands back an authed client has no business being one.
export async function requireAdmin() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in.");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .single();

  if (profile?.role !== "admin") throw new Error("Admin access required.");

  // Second factor, enforced HERE and not only in the admin layout
  // (2026-09-07 housekeeping). The layout's redirect walks a browser to the
  // challenge page before any admin surface renders — but a Server Action
  // commits without a layout ever running, and every action id is baked into
  // the public /_next chunks. So a session with a stolen password and no TOTP
  // was locked out of every /admin PAGE while still able to invoke
  // deleteUser, setUserRole (self-promoting a second account), setBonusCredits
  // and sendEmailBlast directly.
  //
  // Same condition as the layout, deliberately: only once a factor is
  // ENROLLED does nextLevel become aal2, so this cannot lock out an operator
  // who has not set one up — a gate that fires the moment it ships is how an
  // emergency gets worse.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    throw new Error("Two-factor verification required. Open Admin and complete the challenge.");
  }

  // `supabase` is the caller's own session — right for reads, which RLS
  // already widens for admins. `admin` is the service role, needed for the
  // columns no `authenticated` role may write any more: role, plan, status,
  // api_access and every credit counter. Verify the privilege first, then
  // act with it — rather than leaving those columns writable by everyone so
  // that admin tooling happens to work.
  return { supabase, admin: createAdminClient(), userId: data.user.id };
}
