// The dashboard's prompt bar ("Put Eva somewhere…"): who it is for, and when
// it is on screen. Pure, so both rules are tested without a page.

/**
 * Who the bar is for: the reel's own character, the one the band names and
 * rings. With no reel, or a reel whose character is not among those loaded,
 * the newest character, which is the composer's own default.
 *
 * The bar's face, words and link all come from this one answer. They used to
 * come from three places: the face was simply the first of the cast, so on
 * 2026-09-21 it showed Anubis, the newest character, beside "Put Eva
 * somewhere…" on Eva's reel.
 */
export function promptBarCharacter<T extends { id: string }>(
  characters: readonly T[],
  reelCharacterId: string | null | undefined,
): T | null {
  const reelCharacter = reelCharacterId
    ? characters.find((c) => c.id === reelCharacterId)
    : undefined;
  return reelCharacter ?? characters[0] ?? null;
}

/** Scroll that still counts as the page's end: fractional scroll positions. */
const END_SLACK_PX = 2;

export type PromptBarMetrics = {
  /** Bottom edge of the reel band, in viewport pixels. */
  reelBottom: number;
  /** Top edge of the app's scroller, in viewport pixels. */
  scrollerTop: number;
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  /** Where the bar's bottom sits when it is not stuck: the page's own foot. */
  restBottom: number;
  /** Where sticky holds the bar's bottom: the scroller's foot less the dock. */
  dockLine: number;
};

/**
 * Whether the bar is showing (operator, 2026-09-21: "make it appear when you
 * scroll down"). Hidden while any of the reel is on screen, where the band
 * and the pick-up card already offer the same step and the floating bar sat
 * over the quick actions. Shown once the reel has scrolled away, and whenever
 * it is at rest in its own place at the page's foot, where it covers nothing:
 * hiding it there left an empty slot on a page too short to scroll past its
 * reel. Also shown at the very end, which the phone app needs: its tab bar
 * docks the bar higher than the page's bottom padding, so there it never
 * quite comes to rest.
 */
export function promptBarShown(m: PromptBarMetrics): boolean {
  const pastReel = m.reelBottom <= m.scrollerTop;
  const resting = m.restBottom <= m.dockLine + END_SLACK_PX;
  const atEnd = m.scrollTop + m.clientHeight >= m.scrollHeight - END_SLACK_PX;
  return pastReel || resting || atEnd;
}
