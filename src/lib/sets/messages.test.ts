import { describe, expect, it } from "vitest";
import {
  SET_BUILD_FAILED,
  SET_BUILD_FAILED_RETRY,
  SET_BUILD_LOST,
  SET_BUILD_REFUSED,
  setFailureMessage,
  setMonthlyCapMessage,
} from "./messages";
import { localizeServerText } from "../i18n/server-text";
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
