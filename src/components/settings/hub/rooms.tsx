import Link from "next/link";
import { ProducerNameForm } from "@/components/settings/producer-name-form";
import type { Messages } from "@/lib/i18n/messages";
import type { Locale } from "@/lib/i18n/locales";
import { localizedHref } from "@/lib/i18n/routing";
import type { GenerationDefaults } from "@/lib/generations/generation-defaults";
import { SettingsSection } from "@/components/settings/settings-section";
import { UsernameForm } from "@/components/settings/username-form";
import { ProfileForm } from "@/components/profile-form";
import { InviteCard } from "@/components/invite-card";
import { GenerationDefaultsForm } from "@/components/settings/generation-defaults-form";
import { SkipRefinementToggle } from "@/components/settings/skip-refinement-toggle";
import { BrandRulesPanel } from "@/components/brand-rules-panel";
import { ThemePicker } from "@/components/settings/theme-picker";
import { LanguageSwitcher } from "@/components/language-switcher";
import { NotificationsPanel } from "@/components/settings/notifications-panel";
import { MarketingEmailsToggle } from "@/components/settings/marketing-emails-toggle";
import { EmailForm } from "@/components/settings/email-form";
import { PasswordForm } from "@/components/settings/password-form";
import { MfaCard } from "@/components/settings/mfa-card";
import { ConnectedAccountRows } from "@/components/settings/connected-accounts-card";
import { SessionsCard } from "@/components/settings/sessions-card";
import { ApiKeysCard, type ApiKeyRow } from "@/components/settings/api-keys-card";
import {
  BlockedAccountsList,
  CookieChoiceControl,
  SharedPostsList,
  type BlockedRow,
  type SharedPostRow,
} from "@/components/settings/privacy-panel";
import { DeleteAccountForm } from "@/components/settings/delete-account-form";
import { IdentityCard } from "@/components/settings/hub/overview";
import { EditRow, RowList, ValueRow } from "@/components/settings/hub/setting-rows";
import { BUTTON_SECONDARY } from "@/components/settings/hub/parts";
import type { getBrandRules } from "@/lib/brand-rules/actions";
import type { buildVideoModelOptions } from "@/lib/generations/workspace-data";

// The five rooms after the Overview, in its language (2026-09-19, operator:
// "The settings page is incomplete" → "The other tabs"). Each setting reads
// as what it is — its current value on a row, "Change" to open the form in
// place — instead of open forms stacked on one another. Every form inside
// is the same component, doing the same thing, as before.

export function ProfileTab({
  t,
  locale,
  identity,
  gender,
  referralStats,
}: {
  t: Messages;
  locale: Locale;
  identity: { name: string | null; username: string | null; email: string; company: string | null; memberSince: string };
  gender: string;
  referralStats: { joined: number; rewarded: number } | null;
}) {
  const s = t.settings;
  const h = t.settingsHub;
  const notSet = <span className="text-atelier-muted">{h.notSet}</span>;
  const nameCompany = [identity.name?.trim(), identity.company?.trim()].filter(Boolean).join(" · ");
  return (
    <div className="space-y-4">
      <IdentityCard {...identity} locale={locale} h={h} showEdit={false} />
      {/* Only the username is ever shown to anyone else (community posts
          say @username, the invite link is /r/username). */}
      <SettingsSection title={h.publicProfileTitle} description={h.publicProfileDesc}>
        <RowList>
          <EditRow
            label={s.usernameLabel}
            value={identity.username ? `@${identity.username}` : notSet}
            editLabel={h.change}
            closeLabel={h.close}
          >
            <UsernameForm initialUsername={identity.username ?? ""} />
          </EditRow>
        </RowList>
      </SettingsSection>
      <SettingsSection title={h.aboutYouTitle} description={h.aboutYouDesc}>
        <RowList>
          <EditRow label={h.rowNameCompany} value={nameCompany || notSet} editLabel={h.change} closeLabel={h.close}>
            <ProfileForm
              initialFullName={identity.name ?? ""}
              initialCompany={identity.company ?? ""}
              initialGender={gender}
            />
          </EditRow>
        </RowList>
      </SettingsSection>
      {/* Only with a real username: a link built from anything else resolves
          for nobody (the /r route matches profiles.username exactly). */}
      {identity.username && <InviteCard username={identity.username} stats={referralStats} />}
    </div>
  );
}

export function GenerationTab({
  t,
  models,
  globalModelId,
  defaults,
  skipRefinement,
  brandRules,
  brandRulesPaused,
}: {
  t: Messages;
  models: ReturnType<typeof buildVideoModelOptions>;
  globalModelId: string;
  defaults: GenerationDefaults;
  skipRefinement: boolean;
  brandRules: Awaited<ReturnType<typeof getBrandRules>>;
  brandRulesPaused: boolean;
}) {
  const s = t.settings;
  return (
    <div className="space-y-4">
      <SettingsSection title={s.generationDefaultsTitle} description={s.generationDefaultsDesc}>
        <GenerationDefaultsForm models={models} globalDefaultModelId={globalModelId} initial={defaults} />
      </SettingsSection>
      <SettingsSection title={s.aiGeneration} description={s.aiGenerationDesc}>
        <SkipRefinementToggle initialEnabled={skipRefinement} />
      </SettingsSection>
      {/* Brand rules shape every take, so they live here (a tab of their own
          until 2026-09-19); ?tab=brand lands on this anchor. */}
      <div id="brand-rules" className="scroll-mt-24">
        <BrandRulesPanel rules={brandRules} enforcementPaused={brandRulesPaused} />
      </div>
    </div>
  );
}

export function PreferencesTab({
  t,
  notifyPrefs,
  vapidPublicKey,
  nativeApp,
  setsOn,
  marketingEnabled,
  producerName = null,
}: {
  t: Messages;
  notifyPrefs: { notify_render_ready: boolean; notify_render_failed: boolean; notify_low_credits: boolean };
  vapidPublicKey: string | null;
  nativeApp: boolean;
  setsOn: boolean;
  marketingEnabled: boolean;
  /** The Producer's name, or null when this account has no Producer. */
  producerName?: string | null;
}) {
  const s = t.settings;
  return (
    <div className="space-y-4">
      <SettingsSection title={s.appearance} description={s.appearanceDesc}>
        <div>
          <ThemePicker />
          <p className="mt-2 text-xs text-atelier-muted">{s.appearanceSubtitle}</p>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-atelier-rule/60 pt-5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-atelier-ink">{s.language}</p>
            <p className="mt-0.5 text-xs text-atelier-muted">{s.languageSubtitle}</p>
          </div>
          <LanguageSwitcher />
        </div>
      </SettingsSection>
      {producerName !== null && (
        <SettingsSection title="Your assistant" description="What the lamp in the corner answers to. Pick one, or give it your own name.">
          <ProducerNameForm initialName={producerName} />
        </SettingsSection>
      )}
      {/* ?tab=notifications lands on this anchor. */}
      <div id="notifications" className="scroll-mt-24 space-y-4">
        <SettingsSection title={s.notificationsTitle} description={s.notificationsDesc}>
          <NotificationsPanel
            initial={notifyPrefs}
            vapidPublicKey={vapidPublicKey}
            nativeApp={nativeApp}
            // Sets are on the web only (the Android app shows webOnly): the app never names them.
            setsOn={setsOn && !nativeApp}
          />
        </SettingsSection>
        {/* Email beside push: both answer "what is Picacho allowed to send
            me". enabled = NOT opted out. */}
        <SettingsSection title={s.emailPreferences} description={s.emailPreferencesDesc}>
          <MarketingEmailsToggle initialEnabled={marketingEnabled} />
        </SettingsSection>
      </div>
    </div>
  );
}

export function SecurityTab({
  t,
  email,
  hasPassword,
  apiEnabled,
  apiKeys,
}: {
  t: Messages;
  email: string;
  hasPassword: boolean;
  apiEnabled: boolean;
  apiKeys: ApiKeyRow[];
}) {
  const s = t.settings;
  const h = t.settingsHub;
  return (
    <div className="space-y-4">
      <SettingsSection title={h.signInTitle} description={h.signInDesc}>
        <RowList>
          <EditRow label={s.emailLabel} value={email} editLabel={h.change} closeLabel={h.close}>
            <EmailForm initialEmail={email} />
          </EditRow>
          <EditRow
            label={h.rowPassword}
            value={hasPassword ? h.passwordSet : <span className="text-atelier-muted">{h.passwordNone}</span>}
            editLabel={hasPassword ? h.change : s.setPasswordCta}
            closeLabel={h.close}
          >
            <PasswordForm hasPassword={hasPassword} />
          </EditRow>
          {/* Google and email sign-in, one way in per row. */}
          <ConnectedAccountRows />
        </RowList>
      </SettingsSection>
      <SettingsSection title={s.mfaTitle} description={s.mfaDesc}>
        <MfaCard />
      </SettingsSection>
      <SettingsSection title={s.sessionsTitle} description={s.sessionsDesc}>
        <SessionsCard />
      </SettingsSection>
      {/* Live credentials belong with the rest of them. */}
      {apiEnabled && <ApiKeysCard keys={apiKeys} enabled />}
    </div>
  );
}

export function PrivacyTab({
  t,
  locale,
  sharedPosts,
  blocked,
  supportEmail,
  deleteConfirmWith,
}: {
  t: Messages;
  locale: Locale;
  sharedPosts: SharedPostRow[];
  blocked: BlockedRow[];
  supportEmail: string;
  deleteConfirmWith: string;
}) {
  const s = t.settings;
  const h = t.settingsHub;
  return (
    <div className="space-y-4">
      <SettingsSection title={s.sharedPostsTitle} description={s.sharedPostsDesc}>
        <SharedPostsList initial={sharedPosts} />
      </SettingsSection>
      <SettingsSection title={s.blockedTitle} description={s.blockedDesc}>
        <BlockedAccountsList initial={blocked} />
      </SettingsSection>
      <SettingsSection title={s.cookieTitle} description={s.cookieDesc}>
        <CookieChoiceControl />
      </SettingsSection>
      {/* What the privacy policy promises, said where people look for it:
          content kept while the account is active, a copy on request
          (portability goes through the support address, privacy.ts). */}
      <SettingsSection title={h.yourDataTitle} description={h.yourDataDesc}>
        <RowList>
          <ValueRow label={h.dataKeptLabel} value={h.dataKeptValue} />
          <ValueRow
            label={h.dataCopyLabel}
            value={h.dataCopyValue}
            action={
              <a
                href={`mailto:${supportEmail}?subject=${encodeURIComponent("A copy of my Picacho data")}`}
                className={BUTTON_SECONDARY}
              >
                {h.dataCopyCta}
              </a>
            }
          />
          <ValueRow
            label={h.dataDetailsLabel}
            value={
              <Link
                href={localizedHref("/privacy", locale)}
                className="text-atelier-ink underline underline-offset-2 transition-colors hover:text-atelier-accent"
              >
                {h.legalPrivacy}
              </Link>
            }
          />
        </RowList>
      </SettingsSection>
      {/* tone="danger": atelier-accent has both themes. */}
      <SettingsSection tone="danger" title={s.dangerZone} description={s.dangerDesc}>
        <DeleteAccountForm confirmWith={deleteConfirmWith} />
      </SettingsSection>
    </div>
  );
}
