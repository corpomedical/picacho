// What the Sets pages promise about leaving a build that is still running,
// and how the promise is kept (Astra Sets, 2026-09-11). Pure and alias-free:
// both pages and the finisher take their answer from here, and the tests
// load it as it is (leaving.test.ts; the vitest "@/" gotcha).
//
// THE PROMISE. While the finisher can run (finisher.ts finisherCanRun) a
// build completes with the page closed, so the pages say "you can leave";
// without it only an open Sets page collects a build, so they say to come
// back within ten minutes or, for a photo build, to keep the page open.
//
// HOW IT IS KEPT. Exactly one tick settles a build (build-tick.ts), and
// that tick's caller tells the person. The finisher pushes to their
// browsers. The Sets page changes the card, and when its tab is in the
// background, where its poll keeps running and usually collects the answer
// before the finisher's next minute comes round, it shows a notification of
// its own in the push's words. Both open the same page and carry the same
// tag, so a browser never shows two notifications for one set.

import type { Messages } from "../i18n/messages/en";

export type SetSettled = "ready" | "failed";

/** The line under a build still running, on the Sets list and on the set's own page. */
export function buildingHintKey(fromPhoto: boolean, finisherOn: boolean) {
  if (fromPhoto) return finisherOn ? "statusBuildingPhotoHintFinishes" : "statusBuildingPhotoHint";
  return finisherOn ? "statusBuildingHintFinishes" : "statusBuildingHint";
}

/** The photo form's line about how long a build takes and whether it can be left. */
export function photoMetaKey(finisherOn: boolean) {
  return finisherOn ? "photoMetaFinishes" : "photoMeta";
}

/** Where a tap goes: the set itself when it is ready; the list, which says why, when it failed. */
export function setNoticePath(setId: string, how: SetSettled): string {
  return how === "ready" ? `/app/sets/${setId}` : "/app/sets";
}

/** One notification per set: a second with the same tag replaces the first rather than stacking. */
export function setNoticeTag(setId: string): string {
  return `set-${setId}`;
}

type NoticeWords = Pick<
  Messages["push"],
  "setReadyTitle" | "setReadyBodyUntitled" | "setFailedTitle" | "setFailedBody"
>;

/**
 * What a Sets tab in the background shows for a build its own poll settled:
 * the finisher's words, path and tag. No set name: the poll's answer
 * carries none, and the brief is the person's own words, which a
 * notification would put on a lock screen.
 */
export function pageSetNotice(
  setId: string,
  how: SetSettled,
  words: NoticeWords,
): { title: string; body: string; path: string; tag: string } {
  return {
    title: how === "ready" ? words.setReadyTitle : words.setFailedTitle,
    body: how === "ready" ? words.setReadyBodyUntitled : words.setFailedBody,
    path: setNoticePath(setId, how),
    tag: setNoticeTag(setId),
  };
}
