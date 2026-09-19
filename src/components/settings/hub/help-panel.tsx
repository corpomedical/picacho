import Link from "next/link";
import type { Messages } from "@/lib/i18n/messages";
import type { Locale } from "@/lib/i18n/locales";
import { formatMsg } from "@/lib/i18n/format";
import { localizedHref } from "@/lib/i18n/routing";
import { LEGAL_ENTITY } from "@/lib/legal-entity";
import { CURRENT_BUILD, CURRENT_VERSION } from "@/lib/changelog";
import { SettingsSection } from "@/components/settings/settings-section";
import { FeedbackForm } from "@/components/settings/feedback-form";
import { Chevron } from "@/components/settings/hub/parts";

// Help (was Support, 2026-09-19): the feedback form and the help address as
// before, plus what someone looks for in a settings page and could not find
// in this one — the guides, the legal pages, who runs Picacho, and which
// version they are on (CURRENT_VERSION existed and was shown nowhere).

function LinkRow({ href, label, external }: { href: string; label: string; external?: boolean }) {
  const cls = "flex min-h-11 items-center justify-between gap-3 text-sm text-atelier-ink transition-colors hover:text-atelier-accent";
  return (
    <li className="border-t border-atelier-rule/60 first:border-t-0">
      {external ? (
        <a href={href} className={cls}>
          {label}
          <Chevron />
        </a>
      ) : (
        <Link href={href} className={cls}>
          {label}
          <Chevron />
        </Link>
      )}
    </li>
  );
}

export function HelpPanel({
  t,
  locale,
  supportEmail,
  showApiDocs,
}: {
  t: Messages;
  locale: Locale;
  supportEmail: string;
  showApiDocs: boolean;
}) {
  const s = t.settings;
  const h = t.settingsHub;
  return (
    <div className="space-y-4">
      <SettingsSection title={h.helpTitle} description={h.helpDesc}>
        <FeedbackForm />
        <div className="border-t border-atelier-rule/60 pt-4 text-sm">
          <a
            href={`mailto:${supportEmail}?subject=${encodeURIComponent("Picacho help")}`}
            className="text-atelier-muted underline underline-offset-2 hover:text-atelier-ink"
          >
            {s.getHelp}
          </a>
        </div>
      </SettingsSection>

      <SettingsSection title={h.learnTitle}>
        <ul className="-my-2.5">
          <LinkRow href={localizedHref("/guides", locale)} label={h.guides} />
          <LinkRow href="/app/tutorial" label={s.tutorial} />
          <LinkRow href="/app/generate?tour=1" label={s.replayWalkthrough} />
          {showApiDocs && <LinkRow href="/docs/api" label={h.apiDocs} />}
        </ul>
      </SettingsSection>

      <div className="grid gap-4 md:grid-cols-2">
        <SettingsSection title={h.legalTitle}>
          <ul className="-my-2.5">
            <LinkRow href={localizedHref("/terms", locale)} label={h.legalTerms} />
            <LinkRow href={localizedHref("/privacy", locale)} label={h.legalPrivacy} />
            <LinkRow href={localizedHref("/content-policy", locale)} label={h.legalContent} />
          </ul>
        </SettingsSection>
        <SettingsSection title={h.whoRunsPicacho}>
          <div className="text-[13.5px] leading-relaxed">
            <p className="font-medium text-atelier-ink">{LEGAL_ENTITY.name}</p>
            <p className="text-atelier-muted">NIF {LEGAL_ENTITY.nif}</p>
            {LEGAL_ENTITY.addressLines.map((l) => (
              <p key={l} className="text-atelier-muted">
                {l}
              </p>
            ))}
            {LEGAL_ENTITY.registryLine && <p className="text-atelier-muted">{LEGAL_ENTITY.registryLine}</p>}
          </div>
        </SettingsSection>
      </div>

      <p className="px-1 font-mono text-[11px] uppercase tracking-[0.1em] text-atelier-muted">
        {formatMsg(h.version, { version: CURRENT_VERSION, build: CURRENT_BUILD })}
      </p>
    </div>
  );
}
