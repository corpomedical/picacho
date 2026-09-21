import Link from "next/link";
import type { ReactNode, SVGProps } from "react";
import type { Messages } from "@/lib/i18n/messages";
import { cn } from "@/lib/cn";
import { MoreShareRow } from "@/components/more-share-row";

// The More page (/app/more): the app bar's fifth tab (2026-09-21). Everything
// the five-place bar has no room for, in one list: the tools, your work, the
// help and share rows the ⋯ menu used to hide, and Settings at the bottom.
// Helios 3D is listed only for plans that include it, and inside the app it
// says it opens on a computer (the reader-mode rule) instead of leading to a
// page that says so.
//
// Presentational and hook-free, so the page renders it on the server and a
// harness can render it with fixtures.

type Icon = (props: SVGProps<SVGSVGElement>) => React.JSX.Element;
const svg = (children: ReactNode): Icon =>
  function MoreIcon(props) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
        {children}
      </svg>
    );
  };

// The sidebar's glyphs (app-sidebar.tsx), so a tool looks the same everywhere.
const TemplatesIcon = svg(<><rect x="3" y="3" width="18" height="18" rx="2.5" /><path d="M3 9h18M9 9v12" /></>);
const UpscaleIcon = svg(<path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7" />);
const LayersIcon = svg(<><path d="M12 3.5 3.5 8 12 12.5 20.5 8z" /><path d="M3.5 12 12 16.5 20.5 12" /><path d="M3.5 16 12 20.5 20.5 16" /></>);
const FolderIcon = svg(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />);
const NotesIcon = svg(<><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 3v18M4 8h4M4 13h4M4 18h4" /></>);
const SetsIcon = svg(<><path d="M3 17.5 12 21l9-3.5M3 17.5V6.5L12 3l9 3.5v11" /><circle cx="12" cy="10.5" r="1.6" /><path d="M12 12.5v4" /></>);
const HomeIcon = svg(<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>);
const BookIcon = svg(<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14Z" /><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" /></>);
const GearIcon = svg(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></>);
const ChevronIcon = svg(<path d="m9 6 6 6-6 6" />);

const CARD =
  "overflow-hidden rounded-card border border-atelier-rule bg-atelier-surface shadow-[0_1px_2px_rgba(33,29,22,0.04),0_16px_40px_-24px_rgba(33,29,22,0.12)]";
const MORE_ROW = "flex min-h-[52px] items-center gap-3 py-3 transition-colors active:opacity-70";

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="flex-shrink-0 rounded-full bg-atelier-accent/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-atelier-accent">
      {children}
    </span>
  );
}

function RowBody({ label, sub, Icon, badge }: { label: string; sub?: string; Icon: Icon; badge?: string }) {
  return (
    <>
      <Icon className="h-5 w-5 flex-shrink-0 text-atelier-muted" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm text-atelier-ink">{label}</span>
          {badge && <Badge>{badge}</Badge>}
        </span>
        {sub && <span className="mt-0.5 block text-xs leading-snug text-atelier-muted">{sub}</span>}
      </span>
    </>
  );
}

function LinkRow(props: { href: string; label: string; sub?: string; Icon: Icon; badge?: string }) {
  return (
    <Link href={props.href} className={MORE_ROW}>
      <RowBody {...props} />
      <ChevronIcon className="h-4 w-4 flex-shrink-0 text-atelier-muted" />
    </Link>
  );
}

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className={CARD}>
      {title && (
        <h2 className="px-5 pb-1 pt-4 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">{title}</h2>
      )}
      <div className="divide-y divide-atelier-rule/60 px-5">{children}</div>
    </section>
  );
}

export function MoreView({
  t,
  identity,
  native,
  setsVisible,
  shareUrl,
}: {
  t: Messages;
  identity: { name: string; username: string | null; planLabel: string };
  /** Inside the app: Helios 3D says it opens on a computer, and Share uses the system sheet. */
  native: boolean;
  /** Helios 3D is on and this account's plan includes it. */
  setsVisible: boolean;
  shareUrl: string;
}) {
  const n = t.nav;
  const m = t.moreHub;
  const initial = identity.name.trim().charAt(0).toUpperCase() || "·";
  const facts = [identity.username ? `@${identity.username}` : null, identity.planLabel].filter(Boolean).join(" · ");
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">{m.eyebrow}</p>
        <h1 className="mt-1 marquee text-[26px] leading-[1.05] text-atelier-ink sm:text-[28px]">{m.title}</h1>
      </div>

      {/* The Settings Overview's identity card, same look. */}
      <Link href="/app/settings" className={cn(CARD, "flex items-center gap-4 px-5 py-4 active:opacity-80")}>
        <span
          aria-hidden
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-atelier-ink/[0.08] font-numeral text-xl text-atelier-ink"
        >
          {initial}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-numeral text-[17px] font-semibold leading-tight text-atelier-ink">{identity.name}</span>
          <span className="mt-0.5 block truncate text-[12.5px] text-atelier-muted">{facts}</span>
        </span>
        <ChevronIcon className="h-4 w-4 flex-shrink-0 text-atelier-muted" />
      </Link>

      <Group title={n.tools}>
        <LinkRow href="/app/templates" label={n.templates} sub={m.templatesSub} Icon={TemplatesIcon} />
        <LinkRow href="/app/upscale" label={n.upscale} sub={m.upscaleSub} Icon={UpscaleIcon} badge={n.newBadge} />
        <LinkRow href="/app/layers" label={n.layers} sub={m.layersSub} Icon={LayersIcon} badge={n.newBadge} />
      </Group>

      <Group title={m.yourWork}>
        <LinkRow href="/app/projects" label={n.projects} Icon={FolderIcon} />
        <LinkRow href="/app/notes" label={n.notes} Icon={NotesIcon} />
      </Group>

      {setsVisible &&
        (native ? (
          <Group title={m.onComputer}>
            <div className={MORE_ROW}>
              <RowBody label={n.sets} sub={m.setsSub} Icon={SetsIcon} />
              <span className="flex-shrink-0 text-[11px] text-atelier-muted">{m.webTag}</span>
            </div>
          </Group>
        ) : (
          <Group>
            <LinkRow href="/app/sets" label={n.sets} sub={m.setsSubWeb} Icon={SetsIcon} />
          </Group>
        ))}

      <Group>
        <LinkRow href="/app" label={t.nativePill.home} Icon={HomeIcon} />
        <LinkRow href="/app/tutorial" label={t.nativePill.help} Icon={BookIcon} />
        {native && <MoreShareRow label={t.nativePill.share} url={shareUrl} />}
        <LinkRow href="/app/settings" label={n.settings} Icon={GearIcon} />
      </Group>
    </div>
  );
}
