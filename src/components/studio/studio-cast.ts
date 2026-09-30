// "Photo with your character": what the Studio sends (2026-09-30, operator: "Pushed, keep going."). Pure, no
// path aliases, so it runs in node tests; studio-press.ts sends it.
import type { StudioShootInput } from "./studio-press";

/**
 * What "Photo with your character" sends: the clean traced frame when one was made (the window's "Use a clean
 * traced frame" box), otherwise the viewport's frame; the words trimmed to the set's limit; the press id the Studio
 * took before any trace; beat, so the set page's saved arrangement stays as the person left it.
 */
export function studioCastInput(a: {
  viewFrameUri: string;
  tracedFrameUri?: string | null;
  characterId: string;
  words: string;
  maxChars: number;
  frame: { layout: unknown; canvasAspect?: number; rig?: unknown; movers?: unknown };
  pressId: string;
  /** What the character wears (studioWearLine): said after the person's words, which give way to it. */
  wear?: string | null;
  /** A picture from the character's own gallery: the still's outfit reference (shootInSet re-checks it). */
  galleryLookId?: string | null;
}): StudioShootInput & { pressId: string } {
  const wear = (a.wear ?? "").trim().slice(0, a.maxChars);
  const words = a.words.trim().slice(0, Math.max(0, a.maxChars - (wear ? wear.length + 1 : 0))).trim();
  const direction = [words, wear].filter(Boolean).join(" ");
  return {
    frameDataUri: a.tracedFrameUri || a.viewFrameUri,
    characterId: a.characterId,
    direction,
    ...(words ? { words } : {}),
    // Their outfit this time comes from the words or the picked look: the saved outfit photo sits it out.
    ...(wear ? { outfit: false as const } : {}),
    ...(a.galleryLookId ? { galleryLookId: a.galleryLookId } : {}),
    layout: a.frame.layout,
    lifted: false,
    canvasAspect: a.frame.canvasAspect,
    rig: a.frame.rig,
    movers: a.frame.movers,
    beat: true,
    pressId: a.pressId,
  };
}
