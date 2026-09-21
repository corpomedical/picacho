// When each public page's WORDS last changed: the sitemap's <lastmod>, and
// the guides' Article dateModified, from one list so the two cannot disagree.
//
// The sitemap used to stamp every page with the moment it was requested
// (`new Date()`), which tells Google every page changed on every read.
// Google uses lastmod only while it proves accurate, so ours was ignored,
// and a page that really did change had no way to say so. Meanwhile the
// consistency guide's structured data said 21 August for a guide rewritten
// on 3 September. Found 2026-09-14, with Search Console showing 38 of 55
// pages "Discovered – currently not indexed" and Google crawling almost
// nothing that month.
//
// Move a date when what a page SAYS changes: a new section, a corrected
// fact, a new price, a new FAQ answer. Not for colours, layout, dark mode or
// a refactor that moves the same sentences. A date that moves for nothing
// teaches Google what "now" did. The dates below were read from each page's
// history on 2026-09-14 on that rule, text sections of the language files
// included (a translated page's words live there, not in page.tsx).
//
// Legal pages show their own "last updated" date to readers; theirs must
// match it, and page-dates.test.ts holds them to that.
//
// Not listed, on purpose: /gallery, a feed of shared takes that changes
// whenever someone shares — no single date is true, so it gets no lastmod
// and Google judges it by itself.
export const PAGE_UPDATED = {
  "/": "2026-09-20",
  "/pricing": "2026-09-19",
  "/privacy": "2026-09-19",
  "/terms": "2026-08-30",
  "/content-policy": "2026-08-05",
  "/delete-account": "2026-09-21",
  "/compare/heygen": "2026-09-06",
  "/compare/hedra": "2026-09-06",
  "/compare/renoise": "2026-09-14",
  "/compare/imagineart": "2026-09-06",
  "/compare/higgsfield": "2026-09-06",
  "/tools/identity-check": "2026-08-30",
  "/guides": "2026-09-09",
  "/guides/helios": "2026-09-19",
  "/guides/ai-character-consistency": "2026-09-20",
  "/guides/ai-camera-movements": "2026-08-28",
  "/guides/seedance-2": "2026-09-20",
  "/guides/getting-started": "2026-09-09",
  "/docs/api": "2026-09-01",
} as const satisfies Record<string, string>;

export type DatedPage = keyof typeof PAGE_UPDATED;

// Pages that deliberately have no date (see above), so the test can tell a
// choice from an omission.
export const UNDATED_PAGES = ["/gallery"] as const;

export function pageUpdated(path: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(PAGE_UPDATED, path) ? PAGE_UPDATED[path as DatedPage] : undefined;
}
