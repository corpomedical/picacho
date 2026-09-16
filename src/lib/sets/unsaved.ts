// What a tab left behind by a deploy could not save (2026-09-16). The set
// page autosaves the rig and the film, and the Build editor the working
// copy. Once a deploy lands while the page is open, every save from it
// throws (stale-deploy.ts), and only a reload cures that; the reload used
// to take the unsaved change with it. Now the page keeps the change in
// this tab's sessionStorage, reloads, and puts it back, and its own
// autosave then saves it through the same one door as always.
//
// It comes back only onto the copy it was made from. Beside the change the
// page keeps the value it last knew was saved, and after the reload the
// change is put back only if that is still what the server holds. If
// anything else saved in between (another tab, an Astra change), that
// wins and the kept change is dropped, as it was before this existed. A
// later save from the page that lands, or the person leaving the change
// behind on purpose, forgets it (dropUnsaved). Kept for ten minutes, read
// once, and only in this tab.
//
// Relative imports only, and no window at import time: the page renders on
// the server too.

import { normaliseSetFilm } from "./film";
import { normaliseSetRig } from "./rig";
import type { SetSpec } from "./set-spec";

export type UnsavedKind = "film" | "rig" | "edit";
export const UNSAVED_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Each kind as the server stores it, for comparing: what was saved and what
 * was loaded go through the same door the save does, so a saved value and
 * the same value loaded back compare equal.
 */
export const savedFilmKey = (film: unknown): string => JSON.stringify(normaliseSetFilm(film));
export const savedRigKey = (rig: unknown): string => JSON.stringify(normaliseSetRig(rig));
/** The editor's copies are normalised by every edit, and loaded normalised. */
export const savedEditKey = (spec: SetSpec): string => JSON.stringify(spec);

const keyOf = (setId: string, kind: UnsavedKind) => `helios-unsaved:${kind}:${setId}`;

function tabStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Keep `value` for this set, made from `base`: the saved key (above) of what the server held when the save failed. */
export function keepUnsaved(setId: string, kind: UnsavedKind, value: unknown, base: string, now = Date.now()): void {
  const store = tabStorage();
  if (!store) return;
  try {
    store.setItem(keyOf(setId, kind), JSON.stringify({ at: now, base, value }));
  } catch {
    /* full or blocked: the change goes with the reload, as it did before */
  }
}

/**
 * Forget the change kept for this set: all of it, or only if it was kept
 * no later than `keptBy`. A save sent at `keptBy` that landed holds
 * everything kept before it was sent, while a change kept after the send
 * (a later save that failed) stays. A change the person chose to leave
 * behind goes whole. Otherwise a kept change could come back later over a
 * copy that only looks like the one it was made from (the person put the
 * set back as it was, say).
 */
export function dropUnsaved(setId: string, kind: UnsavedKind, keptBy?: number): void {
  const store = tabStorage();
  if (!store) return;
  try {
    const key = keyOf(setId, kind);
    const raw = store.getItem(key);
    if (raw === null) return;
    if (keptBy !== undefined) {
      let at: unknown = null;
      try {
        at = (JSON.parse(raw) as { at?: unknown } | null)?.at;
      } catch {
        /* unreadable: forgotten below */
      }
      if (typeof at === "number" && at > keptBy) return;
    }
    store.removeItem(key);
  } catch {
    /* blocked: nothing was kept */
  }
}

/**
 * The change kept for this set, once. It is read and removed whatever it
 * holds, and handed back only when it was made from `loaded` (the saved key
 * of what the page has just loaded) less than UNSAVED_MAX_AGE_MS ago.
 * Otherwise null.
 */
export function takeUnsaved(setId: string, kind: UnsavedKind, loaded: string, now = Date.now()): unknown {
  const store = tabStorage();
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(keyOf(setId, kind));
    if (raw !== null) store.removeItem(keyOf(setId, kind));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const kept = JSON.parse(raw) as { at?: unknown; base?: unknown; value?: unknown } | null;
    if (!kept || typeof kept.at !== "number" || kept.base !== loaded) return null;
    const age = now - kept.at;
    if (age < 0 || age > UNSAVED_MAX_AGE_MS) return null;
    return kept.value ?? null;
  } catch {
    return null;
  }
}
