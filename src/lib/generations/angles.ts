// Fixed camera-angle presets for multi-angle video generation. Each preset's
// promptHint gets appended to the user's request before it enters the normal
// draft/review/generate/validate pipeline — so every angle still goes
// through the same reliability checks as a single-angle generation, just
// once per angle.

export type AngleId = "front" | "side" | "three-quarter" | "back" | "close-up";

export type AnglePreset = {
  id: AngleId;
  label: string;
  promptHint: string;
};

export const ANGLE_PRESETS: AnglePreset[] = [
  {
    id: "front",
    label: "Front",
    promptHint: "Camera angle: front view, the character facing directly toward the camera.",
  },
  {
    id: "side",
    label: "Side",
    promptHint: "Camera angle: side profile view, the camera positioned at the character's side.",
  },
  {
    id: "three-quarter",
    label: "3/4",
    promptHint:
      "Camera angle: three-quarter view, the camera angled roughly 45 degrees from the character's front.",
  },
  {
    id: "back",
    label: "Back",
    promptHint: "Camera angle: rear view, the camera behind the character looking at their back.",
  },
  {
    id: "close-up",
    label: "Close-up",
    promptHint: "Camera angle: close-up shot, the camera framed tightly on the character.",
  },
];

// Pre-checked when a person turns Multi-angle on — they can add Back and/or
// Close-up, or remove one of these, before confirming.
export const DEFAULT_ANGLE_IDS: AngleId[] = ["front", "side", "three-quarter"];

export function getAnglePreset(id: string): AnglePreset | undefined {
  return ANGLE_PRESETS.find((a) => a.id === id);
}

// Stable display order for anywhere a set of angle rows needs sorting
// (history detail tabs, etc.) — earlier in ANGLE_PRESETS sorts first,
// unrecognized/legacy angle strings sort last but keep their relative order.
export function angleSortIndex(angleId: string | null): number {
  if (!angleId) return ANGLE_PRESETS.length + 1;
  const idx = ANGLE_PRESETS.findIndex((a) => a.id === angleId);
  return idx === -1 ? ANGLE_PRESETS.length : idx;
}
