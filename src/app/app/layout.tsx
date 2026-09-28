import { redirect } from "next/navigation";
import type { PlanId } from "@/lib/plans";
import { isVoiceModeEnabled } from "@/lib/voice/enabled";
import { producerVisible, readProducerGrant } from "@/lib/producer/enabled";
import { readToolGates } from "@/lib/nav/gates";
import { countWatch, loadWatchBar } from "@/lib/producer/watch";
import { DEFAULT_PRODUCER_NAME } from "@/lib/producer/store";
import { ProducerLamp } from "@/components/producer/producer-lamp";
import { parseLampLook, type LampLook } from "@/components/producer/lamp-look";
import { parseWheelStyle, type WheelStyle } from "@/components/producer/wheel-style";
import { parseChatStyle, type ChatStyle } from "@/components/producer/chat-style";
import { isVoiceConfigured } from "@/lib/producer/speech";
import { isEUVisitor } from "@/lib/geo";
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
import { parseAppLook, resolveAppMode } from "@/lib/light/mode";
import { ChoiceFrame, LightShell, LookSync, ModeGate } from "@/components/light/light-shell";
import { InLightProvider } from "@/components/light/in-light";

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
    modeRead,
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
    // Picacho Light's two choices, on their own read: before
    // picacho-light.sql runs it errors, and everyone stays in the full
    // studio with no welcome step (lib/light/mode.ts resolveAppMode).
    supabase.from("profiles").select("app_mode, app_look").eq("id", data.user.id).maybeSingle(),
  ]);
  const profile = profileRow ? { ...profileRow, producer_access: producerGranted } : profileRow;

  const isAdmin = profile?.role === "admin";

  const modeRow = modeRead.data as { app_mode?: unknown; app_look?: unknown } | null;
  const { mode: appMode, needsChoice } = resolveAppMode({ error: modeRead.error, mode: modeRow?.app_mode });
  const accountLook = modeRead.error ? null : parseAppLook(modeRow?.app_look);

  const voiceModeEnabled = await isVoiceModeEnabled(supabase);
  // Which gated tools this account may open: one rule, shared with a take's
  // "Keep going" doors (lib/nav/gates.ts), each tool's plan or role read
  // before its flag.
  const { setsVisible, recceVisible, mystiqueVisible, liveVisible, cutVisible, pressTourVisible } = await readToolGates(
    supabase,
    profile,
  );

  // The Producer's lamp (2026-09-24): admins, accounts an admin granted it
  // to, and Elite once `producer_elite` is on — the route's own rule
  // (lib/producer/enabled.ts producerVisible,
  // which a set's page asks too). Eligibility first, so every other account
  // skips the flag reads and the watch count.
  let producer: { name: string; watchCount: number; look: LampLook; wheel: WheelStyle; chat: ChatStyle; currency: string } | null = null;
  if (await producerVisible(supabase, profile, isAdmin)) {
    const [{ data: prefs }, { data: lookRow }, { data: wheelRow }, { data: chatRow }, watchBar] = await Promise.all([
      supabase.from("producer_prefs").select("display_name, watch_seen_at").eq("user_id", data.user.id).maybeSingle(),
      // On its own: before producer-look.sql runs the column is missing, the
      // read errors, and the lamp simply takes the default look.
      supabase.from("producer_prefs").select("lamp_look").eq("user_id", data.user.id).maybeSingle(),
      // The same for the wheel and the chat before producer-wheel.sql: Filament, the card.
      supabase.from("producer_prefs").select("wheel_style").eq("user_id", data.user.id).maybeSingle(),
      supabase.from("producer_prefs").select("chat_style").eq("user_id", data.user.id).maybeSingle(),
      loadWatchBar(supabase),
    ]);
    producer = {
      name: (prefs?.display_name as string | null)?.trim() || DEFAULT_PRODUCER_NAME,
      watchCount: await countWatch(supabase, data.user.id, prefs?.watch_seen_at as string | null, watchBar),
      look: parseLampLook((lookRow as { lamp_look?: unknown } | null)?.lamp_look),
      wheel: parseWheelStyle((wheelRow as { wheel_style?: unknown } | null)?.wheel_style),
      chat: parseChatStyle((chatRow as { chat_style?: unknown } | null)?.chat_style),
      // What her top-ups are priced in for this visitor (lib/agent/topups.ts).
      currency: (await isEUVisitor()) ? "€" : "$",
    };
  }

  // PICACHO LIGHT (2026-09-28) and the welcome step: their own frame, none of
  // the studio's sidebar or tab bar. Light keeps the assistant's lamp
  // (operator, 2026-09-28: "Assistant should be available in light mode").
  if (appMode === "light" || needsChoice) {
    const recent = (recentJobs ?? []).map((j) => ({ id: j.id as string, prompt: (j.prompt_input as string | null) ?? "" }));
    return (
      <InLightProvider>
      <div className="frost-ground flex h-full overflow-hidden">
        <style dangerouslySetInnerHTML={{ __html: SCREENING_FONT_VARS }} />
        <AppErrorReporter />
        <ActivityHeartbeat />
        <ModeGate mode={appMode} needsChoice={needsChoice} />
        <LookSync look={accountLook} />
        <NativePush />
        <WebPushSync />
        <Suspense fallback={null}>
          <RouteProgress />
        </Suspense>
        <DownloadToasts />
        {needsChoice ? (
          <div data-app-scroll className="min-w-0 flex-1 overflow-y-auto">
            <ChoiceFrame>{children}</ChoiceFrame>
          </div>
        ) : (
          <Suspense fallback={null}>
            <LightShell recent={recent} isAdmin={isAdmin}>
              {children}
            </LightShell>
          </Suspense>
        )}
        {producer && !needsChoice && (
          <ProducerLamp
            name={producer.name}
            watchCount={producer.watchCount}
            voiceAvailable={isVoiceConfigured()}
            look={producer.look}
            wheelStyle={producer.wheel}
            chatStyle={producer.chat}
            diagnostics={isAdmin}
            currency={producer.currency}
          />
        )}
      </div>
      </InLightProvider>
    );
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
      <LookSync look={accountLook} />
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
        pressTourVisible={pressTourVisible}
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
      {/* The Generate lamp offers Recast, Press Tour, Live and Director's Cut
          to the accounts that can open them: the same gates as the sidebar's
          entries. */}
      <NativeTabBar recastOn={mystiqueVisible} pressTourOn={pressTourVisible} liveOn={liveVisible} cutOn={cutVisible} />
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
          wheelStyle={producer.wheel}
          chatStyle={producer.chat}
          diagnostics={isAdmin}
          currency={producer.currency}
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
