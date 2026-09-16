// The rig as a dock (the studio, cut 4 of "out of this world", 2026-09-17):
// the rig's sections in tabs, the way every pro tool docks its panels —
// Camera (the frame, focus, exposure, the viewfinder), Light (the plot, the
// hour), Look (the story, stock, lens, palette) and, while the film is
// open, Film (the move). One column of nine sections was a scroll; a tab is
// a glance. Pure: the panel reads the map, the test holds it.

export const RIG_TABS = ["camera", "light", "look", "film"] as const;
export type RigTab = (typeof RIG_TABS)[number];

export const RIG_SECTIONS = ["frame", "focus", "exposure", "viewfinder", "light", "time", "story", "stock", "lens", "palette", "move"] as const;
export type RigSection = (typeof RIG_SECTIONS)[number];

export const RIG_TAB_SECTIONS: Record<RigTab, readonly RigSection[]> = {
  camera: ["frame", "focus", "exposure", "viewfinder"],
  light: ["light", "time"],
  look: ["story", "stock", "lens", "palette"],
  film: ["move"],
};

/** The tab a section lives in. */
export function tabOf(section: RigSection): RigTab {
  for (const tab of RIG_TABS) if (RIG_TAB_SECTIONS[tab].includes(section)) return tab;
  return "camera";
}

/** The tabs shown: Film only while the film is open. */
export function tabsFor(filmOpen: boolean): readonly RigTab[] {
  return filmOpen ? RIG_TABS : RIG_TABS.filter((t) => t !== "film");
}

/** The tab to show after the film opens or closes: Film when it opens; Camera when it closes on the Film tab. */
export function tabAfterFilm(current: RigTab, filmOpen: boolean): RigTab {
  if (filmOpen) return "film";
  return current === "film" ? "camera" : current;
}
