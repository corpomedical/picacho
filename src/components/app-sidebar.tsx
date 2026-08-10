"use client";

import { useEffect, useLayoutEffect, useRef, useState, type SVGProps } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { ProjectRow } from "@/components/project-row";
import { DeleteGenerationButton } from "@/components/delete-generation-button";
import { DeleteCharacterButton } from "@/components/delete-character-button";
import { SearchDialog } from "@/components/search-dialog";
import { VoiceRecorderButton } from "@/components/voice-recorder-button";
import { parseVoiceCommand } from "@/lib/voice/commands";
import { updateUsername } from "@/lib/profile/actions";
import { logout } from "@/lib/auth/actions";
import { useTheme, type ThemeMode } from "@/lib/theme/theme-provider";
import { useLocale } from "@/lib/i18n/provider";
import type { Messages } from "@/lib/i18n/messages";
import { Logo } from "@/components/logo";
import { SkipRefinementToggle } from "@/components/settings/skip-refinement-toggle";

const COLLAPSED_STORAGE_KEY = "picacho_sidebar_collapsed";

type RecentJob = {
  id: string;
  prompt_input: string;
  status: string;
  content_type: string | null;
};

type RecentCharacter = {
  id: string;
  name: string;
};

type RecentProject = {
  id: string;
  name: string;
  is_starred: boolean;
  is_pinned: boolean;
  is_archived: boolean;
};

function BoltIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />
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

function ImageIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  );
}

function VideoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="2.5" y="5.5" width="14" height="13" rx="2" />
      <path d="m21.5 8.5-5 3.5 5 3.5v-7Z" />
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

function ChevronDownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m6 9 6 6 6-6" />
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

// Images and Videos are grouped under a collapsible "Media" submenu (see
// mediaOpen below) rather than sitting as two flat top-level items — split
// out here so the two halves can be rendered around that group in the JSX
// while keeping the original top-to-bottom order (generate, projects,
// characters, history, [Media], notes).
function getNavItems(t: Messages["nav"]) {
  return [
    { href: "/app/generate", label: t.generate, icon: BoltIcon },
    { href: "/app/projects", label: t.projects, icon: FolderIcon },
    { href: "/app/character", label: t.characters, icon: UserIcon },
    { href: "/app/history", label: t.history, icon: ClockIcon },
  ];
}

function getTrailingNavItems(t: Messages["nav"]) {
  return [{ href: "/app/notes", label: t.notes, icon: NotesIcon }];
}

function getMediaItems(t: Messages["nav"]) {
  return [
    { href: "/app/images", label: t.images, icon: ImageIcon },
    { href: "/app/videos", label: t.videos, icon: VideoIcon },
  ];
}

export function AppSidebar({
  isAdmin,
  username,
  recentJobs,
  characters,
  projects,
  supportEmail,
  skipAiRefinement,
}: {
  isAdmin: boolean;
  username: string;
  recentJobs: RecentJob[];
  characters: RecentCharacter[];
  projects: RecentProject[];
  supportEmail: string;
  skipAiRefinement: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { t } = useLocale();
  const s = t.settings;
  const NAV_ITEMS = getNavItems(t.nav);
  const TRAILING_NAV_ITEMS = getTrailingNavItems(t.nav);
  const MEDIA_ITEMS = getMediaItems(t.nav);
  const [mediaOpen, setMediaOpen] = useState(false);
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
      setMenuPos({
        bottom: window.innerHeight - rect.top + 8,
        left: iconOnly ? rect.right + 8 : rect.left,
      });
    }
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [settingsOpen, iconOnly]);

  // Close the mobile drawer automatically after navigating — otherwise it
  // would stay open over the new page until manually dismissed.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

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
    const saved = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
    if (saved === "1") setCollapsed(true);
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
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  function isActive(href: string) {
    return pathname === href || pathname?.startsWith(`${href}/`);
  }

  // Whether either child of the Media group is the current page — used both
  // to highlight the group's own row and to auto-expand it so landing
  // directly on /app/images or /app/videos (e.g. from a bookmark) doesn't
  // hide the active page inside a collapsed submenu.
  const isMediaActive = isActive("/app/images") || isActive("/app/videos");
  const mediaExpanded = mediaOpen || isMediaActive;

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
      <div className="fixed inset-x-0 top-0 z-30 flex h-14 flex-shrink-0 items-center justify-between border-b border-neutral-200/70 bg-neutral-50 px-3 md:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label={s.showSidebar}
          className="flex h-9 w-9 items-center justify-center rounded-[8px] text-neutral-600 hover:bg-neutral-100"
        >
          <MenuIcon className="h-5 w-5" />
        </button>
        <Link href="/app/generate" className="flex items-center gap-2">
          <Logo className="h-6" />
        </Link>
        <span className="h-9 w-9" aria-hidden="true" />
      </div>

      {/* Backdrop behind the mobile drawer — tapping it closes the menu. */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/30 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex h-screen w-72 flex-shrink-0 flex-col overflow-hidden border-r border-neutral-200/70 bg-neutral-50 px-3 py-5 shadow-2xl transition-transform duration-200 ease-in-out",
          "md:static md:z-auto md:shadow-none md:transition-[width,padding] md:duration-200",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
          collapsed ? "md:w-14 md:items-center md:px-2" : "md:w-64 md:px-3",
        )}
      >
      <div className={cn("flex items-center", iconOnly ? "flex-col gap-3" : "justify-between px-2")}>
        <Link
          href="/app/generate"
          title="Picacho"
          className={cn("flex items-center gap-2", iconOnly && "justify-center")}
        >
          {iconOnly ? (
            // The wordmark is too wide to read as a small square icon, so
            // the collapsed rail keeps the compact "P" badge instead.
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[11px] font-semibold text-white">
              P
            </span>
          ) : (
            <Logo className="h-6" />
          )}
        </Link>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? s.showSidebar : s.hideSidebar}
          title={collapsed ? s.showSidebar : s.hideSidebar}
          className="hidden h-6 w-6 flex-shrink-0 items-center justify-center rounded-[6px] text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 md:flex"
        >
          <PanelIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label={s.hideSidebar}
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[6px] text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 md:hidden"
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
            "flex flex-1 items-center gap-2.5 whitespace-nowrap rounded-[10px] text-sm text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900",
            iconOnly ? "h-9 w-9 justify-center" : "w-full px-2.5 py-2",
          )}
        >
          <SearchIcon className="h-4 w-4 flex-shrink-0" />
          {!iconOnly && <span>{t.nav.search}</span>}
          {!iconOnly && <span className="ml-auto flex-shrink-0 text-xs text-neutral-300">⌘K</span>}
        </button>

        <VoiceRecorderButton
          onTranscript={handleVoiceCommand}
          size={iconOnly ? "md" : "sm"}
          className={iconOnly ? undefined : "flex-shrink-0"}
        />
      </div>

      <nav className={cn("mt-2 space-y-0.5", iconOnly && "flex flex-col items-center")}>
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            title={item.label}
            aria-label={item.label}
            data-tour-id={item.href === "/app/character" ? "tour-characters" : undefined}
            className={cn(
              "flex items-center gap-2.5 whitespace-nowrap rounded-[10px] text-sm transition-colors",
              iconOnly ? "h-9 w-9 justify-center" : "px-2.5 py-2",
              isActive(item.href)
                ? "bg-neutral-900 text-white"
                : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900",
            )}
          >
            <item.icon className="h-4 w-4 flex-shrink-0" />
            {!iconOnly && item.label}
          </Link>
        ))}

        {/* Media group — Images + Videos collapsed under one entry instead of
            two flat top-level items. Collapsed-rail (iconOnly) mode skips the
            expand/collapse UX entirely (cramped in a 56px-wide rail) and just
            links straight to Images. */}
        {iconOnly ? (
          <Link
            href="/app/images"
            title={t.nav.media}
            aria-label={t.nav.media}
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-[10px] text-sm transition-colors",
              isMediaActive
                ? "bg-neutral-900 text-white"
                : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900",
            )}
          >
            <MediaIcon className="h-4 w-4 flex-shrink-0" />
          </Link>
        ) : (
          <div>
            <button
              type="button"
              onClick={() => setMediaOpen((v) => !v)}
              title={t.nav.media}
              aria-label={t.nav.media}
              aria-expanded={mediaExpanded}
              className={cn(
                "flex w-full items-center gap-2.5 whitespace-nowrap rounded-[10px] px-2.5 py-2 text-sm transition-colors",
                isMediaActive
                  ? "bg-neutral-900 text-white"
                  : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900",
              )}
            >
              <MediaIcon className="h-4 w-4 flex-shrink-0" />
              <span className="flex-1 text-left">{t.nav.media}</span>
              <ChevronDownIcon
                className={cn("h-3.5 w-3.5 flex-shrink-0 transition-transform", mediaExpanded && "rotate-180")}
              />
            </button>
            {mediaExpanded && (
              <div className="ml-4 mt-0.5 space-y-0.5 border-l border-neutral-100 pl-2">
                {MEDIA_ITEMS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={item.label}
                    aria-label={item.label}
                    className={cn(
                      "flex items-center gap-2.5 whitespace-nowrap rounded-[10px] px-2.5 py-1.5 text-sm transition-colors",
                      isActive(item.href)
                        ? "bg-neutral-900 text-white"
                        : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900",
                    )}
                  >
                    <item.icon className="h-3.5 w-3.5 flex-shrink-0" />
                    {item.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {TRAILING_NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            title={item.label}
            aria-label={item.label}
            className={cn(
              "flex items-center gap-2.5 whitespace-nowrap rounded-[10px] text-sm transition-colors",
              iconOnly ? "h-9 w-9 justify-center" : "px-2.5 py-2",
              isActive(item.href)
                ? "bg-neutral-900 text-white"
                : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900",
            )}
          >
            <item.icon className="h-4 w-4 flex-shrink-0" />
            {!iconOnly && item.label}
          </Link>
        ))}
        {isAdmin && (
          <Link
            href="/admin"
            title={t.nav.admin}
            aria-label={t.nav.admin}
            className={cn(
              "flex items-center gap-2.5 whitespace-nowrap rounded-[10px] text-sm transition-colors",
              iconOnly ? "h-9 w-9 justify-center" : "px-2.5 py-2",
              pathname?.startsWith("/admin")
                ? "bg-neutral-900 text-white"
                : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900",
            )}
          >
            <ShieldIcon className="h-4 w-4 flex-shrink-0" />
            {!iconOnly && t.nav.admin}
          </Link>
        )}
      </nav>

      {!iconOnly && (
        <div className="mt-6 min-h-0 flex-1 space-y-6 overflow-y-auto pb-2">
          <div>
            <p className="px-2.5 text-xs font-medium uppercase tracking-wide text-neutral-400">
              {s.recent}
            </p>
            {recentJobs.length === 0 ? (
              <p className="mt-2 px-2.5 text-xs text-neutral-400">{s.nothingGeneratedYet}</p>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {recentJobs.map((job) => (
                  <li key={job.id}>
                    <Link
                      href={`/app/history/${job.id}`}
                      className={cn(
                        "group flex items-center gap-2 rounded-[10px] px-2.5 py-2 text-xs transition-colors",
                        pathname === `/app/history/${job.id}`
                          ? "bg-neutral-100 text-neutral-900"
                          : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900",
                      )}
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 flex-shrink-0 rounded-full",
                          job.status === "succeeded"
                            ? "bg-emerald-500"
                            : job.status === "failed"
                              ? "bg-red-400"
                              : "bg-neutral-300",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">{job.prompt_input}</span>
                      <DeleteGenerationButton
                        id={job.id}
                        className="h-5 w-5 flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between px-2.5">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                {t.nav.projects}
              </p>
              <Link href="/app/projects/new" className="text-xs text-neutral-400 hover:text-neutral-700">
                {s.newShort}
              </Link>
            </div>
            {projects.length === 0 ? (
              <p className="mt-2 px-2.5 text-xs text-neutral-400">{s.noneYet}</p>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {projects.map((p) => (
                  <li key={p.id}>
                    <ProjectRow project={p} variant="sidebar" />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between px-2.5">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                {t.nav.characters}
              </p>
              <Link href="/app/character/new" className="text-xs text-neutral-400 hover:text-neutral-700">
                {s.newShort}
              </Link>
            </div>
            {characters.length === 0 ? (
              <p className="mt-2 px-2.5 text-xs text-neutral-400">{s.noneYet}</p>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {characters.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/app/character/${c.id}`}
                      className={cn(
                        "group flex items-center gap-2 rounded-[10px] px-2.5 py-2 text-xs transition-colors",
                        pathname === `/app/character/${c.id}`
                          ? "bg-neutral-100 text-neutral-900"
                          : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900",
                      )}
                    >
                      <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-neutral-200 text-[9px] font-semibold text-neutral-600">
                        {c.name.charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      <DeleteCharacterButton
                        id={c.id}
                        name={c.name}
                        className="h-5 w-5 flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
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
          "relative mt-auto flex-shrink-0 border-t border-neutral-200/70 pt-3",
          iconOnly ? "flex flex-col items-center gap-2" : "flex items-center justify-between gap-2 px-0.5",
        )}
      >
        {!iconOnly && <p className="min-w-0 flex-1 truncate px-2 text-xs text-neutral-400">{displayUsername}</p>}
        <button
          type="button"
          onClick={() => setSettingsOpen((v) => !v)}
          title={t.nav.settings}
          aria-label={t.nav.settings}
          className={cn(
            "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[8px] transition-colors",
            settingsOpen
              ? "bg-neutral-900 text-white"
              : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900",
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
              className="fixed z-50 w-72 rounded-[16px] border border-neutral-200 bg-white p-2 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.25)]"
            >
            <div className="px-2 pb-2 pt-1.5">
              <p className="px-0.5 text-xs font-medium uppercase tracking-wide text-neutral-400">{s.theme}</p>
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {THEME_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setTheme(opt.value)}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-[10px] border px-2 py-2 text-xs transition-colors",
                      theme === opt.value
                        ? "border-neutral-900 bg-neutral-50 text-neutral-900"
                        : "border-neutral-200 text-neutral-500 hover:border-neutral-300 hover:text-neutral-900",
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

            <div className="border-t border-neutral-100 px-2 py-2">
              {editingUsername ? (
                <div>
                  <p className="px-0.5 text-xs font-medium uppercase tracking-wide text-neutral-400">
                    {s.usernameLabel}
                  </p>
                  <input
                    ref={usernameInputRef}
                    value={usernameDraft}
                    onChange={(e) => setUsernameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveUsername();
                      if (e.key === "Escape") cancelEditingUsername();
                    }}
                    className="mt-1.5 w-full rounded-[8px] border border-neutral-200 px-2 py-1.5 text-sm text-neutral-900 outline-none focus:border-neutral-400"
                  />
                  {usernameError && <p className="mt-1 px-0.5 text-xs text-red-600">{usernameError}</p>}
                  <div className="mt-1.5 flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={cancelEditingUsername}
                      className="rounded-[8px] px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100"
                    >
                      {t.common.cancel}
                    </button>
                    <button
                      type="button"
                      onClick={saveUsername}
                      disabled={savingUsername}
                      className="rounded-[8px] bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {savingUsername ? t.common.saving : t.common.save}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={startEditingUsername}
                  className="flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left text-sm text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
                >
                  <PencilIcon className="h-4 w-4 flex-shrink-0" />
                  {s.editUsername}
                </button>
              )}
            </div>

            <div className="border-t border-neutral-100 px-2 py-2">
              <SkipRefinementToggle initialEnabled={skipAiRefinement} variant="compact" />
            </div>

            <div className="border-t border-neutral-100 py-1">
              <Link
                href="/app/settings"
                onClick={() => setSettingsOpen(false)}
                className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-sm text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
              >
                <IdCardIcon className="h-4 w-4 flex-shrink-0" />
                {s.profileDetails}
              </Link>
              <Link
                href="/app/settings?tab=usage"
                onClick={() => setSettingsOpen(false)}
                className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-sm text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
              >
                <GaugeIcon className="h-4 w-4 flex-shrink-0" />
                {s.usageLimits}
              </Link>
            </div>

            <div className="border-t border-neutral-100 py-1">
              <Link
                href="/app?tour=1"
                onClick={() => setSettingsOpen(false)}
                className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-sm text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
              >
                <CompassIcon className="h-4 w-4 flex-shrink-0" />
                {s.replayWalkthrough}
              </Link>
              <a
                href={`mailto:${supportEmail}?subject=${encodeURIComponent("Picacho feedback")}`}
                className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-sm text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
              >
                <MailIcon className="h-4 w-4 flex-shrink-0" />
                {s.sendFeedback}
              </a>
              <a
                href={`mailto:${supportEmail}?subject=${encodeURIComponent("Picacho help")}`}
                className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-sm text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
              >
                <HelpIcon className="h-4 w-4 flex-shrink-0" />
                {s.help}
              </a>
              <Link
                href="/app/settings"
                onClick={() => setSettingsOpen(false)}
                className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-sm text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
              >
                <GearIcon className="h-4 w-4 flex-shrink-0" />
                {t.nav.settings}
              </Link>
            </div>

            <div className="border-t border-neutral-100 pt-1">
              <form action={logout}>
                <button
                  type="submit"
                  className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/15"
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

      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
