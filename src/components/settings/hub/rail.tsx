import type { SVGProps } from "react";
import Link from "next/link";
import type { Messages } from "@/lib/i18n/messages";
import { cn } from "@/lib/cn";
import { settingsHref, type SettingsTab } from "@/lib/settings/tabs";

// The eight rooms (direction A "Front desk", 2026-09-19). On a desktop they
// sit in the rail beside the page, as the nine tabs did. On a phone the rail
// is gone: the Overview lists the rooms (SectionList), and every other tab
// starts with a way back to it — no more sideways strip of nine tabs with
// six of them off the edge.

type Icon = (props: SVGProps<SVGSVGElement>) => React.JSX.Element;

const stroke = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export const TAB_ICONS: Record<SettingsTab, Icon> = {
  overview: (p) => (
    <svg {...stroke} {...p}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  billing: (p) => (
    <svg {...stroke} {...p}>
      <path d="M4.5 19a8.5 8.5 0 1 1 15 0" />
      <path d="M12 13 15 9" />
      <circle cx="12" cy="13" r="1" />
    </svg>
  ),
  profile: (p) => (
    <svg {...stroke} {...p}>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <circle cx="8.5" cy="11.5" r="2" />
      <path d="M5.5 16.5c.5-1.5 1.8-2.3 3-2.3s2.5.8 3 2.3M14 9h5M14 12.5h5" />
    </svg>
  ),
  generation: (p) => (
    <svg {...stroke} {...p}>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="M16 10l5-3v10l-5-3" />
    </svg>
  ),
  preferences: (p) => (
    <svg {...stroke} {...p}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  ),
  security: (p) => (
    <svg {...stroke} {...p}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </svg>
  ),
  privacy: (p) => (
    <svg {...stroke} {...p}>
      <path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3z" />
      <path d="M9.5 12l2 2 3.5-4" />
    </svg>
  ),
  help: (p) => (
    <svg {...stroke} {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .8-1 1.7" />
      <path d="M12 17h.01" />
    </svg>
  ),
};

export function tabLabel(tab: SettingsTab, h: Messages["settingsHub"]): string {
  switch (tab) {
    case "overview":
      return h.tabOverview;
    case "billing":
      return h.tabBilling;
    case "profile":
      return h.tabProfile;
    case "generation":
      return h.tabGeneration;
    case "preferences":
      return h.tabPreferences;
    case "security":
      return h.tabSecurity;
    case "privacy":
      return h.tabPrivacy;
    case "help":
      return h.tabHelp;
  }
}

export function SettingsRail({
  tabs,
  active,
  h,
}: {
  tabs: readonly SettingsTab[];
  active: SettingsTab;
  h: Messages["settingsHub"];
}) {
  return (
    <nav aria-label={h.sectionsLabel} className="hidden w-52 flex-shrink-0 flex-col gap-0.5 sm:flex">
      {tabs.map((tab) => {
        const Icon = TAB_ICONS[tab];
        return (
          <Link
            key={tab}
            href={settingsHref(tab)}
            aria-current={tab === active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 whitespace-nowrap rounded-control px-3 py-2 text-sm transition-colors",
              tab === active
                ? "bg-atelier-surface font-medium text-atelier-ink shadow-[inset_2px_0_0_var(--color-atelier-accent)]"
                : "text-atelier-muted hover:bg-atelier-ink/5 hover:text-atelier-ink",
            )}
          >
            <Icon className="h-4 w-4 flex-shrink-0" />
            {tabLabel(tab, h)}
          </Link>
        );
      })}
    </nav>
  );
}

/** A phone's way back to the Overview, above every other tab. */
export function BackToOverview({ h }: { h: Messages["settingsHub"] }) {
  return (
    <Link
      href={settingsHref("overview")}
      className="-ml-1 mb-3 inline-flex min-h-11 items-center gap-1 rounded-control px-1 text-sm text-atelier-muted transition-colors hover:text-atelier-ink sm:hidden"
    >
      <svg {...stroke} className="h-4 w-4" aria-hidden>
        <path d="m15 6-6 6 6 6" />
      </svg>
      {h.backToSettings}
    </Link>
  );
}
