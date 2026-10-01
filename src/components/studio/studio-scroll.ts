// Helios Studio never scrolls as a page (2026-10-01 live run: after opening and closing the Render and Object
// menus and windows, the whole Studio was pushed up — the top bar off-screen, the viewport a strip — until a
// reload). The Studio is a fixed, full-screen workspace; only its own panes scroll (the outliner, the
// properties, Astra's thread, a window's body, the timeline). A focus() or scrollIntoView() on something near
// an edge also scrolls every box around it that CAN be scrolled from script — overflow: hidden ones included
// (the panels, #app, the page's [data-app-scroll] scroller and the document underneath) — and nothing ever
// scrolls them back. So: focus without scrolling, scroll a row into its own pane only, and put back any scroll
// that lands anywhere else while the Studio is open.
//
// Pure where it can be (the rules are tested in studio-scroll.test.ts); the listener is a few lines over them.

/** What a scroll event's target is, as the guard sees it. */
export type StudioScrollTarget = {
  /** The target holds the Studio (an ancestor of it, the page's scroller, the document) or is its host. */
  holdsStudio: boolean;
  /** The target is inside the Studio. */
  inStudio: boolean;
  /** A text field or list (it scrolls its own text, and must keep doing so). */
  control: boolean;
  overflowX: string;
  overflowY: string;
};

const SCROLLS = /^(auto|scroll|overlay)$/;

/**
 * Which way a scroll that just happened must be put back: everything that holds the Studio, both ways; inside
 * it, an axis its box doesn't scroll on (hidden, clip, visible); never a pane that scrolls, a text field, or
 * anything outside the Studio that doesn't hold it (the lamp, a banner).
 */
export function studioScrollUndo(t: StudioScrollTarget): { x: boolean; y: boolean } {
  if (t.holdsStudio) return { x: true, y: true };
  if (!t.inStudio || t.control) return { x: false, y: false };
  return { x: !SCROLLS.test(t.overflowX), y: !SCROLLS.test(t.overflowY) };
}

/**
 * The pane's new scrollTop so a row is wholly in view, moving as little as it can (block: "nearest", but only
 * this pane moves). All in the same coordinates (client pixels for the tops, as getBoundingClientRect gives).
 */
export function nearestScrollTop(pane: { top: number; height: number; scrollTop: number }, row: { top: number; height: number }): number {
  const above = row.top - pane.top, below = row.top + row.height - (pane.top + pane.height);
  if (above < 0) return Math.max(0, pane.scrollTop + above);
  if (below > 0) return pane.scrollTop + Math.min(below, above);
  return pane.scrollTop;
}

/** Scrolls `el` into view inside `pane` only (never the boxes around it). */
export function scrollIntoPane(pane: HTMLElement | null | undefined, el: HTMLElement | null | undefined): void {
  if (!pane || !el) return;
  const p = pane.getBoundingClientRect(), r = el.getBoundingClientRect();
  pane.scrollTop = nearestScrollTop({ top: p.top, height: pane.clientHeight || p.height, scrollTop: pane.scrollTop }, { top: r.top, height: r.height });
}

/**
 * While the Studio is open: any scroll of a box that holds it, or of a box inside it that isn't a scrolling pane,
 * is put straight back. `host` is the Studio's outermost element; the listener goes when `signal` aborts.
 */
export function guardStudioScroll(host: HTMLElement, signal: AbortSignal): void {
  if (typeof document === "undefined") return;
  document.addEventListener(
    "scroll",
    (e) => {
      const t = e.target === document ? document.scrollingElement : e.target;
      if (!(t instanceof HTMLElement) || !host.isConnected) return;
      const cs = getComputedStyle(t);
      const undo = studioScrollUndo({
        holdsStudio: t.contains(host),
        inStudio: host.contains(t),
        control: /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable,
        overflowX: cs.overflowX,
        overflowY: cs.overflowY,
      });
      if (undo.y && t.scrollTop !== 0) t.scrollTop = 0;
      if (undo.x && t.scrollLeft !== 0) t.scrollLeft = 0;
    },
    { capture: true, passive: true, signal },
  );
}
