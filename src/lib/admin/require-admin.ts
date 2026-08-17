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

  // `supabase` is the caller's own session — right for reads, which RLS
  // already widens for admins. `admin` is the service role, needed for the
  // columns no `authenticated` role may write any more: role, plan, status,
  // api_access and every credit counter. Verify the privilege first, then
  // act with it — rather than leaving those columns writable by everyone so
  // that admin tooling happens to work.
  return { supabase, admin: createAdminClient(), userId: data.user.id };
}
