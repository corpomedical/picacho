"use client";

import { useState } from "react";
import { addBrandRule, deleteBrandRule, toggleBrandRule } from "@/lib/brand-rules/actions";
import type { BrandRule } from "@/lib/brand-rules/types";
import { Card } from "@/components/ui/card";
import { Label, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLocale } from "@/lib/i18n/provider";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";

// Two rule kinds with genuinely different behaviour, so the form makes the
// choice explicit rather than burying it: a "require" rule is repaired
// automatically if the finished prompt lost it, while a "forbid" rule stops
// the generation outright. See BRAND_RULEBOOK_DESIGN.md.
export function BrandRulesPanel({ rules }: { rules: BrandRule[] }) {
  const { t } = useLocale();
  const b = t.brandRules;
  const router = useRouter();
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
    router.refresh();
  }

  async function handleToggle(rule: BrandRule) {
    const fd = new FormData();
    fd.set("id", rule.id);
    fd.set("active", String(!rule.active));
    await toggleBrandRule(fd);
    router.refresh();
  }

  async function handleDelete(rule: BrandRule) {
    if (!window.confirm(b.deleteConfirm)) return;
    const fd = new FormData();
    fd.set("id", rule.id);
    await deleteBrandRule(fd);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-sm font-semibold text-neutral-900">{b.title}</h2>
        <p className="mt-1 text-sm text-neutral-500">{b.subtitle}</p>

        <form action={handleAdd} className="mt-4 space-y-4">
          <div className="flex gap-2">
            {(["forbid", "require"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                aria-pressed={kind === k}
                className={cn(
                  "flex-1 rounded-[12px] border px-3 py-2.5 text-left transition-colors",
                  kind === k
                    ? "border-neutral-900 bg-neutral-50"
                    : "border-neutral-200 hover:border-neutral-300",
                )}
              >
                <span className="block text-sm font-medium text-neutral-900">
                  {k === "forbid" ? b.kindForbid : b.kindRequire}
                </span>
                <span className="mt-0.5 block text-xs text-neutral-500">
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
              <select
                id="applies_to"
                name="applies_to"
                defaultValue="all"
                className="mt-1 rounded-[10px] border border-neutral-200 px-3 py-2 text-sm"
              >
                <option value="all">{b.appliesAll}</option>
                <option value="image">{b.appliesImage}</option>
                <option value="video">{b.appliesVideo}</option>
              </select>
            </div>

            {kind === "forbid" && (
              <div>
                <Label htmlFor="severity">{b.severity}</Label>
                <select
                  id="severity"
                  name="severity"
                  defaultValue="block"
                  className="mt-1 rounded-[10px] border border-neutral-200 px-3 py-2 text-sm"
                >
                  <option value="block">{b.severityBlock}</option>
                  <option value="warn">{b.severityWarn}</option>
                </select>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? b.adding : b.addRule}
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-neutral-900">{b.yourRules}</h2>
        {rules.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">{b.noRules}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {rules.map((rule) => (
              <li
                key={rule.id}
                className={cn(
                  "flex items-start gap-3 rounded-[12px] border border-neutral-100 px-3.5 py-3",
                  !rule.active && "opacity-50",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-neutral-900">{rule.label}</span>
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
                  <p className="mt-1 break-words text-sm text-neutral-600">{rule.value}</p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleToggle(rule)}
                    className="text-xs text-neutral-500 hover:text-neutral-900"
                  >
                    {rule.active ? b.disable : b.enable}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(rule)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    {b.delete}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 border-t border-neutral-100 pt-3 text-xs text-neutral-400">{b.promptLevelNote}</p>
      </Card>
    </div>
  );
}
