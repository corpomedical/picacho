// The door's line icons (the Red Carpet artboards' set: 24-unit strokes,
// round caps). Decorative: every one is aria-hidden and sits beside words.

import type { ReactNode } from "react";

type IconProps = { className?: string };

function Icon({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={className ?? "h-4 w-4 flex-none"}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function CheckIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M5 12.5 9.5 17 19 7.5" />
    </Icon>
  );
}

export function LinkIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" />
      <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />
    </Icon>
  );
}

export function RefreshIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4v5h-5" />
    </Icon>
  );
}

export function SendIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 19V5" />
      <path d="m6 11 6-6 6 6" />
    </Icon>
  );
}

export function InfoIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </Icon>
  );
}

export function CloseIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  );
}

export function UploadIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M5 20h14" />
    </Icon>
  );
}

export function EditIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 20h4L19 9l-4-4L4 16v4Z" />
      <path d="m13.5 6.5 4 4" />
    </Icon>
  );
}

export function PhotosIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m21 16-5-5-8 8" />
    </Icon>
  );
}

/** The press camera (the Press Tour row's icon on the artboards). */
export function PressIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3" y="7" width="18" height="13" rx="2.5" />
      <circle cx="12" cy="13.5" r="3.5" />
      <path d="M8 7l1.5-2.5h5L16 7" />
      <path d="M18 4.5v2M17 5.5h2" />
    </Icon>
  );
}

/** Cut this shot. */
export function ScissorsIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="6" cy="7" r="2.5" />
      <circle cx="6" cy="17" r="2.5" />
      <path d="M8.2 8.3 20 18M8.2 15.7 20 6" />
    </Icon>
  );
}

/** Save a file. */
export function DownloadIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 4v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M5 20h14" />
    </Icon>
  );
}

/** Exactly what you see. */
export function EyeIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  );
}

/** A label that is always on (a shield: kept on, never a padlock word). */
export function ShieldIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 3.5 19 6v5.5c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V6l7-2.5Z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </Icon>
  );
}

/** When it goes. */
export function CalendarIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </Icon>
  );
}

/** Play a take. */
export function PlayIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M8 5.5v13l10.5-6.5L8 5.5Z" />
    </Icon>
  );
}
