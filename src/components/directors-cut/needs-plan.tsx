"use client";

// Director's Cut for someone with no paid plan (operator, 2026-10-03: "Page
// with upgrade prompt" — people arrive from the ad): what it does, what a
// cut costs, and the way to a plan. In the suite's own frame, so the door
// looks like the room behind it.

import Link from "next/link";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";
import { typicalCut } from "@/lib/editor/pricing";

export function DirectorsCutNeedsPlan() {
  const { t } = useLocale();
  const d = t.directorsCut;
  const { low, high } = typicalCut();
  return (
    <div className="overflow-hidden rounded-[16px] bg-[#0b0c0f] text-[#a4a9b4] shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
      <div className="flex h-[52px] items-center gap-2.5 border-b border-[rgba(255,255,255,0.06)] bg-[#0e0f13] px-3 lg:px-4">
        <span className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-[#e0a468] text-[#1a0f07]" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
          </svg>
        </span>
        <span className="text-[13px] font-semibold text-[#eceef2]">{d.title}</span>
      </div>
      <div className="mx-auto flex w-full max-w-[720px] flex-col items-start gap-5 px-5 pb-12 pt-10 lg:px-0 lg:pt-16">
        <h1 className="font-display text-[30px] font-semibold leading-[1.05] tracking-[-0.015em] text-[#eceef2] lg:text-[40px]">{d.upgradeTitle}</h1>
        <p className="max-w-[620px] text-[15px] leading-relaxed text-[#8b909b]">{formatMsg(d.upgradeBody, { low, high })}</p>
        <Link
          href="/app/settings?tab=billing"
          className="flex h-[46px] items-center justify-center rounded-xl bg-[#e0a468] px-[26px] text-[15px] font-bold text-[#1a0f07] shadow-[0_10px_30px_-12px_rgba(224,164,104,0.6)]"
        >
          {d.upgradeCta}
        </Link>
      </div>
    </div>
  );
}
