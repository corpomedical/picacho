"use client";

import type { SVGProps } from "react";
import { cn } from "@/lib/cn";
import { useTheme, type ThemeMode } from "@/lib/theme/theme-provider";
import { useLocale } from "@/lib/i18n/provider";

function MonitorIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

function SunIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />
    </svg>
  );
}

function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

const THEME_OPTIONS: { value: ThemeMode; icon: (props: SVGProps<SVGSVGElement>) => React.JSX.Element }[] = [
  { value: "default", icon: MonitorIcon },
  { value: "light", icon: SunIcon },
  { value: "dark", icon: MoonIcon },
];

export function ThemePicker() {
  const { theme, setTheme } = useTheme();
  const { t } = useLocale();
  const themeLabel: Record<ThemeMode, string> = {
    default: t.settings.themeDefault,
    light: t.settings.themeLight,
    dark: t.settings.themeDark,
  };

  return (
    <div className="grid grid-cols-3 gap-2">
      {THEME_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => setTheme(opt.value)}
          className={cn(
            "flex flex-col items-center gap-1.5 rounded-[10px] border px-3 py-3 text-sm transition-colors",
            theme === opt.value
              ? "border-neutral-900 bg-neutral-50 text-neutral-900"
              : "border-neutral-200 text-neutral-500 hover:border-neutral-300 hover:text-neutral-900",
          )}
        >
          <opt.icon className="h-4 w-4" />
          <span className="flex items-center gap-1">
            {themeLabel[opt.value]}
            {theme === opt.value && <CheckIcon className="h-3 w-3" />}
          </span>
        </button>
      ))}
    </div>
  );
}
