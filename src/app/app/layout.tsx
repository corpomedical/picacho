import { redirect } from "next/navigation";
import type { PlanId } from "@/lib/plans";
import { isVoiceModeEnabled } from "@/lib/voice/enabled";
import { RatePrompt } from "@/components/rate-prompt";
import { NativePush } from "@/components/native-push";
import { Suspense } from "react";
import { NativeTabBar } from "@/components/native-tab-bar";
import { RouteProgress } from "@/components/route-progress";
import { ScrollReset } from "@/components/scroll-reset";
import { NativeQuickPill } from "@/components/native-quick-pill";
import { DownloadToasts } from "@/components/download-toasts";
import { createClient } from "@/lib/supabase/server";
import { AppSidebar } from "@/components/app-sidebar";
import { AppErrorReporter } from "@/components/app-error-reporter";
import { ActivityHeartbeat } from "@/components/activity-heartbeat";

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
    supabase.from("profiles").select("role, username, plan, skip_ai_refinement, rating_prompted_at").eq("id", data.user.id).single(),
    // Explicit user_id filters below, not just RLS — an admin's SELECT
    // policy on these tables intentionally allows reading every user's rows
    // (that's what powers /admin), so without this an admin browsing their
    // own /app pages would see everyone else's recent jobs/characters/
    // projects here instead of just their own.
    supabase
      .from("generations")
      .select("id, prompt_input, status, content_type")
      .eq("user_id", data.user.id)
      // Rows are soft-deleted (the ledger keeps counting them); the jobs
      // menu is a user-facing surface, so deleted work must not linger here.
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(6),
    supabase
      .from("character_profiles")
      .select("id, name")
      .eq("user_id", data.user.id)
      .order("created_at", { ascending: false })
      .limit(6),
    supabase
      .from("projects")
      .select("id, name, is_starred, is_pinned, is_archived")
      .eq("user_id", data.user.id)
      .eq("is_archived", false)
      .order("is_pinned", { ascending: false })
      .order("is_starred", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(6),
    supabase.from("app_settings").select("value").eq("key", "support_email").single(),
  ]);

  const isAdmin = profile?.role === "admin";

  const voiceModeEnabled = await isVoiceModeEnabled(supabase);

  // Ask for a rating only once someone has had enough successful results to
  // hold an opinion, and only once ever (rating_prompted_at is stamped by
  // both answering and dismissing). head+count so this is a cheap COUNT
  // rather than pulling rows on every page load.
  const { count: successfulGenerations } = await supabase
    .from("generations")
    .select("id", { count: "exact", head: true })
    .eq("user_id", data.user.id)
    .eq("status", "succeeded");

  const showRatePrompt =
    (successfulGenerations ?? 0) >= 3 && !profile?.rating_prompted_at;

  // h-full, not h-screen: html/body are pinned to 100% while this shell is
  // mounted (globals.css, the :has([data-app-scroll]) rule), so 100% here is
  // the viewport MINUS body's safe-area padding — the shell fits exactly and
  // the document has nothing left to scroll. h-screen was 100vh, which
  // overflowed the padded body by the inset sum and gave every app page a
  // second, momentum-killing document scroller (the two-swipe dashboard).
  return (
    <div className="frost-ground flex h-full overflow-hidden">
      <AppErrorReporter />
      {/* Times how long this person actually uses the app — see the
          component for why it only beats while the tab is visible. */}
      <ActivityHeartbeat />
      <AppSidebar
        isAdmin={isAdmin}
        username={profile?.username ?? (data.user.email ?? "").split("@")[0]}
        plan={(profile?.plan ?? "none") as PlanId}
        recentJobs={recentJobs ?? []}
        characters={characters ?? []}
        projects={projects ?? []}
        supportEmail={supportEmailSetting?.value ?? "support@picacho.app"}
        skipAiRefinement={profile?.skip_ai_refinement === true}
        voiceModeEnabled={voiceModeEnabled}
      />
      {/* Registers this device for push, once there's a session to
          attach it to. No-ops entirely on the web. */}
      <NativePush />
      {/* Instant navigation acknowledgment — the ochre sliver along the top
          edge while a tapped route is still loading. Suspense because the
          component reads useSearchParams. */}
      <Suspense fallback={null}>
        <RouteProgress />
      </Suspense>
      <ScrollReset />
      <NativeTabBar />
      <NativeQuickPill
        shareUrl={profile?.username ? `https://picacho.ai/r/${profile.username}` : undefined}
      />
      {showRatePrompt && <RatePrompt />}
      <DownloadToasts />
      {/* data-app-scroll: the app's one real scroller — the native quick
          pill watches its scrollTop to decide when to slide in. */}
      <div data-app-scroll className="min-w-0 flex-1 overflow-y-auto">
        {/* pt-14 clears the fixed mobile top bar (see AppSidebar); not needed
            at md+ where that bar is hidden and the sidebar sits in-flow. */}
        {/* pb-24 in the app clears the fixed bottom tab bar — without it the
            last item on every page sits underneath it and can't be reached.
            The class is applied unconditionally rather than gated on the
            native check because that check is client-only, and a server-
            rendered page would otherwise briefly lay out at the wrong height. */}
        <div
          data-app-content
          className="mx-auto max-w-5xl px-4 py-8 pt-20 pb-24 sm:px-8 sm:py-12 sm:pb-24 md:pt-12"
        >
          {children}
        </div>
      </div>
    </div>
  );
}
