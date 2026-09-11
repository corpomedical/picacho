import { describe, expect, it } from "vitest";
import {
  SET_BUILD_FAILED,
  SET_BUILD_FAILED_RETRY,
  SET_BUILD_LOST,
  SET_BUILD_REFUSED,
  SET_MATCH_FAILED,
  SET_MATCH_REFUSED,
  SET_MATCH_TIMED_OUT,
  SET_MATCH_TOO_FAST,
  SET_MATCH_UNCHECKED,
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

// Match this shot (2026-09-11).

const MATCH_SENTENCES = [SET_MATCH_REFUSED, SET_MATCH_UNCHECKED, SET_MATCH_FAILED, SET_MATCH_TOO_FAST, SET_MATCH_TIMED_OUT];

describe("every Match this shot sentence reaches every language", () => {
  it("English readers get the wire sentence itself", () => {
    for (const wire of MATCH_SENTENCES) expect(localizeServerText(wire, en)).toBe(wire);
  });

  it("Spanish, Portuguese and Italian readers get it translated", () => {
    for (const wire of MATCH_SENTENCES) {
      for (const t of [es, pt, it_]) expect(localizeServerText(wire, t), wire).not.toBe(wire);
    }
  });

  it("none of them is a prompt-gate refusal (the composer's strip is not theirs)", () => {
    for (const wire of MATCH_SENTENCES) expect(isPolicyRefusal(wire), wire).toBe(false);
  });

  it("the sentences the design names are the ones the server says", () => {
    expect(SET_MATCH_REFUSED).toBe("This picture can't be used to match a shot.");
    expect(SET_MATCH_FAILED).toBe("Astra couldn't read a camera from that picture — try another.");
  });
});

// A refused reference picture answers to the same rules as a refused photo:
// no coaching, no money word (a match moves no allowance at all), no category
// or reader named, and "try again" only where the picture could not be
// checked.
describe("a refused reference picture, in every language", () => {
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
    { wire: SET_MATCH_REFUSED, couldNotRun: false },
    { wire: SET_MATCH_UNCHECKED, couldNotRun: true },
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

  it("never asks a refused picture to be retried or swapped", () => {
    expect(SET_MATCH_REFUSED).not.toMatch(/differently|try again|another/i);
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
    "photoMetaFinishes",
    "photoPreparing",
    "photoChecking",
    "photoPreviewAlt",
    "statusBuildingHintFinishes",
    "statusBuildingPhotoHint",
    "statusBuildingPhotoHintFinishes",
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

  // Two versions of each build-time line (2026-09-11): with the finisher
  // running a build completes with the page closed, and without it only an
  // open Sets page collects one.
  const FINISHES = ["photoMetaFinishes", "statusBuildingHintFinishes", "statusBuildingPhotoHintFinishes"] as const;

  it("says to keep the page open only where no finisher runs", () => {
    expect(en.sets.photoMeta).toContain("keep this page open");
    expect(en.sets.statusBuildingPhotoHint).toContain("Keep this page open");
    expect(en.sets.statusBuildingHint).toContain("come back within ten minutes");
    for (const k of FINISHES) {
      expect(en.sets[k], k).toMatch(/you can leave/i);
      expect(en.sets[k], k).not.toMatch(/keep this page open|ten minutes|lost/i);
    }
    for (const k of ["statusBuildingHintFinishes", "statusBuildingPhotoHintFinishes"] as const) {
      expect(en.sets[k], k).toContain("finishes on its own");
      // Web push is opt-in per browser: never promised unconditionally.
      expect(en.sets[k], k).toContain("if notifications are on");
    }
  });

  it("gives a photo build the measured 2–5 minutes in both versions and every language", () => {
    // The three test builds took 123–183 s (docs 3.2), and a closing retry
    // adds an attempt.
    for (const t of [en, es, pt, it_]) {
      for (const k of ["photoMeta", "photoMetaFinishes", "statusBuildingPhotoHint", "statusBuildingPhotoHintFinishes"] as const) {
        expect(t.sets[k], k).toContain("2–5");
        expect(t.sets[k], k).not.toContain("4–6");
      }
      for (const k of ["statusBuildingHint", "statusBuildingHintFinishes"] as const) expect(t.sets[k], k).toContain("1–2");
    }
  });

  it("carries every Match this shot key in all four languages, translated", () => {
    const MATCH_KEYS = [
      "matchShot",
      "matchHint",
      "matchReading",
      "matchedDown",
      "matchedUp",
      "matchedLevel",
      "matchNoteWide",
      "matchNoteNarrow",
      "matchNoteTiltUp",
      "matchNoteTiltDown",
      "matchNoteSubject",
      "matchNotePulledIn",
      "matchReferenceAlt",
    ] as const;
    const MATCH_SERVER_KEYS = ["setMatchRefused", "setMatchUnchecked", "setMatchFailed", "setMatchTooFast", "setMatchTimedOut"] as const;
    for (const t of [en, es, pt, it_]) {
      for (const k of MATCH_KEYS) expect(typeof t.sets[k] === "string" && t.sets[k].trim().length > 0, `sets.${k}`).toBe(true);
      for (const k of MATCH_SERVER_KEYS) {
        expect(typeof t.serverText[k] === "string" && t.serverText[k].trim().length > 0, `serverText.${k}`).toBe(true);
      }
    }
    for (const t of [es, pt, it_]) {
      for (const k of MATCH_KEYS) expect(t.sets[k], `sets.${k}`).not.toBe(en.sets[k]);
    }
  });

  it("fills every placeholder of the matched line and the tilt notes, in every language", () => {
    for (const t of [en, es, pt, it_]) {
      for (const k of ["matchedDown", "matchedUp"] as const) {
        for (const token of ["{mm}", "{height}", "{tilt}"]) expect(t.sets[k], `${k} ${token}`).toContain(token);
      }
      expect(t.sets.matchedLevel).toContain("{mm}");
      expect(t.sets.matchedLevel).toContain("{height}");
      expect(t.sets.matchedLevel).not.toContain("{tilt}");
      expect(t.sets.matchNoteTiltUp).toContain("{deg}");
      expect(t.sets.matchNoteTiltDown).toContain("{deg}");
    }
  });

  it("the match hint says only what the answer's shape guarantees, in English as in the design", () => {
    // match-shot.ts: the answer is numbers and enums, nothing is stored, and a
    // shot carries the stage frame — never the reference.
    expect(en.sets.matchHint).toContain("Only the camera comes back");
    expect(en.sets.matchHint).toContain("never goes to the image model");
    expect(en.sets.matchHint).toContain("We don't keep the picture");
    expect(en.sets.matchHint).toContain("About a minute");
  });

  it("says what Astra is TOLD about people, never promises what it does, in every language", () => {
    // Leaving people out is an instruction (set-builder-prompt.ts
    // SET_PHOTO_RULES), and nothing measures it until eval part D: the form
    // may not state it as a fact.
    expect(en.sets.photoHint).toMatch(/\bis told\b/);
    expect(es.sets.photoHint).toMatch(/\bSe le indica\b/);
    expect(pt.sets.photoHint).toMatch(/\binstruído\b/);
    expect(it_.sets.photoHint).toMatch(/\bGli viene chiesto\b/);
    expect(en.sets.photoHint).not.toMatch(/never (models|describes)|becomes a mark/i);
  });
});
