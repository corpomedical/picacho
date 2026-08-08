import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminNav } from "@/components/admin-nav";
import { Logo } from "@/components/logo";

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
            <Logo className="h-5" />
            <span className="text-sm font-medium text-neutral-400">admin</span>
          </Link>
          <Link href="/app" className="text-sm text-neutral-500 hover:text-neutral-900">
            Back to app
          </Link>
        </div>
        <AdminNav />
      </header>
      <div className="mx-auto max-w-6xl px-8 py-10">{children}</div>
    </div>
  );
}
