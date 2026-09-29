"use client";

import "./light.css";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n/provider";
import { useTheme } from "@/lib/theme/theme-provider";
import { THEME_STORAGE_KEY } from "@/lib/theme/screening";
import { saveAppChoices } from "@/lib/light/actions";
import { LIGHT_HOME, type AppLook, type AppMode } from "@/lib/light/mode";

function Tick({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[13px]"
      style={on ? { background: "#a84e24", color: "#fff" } : { border: "2px solid var(--pl-send-idle)" }}
    >
      {on ? "✓" : ""}
    </span>
  );
}

const card = (on: boolean): React.CSSProperties => ({
  textAlign: "left",
  background: "var(--pl-card)",
  borderRadius: 20,
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 12,
  color: "var(--pl-ink)",
  border: on ? "2px solid #a84e24" : "2px solid var(--pl-card-line)",
  cursor: "pointer",
});

/** Board "Signup": two questions on one step, both changeable in Settings. */
export function WelcomeChoices() {
  const { t } = useLocale();
  const l = t.light;
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [mode, setMode] = useState<AppMode>("light");
  // null = not touched here yet: show the device's own look, else Light.
  const [picked, setLook] = useState<AppLook | null>(null);
  const look: AppLook = picked ?? (theme === "dark" || theme === "system" ? theme : "light");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // The preselected look (Light, as the board draws it) shows from the start
  // on a device that never chose one; a device that did keeps its own.
  useEffect(() => {
    // Read storage itself: this runs before the provider's own first read.
    let stored: string | null = "unknown";
    try {
      stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      // Storage blocked: leave the look alone.
    }
    if (stored === null) setTheme("light");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The look shows at once, so the choice is seen before it is saved.
  function pickLook(next: AppLook) {
    setLook(next);
    setTheme(next);
  }

  async function start() {
    setSaving(true);
    setError("");
    setTheme(look);
    const res = await saveAppChoices({ mode, look });
    if (res.error) {
      setError(l.saveFailed);
      setSaving(false);
      return;
    }
    router.replace(mode === "light" ? LIGHT_HOME : "/app");
    router.refresh();
  }

  return (
    <div className="pl pl-surface min-h-full w-full overflow-y-auto" style={{ background: "var(--pl-rail)" }}>
      <div className="mx-auto flex w-full max-w-[880px] flex-col items-center gap-9 px-4 pb-12 pt-10 md:pt-14">
        <div className="flex flex-col items-center gap-2.5 text-center">
          {/* The first screen after signing up carries the name (2026-09-29 check: it had no logo). */}
          <span className="pl-display mb-3 text-[22px] font-semibold" style={{ color: "var(--pl-ink)" }}>
            Picacho
          </span>
          <span className="text-[13px] font-semibold" style={{ color: "var(--pl-muted)" }}>
            {l.welcomeStep}
          </span>
          <h1 className="pl-display m-0 text-[32px] font-semibold md:text-[40px]">{l.welcomeTitle}</h1>
          <p className="m-0 text-[16px]" style={{ color: "var(--pl-muted)" }}>
            {l.welcomeSub}
          </p>
        </div>

        <section aria-labelledby="pl-q1" className="flex w-full flex-col gap-3.5">
          <h2 id="pl-q1" className="m-0 text-[17px] font-semibold">
            {l.q1}
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <button type="button" aria-pressed={mode === "light"} onClick={() => setMode("light")} style={card(mode === "light")}>
              <div className="flex h-[120px] w-full flex-col items-center justify-center gap-3 rounded-[14px]" style={{ background: "#ffffff", border: "1px solid #e6e2dd" }}>
                <div className="h-2.5 w-[150px] rounded-[5px]" style={{ background: "#e8c9b6" }} />
                <div className="h-[34px] w-[min(240px,80%)] rounded-[17px]" style={{ background: "#f1eeea" }} />
              </div>
              <span className="flex w-full items-center justify-between">
                <span className="text-[18px] font-semibold">{l.lightTitle}</span>
                <Tick on={mode === "light"} />
              </span>
              <span className="text-sm leading-normal" style={{ color: "var(--pl-muted)" }}>
                {l.lightDesc}
              </span>
            </button>
            <button type="button" aria-pressed={mode === "advanced"} onClick={() => setMode("advanced")} style={card(mode === "advanced")}>
              <div className="grid h-[120px] w-full grid-cols-3 gap-1.5 rounded-[14px] p-3" style={{ background: "#1c1b1a" }}>
                <div className="rounded-md" style={{ background: "#2e2b29" }} />
                <div className="col-span-2 rounded-md" style={{ background: "#3a3633" }} />
                <div className="col-span-2 rounded-md" style={{ background: "#3a3633" }} />
                <div className="rounded-md" style={{ background: "#a84e24" }} />
              </div>
              <span className="flex w-full items-center justify-between">
                <span className="text-[18px] font-semibold">{l.advTitle}</span>
                <Tick on={mode === "advanced"} />
              </span>
              <span className="text-sm leading-normal" style={{ color: "var(--pl-muted)" }}>
                {l.advDesc}
              </span>
            </button>
          </div>
        </section>

        <section aria-labelledby="pl-q2" className="flex w-full flex-col gap-3.5">
          <h2 id="pl-q2" className="m-0 text-[17px] font-semibold">
            {l.q2}
          </h2>
          <div className="grid grid-cols-3 gap-2.5 md:gap-4">
            {(
              [
                ["light", l.lookLight, <div key="l" className="flex h-16 items-center justify-center rounded-xl" style={{ background: "#fff", border: "1px solid #e6e2dd" }}><div className="h-5 w-[70%] rounded-[10px]" style={{ background: "#f1eeea" }} /></div>],
                ["dark", l.lookDark, <div key="d" className="flex h-16 items-center justify-center rounded-xl" style={{ background: "#141313", border: "1px solid #2a2725" }}><div className="h-5 w-[70%] rounded-[10px]" style={{ background: "#2a2725" }} /></div>],
                ["system", l.lookSystem, <div key="s" className="flex h-16 overflow-hidden rounded-xl" style={{ border: "1px solid #e6e2dd" }}><div className="flex-grow" style={{ background: "#fff" }} /><div className="flex-grow" style={{ background: "#141313" }} /></div>],
              ] as const
            ).map(([value, label, swatch]) => (
              <button key={value} type="button" aria-pressed={look === value} onClick={() => pickLook(value)} style={card(look === value)}>
                {swatch}
                <span className="text-[14px] font-semibold md:text-[16px]">{label}</span>
              </button>
            ))}
          </div>
        </section>

        <button
          type="button"
          onClick={() => void start()}
          disabled={saving}
          className="h-[52px] min-w-[240px] rounded-[26px] border-0 px-6 text-[16px] font-semibold text-white"
          style={{ background: "#a84e24", cursor: "pointer", opacity: saving ? 0.7 : 1 }}
        >
          {saving ? l.saving : l.startCreating}
        </button>
        {error && (
          <p role="alert" className="-mt-5 text-sm" style={{ color: "var(--pl-accent)" }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
