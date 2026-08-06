import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppSidebar } from "@/components/app-sidebar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    redirect("/login");
  }

  const [
    { data: profile },
    { data: recentJobs },
    { data: characters },
    { data: projects },
    { data: supportEmailSetting },
  ] = await Promise.all([
    supabase.from("profiles").select("role, username").eq("id", data.user.id).single(),
    supabase
      .from("generations")
      .select("id, prompt_input, status, content_type")
      .order("created_at", { ascending: false })
      .limit(6),
    supabase
      .from("character_profiles")
      .select("id, name")
      .order("created_at", { ascending: false })
      .limit(6),
    supabase
      .from("projects")
      .select("id, name, is_starred, is_pinned, is_archived")
      .eq("is_archived", false)
      .order("is_pinned", { ascending: false })
      .order("is_starred", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(6),
    supabase.from("app_settings").select("value").eq("key", "support_email").single(),
  ]);

  const isAdmin = profile?.role === "admin";

  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar
        isAdmin={isAdmin}
        username={profile?.username ?? (data.user.email ?? "").split("@")[0]}
        recentJobs={recentJobs ?? []}
        characters={characters ?? []}
        projects={projects ?? []}
        supportEmail={supportEmailSetting?.value ?? "support@picacho.app"}
      />
      <div className="min-w-0 flex-1 overflow-y-auto">
        {/* pt-14 clears the fixed mobile top bar (see AppSidebar); not needed
            at md+ where that bar is hidden and the sidebar sits in-flow. */}
        <div className="mx-auto max-w-5xl px-4 py-8 pt-20 sm:px-8 sm:py-12 md:pt-12">{children}</div>
      </div>
    </div>
  );
}
