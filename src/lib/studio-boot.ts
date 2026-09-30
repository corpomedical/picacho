// Helios Studio's first paint (2026-09-30, operator: "Pushed, measure it"). Live, the Studio's
// "Opening the set…" cover painted ~1.5 s in, though the /app layout was done in ~0.27 s of server time: the
// first byte of the page's body waited on the proxy, the function's start and the layout's reads. The proxy
// now marks a Studio opening on the request (STUDIO_BOOT_HEADER); the root layout then wraps the page in a
// Suspense boundary whose fallback is that same cover, so it streams in the very first flush — the head and
// the cover — and the page replaces it as it arrives (the page shows the same cover until the Studio's first
// frame). The header only says what to draw meanwhile: it opens nothing and carries nothing private.

export const STUDIO_BOOT_HEADER = "x-picacho-studio-boot";

const SET = /^\/app\/sets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A page load of a set in Helios Studio (/app/sets/<id>?studio=1). */
export function isStudioBoot(method: string, pathname: string, search: URLSearchParams): boolean {
  return method === "GET" && SET.test(pathname) && search.get("studio") === "1";
}
