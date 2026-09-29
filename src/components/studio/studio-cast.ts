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
}): StudioShootInput & { pressId: string } {
  const words = a.words.trim().slice(0, a.maxChars);
  return {
    frameDataUri: a.tracedFrameUri || a.viewFrameUri,
    characterId: a.characterId,
    direction: words,
    ...(words ? { words } : {}),
    layout: a.frame.layout,
    lifted: false,
    canvasAspect: a.frame.canvasAspect,
    rig: a.frame.rig,
    movers: a.frame.movers,
    beat: true,
    pressId: a.pressId,
  };
}
