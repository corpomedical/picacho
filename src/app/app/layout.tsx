import { redirect } from "next/navigation";
import type { PlanId } from "@/lib/plans";
import { isVoiceModeEnabled } from "@/lib/voice/enabled";
import { isRecceEnabled, isSetsEnabled } from "@/lib/sets/enabled";
import { isRecastEnabled } from "@/lib/recast/enabled";
import { isLiveEnabled, isLiveOpenToPlans, liveAllowed } from "@/lib/live/enabled";
import { isEditorEnabled } from "@/lib/editor/enabled";
import { producerVisible, readProducerGrant } from "@/lib/producer/enabled";
import { countWatch, loadWatchBar } from "@/lib/producer/watch";
import { DEFAULT_PRODUCER_NAME } from "@/lib/producer/store";
import { ProducerLamp } from "@/components/producer/producer-lamp";
import { parseLampLook, type LampLook } from "@/components/producer/lamp-look";
import { isVoiceConfigured } from "@/lib/producer/speech";
import { setsEligible } from "@/lib/sets/set-config";
import { RatePrompt } from "@/components/rate-prompt";
import { NativePush } from "@/components/native-push";
import { WebPushSync } from "@/components/web-push-sync";
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
import { SUPPORT_EMAIL_FALLBACK } from "@/lib/domains";
import { SCREENING_FONT_VARS } from "@/lib/theme/screening-fonts";

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

  // Two-step verification: a session whose account has a verified factor
  // but hasn't presented it this sign-in goes to the challenge first —
  // without this, user MFA would be decoration (the admin layout has had
  // the same gate since 2026-09-05). Only ENROLLED accounts have nextLevel
  // aal2, so this can never gate someone with no factor.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    redirect("/verify-2fa");
  }

  const [
    { data: profileRow },
    { data: recentJobs },
    { data: supportEmailSetting },
    producerGranted,
  ] = await Promise.all([
    supabase.from("profiles").select("role, username, plan, plan_status, status, skip_ai_refinement, rating_prompted_at").eq("id", data.user.id).single(),
    // Explicit user_id filter below, not just RLS — an admin's SELECT
    // policy on generations intentionally allows reading every user's rows
    // (that's what powers /admin), so without this an admin browsing their
    // own /app pages would see everyone else's recent jobs here instead of
    // just their own. (The sidebar's Characters and Projects lists left with
    // the Tools door, 2026-09-25: their rows open the full pages.)
    supabase
      .from("generations")
      .select("id, prompt_input, status, content_type")
      .eq("user_id", data.user.id)
      // Rows are soft-deleted (the ledger keeps counting them); the jobs
      // menu is a user-facing surface, so deleted work must not linger here.
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(6),
    supabase.from("app_settings").select("value").eq("key", "support_email").single(),
    // An admin's grant of the Producer, on its own (lib/producer/enabled.ts):
    // before producer-access.sql runs it reads as not granted.
    readProducerGrant(supabase, data.user.id),
  ]);
  const profile = profileRow ? { ...profileRow, producer_access: producerGranted } : profileRow;

  const isAdmin = profile?.role === "admin";

  const voiceModeEnabled = await isVoiceModeEnabled(supabase);
  // Sets shows in the sidebar only to accounts that can open it (admins in
  // Phase 1). Eligibility first: it costs nothing, and spares everyone else
  // the flag read.
  const setsVisible = setsEligible(profile?.plan, isAdmin) && (await isSetsEnabled(supabase));
  // The Recce door (board K): admins only while in testing, behind its own
  // flag with both Sets switches under it. Admin first: spares everyone
  // else the flag read.
  const recceVisible = isAdmin && (await isRecceEnabled(supabase));
  // The Mystique door (working title): the same rule — admins only while
  // the recast lane is proved, behind its own flag.
  const mystiqueVisible = isAdmin && (await isRecastEnabled(supabase));
  // Live (H3 Max Director, 2026-09-24): admins, and every paid plan once
  // `live_paid_plans` is on (lib/live/enabled.ts), behind its own switch.
  // The plan first (no read): free accounts skip both flags, admins the plans one.
  const liveVisible =
    !liveAllowed(profile, true).error &&
    (isAdmin || (await isLiveOpenToPlans(supabase))) &&
    (await isLiveEnabled(supabase));
  // Director's Cut (2026-09-24): admins only, behind the video_editor
  // switch (lib/editor/enabled.ts). Admin first spares everyone the flag read.
  const cutVisible = isAdmin && (await isEditorEnabled(supabase));

  // The Producer's lamp (2026-09-24): admins, accounts an admin granted it
  // to, and Elite once `producer_elite` is on — the route's own rule
  // (lib/producer/enabled.ts producerVisible,
  // which a set's page asks too). Eligibility first, so every other account
  // skips the flag reads and the watch count.
  let producer: { name: string; watchCount: number; look: LampLook } | null = null;
  if (await producerVisible(supabase, profile, isAdmin)) {
    const [{ data: prefs }, { data: lookRow }, watchBar] = await Promise.all([
      supabase.from("producer_prefs").select("display_name, watch_seen_at").eq("user_id", data.user.id).maybeSingle(),
      // On its own: before producer-look.sql runs the column is missing, the
      // read errors, and the lamp simply takes the default look.
      supabase.from("producer_prefs").select("lamp_look").eq("user_id", data.user.id).maybeSingle(),
      loadWatchBar(supabase),
    ]);
    producer = {
      name: (prefs?.display_name as string | null)?.trim() || DEFAULT_PRODUCER_NAME,
      watchCount: await countWatch(supabase, data.user.id, prefs?.watch_seen_at as string | null, watchBar),
      look: parseLampLook((lookRow as { lamp_look?: unknown } | null)?.lamp_look),
    };
  }

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
      {/* The Screening Room's faces, published on :root for the whole app,
          portals included (lib/theme/screening-fonts.ts). Inline style is
          allowed by the CSP (style-src 'unsafe-inline'); the string is ours,
          built from next/font's own family names. */}
      <style dangerouslySetInnerHTML={{ __html: SCREENING_FONT_VARS }} />
      <AppErrorReporter />
      {/* Times how long this person actually uses the app — see the
          component for why it only beats while the tab is visible. */}
      <ActivityHeartbeat />
      <AppSidebar
        isAdmin={isAdmin}
        username={profile?.username ?? (data.user.email ?? "").split("@")[0]}
        plan={(profile?.plan ?? "none") as PlanId}
        recentJobs={recentJobs ?? []}
        supportEmail={supportEmailSetting?.value ?? SUPPORT_EMAIL_FALLBACK}
        skipAiRefinement={profile?.skip_ai_refinement === true}
        voiceModeEnabled={voiceModeEnabled}
        setsVisible={setsVisible}
        recceVisible={recceVisible}
        mystiqueVisible={mystiqueVisible}
        liveVisible={liveVisible}
        cutVisible={cutVisible}
      />
      {/* Registers this device for push, once there's a session to
          attach it to. No-ops entirely on the web. */}
      <NativePush />
      <WebPushSync />
      {/* Instant navigation acknowledgment — the ochre sliver along the top
          edge while a tapped route is still loading. Suspense because the
          component reads useSearchParams. */}
      <Suspense fallback={null}>
        <RouteProgress />
      </Suspense>
      <ScrollReset />
      {/* The Generate lamp offers Recast and Live to the accounts that can
          open them: the same gates as the sidebar's entries. */}
      <NativeTabBar recastOn={mystiqueVisible} liveOn={liveVisible} cutOn={cutVisible} />
      <NativeQuickPill
        shareUrl={profile?.username ? `https://picacho.ai/r/${profile.username}` : undefined}
      />
      {showRatePrompt && <RatePrompt />}
      <DownloadToasts />
      {producer && (
        <ProducerLamp
          name={producer.name}
          watchCount={producer.watchCount}
          voiceAvailable={isVoiceConfigured()}
          look={producer.look}
          diagnostics={isAdmin}
        />
      )}
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
