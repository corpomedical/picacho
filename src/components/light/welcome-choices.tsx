"use client";

import "./light.css";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";
import { useTheme } from "@/lib/theme/theme-provider";
import { THEME_STORAGE_KEY } from "@/lib/theme/screening";
import { saveAppChoices } from "@/lib/light/actions";
import { LIGHT_HOME, welcomeLook, type AppMode } from "@/lib/light/mode";

/** What this device has stored as its look, or null (never picked, or storage blocked). */
function storedLook(): string | null {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * A real screen of what each choice opens, in the page's look and language
 * (public/welcome, shot on test rows). A background rather than an <img>:
 * only the look on screen is fetched (light.css picks --shot-light or
 * --shot-dark), and the band shown is set per card and screen width there.
 */
function Shot({ kind, locale, label }: { kind: "studio" | "chat"; locale: string; label: string }) {
  const src = (look: "light" | "dark") => `url(/welcome/${kind}-${look}-${locale}.webp)`;
  return (
    <div className="pl-welcome-shot">
      <div
        role="img"
        aria-label={label}
        className={`pl-welcome-shot-img pl-welcome-shot-${kind}`}
        style={{ "--shot-light": src("light"), "--shot-dark": src("dark") } as React.CSSProperties}
      />
    </div>
  );
}

function Perks({ heading, items }: { heading: string; items: string[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h3
        className="m-0 text-[11px] font-semibold md:text-[12px]"
        style={{ color: "var(--pl-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}
      >
        {heading}
      </h3>
      <ul className="m-0 flex list-none flex-col gap-[7px] p-0 text-[14px] leading-[1.4]">
        {items.map((item) => (
          <li key={item} className="flex gap-[9px]">
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mt-0.5 flex-shrink-0"
              style={{ color: "var(--pl-accent)" }}
            >
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The sign-up's last step, with the studio first (operator, 2026-09-29: "I
 * want you to push users to use Studio. List what Studio gives you in
 * options.", then "Build it" on the canvas's option 2). The full studio is
 * the recommended card, with what it gives free and what needs a plan; the
 * simple chat (Picacho Light) is the second card. One press saves and opens
 * it. No look question: the device's look is kept (lib/light/mode.ts
 * welcomeLook) and Settings changes it.
 *
 * `scenes` and `looks` are counted by the page from the templates and the
 * proven camera presets, so the list can't outgrow what's there.
 */
export function WelcomeChoices({ scenes, looks }: { scenes: number; looks: number }) {
  const { t, locale } = useLocale();
  const l = t.light;
  const router = useRouter();
  const { setTheme } = useTheme();
  const [opening, setOpening] = useState<AppMode | null>(null);
  const [error, setError] = useState("");

  // A device that never picked a look follows the device from the first
  // paint of this step, not the studio's own dark.
  useEffect(() => {
    if (storedLook() === null) setTheme("system");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function choose(mode: AppMode) {
    setOpening(mode);
    setError("");
    const look = welcomeLook(storedLook());
    setTheme(look);
    const res = await saveAppChoices({ mode, look });
    if (res.error) {
      setError(l.saveFailed);
      setOpening(null);
      return;
    }
    router.replace(mode === "light" ? LIGHT_HOME : "/app");
    router.refresh();
  }

  return (
    <div className="pl pl-surface pl-welcome min-h-full w-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col items-center gap-[18px] px-4 pb-7 pt-10 md:gap-[22px] md:pb-10 md:pt-[34px]">
        {/* The first screen after signing up carries the name (2026-09-29 check: it had no logo). */}
        <span className="pl-display text-[20px] font-semibold md:text-[22px]">Picacho</span>
        <div className="flex flex-col items-center gap-1.5 text-center md:gap-2">
          <h1 className="pl-display m-0 text-[28px] font-semibold leading-[1.15] md:text-[40px]">{l.welcomeTitle}</h1>
          <p className="m-0 text-[15px] leading-[1.4] md:text-[16px]" style={{ color: "var(--pl-muted)" }}>
            {l.welcomeSub}
          </p>
        </div>

        {/* Stacked (phones, tablets) the cards keep a readable column, so a
            card's picture isn't cut to a thin strip across a wide screen. */}
        <div className="grid w-full max-w-[560px] grid-cols-1 gap-4 lg:max-w-none lg:grid-cols-[3fr_2fr] lg:gap-6">
          <section aria-labelledby="pl-welcome-studio" className="pl-welcome-card pl-welcome-pick">
            <Shot kind="studio" locale={locale} label={l.studioShotAlt} />
            <div className="flex flex-col gap-3.5 px-[18px] pb-[18px] pt-4 md:px-7 md:pb-6 md:pt-5">
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2 md:gap-2.5">
                  <h2 id="pl-welcome-studio" className="pl-display m-0 text-[22px] font-semibold md:text-[26px]">
                    {l.studioTitle}
                  </h2>
                  <span className="pl-welcome-badge">{l.recommended}</span>
                </div>
                <p className="m-0 text-[14px] leading-normal md:text-[15px]">{l.studioDesc}</p>
              </div>
              <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2 lg:gap-7">
                <Perks
                  heading={l.studioFreeHeading}
                  items={[
                    l.studioFreeCharacter,
                    l.studioFreeScore,
                    formatMsg(l.studioFreeScenes, { n: scenes }),
                    l.studioFreePrice,
                  ]}
                />
                <Perks
                  heading={l.studioPlanHeading}
                  items={[
                    l.studioPlanEngines,
                    formatMsg(l.studioPlanCamera, { n: looks }),
                    l.studioPlanLonger,
                    l.studioPlanAngles,
                    l.studioPlanHelios,
                  ]}
                />
              </div>
              <button
                type="button"
                onClick={() => void choose("advanced")}
                disabled={opening !== null}
                className="pl-welcome-go h-[50px] rounded-[25px] px-[30px] text-[16px] font-semibold sm:self-start"
              >
                {opening === "advanced" ? l.opening : l.openStudio}
              </button>
            </div>
          </section>

          <section aria-labelledby="pl-welcome-chat" className="pl-welcome-card">
            <Shot kind="chat" locale={locale} label={l.chatShotAlt} />
            <div className="flex flex-grow flex-col gap-2 px-[18px] pb-[18px] pt-4 md:gap-2.5 md:px-[26px] md:pb-6 md:pt-5">
              <h2 id="pl-welcome-chat" className="pl-display m-0 text-[20px] font-semibold md:text-[22px]">
                {l.chatTitle}
              </h2>
              <p className="m-0 text-[14px] leading-normal md:text-[15px]">{l.chatDesc}</p>
              <p className="m-0 text-[13px] leading-normal md:text-[14px]" style={{ color: "var(--pl-muted)" }}>
                {l.chatFewer}
              </p>
              <div className="hidden flex-grow lg:block" />
              <button
                type="button"
                onClick={() => void choose("light")}
                disabled={opening !== null}
                className="pl-welcome-alt mt-1 h-12 rounded-[24px] px-6 text-[16px] font-semibold sm:self-start"
              >
                {opening === "light" ? l.opening : l.startChat}
              </button>
            </div>
          </section>
        </div>

        {error && (
          <p role="alert" className="m-0 text-sm" style={{ color: "var(--pl-accent)" }}>
            {error}
          </p>
        )}
        <p className="m-0 text-center text-[12px] md:text-[13px]" style={{ color: "var(--pl-muted)" }}>
          {l.welcomeLook}
        </p>
      </div>
    </div>
  );
}
