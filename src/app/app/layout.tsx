import { redirect } from "next/navigation";
import type { PlanId } from "@/lib/plans";
import { isVoiceModeEnabled } from "@/lib/voice/enabled";
import { isProducerLiveEnabled, producerVisible, readProducerGrant } from "@/lib/producer/enabled";
import { readToolGates } from "@/lib/nav/gates";
import { countWatch, loadWatchBar } from "@/lib/producer/watch";
import { DEFAULT_PRODUCER_NAME } from "@/lib/producer/store";
import { ProducerLamp } from "@/components/producer/producer-lamp";
import { AlyPointer } from "@/components/producer/aly-pointer";
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
import { firstName, parseAppLook, resolveAppMode } from "@/lib/light/mode";
import { ChoiceFrame, LightShell, LookSync, ModeGate } from "@/components/light/light-shell";
import { InLightProvider } from "@/components/light/in-light";
import { isAlyChatEnabled } from "@/lib/aly-chat/enabled";
import { serverTimer, type ServerTimer } from "@/lib/server-timing";
import { verifiedClaims } from "@/lib/supabase/claims";
import { ServerTimingMark } from "@/components/server-timing-mark";
import { AccountMenuProvider } from "@/components/account-menu/account-menu";

type Db = Awaited<ReturnType<typeof createClient>>;
type Chrome = Awaited<ReturnType<typeof loadChrome>>;

/**
 * Everything the app's chrome shows — the sidebar's profile, plan, jobs and tools, the tab bar's doors,
 * the rating prompt, the assistant's lamp — read at once (2026-09-30: every /app page used to wait on these
 * before sending anything). Timed step by step for our own measurement (lib/server-timing.ts).
 */
async function loadChrome(supabase: Db, userId: string, tm: ServerTimer) {
  const [
    { data: profileRow },
    { data: recentJobs },
    { data: supportEmailSetting },
    producerGranted,
    ratingCount,
  ] = await Promise.all([
    tm.step("profile", () => supabase.from("profiles").select("role, username, full_name, plan, plan_status, status, skip_ai_refinement, rating_prompted_at").eq("id", userId).single()),
    // Explicit user_id filter below, not just RLS — an admin's SELECT
    // policy on generations intentionally allows reading every user's rows
    // (that's what powers /admin), so without this an admin browsing their
    // own /app pages would see everyone else's recent jobs here instead of
    // just their own. (The sidebar's Characters and Projects lists left with
    // the Tools door, 2026-09-25: their rows open the full pages.)
    tm.step("jobs", () =>
      supabase
        .from("generations")
        .select("id, prompt_input, status, content_type")
        .eq("user_id", userId)
        // Rows are soft-deleted (the ledger keeps counting them); the jobs
        // menu is a user-facing surface, so deleted work must not linger here.
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(6),
    ),
    tm.step("support", () => supabase.from("app_settings").select("value").eq("key", "support_email").single()),
    // An admin's grant of the Producer, on its own (lib/producer/enabled.ts):
    // before producer-access.sql runs it reads as not granted.
    tm.step("grant", () => readProducerGrant(supabase, userId)),
    // Ask for a rating only once someone has had enough successful results to
    // hold an opinion, and only once ever (rating_prompted_at is stamped by
    // both answering and dismissing). head+count so this is a cheap COUNT
    // rather than pulling rows on every page load.
    tm.step("count", () => supabase.from("generations").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "succeeded")),
  ]);
  const profile = profileRow ? { ...profileRow, producer_access: producerGranted } : profileRow;
  const isAdmin = profile?.role === "admin";

  // The flags don't depend on each other: read at once, not one after another.
  const [voiceModeEnabled, toolGates, producerOk, alyChatOn] = await Promise.all([
    tm.step("voice", () => isVoiceModeEnabled(supabase)),
    // Which gated tools this account may open: one rule, shared with a take's
    // "Keep going" doors (lib/nav/gates.ts), each tool's plan or role read
    // before its flag.
    tm.step("gates", () => readToolGates(supabase, profile)),
    // The Producer's lamp (2026-09-24): admins, accounts an admin granted it
    // to, and Elite once `producer_elite` is on — the route's own rule
    // (lib/producer/enabled.ts producerVisible, which a set's page asks too).
    tm.step("producer", () => producerVisible(supabase, profile, isAdmin)),
    tm.step("aly", () => isAlyChatEnabled(supabase)),
  ]);

  // Eligibility first, so every other account skips the lamp's reads and the watch count.
  let producer: { name: string; watchCount: number; look: LampLook; wheel: WheelStyle; chat: ChatStyle; currency: string; live: boolean } | null =
    null;
  if (producerOk) {
    const [{ data: prefs }, { data: lookRow }, { data: wheelRow }, { data: chatRow }, watchBar, live] = await tm.step("lamp", () =>
      Promise.all([
        supabase.from("producer_prefs").select("display_name, watch_seen_at").eq("user_id", userId).maybeSingle(),
        // On its own: before producer-look.sql runs the column is missing, the
        // read errors, and the lamp simply takes the default look.
        supabase.from("producer_prefs").select("lamp_look").eq("user_id", userId).maybeSingle(),
        // The same for the wheel and the chat before producer-wheel.sql: Filament, the card.
        supabase.from("producer_prefs").select("wheel_style").eq("user_id", userId).maybeSingle(),
        supabase.from("producer_prefs").select("chat_style").eq("user_id", userId).maybeSingle(),
        loadWatchBar(supabase),
        // Her live voice when they press Talk (lib/producer/live.ts).
        isProducerLiveEnabled(supabase),
      ]),
    );
    const [watchCount, eu] = await tm.step("watch", () => Promise.all([countWatch(supabase, userId, prefs?.watch_seen_at as string | null, watchBar), isEUVisitor()]));
    producer = {
      name: (prefs?.display_name as string | null)?.trim() || DEFAULT_PRODUCER_NAME,
      watchCount,
      look: parseLampLook((lookRow as { lamp_look?: unknown } | null)?.lamp_look),
      wheel: parseWheelStyle((wheelRow as { wheel_style?: unknown } | null)?.wheel_style),
      chat: parseChatStyle((chatRow as { chat_style?: unknown } | null)?.chat_style),
      // What her top-ups are priced in for this visitor (lib/agent/topups.ts).
      currency: eu ? "€" : "$",
      live,
    };
  }

  // Aly's own chat page (2026-09-29): every plan, behind the aly_chat flag.
  // Her name is the one the person gave her (the lamp's, when they have it).
  let alyChat: { name: string } | null = null;
  if (alyChatOn) {
    let name = producer?.name ?? null;
    if (!name) {
      const { data: prefs } = await tm.step("alyname", () => supabase.from("producer_prefs").select("display_name").eq("user_id", userId).maybeSingle());
      name = (prefs?.display_name as string | null)?.trim() || DEFAULT_PRODUCER_NAME;
    }
    alyChat = { name };
  }

  return {
    profile,
    isAdmin,
    recentJobs: recentJobs ?? [],
    supportEmail: (supportEmailSetting?.value as string | undefined) ?? SUPPORT_EMAIL_FALLBACK,
    voiceModeEnabled,
    gates: toolGates,
    producer,
    alyChatOn,
    alyChat,
    showRatePrompt: (ratingCount.count ?? 0) >= 3 && !profile?.rating_prompted_at,
  };
}

function Lamp({ producer, isAdmin }: { producer: NonNullable<Chrome["producer"]>; isAdmin: boolean }) {
  return (
    <ProducerLamp
      name={producer.name}
      watchCount={producer.watchCount}
      voiceAvailable={isVoiceConfigured()}
      look={producer.look}
      wheelStyle={producer.wheel}
      chatStyle={producer.chat}
      diagnostics={isAdmin}
      currency={producer.currency}
      liveVoice={producer.live}
    />
  );
}

/**
 * The app's chrome, streamed in its own time (2026-09-30): the sidebar, the tab bar and quick pill, the rating
 * prompt and the lamp. The page beside it — the Studio's "Opening the set…" above all — no longer waits for it.
 */
async function AppChrome({ userId, email }: { userId: string; email: string }) {
  const tm = serverTimer("chrome");
  const supabase = await createClient();
  const c = await loadChrome(supabase, userId, tm);
  const { setsVisible, recceVisible, mystiqueVisible, liveVisible, cutVisible, effectsVisible, pressTourVisible } = c.gates;
  return (
    <>
      {/* data-app-chrome: the sidebar and the tab bar step out of the way (display: none, studio-opening.tsx)
          while Helios Studio covers the screen — so their links, hidden behind it, aren't prefetched. */}
      <div data-app-chrome className="contents">
        <AppSidebar
          isAdmin={c.isAdmin}
          username={c.profile?.username ?? email.split("@")[0]}
          plan={(c.profile?.plan ?? "none") as PlanId}
          recentJobs={c.recentJobs}
          supportEmail={c.supportEmail}
          skipAiRefinement={c.profile?.skip_ai_refinement === true}
          voiceModeEnabled={c.voiceModeEnabled}
          setsVisible={setsVisible}
          recceVisible={recceVisible}
          mystiqueVisible={mystiqueVisible}
          liveVisible={liveVisible}
          cutVisible={cutVisible}
          effectsVisible={effectsVisible}
          pressTourVisible={pressTourVisible}
          alyChat={c.alyChat}
        />
      </div>
      {/* The Generate lamp offers Recast, Press Tour, Live and Director's Cut
          to the accounts that can open them: the same gates as the sidebar's
          entries. */}
      <div data-app-chrome className="contents">
        <NativeTabBar recastOn={mystiqueVisible} pressTourOn={pressTourVisible} liveOn={liveVisible} cutOn={cutVisible} effectsOn={effectsVisible} />
        <NativeQuickPill shareUrl={c.profile?.username ? `https://picacho.ai/r/${c.profile.username}` : undefined} />
      </div>
      {c.showRatePrompt && <RatePrompt />}
      {c.producer && <Lamp producer={c.producer} isAdmin={c.isAdmin} />}
      <ServerTimingMark value={tm.value()} />
    </>
  );
}

/** Where the sidebar will be, while it streams: its width on a laptop, nothing on a phone (its bar is fixed). */
function ChromeSpace() {
  return (
    <div data-app-chrome className="contents">
      <div aria-hidden className="hidden h-screen w-64 flex-shrink-0 border-r border-atelier-rule bg-atelier-surface/75 md:block" />
    </div>
  );
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tm = serverTimer("layout");
  const supabase = await createClient();
  // Who this is (2026-09-30): the session's signed claims, verified locally — the same check the proxy runs on
  // every /app request before this layout is reached (lib/supabase/middleware.ts getClaims, which also refreshes
  // an expiring token and falls back to the auth server on a token it can't verify locally). It replaced a
  // getUser() round trip to the auth server that every /app page waited on. Revocation stays where it was: the
  // proxy's own profiles.status check on every /app request. No session: /login, before anything is sent.
  // The signing keys come from the deployment's shared cache, not a fetch per cold instance
  // (lib/supabase/claims.ts; live the step took ~220 ms).
  const claims = await tm.step("auth", () => verifiedClaims(supabase));
  const userId = typeof claims?.sub === "string" ? claims.sub : null;
  if (!userId) {
    redirect("/login");
  }
  const email = typeof claims?.email === "string" ? claims.email : "";

  const [{ data: aal }, modeRead] = await Promise.all([
    // Two-step verification: a session whose account has a verified factor
    // but hasn't presented it this sign-in goes to the challenge first —
    // without this, user MFA would be decoration (the admin layout has had
    // the same gate since 2026-09-05). Only ENROLLED accounts have nextLevel
    // aal2, so this can never gate someone with no factor.
    tm.step("aal", () => supabase.auth.mfa.getAuthenticatorAssuranceLevel()),
    // Picacho Light's two choices, on their own read: before
    // picacho-light.sql runs it errors, and everyone stays in the full
    // studio with no welcome step (lib/light/mode.ts resolveAppMode). The one
    // read the frame waits for: it decides which frame this is.
    tm.step("mode", () => supabase.from("profiles").select("app_mode, app_look").eq("id", userId).maybeSingle()),
  ]);
  if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    redirect("/verify-2fa");
  }

  const modeRow = modeRead.data as { app_mode?: unknown; app_look?: unknown } | null;
  const { mode: appMode, needsChoice } = resolveAppMode({ error: modeRead.error, mode: modeRow?.app_mode });
  const accountLook = modeRead.error ? null : parseAppLook(modeRow?.app_look);

  // PICACHO LIGHT (2026-09-28) and the welcome step: their own frame, none of
  // the studio's sidebar or tab bar. Light keeps the assistant's lamp
  // (operator, 2026-09-28: "Assistant should be available in light mode").
  // Its shell needs its data up front (the rail's list, the account letter).
  if (appMode === "light" || needsChoice) {
    const c = await loadChrome(supabase, userId, tm);
    const profile = c.profile;
    const recent = c.recentJobs.map((j) => ({ id: j.id as string, prompt: (j.prompt_input as string | null) ?? "" }));
    // Aly is Light's chat when her chat is open (2026-09-29): the rail then
    // lists her chats instead of the latest takes.
    const lightAly = !needsChoice && c.alyChatOn;
    // The account button's letter on Light's other pages, as the chat's top
    // bar draws it (its first name, else the username or email).
    const lightInitial = (
      (firstName((profile as { full_name?: string | null } | null)?.full_name ?? null) ?? profile?.username ?? email ?? "?").trim()[0] ?? "?"
    ).toUpperCase();
    return (
      <InLightProvider>
      <AccountMenuProvider>
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
            <LightShell recent={recent} alyChat={lightAly} isAdmin={c.isAdmin} initial={lightInitial}>
              {children}
            </LightShell>
          </Suspense>
        )}
        {/* Where Aly takes them and what she points at (open_page): her lamp and her chat both use it. */}
        <AlyPointer />
        {c.producer && !needsChoice && <Lamp producer={c.producer} isAdmin={c.isAdmin} />}
        <ServerTimingMark value={tm.value()} />
      </div>
      </AccountMenuProvider>
      </InLightProvider>
    );
  }

  // THE FRAME SENDS AT ONCE (2026-09-30, operator: "Speed up the loading" · "measure it"): only who this is and
  // which frame they use are awaited above. The chrome's own reads stream in beside the page (AppChrome, in
  // its own Suspense), so a page's first paint — the Studio's "Opening the set…" above all — never waits on
  // the sidebar's profile, jobs, flags and counts.
  //
  // h-full, not h-screen: html/body are pinned to 100% while this shell is
  // mounted (globals.css, the :has([data-app-scroll]) rule), so 100% here is
  // the viewport MINUS body's safe-area padding — the shell fits exactly and
  // the document has nothing left to scroll. h-screen was 100vh, which
  // overflowed the padded body by the inset sum and gave every app page a
  // second, momentum-killing document scroller (the two-swipe dashboard).
  // The account menu (2026-10-02) wraps the chrome and the page alike: the
  // sidebar's name and the Generate header's credits open the same one.
  return (
    <AccountMenuProvider>
    <div className="frost-ground flex h-full overflow-hidden">
      {/* The Screening Room's faces, published on :root for the whole app,
          portals included (lib/theme/screening-fonts.ts). Inline style is
          allowed by the CSP (style-src 'unsafe-inline'); the string is ours,
          built from next/font's own family names. */}
      <style dangerouslySetInnerHTML={{ __html: SCREENING_FONT_VARS }} />
      <ServerTimingMark value={tm.value()} />
      <AppErrorReporter />
      <LookSync look={accountLook} />
      {/* Times how long this person actually uses the app — see the
          component for why it only beats while the tab is visible. */}
      <ActivityHeartbeat />
      <Suspense fallback={<ChromeSpace />}>
        <AppChrome userId={userId} email={email} />
      </Suspense>
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
      <DownloadToasts />
      {/* Where Aly takes them and what she points at (open_page): her lamp and her chat both use it. */}
      <AlyPointer />
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
    </AccountMenuProvider>
  );
}
