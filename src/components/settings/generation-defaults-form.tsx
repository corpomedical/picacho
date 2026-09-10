"use client";

import { useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";
import { localizeServerText } from "@/lib/i18n/server-text";
import { setGenerationDefaults } from "@/lib/profile/generation-defaults-actions";
import type { GenerationDefaults } from "@/lib/generations/generation-defaults";
import { SettingsStatus } from "@/components/settings/settings-status";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";

// Settings → Generation: where the composer starts (2026-09-11). Every
// field has a "Picacho's default" answer, which is what everyone had before
// this existed; nothing here limits what can be picked per render.

type ModelOption = { id: string; name: string; durations: { seconds: number }[]; defaultDurationSeconds: number };

export function GenerationDefaultsForm({
  models,
  globalDefaultModelId,
  initial,
}: {
  models: ModelOption[];
  globalDefaultModelId: string;
  initial: GenerationDefaults;
}) {
  const { t } = useLocale();
  const s = t.settings;
  // Start from values this form can actually save (2026-09-11 review): a
  // stored model that is no longer offered reads as Picacho's pick, and a
  // stored length the effective model lacks reads as the model's default.
  // Otherwise the selects showed one thing, state held another, and every
  // Save came back "Invalid setting".
  const initialModel = initial.videoModel && models.some((m) => m.id === initial.videoModel) ? initial.videoModel : "";
  const initialEffective = models.find((m) => m.id === (initialModel || globalDefaultModelId));
  const initialDuration =
    initial.durationSeconds && initialEffective?.durations.some((d) => d.seconds === initial.durationSeconds)
      ? String(initial.durationSeconds)
      : "";
  const [model, setModel] = useState(initialModel);
  const [duration, setDuration] = useState(initialDuration);
  const [aspect, setAspect] = useState<"" | "16:9" | "9:16">(initial.aspectRatio ?? "");
  const [sound, setSound] = useState(initial.sound);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ state: "idle" | "saved" | "error"; message?: string | null }>({ state: "idle" });

  const globalModel = models.find((m) => m.id === globalDefaultModelId);
  const effective = models.find((m) => m.id === (model || globalDefaultModelId));

  function pickModel(next: string) {
    setModel(next);
    const target = models.find((m) => m.id === (next || globalDefaultModelId));
    // A length the new model does not offer falls back to its own default.
    if (duration && !target?.durations.some((d) => String(d.seconds) === duration)) setDuration("");
    setStatus({ state: "idle" });
  }

  async function save() {
    setBusy(true);
    setStatus({ state: "idle" });
    const { error } = await setGenerationDefaults({ videoModel: model, aspectRatio: aspect, durationSeconds: duration, sound });
    setBusy(false);
    if (error) {
      const localized = localizeServerText(error, t);
      setStatus({ state: "error", message: localized === error ? s.defaultsSaveFailed : localized });
      return;
    }
    setStatus({ state: "saved", message: t.common.saved });
  }

  const selectClass =
    "w-full rounded-control border border-atelier-rule bg-atelier-surface px-3 py-2 text-sm text-atelier-ink focus:border-atelier-accent focus:outline-none";

  return (
    <div className="space-y-5">
      <label className="block">
        <span className="text-sm font-medium text-atelier-ink">{s.defaultModelLabel}</span>
        <select value={model} onChange={(e) => pickModel(e.target.value)} className={cn(selectClass, "mt-1.5")}>
          <option value="">{formatMsg(s.defaultModelPicacho, { name: globalModel?.name ?? globalDefaultModelId })}</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-atelier-ink">{s.defaultDurationLabel}</span>
        <select value={duration} onChange={(e) => setDuration(e.target.value)} className={cn(selectClass, "mt-1.5")}>
          <option value="">{formatMsg(s.defaultDurationModel, { n: effective?.defaultDurationSeconds ?? 5 })}</option>
          {(effective?.durations ?? []).map((d) => (
            <option key={d.seconds} value={String(d.seconds)}>
              {formatMsg(s.durationOption, { n: d.seconds })}
            </option>
          ))}
        </select>
      </label>

      <div>
        <p className="text-sm font-medium text-atelier-ink">{s.defaultAspectLabel}</p>
        <div className="mt-1.5 inline-flex rounded-full border border-atelier-rule bg-atelier-surface p-1">
          {([
            ["", s.aspectAuto],
            ["16:9", s.aspectLandscape],
            ["9:16", s.aspectPortrait],
          ] as const).map(([value, label]) => (
            <button
              key={value || "auto"}
              type="button"
              onClick={() => setAspect(value)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                aspect === value ? "bg-atelier-ink text-atelier-paper" : "text-atelier-muted hover:text-atelier-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-atelier-muted">{s.aspectHelp}</p>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-atelier-rule/60 pt-5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-atelier-ink">{s.soundLabel}</p>
          <p className="mt-0.5 text-xs text-atelier-muted">{s.soundHelp}</p>
        </div>
        <Switch
          checked={sound}
          onChange={() => setSound((v) => !v)}
          ariaLabel={s.soundLabel}
          labelOn={t.common.toggleOn}
          labelOff={t.common.toggleOff}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-control bg-atelier-ink px-4 py-2 text-sm font-medium text-atelier-paper transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {s.saveDefaults}
        </button>
        <SettingsStatus state={status.state} message={status.message} />
      </div>
    </div>
  );
}
