import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200/70 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-8 py-4">
          <Link href="/admin" className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900 text-[11px] font-semibold text-white">
              P
            </span>
            <span className="text-sm font-semibold text-neutral-900">Picacho admin</span>
          </Link>
          <Link href="/app" className="text-sm text-neutral-500 hover:text-neutral-900">
            Back to app
          </Link>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-6 px-8 text-sm text-neutral-500">
          <Link href="/admin" className="border-b-2 border-transparent py-3 hover:text-neutral-900">
            Dashboard
          </Link>
          <Link href="/admin/users" className="border-b-2 border-transparent py-3 hover:text-neutral-900">
            Users
          </Link>
          <Link href="/admin/stats" className="border-b-2 border-transparent py-3 hover:text-neutral-900">
            Stats
          </Link>
          <Link href="/admin/billing" className="border-b-2 border-transparent py-3 hover:text-neutral-900">
            Billing
          </Link>
          <Link href="/admin/moderation" className="border-b-2 border-transparent py-3 hover:text-neutral-900">
            Moderation
          </Link>
          <Link href="/admin/system" className="border-b-2 border-transparent py-3 hover:text-neutral-900">
            System health
          </Link>
          <Link href="/admin/providers" className="border-b-2 border-transparent py-3 hover:text-neutral-900">
            AI providers
          </Link>
          <Link href="/admin/voices" className="border-b-2 border-transparent py-3 hover:text-neutral-900">
            Voices
          </Link>
          <Link href="/admin/flags" className="border-b-2 border-transparent py-3 hover:text-neutral-900">
            Feature flags
          </Link>
          <Link href="/admin/settings" className="border-b-2 border-transparent py-3 hover:text-neutral-900">
            Settings
          </Link>
        </nav>
      </header>
      <div className="mx-auto max-w-6xl px-8 py-10">{children}</div>
    </div>
  );
}
