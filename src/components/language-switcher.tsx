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

function CheckIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

// A small globe-icon dropdown — used in both the logged-out marketing
// header/footer and (compact variant) inside the app. Reads/writes through
// LocaleProvider, which persists the choice in a cookie server-rendered
// pages read on their next request.
export function LanguageSwitcher({ compact = false, triggerClassName }: { compact?: boolean; triggerClassName?: string }) {
  const { locale, setLocale, t } = useLocale();
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
        aria-label={t.common.language}
        className={cn(
          "flex items-center gap-1.5 rounded-[10px] text-sm transition-colors",
          // Callers on a pinned-dark surface (the front page's header) pass
          // their own literals via triggerClassName; the default keeps the
          // theme-adaptive greys.
          triggerClassName ?? "text-atelier-muted hover:text-atelier-ink",
          compact ? "h-8 w-8 justify-center" : "px-1",
        )}
      >
        <GlobeIcon className="h-4 w-4 flex-shrink-0" />
        {!compact && <span>{current.code.toUpperCase()}</span>}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-40 rounded-[12px] bg-atelier-surface p-1.5 shadow-[0_0_0_1px_var(--frost-ring),0_24px_48px_-12px_rgba(0,0,0,0.25)] backdrop-blur-xl">
          {LOCALES.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => {
                setLocale(l.code as Locale);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between gap-3 rounded-[8px] px-2.5 py-1.5 text-left text-sm transition-colors",
                l.code === locale
                  ? "bg-atelier-accent/[0.08] text-atelier-ink shadow-[inset_0_0_0_1.5px_var(--color-atelier-accent)]"
                  : "text-atelier-muted hover:bg-atelier-ink/5 hover:text-atelier-ink",
              )}
            >
              {l.label}
              {l.code === locale && <CheckIcon className="h-3.5 w-3.5 flex-shrink-0 text-atelier-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
