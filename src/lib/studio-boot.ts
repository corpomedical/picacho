// Helios Studio's first paint (2026-09-30, operator: "Pushed, measure it"). Live, the Studio's
// "Opening the set…" cover painted ~1.5 s in, though the /app layout was done in ~0.27 s of server time: the
// first byte of the page's body waited on the proxy, the function's start and the layout's reads. The proxy
// now marks a Studio opening on the request (STUDIO_BOOT_HEADER); the root layout then wraps the page in a
// Suspense boundary whose fallback is that same cover, so it streams in the very first flush — the head and
// the cover — and the page replaces it as it arrives (the page shows the same cover until the Studio's first
// frame). The header only says what to draw meanwhile: it opens nothing and carries nothing private.

export const STUDIO_BOOT_HEADER = "x-picacho-studio-boot";

const SET = /^\/app\/sets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// EVERY request for the Studio's page carries it, its server actions (POST) too (2026-10-01 live run: the video
// window closed itself right after the send). A server action that revalidates a path (Recast's start does)
// re-renders the page it was called from; on a POST without the mark, the root layout drew `children` where the
// page load had drawn <Suspense>{children}</Suspense>, React saw a different element there and mounted the whole
// tree again: the Studio restarted under its open window. Reproduced on a minimal Next 16 app (a revalidating
// action remounted the client component; with POST marked too, it did not).

/** A request for a set in Helios Studio (/app/sets/<id>?studio=1): its page load, a refresh, or one of its server actions. */
export function isStudioBoot(method: string, pathname: string, search: URLSearchParams): boolean {
  return (method === "GET" || method === "POST" || method === "HEAD") && SET.test(pathname) && search.get("studio") === "1";
}
