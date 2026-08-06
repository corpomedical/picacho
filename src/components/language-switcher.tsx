"use client";

import { useEffect, useRef, useState } from "react";
import { LOCALES, type Locale } from "@/lib/i18n/locales";
import { useLocale } from "@/lib/i18n/provider";
import { cn } from "@/lib/cn";

function GlobeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.7 3.8 6 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-6-3.8-9s1.3-6.3 3.8-9Z" />
    </svg>
  );
}

// A small globe-icon dropdown — used in both the logged-out marketing
// header/footer and (compact variant) inside the app. Reads/writes through
// LocaleProvider, which persists the choice in a cookie server-rendered
// pages read on their next request.
export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale } = useLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const current = LOCALES.find((l) => l.code === locale) ?? LOCALES[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Language"
        aria-label="Language"
        className={cn(
          "flex items-center gap-1.5 rounded-[10px] text-sm text-neutral-500 transition-colors hover:text-neutral-900",
          compact ? "h-8 w-8 justify-center" : "px-1",
        )}
      >
        <GlobeIcon className="h-4 w-4 flex-shrink-0" />
        {!compact && <span>{current.code.toUpperCase()}</span>}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-40 rounded-[12px] border border-neutral-200 bg-white p-1.5 shadow-[0_16px_36px_-14px_rgba(0,0,0,0.2)]">
          {LOCALES.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => {
                setLocale(l.code as Locale);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between rounded-[8px] px-2.5 py-1.5 text-left text-sm transition-colors",
                l.code === locale
                  ? "bg-neutral-900 text-white"
                  : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900",
              )}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
