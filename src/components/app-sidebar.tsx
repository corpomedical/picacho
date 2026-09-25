"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type SVGProps } from "react";
import { PLAN_LABELS, type PlanId } from "@/lib/plans";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { DeleteGenerationButton } from "@/components/delete-generation-button";
import { SearchDialog, type SearchPage } from "@/components/search-dialog";
import { VoiceRecorderButton } from "@/components/voice-recorder-button";
import { parseVoiceCommand } from "@/lib/voice/commands";
import { updateUsername } from "@/lib/profile/actions";
import { logout } from "@/lib/auth/actions";
import { useTheme, type ThemeMode } from "@/lib/theme/theme-provider";
import { useLocale } from "@/lib/i18n/provider";
import type { Messages } from "@/lib/i18n/messages";
import { formatMsg } from "@/lib/i18n/format";
import {
  PINNED_STORAGE_KEY,
  SEEN_STORAGE_KEY,
  TOOL_GROUPS,
  isToolNew,
  localDay,
  parseToolKeys,
  togglePin,
  toolForPath,
  visibleTools,
  type NavTool,
  type ToolGroup,
  type ToolKey,
} from "@/lib/nav/tools";
import { Logo } from "@/components/logo";
import { EarlyAccessBadge } from "@/components/early-access-badge";
import { SkipRefinementToggle } from "@/components/settings/skip-refinement-toggle";

const COLLAPSED_STORAGE_KEY = "picacho_sidebar_collapsed";

type RecentJob = {
  id: string;
  prompt_input: string;
  status: string;
  content_type: string | null;
};

function BoltIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />
    </svg>
  );
}

function TemplatesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <path d="M3 9h18M9 9v12" />
    </svg>
  );
}

function CommunityIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16 6.5a3 3 0 0 1 0 6" />
      <path d="M21 20a5.5 5.5 0 0 0-4-5.3" />
    </svg>
  );
}

function UserIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.418 3.582-8 8-8s8 3.582 8 8" />
    </svg>
  );
}

function ClockIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}

function ShieldIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 2 4 5v6c0 5 3.4 8.5 8 11 4.6-2.5 8-6 8-11V5l-8-3Z" />
    </svg>
  );
}

function PanelIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9 4v16" />
    </svg>
  );
}

function MenuIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function XIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function FolderIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </svg>
  );
}

function SearchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function GearIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

function NotesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 3v18M4 8h4M4 13h4M4 18h4" />
    </svg>
  );
}

function HomeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3.5 11 12 4l8.5 7" />
      <path d="M5.5 9.5V20h13V9.5" />
    </svg>
  );
}

function ToolsIcon(props: SVGProps<SVGSVGElement>) {
  // Four tiles: the door to every tool.
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function PinIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M9 3.5h6l-1 6 3.5 3.5h-11L10 9.5l-1-6Z" />
      <path d="M12 13v7.5" />
    </svg>
  );
}

function ChevronRightIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function MediaIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <circle cx="8.5" cy="9" r="1.4" />
      <path d="m4.5 15 4-3.5 3 2.7 3.5-3.7L20 15" />
      <path d="M3 20h18" />
    </svg>
  );
}

function LayersIcon(props: SVGProps<SVGSVGElement>) {
  // Three offset sheets — the layer stack, not Photoshop's diamond.
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3.5 3.5 8 12 12.5 20.5 8z" />
      <path d="M3.5 12 12 16.5 20.5 12" />
      <path d="M3.5 16 12 20.5 20.5 16" />
    </svg>
  );
}

function RecceIcon(props: SVGProps<SVGSVGElement>) {
  // A frame of footage and the place it becomes: a screen with a scan line.
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M12 5v14" />
      <path d="M6.5 9.5 9 12l-2.5 2.5" />
      <circle cx="16.5" cy="12" r="1.4" />
    </svg>
  );
}

function LiveIcon(props: SVGProps<SVGSVGElement>) {
  // A lens with its on-air light.
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M7.1 16.9a7 7 0 0 1 0-9.8M16.9 7.1a7 7 0 0 1 0 9.8" />
      <path d="M4.2 19.8a11 11 0 0 1 0-15.6M19.8 4.2a11 11 0 0 1 0 15.6" />
    </svg>
  );
}

function CutIcon(props: SVGProps<SVGSVGElement>) {
  // Director's Cut: the editor's scissors.
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M8.1 8.1 20 20M14.5 9.5 20 4M8.1 15.9l3.4-3.4" />
    </svg>
  );
}

function MystiqueIcon(props: SVGProps<SVGSVGElement>) {
  // One performer becoming another: two heads sharing a line.
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="8.5" cy="8" r="3.2" />
      <path d="M2.5 19.5c.6-3.4 3-5.5 6-5.5 1.2 0 2.3.3 3.2.9" />
      <circle cx="16.5" cy="10" r="2.7" strokeDasharray="2.2 2.2" />
      <path d="M11.5 20c.5-2.9 2.5-4.7 5-4.7s4.5 1.8 5 4.7" strokeDasharray="2.2 2.2" />
    </svg>
  );
}

function SetsIcon(props: SVGProps<SVGSVGElement>) {
  // A floor, a back wall and a figure on its mark — a set, not a cube.
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 17.5 12 21l9-3.5M3 17.5V6.5L12 3l9 3.5v11" />
      <circle cx="12" cy="10.5" r="1.6" />
      <path d="M12 12.5v4" />
    </svg>
  );
}

function UpscaleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7" />
    </svg>
  );
}

function BookIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
    </svg>
  );
}

function CompassIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="m14.5 9.5-1.7 5.3-5.3 1.7 1.7-5.3 5.3-1.7Z" />
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

function PencilIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function IdCardIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <circle cx="8.5" cy="11.5" r="2" />
      <path d="M5.5 16.5c.5-1.5 1.8-2.3 3-2.3s2.5.8 3 2.3M14 9h5M14 12.5h5" />
    </svg>
  );
}

function GaugeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4.5 19a8.5 8.5 0 1 1 15 0" />
      <path d="M12 13 15 9" />
      <circle cx="12" cy="13" r="1" />
    </svg>
  );
}

function MailIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

function HelpIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .8-1 1.7" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function LogOutIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

const THEME_OPTIONS: { value: ThemeMode; icon: (props: SVGProps<SVGSVGElement>) => React.JSX.Element }[] = [
  { value: "default", icon: MonitorIcon },
  { value: "light", icon: SunIcon },
  { value: "dark", icon: MoonIcon },
];

type Glyph = (props: SVGProps<SVGSVGElement>) => React.JSX.Element;

const ROW_ACTIVE = "bg-atelier-ink/[0.06] font-medium text-atelier-ink shadow-[inset_2px_0_0_var(--color-atelier-accent)]";
const ROW_IDLE = "text-atelier-muted hover:bg-atelier-ink/5 hover:text-atelier-ink";

// The Tools door (operator, 2026-09-25: "B" on the sidebar draft). The menu
// keeps the places a person goes back to; every tool sits behind one row whose
// panel says what each one does. Its list is lib/nav/tools.ts.
const TOOLS_PANEL_ID = "sidebar-tools-panel";

const TOOL_ICONS: Record<ToolKey, Glyph> = {
  generate: BoltIcon,
  live: LiveIcon,
  recast: MystiqueIcon,
  sets: SetsIcon,
  recce: RecceIcon,
  cut: CutIcon,
  upscale: UpscaleIcon,
  layers: LayersIcon,
  templates: TemplatesIcon,
  notes: NotesIcon,
};

// A tool's two words: its name, and one line saying what it does. Eight of the
// ten lines were already said by the phone's lamp and More page, so a tool
// reads the same wherever it is offered.
function toolWords(t: Messages, key: ToolKey): { label: string; sub: string } {
  switch (key) {
    case "generate":
      return { label: t.nav.generate, sub: t.nav.generateSub };
    case "live":
      return { label: t.nav.live, sub: t.nav.liveSub };
    case "recast":
      return { label: t.nav.mystique, sub: t.nav.recastSub };
    case "sets":
      return { label: t.nav.sets, sub: t.moreHub.setsSubWeb };
    case "recce":
      return { label: t.nav.recce, sub: t.recce.headline };
    case "cut":
      return { label: t.nav.directorsCut, sub: t.nav.directorsCutSub };
    case "upscale":
      return { label: t.nav.upscale, sub: t.moreHub.upscaleSub };
    case "layers":
      return { label: t.nav.layers, sub: t.moreHub.layersSub };
    case "templates":
      return { label: t.nav.templates, sub: t.moreHub.templatesSub };
    case "notes":
      return { label: t.nav.notes, sub: t.nav.notesSub };
  }
}

function groupTitle(t: Messages, group: ToolGroup): string {
  return group === "make" ? t.nav.toolsGroupMake : group === "edit" ? t.nav.toolsGroupEdit : t.nav.toolsGroupStart;
}

// The one mark for "new" in the menu: a lit dot. Seven NEW pills in a row
// said nothing (2026-09-25); a dot that goes once the tool is opened does.
function NewDot({ label }: { label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className="block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-atelier-accent shadow-[0_0_8px_var(--color-atelier-accent)]"
    />
  );
}

function ToolsPanel({
  anchorRef,
  tools,
  pinned,
  newKeys,
  currentKey,
  onTogglePin,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  tools: NavTool[];
  pinned: ToolKey[];
  newKeys: ReadonlySet<ToolKey>;
  currentKey: ToolKey | undefined;
  onTogglePin: (key: ToolKey) => void;
  onClose: (returnFocus: boolean) => void;
}) {
  const { t } = useLocale();
  const panelRef = useRef<HTMLDivElement>(null);
  // Beside the sidebar on a computer, anchored to the Tools row; a sheet
  // over the drawer on a phone, where there is no room beside it.
  const [pos, setPos] = useState<{ wide: boolean; left: number; top: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    function place() {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const wide = window.innerWidth >= 768;
      const row = anchor.getBoundingClientRect();
      const aside = anchor.closest("aside")?.getBoundingClientRect() ?? row;
      const top = Math.max(12, Math.min(row.top - 8, window.innerHeight - 320));
      const next = { wide, left: aside.right + 8, top, maxHeight: window.innerHeight - top - 12 };
      setPos((prev) =>
        prev && prev.wide === next.wide && prev.left === next.left && prev.top === next.top && prev.maxHeight === next.maxHeight
          ? prev
          : next,
      );
    }
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchorRef]);

  // Keyboard: the first tool takes focus when the panel opens, Escape hands
  // it back to the Tools row.
  const placed = pos !== null;
  useEffect(() => {
    if (placed) panelRef.current?.querySelector<HTMLElement>("a[href]")?.focus({ preventScroll: true });
  }, [placed]);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose(true);
    }
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [anchorRef, onClose]);

  if (!pos) return null;

  return createPortal(
    <div
      ref={panelRef}
      id={TOOLS_PANEL_ID}
      role="dialog"
      aria-label={t.nav.tools}
      data-tools-panel
      style={pos.wide ? { left: pos.left, top: pos.top, maxHeight: pos.maxHeight } : undefined}
      className={cn(
        "fixed z-50 overflow-y-auto overscroll-contain rounded-control bg-atelier-surface/95 p-4 backdrop-blur-xl shadow-[0_0_0_1px_var(--frost-ring),0_24px_48px_-12px_rgba(0,0,0,0.3)]",
        pos.wide ? "w-[600px]" : "inset-x-3 bottom-3 top-[4.5rem]",
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1">
        <p className="text-sm font-medium text-atelier-ink">{t.nav.toolsTitle}</p>
        {pos.wide && <p className="text-[11px] text-atelier-muted">{formatMsg(t.nav.toolsSearchHint, { key: "⌘K" })}</p>}
      </div>
      {TOOL_GROUPS.map((group) => {
        const shelf = tools.filter((tool) => tool.group === group);
        if (shelf.length === 0) return null;
        return (
          <div key={group} className="mt-3">
            <p className="px-1 pb-1.5 text-[10px] font-medium uppercase tracking-widest text-atelier-muted">
              {groupTitle(t, group)}
            </p>
            <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
              {shelf.map((tool, i) => {
                const { label, sub } = toolWords(t, tool.key);
                const Icon = TOOL_ICONS[tool.key];
                const isPinned = pinned.includes(tool.key);
                // A shelf's first card spans the row when the rest pair up,
                // so no shelf ends on a lone half-width card.
                const lead = i === 0 && shelf.length % 2 === 1 && shelf.length > 1;
                return (
                  <div
                    key={tool.key}
                    className={cn(
                      "group relative rounded-control border transition-colors hover:bg-atelier-ink/[0.04]",
                      lead && "md:col-span-2",
                      tool.key === currentKey ? "border-atelier-accent/50 bg-atelier-ink/[0.04]" : "border-atelier-rule",
                    )}
                  >
                    <Link
                      href={tool.href}
                      onClick={() => onClose(false)}
                      aria-current={tool.key === currentKey ? "page" : undefined}
                      className="flex items-start gap-3 rounded-control px-3 py-2.5 pr-10"
                    >
                      <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-control bg-atelier-ink/[0.06] text-atelier-ink">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-1.5">
                          <span className="text-sm text-atelier-ink">{label}</span>
                          {newKeys.has(tool.key) && (
                            <span className="rounded-full bg-atelier-accent/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-atelier-accent">
                              {t.nav.newBadge}
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block text-xs leading-snug text-atelier-muted">{sub}</span>
                      </span>
                    </Link>
                    {/* Generate is always in the menu, so it has nothing to pin. */}
                    {tool.key !== "generate" && (
                      <button
                        type="button"
                        onClick={() => onTogglePin(tool.key)}
                        aria-pressed={isPinned}
                        aria-label={formatMsg(isPinned ? t.nav.unpinTool : t.nav.pinTool, { name: label })}
                        title={formatMsg(isPinned ? t.nav.unpinTool : t.nav.pinTool, { name: label })}
                        className={cn(
                          "absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-control transition-[opacity,color]",
                          isPinned
                            ? "text-atelier-accent"
                            : "text-atelier-muted hover:text-atelier-ink focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100",
                        )}
                      >
                        <PinIcon className={cn("h-3.5 w-3.5", isPinned && "fill-current")} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

export function AppSidebar({
  isAdmin,
  username,
  plan,
  recentJobs,
  supportEmail,
  skipAiRefinement,
  voiceModeEnabled,
  setsVisible = false,
  recceVisible = false,
  mystiqueVisible = false,
  liveVisible = false,
  cutVisible = false,
}: {
  isAdmin: boolean;
  username: string;
  plan: PlanId;
  recentJobs: RecentJob[];
  supportEmail: string;
  voiceModeEnabled: boolean;
  skipAiRefinement: boolean;
  /** Sets (Astra) — shown only when the flag is on and the account may open it. */
  setsVisible?: boolean;
  /** The Recce door (board K) — admins only, behind astra_recce. */
  recceVisible?: boolean;
  /** The Mystique door (working title) — admins only, behind the recast flag. */
  mystiqueVisible?: boolean;
  /** Live (H3 Max Director) — every paid plan, behind the live flag. */
  liveVisible?: boolean;
  /** Director's Cut (the video editor) — admins only, behind the video_editor flag. */
  cutVisible?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { t } = useLocale();
  const s = t.settings;
  // The tools this account may open, behind the one Tools row.
  const tools = visibleTools({ setsVisible, recceVisible, mystiqueVisible, liveVisible, cutVisible });
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsButtonRef = useRef<HTMLButtonElement>(null);
  // Pins and the tools this person has already opened: per-browser
  // conveniences like the collapse preference, read after mount so the
  // server and first client render agree (no dots or pins until then).
  const [toolPrefs, setToolPrefs] = useState<{ pinned: ToolKey[]; seen: ToolKey[]; today: string } | null>(null);
  const themeLabel: Record<ThemeMode, string> = {
    default: s.themeDefault,
    light: s.themeLight,
    dark: s.themeDark,
  };
  const [collapsed, setCollapsed] = useState(false);
  // Separate from the desktop icon-only "collapsed" preference above — this
  // controls the mobile off-canvas drawer (hidden by default, opened by the
  // hamburger button in the mobile top bar). Previously there was no mobile
  // layout at all: the sidebar was a permanent fixed-width column that ate
  // more than half of a typical phone screen on every single page.
  const [mobileOpen, setMobileOpen] = useState(false);
  // While the mobile drawer is open, always show the full (non-icon-only)
  // layout regardless of the desktop collapse preference — collapsing a
  // temporary overlay to icon-only doesn't make sense the way it does for a
  // persistent desktop rail.
  const iconOnly = collapsed && !mobileOpen;
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ bottom: number; left: number } | null>(null);
  const [displayUsername, setDisplayUsername] = useState(username);
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState(username);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [savingUsername, setSavingUsername] = useState(false);
  const usernameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDisplayUsername(username);
    setUsernameDraft(username);
  }, [username]);

  // Close the popover on outside click; also bail out of an in-progress
  // username edit so a stray click doesn't leave a half-edited draft. The
  // menu itself is portaled to <body> (see below), so a click inside it
  // isn't a DOM descendant of settingsRef — it has to be checked separately.
  useEffect(() => {
    if (!settingsOpen) return;
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      const insideTrigger = settingsRef.current?.contains(target);
      const insideMenu = menuRef.current?.contains(target);
      if (!insideTrigger && !insideMenu) {
        setSettingsOpen(false);
        setEditingUsername(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [settingsOpen]);

  // The popover is rendered via a portal into <body> so it isn't clipped by
  // the sidebar's own overflow-hidden (needed for the collapse-width
  // transition). Position is computed from the trigger's live coordinates
  // and kept in sync while open, since portaled content can't rely on a
  // positioned ancestor for placement.
  useLayoutEffect(() => {
    if (!settingsOpen) return;
    function updatePosition() {
      const el = settingsRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const next = {
        bottom: window.innerHeight - rect.top + 8,
        left: iconOnly ? rect.right + 8 : rect.left,
      };
      // The menu tracks the trigger, so while nothing moves there is nothing
      // to write — and a scroll that does not move this trigger (the capture
      // phase hears EVERY scroller in the page) used to re-render anyway.
      setMenuPos((prev) =>
        prev && prev.bottom === next.bottom && prev.left === next.left ? prev : next,
      );
    }
    // Coalesced to one measurement per frame: a rect read per scroll event,
    // from every scroller in the document, is the same picture measured
    // several times over.
    let frame: number | null = null;
    const onScroll = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        updatePosition();
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [settingsOpen, iconOnly]);

  // Close the mobile drawer automatically after navigating — otherwise it
  // would stay open over the new page until manually dismissed.
  useEffect(() => {
    setMobileOpen(false);
    setToolsOpen(false);
  }, [pathname]);

  useEffect(() => {
    let pinned: ToolKey[] = [];
    let seen: ToolKey[] = [];
    try {
      pinned = parseToolKeys(window.localStorage.getItem(PINNED_STORAGE_KEY));
      seen = parseToolKeys(window.localStorage.getItem(SEEN_STORAGE_KEY));
    } catch {
      // Storage blocked: no pins, and every new tool keeps its dot.
    }
    setToolPrefs({ pinned, seen, today: localDay(new Date()) });
  }, []);

  // Opening a new tool is what retires its dot.
  const currentTool = toolForPath(pathname, tools);
  const openedNewKey = currentTool?.newUntil ? currentTool.key : null;
  const prefsLoaded = toolPrefs !== null;
  useEffect(() => {
    if (!openedNewKey || !prefsLoaded) return;
    setToolPrefs((prev) => {
      if (!prev || prev.seen.includes(openedNewKey)) return prev;
      const seen = [...prev.seen, openedNewKey];
      try {
        window.localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(seen));
      } catch {
        // Storage blocked — the dot comes back next visit, nothing breaks.
      }
      return { ...prev, seen };
    });
  }, [openedNewKey, prefsLoaded]);

  function toggleToolPin(key: ToolKey) {
    setToolPrefs((prev) => {
      const base = prev ?? { pinned: [], seen: [], today: localDay(new Date()) };
      const pinned = togglePin(base.pinned, key);
      try {
        window.localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(pinned));
      } catch {
        // Storage blocked — the pin holds for this visit.
      }
      return { ...base, pinned };
    });
  }

  const closeTools = useCallback((returnFocus: boolean) => {
    setToolsOpen(false);
    if (returnFocus) toolsButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (editingUsername) usernameInputRef.current?.focus();
  }, [editingUsername]);

  function startEditingUsername() {
    setUsernameDraft(displayUsername);
    setUsernameError(null);
    setEditingUsername(true);
  }

  function cancelEditingUsername() {
    setEditingUsername(false);
    setUsernameError(null);
    setUsernameDraft(displayUsername);
  }

  async function saveUsername() {
    if (usernameDraft.trim().toLowerCase() === displayUsername.toLowerCase()) {
      setEditingUsername(false);
      return;
    }
    setSavingUsername(true);
    setUsernameError(null);
    const formData = new FormData();
    formData.set("username", usernameDraft);
    const result = await updateUsername(formData);
    setSavingUsername(false);
    if (result.error !== null) {
      setUsernameError(result.error);
      return;
    }
    setDisplayUsername(usernameDraft.trim().toLowerCase());
    setEditingUsername(false);
  }

  // Read the saved preference after mount (not during the initial render) so
  // the server-rendered and first client-rendered output always match —
  // avoids a hydration mismatch, at the cost of a brief flash if collapsed.
  useEffect(() => {
    // try/catch, not optional: with "Block all cookies" set, touching
    // localStorage at all throws, and an unguarded mount effect here takes
    // the whole app shell down with it.
    try {
      const saved = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
      if (saved === "1") setCollapsed(true);
    } catch {
      // No stored preference — start expanded.
    }
  }, []);

  // Cmd/Ctrl+K opens search from anywhere in the app, same as Claude.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSED_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Storage blocked — the toggle still works for this visit.
      }
      return next;
    });
  }

  function isActive(href: string) {
    return pathname === href || pathname?.startsWith(`${href}/`);
  }

  const seenSet = new Set<ToolKey>(toolPrefs?.seen ?? []);
  const newKeys = new Set<ToolKey>(
    toolPrefs ? tools.filter((tool) => isToolNew(tool, toolPrefs.today, seenSet)).map((tool) => tool.key) : [],
  );
  const pinnedTools = (toolPrefs?.pinned ?? [])
    .map((key) => tools.find((tool) => tool.key === key))
    .filter((tool): tool is NavTool => tool !== undefined && tool.key !== "generate");
  // The Tools row lights while you are on a tool it holds, unless that tool
  // is pinned (its own row lights then) — so you always see where you are.
  const onUnpinnedTool =
    currentTool !== undefined && currentTool.key !== "generate" && !pinnedTools.includes(currentTool);

  // Every page and tool, for ⌘K: a feature nobody can find by name is the
  // one people miss.
  const searchPages: SearchPage[] = [
    { href: "/app", label: t.nav.home },
    ...tools.map((tool) => ({ href: tool.href, ...toolWords(t, tool.key) })),
    { href: "/app/character", label: t.nav.characters },
    { href: "/app/media", label: t.nav.media },
    { href: "/app/history", label: t.nav.history },
    { href: "/app/projects", label: t.nav.projects },
    { href: "/app/community", label: t.nav.community },
    { href: "/app/settings", label: t.nav.settings },
    ...(isAdmin ? [{ href: "/admin", label: t.nav.admin }] : []),
  ];

  // One row of the menu. The collapsed rail keeps the icon and moves the dot
  // onto its corner.
  function navRow({
    href,
    label,
    Icon,
    active,
    dot = false,
    tourId,
  }: {
    href: string;
    label: string;
    Icon: Glyph;
    active: boolean;
    dot?: boolean;
    tourId?: string;
  }) {
    return (
      <Link
        key={href}
        href={href}
        title={label}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        data-tour-id={tourId}
        className={cn(
          "relative flex items-center gap-2.5 whitespace-nowrap rounded-control text-sm transition-colors",
          iconOnly ? "h-9 w-9 justify-center" : "px-2.5 py-2",
          active ? ROW_ACTIVE : ROW_IDLE,
        )}
      >
        <Icon className="h-4 w-4 flex-shrink-0" />
        {!iconOnly && <span className="flex-1 text-left">{label}</span>}
        {dot &&
          (iconOnly ? (
            <span className="absolute right-1.5 top-1.5">
              <NewDot label={t.nav.newBadge} />
            </span>
          ) : (
            <NewDot label={t.nav.newBadge} />
          ))}
      </Link>
    );
  }

  // Global voice command — "open characters" navigates, "new chat" clears
  // the Generate thread, and anything else is forwarded to Generate as a
  // prompt (which auto-sends it and speaks the result back).
  function handleVoiceCommand(text: string) {
    const command = parseVoiceCommand(text);
    if (command.type === "navigate") {
      router.push(command.href);
    } else if (command.type === "new-chat") {
      router.push("/app/generate?voice=__new_chat__");
    } else if (command.type === "prompt") {
      router.push(`/app/generate?voice=${encodeURIComponent(command.text)}`);
    } else {
      // "switch-character" can't actually happen from this call site —
      // parseVoiceCommand only returns it when given a list of the
      // account's character names, and the sidebar's global command isn't
      // scoped to any particular page/character. Forward the raw text as a
      // prompt as a safe fallback instead of leaving this non-exhaustive.
      router.push(`/app/generate?voice=${encodeURIComponent(text)}`);
    }
  }

  // A single persistent <aside> whose width (and inner padding) transitions
  // smoothly — collapsing used to swap between two entirely different
  // elements, which just snapped instantly with no animation.
  return (
    <>
      {/* Mobile top bar — only shown below md. Replaces the permanent
          sidebar with a slim bar plus a hamburger button that opens the
          same sidebar as an off-canvas drawer. */}
      {/* Tagged so the native app can hide it: its only job is opening the
          sidebar, and the app navigates by bottom tabs instead. See the
          html.native-app rules in globals.css. */}
      <div
        data-mobile-topbar
        className="fixed inset-x-0 top-0 z-30 flex h-14 flex-shrink-0 items-center justify-between border-b border-atelier-rule bg-atelier-surface/80 backdrop-blur-xl px-3 md:hidden"
      >
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label={s.showSidebar}
          data-tour-id="tour-menu"
          className="flex h-9 w-9 items-center justify-center rounded-control text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink"
        >
          <MenuIcon className="h-5 w-5" />
        </button>
        <Link href="/app/generate" className="flex items-center gap-1">
          <Logo className="h-6" />
          <EarlyAccessBadge />
        </Link>
        <span className="h-9 w-9" aria-hidden="true" />
      </div>

      {/* Backdrop behind the mobile drawer — tapping it closes the menu.
          z-38: above the Generate page's phone dock (z-37, fixed), so the
          RENDER key never stays live beside an open drawer. */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-[38] bg-black/30 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        data-app-sidebar
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex h-screen w-72 flex-shrink-0 flex-col overflow-hidden border-r border-atelier-rule bg-atelier-surface/75 backdrop-blur-xl px-3 py-5 shadow-2xl transition-transform duration-200 ease-in-out",
          // Screening Room: the rail is darker than the room it sits beside,
          // so the render reads as the lit thing on the screen.
          "screening-dark:bg-[#0a0907]/95",
          "md:static md:z-auto md:shadow-none md:transition-[width,padding] md:duration-200",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
          collapsed ? "md:w-14 md:items-center md:px-2" : "md:w-64 md:px-3",
        )}
      >
      <div className={cn("flex items-center", iconOnly ? "flex-col gap-3" : "justify-between px-2")}>
        <Link
          href="/app/generate"
          title="Picacho"
          data-app-logo
          // overflow-hidden + a nowrap, fixed-width wordmark below turn the
          // collapse/expand into a clean slide-reveal — without them the
          // 200px wordmark reflowed inside the still-animating 56px rail
          // (operator, 2026-08-26: 'weird transition ... between the P logo
          // and the Full logo').
          className={cn("flex items-center gap-1 overflow-hidden", iconOnly && "justify-center")}
        >
          {iconOnly ? (
            // The wordmark is too wide to read as a small square icon, so
            // the collapsed rail shows the wordmark's own P with its ochre
            // underline — transparent, no badge disc (operator, 2026-08-26:
            // 'Remove the black circle'). Light/dark pair, same swap
            // mechanism as the Logo component.
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand-icon.png" alt="Picacho" className="h-6 w-6 flex-shrink-0 dark:hidden" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand-icon-dark.png"
                alt="Picacho"
                className="hidden h-6 w-6 flex-shrink-0 dark:block"
              />
            </>
          ) : (
            <span className="flex flex-shrink-0 items-center gap-1 whitespace-nowrap">
              <Logo className="h-6" />
              <EarlyAccessBadge />
            </span>
          )}
        </Link>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? s.showSidebar : s.hideSidebar}
          title={collapsed ? s.showSidebar : s.hideSidebar}
          className="hidden h-6 w-6 flex-shrink-0 items-center justify-center rounded-control text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink md:flex"
        >
          <PanelIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label={s.hideSidebar}
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-control text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink md:hidden"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>

      <div className={cn("mt-4 flex items-center gap-1.5", iconOnly && "flex-col")}>
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          title={t.nav.search}
          aria-label={t.nav.search}
          className={cn(
            "flex flex-1 items-center gap-2.5 whitespace-nowrap rounded-control text-sm text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink",
            iconOnly ? "h-9 w-9 justify-center" : "w-full px-2.5 py-2",
          )}
        >
          <SearchIcon className="h-4 w-4 flex-shrink-0" />
          {!iconOnly && <span>{t.nav.search}</span>}
          {!iconOnly && <span className="ml-auto flex-shrink-0 text-xs text-atelier-muted/60">⌘K</span>}
        </button>

        {/* Global voice command — part of voice mode, so it follows the
            same feature flag (see lib/voice/enabled.ts). */}
        {voiceModeEnabled && (
          <VoiceRecorderButton
            onTranscript={handleVoiceCommand}
            size={iconOnly ? "md" : "sm"}
            className={iconOnly ? undefined : "flex-shrink-0"}
          />
        )}
      </div>

      <nav className={cn("mt-2 space-y-0.5", iconOnly && "flex flex-col items-center")}>
        {/* The places a person goes back to, and one door to every tool
            (operator, 2026-09-25: "B"). A new tool is a card behind the door,
            never a new row here — the list is lib/nav/tools.ts. */}
        {navRow({ href: "/app", label: t.nav.home, Icon: HomeIcon, active: pathname === "/app" })}
        {navRow({ href: "/app/generate", label: t.nav.generate, Icon: BoltIcon, active: isActive("/app/generate") })}
        <button
          ref={toolsButtonRef}
          type="button"
          onClick={() => setToolsOpen((v) => !v)}
          title={t.nav.tools}
          aria-label={t.nav.tools}
          aria-haspopup="dialog"
          aria-expanded={toolsOpen}
          aria-controls={toolsOpen ? TOOLS_PANEL_ID : undefined}
          data-tour-id="tour-tools"
          className={cn(
            "relative flex items-center gap-2.5 whitespace-nowrap rounded-control text-sm transition-colors",
            iconOnly ? "h-9 w-9 justify-center" : "w-full px-2.5 py-2",
            toolsOpen
              ? "bg-atelier-ink/[0.06] font-medium text-atelier-ink"
              : onUnpinnedTool
                ? ROW_ACTIVE
                : ROW_IDLE,
          )}
        >
          <ToolsIcon className="h-4 w-4 flex-shrink-0" />
          {iconOnly ? (
            newKeys.size > 0 && (
              <span className="absolute right-1.5 top-1.5">
                <NewDot label={t.nav.newBadge} />
              </span>
            )
          ) : (
            <>
              <span className="flex-1 text-left">{t.nav.tools}</span>
              {newKeys.size > 0 && <NewDot label={t.nav.newBadge} />}
              <span className="text-xs tabular-nums text-atelier-muted/70">{tools.length}</span>
              <ChevronRightIcon className="h-3.5 w-3.5 flex-shrink-0" />
            </>
          )}
        </button>
        {pinnedTools.map((tool) =>
          navRow({
            href: tool.href,
            label: toolWords(t, tool.key).label,
            Icon: TOOL_ICONS[tool.key],
            active: isActive(tool.href),
            dot: newKeys.has(tool.key),
          }),
        )}

        <div aria-hidden="true" className={cn("my-2 border-t border-atelier-rule", iconOnly ? "mx-auto w-6" : "mx-2.5")} />

        {navRow({
          href: "/app/character",
          label: t.nav.characters,
          Icon: UserIcon,
          active: isActive("/app/character"),
          tourId: "tour-characters",
        })}
        {/* One row to the phone's Media page (All · Images · Videos |
            History); the old Images and Videos pages still light it. */}
        {navRow({
          href: "/app/media",
          label: t.nav.media,
          Icon: MediaIcon,
          active: isActive("/app/media") || isActive("/app/images") || isActive("/app/videos"),
        })}
        {navRow({ href: "/app/history", label: t.nav.history, Icon: ClockIcon, active: isActive("/app/history") })}
        {navRow({ href: "/app/projects", label: t.nav.projects, Icon: FolderIcon, active: isActive("/app/projects") })}
        {navRow({
          href: "/app/community",
          label: t.nav.community,
          Icon: CommunityIcon,
          active: isActive("/app/community"),
          tourId: "tour-community",
        })}
      </nav>

      {toolsOpen && (
        <ToolsPanel
          anchorRef={toolsButtonRef}
          tools={tools}
          pinned={toolPrefs?.pinned ?? []}
          newKeys={newKeys}
          currentKey={currentTool?.key}
          onTogglePin={toggleToolPin}
          onClose={closeTools}
        />
      )}

      {!iconOnly && (
        <div className="mt-6 min-h-0 flex-1 space-y-6 overflow-y-auto pb-2">
          <div>
            <p className="px-2.5 text-[11px] font-medium uppercase tracking-widest text-atelier-muted">
              {s.recent}
            </p>
            {recentJobs.length === 0 ? (
              <p className="mt-2 px-2.5 text-xs text-atelier-muted">{s.nothingGeneratedYet}</p>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {recentJobs.map((job) => (
                  <li key={job.id}>
                    <Link
                      href={`/app/history/${job.id}`}
                      className={cn(
                        "group flex items-center gap-2 rounded-control px-2.5 py-2 text-xs transition-colors",
                        pathname === `/app/history/${job.id}`
                          ? "bg-atelier-ink/[0.08] text-atelier-ink"
                          : "text-atelier-muted hover:bg-atelier-ink/5 hover:text-atelier-ink",
                      )}
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 flex-shrink-0 rounded-full",
                          job.status === "succeeded"
                            ? "bg-emerald-500"
                            : job.status === "failed"
                              ? "bg-red-400"
                              : "bg-atelier-rule",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">{job.prompt_input}</span>
                      {/* Same hover-capability fix as the character trash
                          below — invisible controls don't exist on phones. */}
                      <DeleteGenerationButton
                        id={job.id}
                        className="h-5 w-5 flex-shrink-0 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus:opacity-100"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div
        ref={settingsRef}
        className={cn(
          "relative mt-auto flex-shrink-0 border-t border-atelier-rule pt-3",
          iconOnly ? "flex flex-col items-center gap-2" : "flex items-center justify-between gap-2 px-0.5",
        )}
      >
        {!iconOnly && (
          <div className="flex min-w-0 flex-1 items-center gap-1.5 px-2">
            <p className="min-w-0 truncate text-xs text-atelier-muted">{displayUsername}</p>
            <span className="flex-shrink-0 rounded-full border border-atelier-rule px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-widest text-atelier-muted">
              {PLAN_LABELS[plan]}
            </span>
          </div>
        )}
        <button
          type="button"
          onClick={() => setSettingsOpen((v) => !v)}
          title={t.nav.settings}
          aria-label={t.nav.settings}
          className={cn(
            "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-control transition-colors",
            settingsOpen
              ? "bg-atelier-ink text-atelier-paper"
              : "text-atelier-muted hover:bg-atelier-ink/5 hover:text-atelier-ink",
          )}
        >
          <GearIcon className="h-4 w-4 flex-shrink-0" />
        </button>

        {settingsOpen &&
          menuPos &&
          createPortal(
            <div
              ref={menuRef}
              style={{ bottom: menuPos.bottom, left: menuPos.left }}
              className="fixed z-50 w-72 rounded-control bg-atelier-surface/95 backdrop-blur-xl p-2 shadow-[0_0_0_1px_var(--frost-ring),0_24px_48px_-12px_rgba(0,0,0,0.3)]"
            >
            <div className="px-2 pb-2 pt-1.5">
              <p className="px-0.5 text-[11px] font-medium uppercase tracking-widest text-atelier-muted">{s.theme}</p>
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {THEME_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setTheme(opt.value)}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-control border px-2 py-2 text-xs transition-colors",
                      theme === opt.value
                        ? "border-atelier-accent bg-atelier-accent/5 text-atelier-ink"
                        : "border-atelier-rule text-atelier-muted hover:border-atelier-muted hover:text-atelier-ink",
                    )}
                  >
                    <opt.icon className="h-3.5 w-3.5" />
                    <span className="flex items-center gap-1">
                      {themeLabel[opt.value]}
                      {theme === opt.value && <CheckIcon className="h-2.5 w-2.5" />}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-atelier-rule/60 px-2 py-2">
              {editingUsername ? (
                <div>
                  <p className="px-0.5 text-[11px] font-medium uppercase tracking-widest text-atelier-muted">
                    {s.usernameLabel}
                  </p>
                  <input
                    ref={usernameInputRef}
                    aria-label={s.usernameLabel}
                    value={usernameDraft}
                    onChange={(e) => setUsernameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveUsername();
                      if (e.key === "Escape") cancelEditingUsername();
                    }}
                    className="mt-1.5 w-full rounded-control border border-atelier-rule bg-transparent px-2 py-1.5 text-sm text-atelier-ink outline-none focus:border-atelier-accent"
                  />
                  {usernameError && <p className="mt-1 px-0.5 text-xs text-red-600">{usernameError}</p>}
                  <div className="mt-1.5 flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={cancelEditingUsername}
                      className="rounded-control px-2 py-1 text-xs text-atelier-muted hover:bg-atelier-ink/5"
                    >
                      {t.common.cancel}
                    </button>
                    <button
                      type="button"
                      onClick={saveUsername}
                      disabled={savingUsername}
                      className="rounded-control bg-atelier-ink px-2.5 py-1 text-xs font-medium text-atelier-paper transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {savingUsername ? t.common.saving : t.common.save}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={startEditingUsername}
                  className="flex w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-left text-sm text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink"
                >
                  <PencilIcon className="h-4 w-4 flex-shrink-0" />
                  {s.editUsername}
                </button>
              )}
            </div>

            <div className="border-t border-atelier-rule/60 px-2 py-2">
              <SkipRefinementToggle initialEnabled={skipAiRefinement} variant="compact" />
            </div>

            <div className="border-t border-atelier-rule/60 py-1">
              {/* The Settings tabs by their 2026-09-19 names: Settings itself
                  now opens on the Overview, so this row goes to Profile. */}
              <Link
                href="/app/settings?tab=profile"
                onClick={() => setSettingsOpen(false)}
                className="flex items-center gap-2.5 rounded-control px-2.5 py-2 text-sm text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink"
              >
                <IdCardIcon className="h-4 w-4 flex-shrink-0" />
                {t.settingsHub.tabProfile}
              </Link>
              <Link
                href="/app/settings?tab=billing"
                onClick={() => setSettingsOpen(false)}
                className="flex items-center gap-2.5 rounded-control px-2.5 py-2 text-sm text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink"
              >
                <GaugeIcon className="h-4 w-4 flex-shrink-0" />
                {t.settingsHub.tabBilling}
              </Link>
            </div>

            <div className="border-t border-atelier-rule/60 py-1">
              <Link
                // /app/generate, not /app: the walkthrough lives inside
                // GenerateForm, and /app is a dashboard now with no composer
                // on it — pointing here at /app?tour=1 made this link a
                // no-op, since nothing on that page consumes the param.
                href="/app/generate?tour=1"
                onClick={() => setSettingsOpen(false)}
                className="flex items-center gap-2.5 rounded-control px-2.5 py-2 text-sm text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink"
              >
                <CompassIcon className="h-4 w-4 flex-shrink-0" />
                {s.replayWalkthrough}
              </Link>
              <Link
                href="/app/tutorial"
                onClick={() => setSettingsOpen(false)}
                className="flex items-center gap-2.5 rounded-control px-2.5 py-2 text-sm text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink"
              >
                <BookIcon className="h-4 w-4 flex-shrink-0" />
                {s.tutorial}
              </Link>
              <Link
                href="/app/settings?tab=help"
                onClick={() => setSettingsOpen(false)}
                className="flex items-center gap-2.5 rounded-control px-2.5 py-2 text-sm text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink"
              >
                <MailIcon className="h-4 w-4 flex-shrink-0" />
                {s.sendFeedback}
              </Link>
              <a
                href={`mailto:${supportEmail}?subject=${encodeURIComponent("Picacho help")}`}
                className="flex items-center gap-2.5 rounded-control px-2.5 py-2 text-sm text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink"
              >
                <HelpIcon className="h-4 w-4 flex-shrink-0" />
                {s.help}
              </a>
              {/* Admin lives here since the Tools door (2026-09-25): a side
                  room for the few accounts that have it, not a menu row. */}
              {isAdmin && (
                <Link
                  href="/admin"
                  onClick={() => setSettingsOpen(false)}
                  className="flex items-center gap-2.5 rounded-control px-2.5 py-2 text-sm text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink"
                >
                  <ShieldIcon className="h-4 w-4 flex-shrink-0" />
                  {t.nav.admin}
                </Link>
              )}
              <Link
                href="/app/settings"
                onClick={() => setSettingsOpen(false)}
                className="flex items-center gap-2.5 rounded-control px-2.5 py-2 text-sm text-atelier-muted transition-colors hover:bg-atelier-ink/5 hover:text-atelier-ink"
              >
                <GearIcon className="h-4 w-4 flex-shrink-0" />
                {t.nav.settings}
              </Link>
            </div>

            <div className="border-t border-atelier-rule/60 pt-1">
              <form action={logout}>
                <button
                  type="submit"
                  className="flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/15"
                >
                  <LogOutIcon className="h-4 w-4 flex-shrink-0" />
                  {s.logOut}
                </button>
              </form>
            </div>
            </div>,
            document.body,
          )}
      </div>
      </aside>

      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} pages={searchPages} />
    </>
  );
}
