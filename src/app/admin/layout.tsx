import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { computeAdminBadgeCounts } from "@/lib/admin/badges";
import { AdminCommandBar } from "@/components/admin-command-bar";
import "./admin-apple.css";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    redirect("/login");
  }

  // Server-side role check — never trust a client-side check alone for admin access.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();

  if (profile?.role !== "admin") {
    redirect("/app");
  }

  // Second factor (2026-09-05 flaw hunt): one compromised password used to
  // grant unlimited credit edits, plan changes, mass email, and every
  // customer's data. Once an admin has ENROLLED a TOTP factor (Admin →
  // Security), a session that hasn't presented it this sign-in
  // (nextLevel aal2, currentLevel below it) is walked to the challenge page
  // before any admin surface renders. Deliberately not forced on accounts
  // with no factor yet — a gate that locks the operator out the moment it
  // ships is how an emergency gets worse — so enrollment is the switch.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    redirect("/admin-verify");
  }

  // Badge counts for the nav — computed here (Server Component) so the
  // first paint never shows a flash of zero badges, then handed to
  // AdminCommandBar as its seed value. From there the command bar polls
  // getAdminBadgeCounts (a server action wrapping this same
  // computeAdminBadgeCounts helper) on its own timer to keep the red dots
  // live without a page refresh — see admin-command-bar.tsx.
  const badges = await computeAdminBadgeCounts(supabase);

  // APPLE (operator, 2026-10-02: draft D, system blue, light and dark
  // follow the device — admin-apple.css). The frosted sidebar sits beside the
  // page from md up; on a phone AdminCommandBar draws a top bar with a Menu
  // button instead.
  return (
    <div className="admin-apple min-h-screen">
      <div className="md:flex">
        <AdminCommandBar badges={badges} />
        <main className="min-w-0 flex-1 px-4 pb-10 pt-4 sm:px-8 md:px-10 md:pb-12 md:pt-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
