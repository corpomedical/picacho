"use client";

import { useState } from "react";
import { addBrandRule, applyBrandRulePack, deleteBrandRule, toggleBrandRule } from "@/lib/brand-rules/actions";
import { BRAND_RULE_PACKS } from "@/lib/brand-rules/packs";
import type { BrandRule } from "@/lib/brand-rules/types";
import { Label, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SettingsSection } from "@/components/settings/settings-section";
import { BUTTON_SECONDARY } from "@/components/settings/hub/parts";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";

// Two rule kinds with genuinely different behaviour, so the form makes the
// choice explicit rather than burying it: a "require" rule is repaired
// automatically if the finished prompt lost it, while a "forbid" rule stops
// the generation outright. See BRAND_RULEBOOK_DESIGN.md.
//
// Settings → Generation (2026-09-19): the rules in force come first, one per
// row; the form opens under them on "Add rule" and closes once the rule is
// in; the industry presets are a section of their own below. Same actions.
export function BrandRulesPanel({
  rules,
  enforcementPaused,
}: {
  rules: BrandRule[];
  enforcementPaused?: boolean;
}) {
  const { t } = useLocale();
  const b = t.brandRules;
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<"require" | "forbid">("forbid");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(formData: FormData) {
    setPending(true);
    setError(null);
    formData.set("kind", kind);
    const result = await addBrandRule(formData);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setAdding(false);
    router.refresh();
  }

  // Both of these discarded their result and refreshed anyway, so a failed
  // toggle or delete rendered as the rule simply snapping back — the panel
  // already has an error line, it just was not being fed.
  async function handleToggle(rule: BrandRule) {
    setError(null);
    const fd = new FormData();
    fd.set("id", rule.id);
    fd.set("active", String(!rule.active));
    const result = await toggleBrandRule(fd);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function handleDelete(rule: BrandRule) {
    if (!window.confirm(b.deleteConfirm)) return;
    setError(null);
    const fd = new FormData();
    fd.set("id", rule.id);
    const result = await deleteBrandRule(fd);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function handleApplyPack(packId: string) {
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set("pack", packId);
    const result = await applyBrandRulePack(fd);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  const selectClass =
    "mt-1 rounded-control border border-atelier-rule bg-transparent px-3 py-2 text-sm text-atelier-ink outline-none transition-colors focus:border-atelier-accent";

  return (
    <div className="space-y-4">
      <SettingsSection title={b.title} description={b.subtitle}>
        {/* Honesty banner: rules stay editable while enforcement is globally
            switched off, and nobody should discover that the hard way. */}
        {enforcementPaused && (
          <p className="rounded-control bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
            {b.pausedNotice}
          </p>
        )}

        {rules.length === 0 ? (
          <p className="text-sm text-atelier-muted">{b.noRules}</p>
        ) : (
          <ul className="-mt-3 mb-2 divide-y divide-atelier-rule/60">
            {rules.map((rule) => (
              <li key={rule.id} className={cn("flex items-start gap-4 py-3", !rule.active && "opacity-50")}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-atelier-ink">{rule.label}</span>
                    <Badge tone={rule.kind === "forbid" ? "danger" : "neutral"}>
                      {rule.kind === "forbid" ? b.kindForbid : b.kindRequire}
                    </Badge>
                    {rule.kind === "forbid" && rule.severity === "warn" && (
                      <Badge tone="neutral">{b.severityWarn}</Badge>
                    )}
                    {rule.appliesTo !== "all" && (
                      <Badge tone="neutral">
                        {rule.appliesTo === "image" ? b.appliesImage : b.appliesVideo}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 break-words text-[13px] leading-relaxed text-atelier-muted">{rule.value}</p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-3 pt-0.5">
                  <button
                    type="button"
                    onClick={() => handleToggle(rule)}
                    className="text-xs text-atelier-muted hover:text-atelier-ink"
                  >
                    {rule.active ? b.disable : b.enable}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(rule)}
                    className="text-xs text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                  >
                    {b.delete}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {adding ? (
          <form action={handleAdd} className="space-y-4 rounded-control border border-atelier-rule p-4">
            <div className="flex gap-2">
              {(["forbid", "require"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  aria-pressed={kind === k}
                  className={cn(
                    // Accent border marks the ACTIVE choice — same idiom as the
                    // sidebar theme picker (accent = active state, not chrome).
                    "flex-1 rounded-control border px-3 py-2.5 text-left transition-colors",
                    kind === k
                      ? "border-atelier-accent bg-atelier-accent/5"
                      : "border-atelier-rule hover:border-atelier-muted",
                  )}
                >
                  <span className="block text-sm font-medium text-atelier-ink">
                    {k === "forbid" ? b.kindForbid : b.kindRequire}
                  </span>
                  <span className="mt-0.5 block text-xs text-atelier-muted">
                    {k === "forbid" ? b.kindForbidHint : b.kindRequireHint}
                  </span>
                </button>
              ))}
            </div>

            <div>
              <Label htmlFor="label">{b.labelField}</Label>
              <Input id="label" name="label" required placeholder={b.labelPlaceholder} maxLength={60} />
            </div>

            <div>
              <Label htmlFor="value">{b.valueField}</Label>
              <Input id="value" name="value" required placeholder={b.valuePlaceholder} maxLength={300} />
            </div>

            <div className="flex flex-wrap gap-4">
              <div>
                <Label htmlFor="applies_to">{b.appliesTo}</Label>
                <select id="applies_to" name="applies_to" defaultValue="all" className={selectClass}>
                  <option value="all">{b.appliesAll}</option>
                  <option value="image">{b.appliesImage}</option>
                  <option value="video">{b.appliesVideo}</option>
                </select>
              </div>

              {kind === "forbid" && (
                <div>
                  <Label htmlFor="severity">{b.severity}</Label>
                  <select id="severity" name="severity" defaultValue="block" className={selectClass}>
                    <option value="block">{b.severityBlock}</option>
                    <option value="warn">{b.severityWarn}</option>
                  </select>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setAdding(false);
                  setError(null);
                }}
                disabled={pending}
              >
                {t.settingsHub.close}
              </Button>
              <Button type="submit" pending={pending} pendingLabel={b.adding}>
                {b.addRule}
              </Button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className={BUTTON_SECONDARY}>
            {b.addRule}
          </button>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <p className="border-t border-atelier-rule/60 pt-4 text-xs leading-relaxed text-atelier-muted">
          {b.promptLevelNote}
        </p>
      </SettingsSection>

      <SettingsSection title={b.packsTitle} description={b.packsSubtitle}>
        <ul className="-mt-3 mb-2 divide-y divide-atelier-rule/60">
          {BRAND_RULE_PACKS.map((pack) => (
            <li key={pack.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-atelier-ink">{pack.name}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-atelier-muted">{pack.description}</p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={pending}
                onClick={() => handleApplyPack(pack.id)}
                className="min-h-8 flex-shrink-0 self-start sm:self-auto"
              >
                {formatMsg(b.addPackRules, { n: pack.rules.length })}
              </Button>
            </li>
          ))}
        </ul>

        {/* Deliberately prominent rather than a footnote. These rules touch
            advertising law, and someone in a regulated trade should not
            infer from a tidy UI that they've been legally cleared. */}
        <p className="rounded-control bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
          {b.packsDisclaimer}
        </p>
      </SettingsSection>
    </div>
  );
}
