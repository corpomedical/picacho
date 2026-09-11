import { describe, expect, it } from "vitest";
import {
  SET_BUILD_FAILED,
  SET_BUILD_FAILED_RETRY,
  SET_BUILD_LOST,
  SET_BUILD_REFUSED,
  SET_PHOTO_BAD_SHAPE,
  SET_PHOTO_BUILD_FAILED,
  SET_PHOTO_NEEDS_DATABASE,
  SET_PHOTO_REFUSED,
  SET_PHOTO_SAVE_FAILED,
  SET_PHOTO_TOO_LARGE,
  SET_PHOTO_TOO_SMALL,
  SET_PHOTO_UNCHECKED,
  SET_PHOTO_UNREADABLE,
  setFailureMessage,
  setMonthlyCapMessage,
} from "./messages";
import { isPolicyRefusal, localizeServerText } from "../i18n/server-text";
import { REFUSAL_COACHING, REFUSAL_GUARDS } from "../generations/providers/refusal-messages";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import it_ from "../i18n/messages/it";

// What a failed build SAYS depends on whose failure it was: only an answer
// that came back unusable asks the person to describe the place
// differently; our side or OpenAI's failing says try again (2026-09-10
// review — the card used to tell someone to reword a brief an outage
// had nothing to do with).

describe("setFailureMessage", () => {
  it("asks for a different description only when the answer itself was unusable", () => {
    expect(setFailureMessage("invalid")).toBe(SET_BUILD_FAILED);
    expect(setFailureMessage("incomplete")).toBe(SET_BUILD_FAILED);
    for (const ours of ["start", "save", "failed", "cancelled", null, undefined, "anything"]) {
      expect(setFailureMessage(ours)).toBe(SET_BUILD_FAILED_RETRY);
    }
  });

  it("keeps the refusal and the lost build their own sentences", () => {
    expect(setFailureMessage("refused")).toBe(SET_BUILD_REFUSED);
    expect(setFailureMessage("lost")).toBe(SET_BUILD_LOST);
    expect(setFailureMessage("expired")).toBe(SET_BUILD_LOST);
  });

  it("never asks a refused build to be reworded or retried", () => {
    expect(SET_BUILD_REFUSED).not.toMatch(/differently|try again/i);
  });
});

describe("the monthly cap sentence", () => {
  it("says 1 set, not 1 sets", () => {
    expect(setMonthlyCapMessage(1)).toContain("built 1 set this");
    expect(setMonthlyCapMessage(2)).toContain("built 2 sets this");
  });

  it("reaches every language, singular and plural, with the count carried", () => {
    for (const t of [es, pt, it_]) {
      const one = localizeServerText(setMonthlyCapMessage(1), t);
      const five = localizeServerText(setMonthlyCapMessage(5), t);
      expect(one).toBe(t.serverText.setMonthlyCapOne);
      expect(five).toContain("5");
      expect(five).not.toBe(setMonthlyCapMessage(5));
    }
    expect(localizeServerText(setMonthlyCapMessage(5), en)).toBe(setMonthlyCapMessage(5));
  });

  it("translates every failure sentence a build card can show", () => {
    for (const wire of [SET_BUILD_FAILED, SET_BUILD_FAILED_RETRY, SET_BUILD_LOST, SET_BUILD_REFUSED]) {
      for (const t of [es, pt, it_]) expect(localizeServerText(wire, t)).not.toBe(wire);
    }
  });
});

// Sets from a photo (2026-09-11).

describe("setFailureMessage for a photo build", () => {
  it("says the photo, not the description, wherever the answer was the problem", () => {
    expect(setFailureMessage("refused", "photo")).toBe(SET_PHOTO_REFUSED);
    expect(setFailureMessage("invalid", "photo")).toBe(SET_PHOTO_BUILD_FAILED);
    expect(setFailureMessage("incomplete", "photo")).toBe(SET_PHOTO_BUILD_FAILED);
  });

  it("keeps the sentences that are about us, not the photo", () => {
    expect(setFailureMessage("lost", "photo")).toBe(SET_BUILD_LOST);
    expect(setFailureMessage("expired", "photo")).toBe(SET_BUILD_LOST);
    for (const ours of ["start", "save", "failed", "cancelled", null, undefined]) {
      expect(setFailureMessage(ours, "photo")).toBe(SET_BUILD_FAILED_RETRY);
    }
  });

  it("leaves a text build's sentences exactly as they were", () => {
    expect(setFailureMessage("refused", "text")).toBe(SET_BUILD_REFUSED);
    expect(setFailureMessage("invalid", "text")).toBe(SET_BUILD_FAILED);
    expect(setFailureMessage("refused")).toBe(SET_BUILD_REFUSED);
  });
});

const PHOTO_SENTENCES = [
  SET_PHOTO_UNREADABLE,
  SET_PHOTO_TOO_LARGE,
  SET_PHOTO_TOO_SMALL,
  SET_PHOTO_BAD_SHAPE,
  SET_PHOTO_REFUSED,
  SET_PHOTO_UNCHECKED,
  SET_PHOTO_NEEDS_DATABASE,
  SET_PHOTO_SAVE_FAILED,
  SET_PHOTO_BUILD_FAILED,
];

describe("every photo sentence reaches every language", () => {
  it("English readers get the wire sentence itself", () => {
    for (const wire of PHOTO_SENTENCES) expect(localizeServerText(wire, en)).toBe(wire);
  });

  it("Spanish, Portuguese and Italian readers get it translated", () => {
    for (const wire of PHOTO_SENTENCES) {
      for (const t of [es, pt, it_]) expect(localizeServerText(wire, t), wire).not.toBe(wire);
    }
  });

  it("the admin-only database sentence keeps the file name in every language", () => {
    for (const t of [en, es, pt, it_]) expect(t.serverText.setPhotoNeedsDatabase).toContain("astra-photo-sets.sql");
  });

  it("none of them is a prompt-gate refusal (the composer's strip is not theirs)", () => {
    for (const wire of PHOTO_SENTENCES) expect(isPolicyRefusal(wire), wire).toBe(false);
  });
});

// A refused photo answers to the refusal rules everywhere else: no advice on
// getting past it, no category named, no reader named, no word about money
// ("allowance" is the monthly slot, not a charge), and "try again" only
// where the photo could not be checked at all.
describe("a refused photo, in every language", () => {
  const ACCUSATION = {
    en: /sexual|\bnud|minor|real person|self-harm|suicid/i,
    es: /sexual|desnud|menor|persona real|autoles|suicid/i,
    pt: /sexual|nudez|\bnu[as]?\b|menor|pessoa real|automutil|autoles|suic/i,
    it: /sessual|\bnud|minor|persona reale|autolesion|suicid/i,
  } as const;
  const LANGS = [
    { name: "en", t: en },
    { name: "es", t: es },
    { name: "pt", t: pt },
    { name: "it", t: it_ },
  ] as const;
  const CASES = [
    { wire: SET_PHOTO_REFUSED, couldNotRun: false },
    { wire: SET_PHOTO_UNCHECKED, couldNotRun: true },
  ];

  for (const L of LANGS) {
    it(`${L.name}: no coaching, no money word, no category named, try again only when unchecked`, () => {
      const g = REFUSAL_GUARDS[L.name];
      for (const { wire, couldNotRun } of CASES) {
        const local = localizeServerText(wire, L.t);
        expect(local, wire).not.toMatch(g.coaching);
        expect(local, wire).not.toMatch(REFUSAL_COACHING);
        expect(local, wire).not.toMatch(g.money);
        expect(local, wire).not.toMatch(ACCUSATION[L.name]);
        expect(g.again.test(local), `${L.name}: ${wire}`).toBe(couldNotRun);
        expect(local, wire).not.toMatch(/openai|anthropic|astra|claude|gpt/i);
      }
    });
  }

  it("never asks a refused photo to be reworded or retried", () => {
    expect(SET_PHOTO_REFUSED).not.toMatch(/differently|try again/i);
  });
});

describe("the catalogs carry every new Sets key in all four languages", () => {
  const SETS_KEYS = [
    "modeDescribe",
    "fromPhoto",
    "photoPick",
    "photoChange",
    "photoHint",
    "photoNotesLabel",
    "photoNotesPlaceholder",
    "photoBuildButton",
    "photoMeta",
    "photoPreparing",
    "photoChecking",
    "photoPreviewAlt",
    "statusBuildingPhotoHint",
    "compareTitle",
    "comparePhoto",
    "compareNote",
  ] as const;
  const SERVER_KEYS = [
    "setPhotoUnreadable",
    "setPhotoTooLarge",
    "setPhotoTooSmall",
    "setPhotoBadShape",
    "setPhotoRefused",
    "setPhotoUnchecked",
    "setPhotoNeedsDatabase",
    "setPhotoSaveFailed",
    "setPhotoBuildFailed",
  ] as const;

  it("as non-empty strings", () => {
    for (const t of [en, es, pt, it_]) {
      for (const k of SETS_KEYS) expect(typeof t.sets[k] === "string" && t.sets[k].trim().length > 0, `sets.${k}`).toBe(true);
      for (const k of SERVER_KEYS) {
        expect(typeof t.serverText[k] === "string" && t.serverText[k].trim().length > 0, `serverText.${k}`).toBe(true);
      }
    }
  });

  it("translated, not copied from English", () => {
    for (const t of [es, pt, it_]) {
      for (const k of SETS_KEYS) expect(t.sets[k], `sets.${k}`).not.toBe(en.sets[k]);
    }
  });

  it("the photo copy says to keep the page open, in English as in the design", () => {
    expect(en.sets.photoMeta).toContain("keep this page open");
    expect(en.sets.statusBuildingPhotoHint).toContain("Keep this page open");
  });
});
