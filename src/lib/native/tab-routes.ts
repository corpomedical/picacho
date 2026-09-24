// Which tab of the app's bottom bar a page belongs to (2026-09-21).
//
// The bar has seven places: Home · Characters · Media · the Generate lamp ·
// Community · History · More (Home and History added the same day, operator:
// "Add another button on the left as home that will take you to dashboard.
// Add history beside community"). Every page the app can reach lives under
// exactly one of them, so the tab you came through stays lit while you work
// inside it: Recast is one of the lamp's two choices, and every tool the bar
// has no room for lives on the More page.
//
// Pure and import-free on purpose: the bar reads it on the client and the
// tests read it directly.

export type NativeTab = "home" | "characters" | "media" | "generate" | "community" | "history" | "more";

// Home is the dashboard, /app itself, matched exactly (every app page sits
// below /app, so it cannot be a prefix).
const ROUTES: Record<Exclude<NativeTab, "home">, readonly string[]> = {
  characters: ["/app/character"],
  media: ["/app/media", "/app/images", "/app/videos"],
  generate: ["/app/generate", "/app/mystique", "/app/live", "/app/edit"],
  community: ["/app/community"],
  // The Angle Stage is opened from a History take.
  history: ["/app/history", "/app/stage"],
  more: [
    "/app/more",
    "/app/settings",
    "/app/templates",
    "/app/upscale",
    "/app/layers",
    "/app/projects",
    "/app/notes",
    "/app/tutorial",
    "/app/usage",
    "/app/profile",
    "/app/sets",
    "/app/recce",
  ],
};

/** Whether `pathname` is `route` itself or a page below it (segment-aware). */
function under(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

/** The tab that owns this page, or null when none does. */
export function nativeTabFor(pathname: string | null | undefined): NativeTab | null {
  if (!pathname) return null;
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if (path === "/app") return "home";
  for (const tab of Object.keys(ROUTES) as Exclude<NativeTab, "home">[]) {
    if (ROUTES[tab].some((route) => under(path, route))) return tab;
  }
  return null;
}

/** Where each of the six plain tabs goes. The lamp has no href: it opens its
 *  two choices, or goes straight to Generate for accounts without Recast. */
export const NATIVE_TAB_HREF: Record<Exclude<NativeTab, "generate">, string> = {
  home: "/app",
  characters: "/app/character",
  media: "/app/media",
  community: "/app/community",
  history: "/app/history",
  more: "/app/more",
};

/** The lamp's two choices. "Generate Video" opens the composer on video. */
export const GENERATE_VIDEO_HREF = "/app/generate?type=video";
export const RECAST_HREF = "/app/mystique";
/** The third choice (2026-09-24): Live, H3 Max Director — every paid plan. */
export const LIVE_HREF = "/app/live";
/** The fourth (2026-09-24): Director's Cut, the video editor — admins. */
export const DIRECTORS_CUT_HREF = "/app/edit";
/** Where the lamp goes on its own, for accounts without Recast. */
export const GENERATE_HREF = "/app/generate";

/** "Generate Video" while the composer is already on screen: ?type= is read
 *  only when the composer mounts, so the lamp tells it directly. The detail
 *  is "video" or "image". */
export const CONTENT_TYPE_EVENT = "picacho:content-type";
