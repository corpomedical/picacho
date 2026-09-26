import { describe, expect, it } from "vitest";
import { MAPPED_SERVER_STRINGS, localizeServerText } from "../i18n/server-text";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import it_ from "../i18n/messages/it";
import pt from "../i18n/messages/pt";
import { PRODUCT_LOCK_MESSAGES } from "./messages";

// Every sentence a person can read about a product check is mapped for
// translation, really translated in es / pt / it, and free of the words the
// customer copy may not use (spec §0; synthesis S1, S6; operator 2026-09-26:
// nothing says "locked", no free re-shoot, no refund).

const BANNED = /\b(lock(ed)?|product lock|every frame|re-?shoot|refund|gemini|claude|sonnet|anthropic|openai|gpt|vision|ocr|sam ?2|fal|kling|seedance|wan|veo|server|model|engine|\d+p)\b/i;

describe("the product checker's sentences", () => {
  it("are all mapped for translation", () => {
    for (const s of PRODUCT_LOCK_MESSAGES) expect(MAPPED_SERVER_STRINGS, s).toContain(s);
  });

  it("read in English as themselves and differently in es, pt and it", () => {
    for (const s of PRODUCT_LOCK_MESSAGES) {
      expect(localizeServerText(s, en)).toBe(s);
      for (const [name, catalog] of [
        ["es", es],
        ["pt", pt],
        ["it", it_],
      ] as const) {
        const out = localizeServerText(s, catalog);
        expect(out, `${name}: ${s}`).not.toBe(s);
        expect(out.length, `${name}: ${s}`).toBeGreaterThan(10);
      }
    }
  });

  it("never name a machine, claim a lock, or promise a re-shoot or a refund", () => {
    for (const s of PRODUCT_LOCK_MESSAGES) expect(s, s).not.toMatch(BANNED);
    for (const catalog of [es, pt, it_]) {
      for (const s of PRODUCT_LOCK_MESSAGES) expect(localizeServerText(s, catalog)).not.toMatch(BANNED);
    }
  });
});
