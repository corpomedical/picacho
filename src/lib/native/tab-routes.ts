// Which tab of the app's bottom bar a page belongs to (2026-09-21).
//
// The bar has five places: Characters · Media · the Generate lamp · Community
// · More. Every page the app can reach lives under exactly one of them, so
// the tab you came through stays lit while you work inside it: History sits
// inside Media, Recast is one of the lamp's two choices, and every tool the
// bar has no room for lives on the More page.
//
// Pure and import-free on purpose: the bar reads it on the client and the
// tests read it directly.

export type NativeTab = "characters" | "media" | "generate" | "community" | "more";

const ROUTES: Record<NativeTab, readonly string[]> = {
  characters: ["/app/character"],
  media: ["/app/media", "/app/images", "/app/videos", "/app/history", "/app/stage"],
  generate: ["/app/generate", "/app/mystique"],
  community: ["/app/community"],
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

/** The tab that owns this page, or null when none does. The dashboard (/app)
 *  belongs to More, where it is listed. */
export function nativeTabFor(pathname: string | null | undefined): NativeTab | null {
  if (!pathname) return null;
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if (path === "/app") return "more";
  for (const tab of Object.keys(ROUTES) as NativeTab[]) {
    if (ROUTES[tab].some((route) => under(path, route))) return tab;
  }
  return null;
}

/** Where each of the four plain tabs goes. The lamp has no href: it opens its
 *  two choices, or goes straight to Generate for accounts without Recast. */
export const NATIVE_TAB_HREF: Record<Exclude<NativeTab, "generate">, string> = {
  characters: "/app/character",
  media: "/app/media",
  community: "/app/community",
  more: "/app/more",
};

/** The lamp's two choices. "Generate Video" opens the composer on video. */
export const GENERATE_VIDEO_HREF = "/app/generate?type=video";
export const RECAST_HREF = "/app/mystique";
/** Where the lamp goes on its own, for accounts without Recast. */
export const GENERATE_HREF = "/app/generate";

/** "Generate Video" while the composer is already on screen: ?type= is read
 *  only when the composer mounts, so the lamp tells it directly. The detail
 *  is "video" or "image". */
export const CONTENT_TYPE_EVENT = "picacho:content-type";
