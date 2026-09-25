import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLAIN_FREE_USED_TODAY, PLAIN_NO_CREDITS, withoutSalesPitch } from "./plain-errors";

// ERRORS SAY WHAT HAPPENED, NOT WHAT TO BUY (Press Tour cut 0, 2026-09-25).
// ChatGPT's app rules forbid upgrade prompts, and the API passed the web
// composer's allowance refusals through word for word, pitch included.

const PITCH = /pick a plan|top up|top-up|upgrade|reach out|get in touch|contact us|elite plan/i;

describe("withoutSalesPitch", () => {
  it("keeps what happened and drops the pitch sentence", () => {
    expect(
      withoutSalesPitch(
        "That would use 3 credits (some models cost more than 1 per video), but you only have 1 left. Top up or pick a plan to keep going.",
      ),
    ).toBe("That would use 3 credits (some models cost more than 1 per video), but you only have 1 left.");
  });

  it("drops a pitch's tail with it, not only the pitch", () => {
    // "— your characters and history stay exactly as they are" belongs to
    // the pitch; left alone it would be a sentence starting in lower case.
    expect(
      withoutSalesPitch(
        "You've used today's free generation — it comes back tomorrow. Pick a plan or top up credits to keep going — your characters and history stay exactly as they are.",
      ),
    ).toBe("You've used today's free generation — it comes back tomorrow.");
  });

  it("cuts a pitch clause out of the middle of a sentence and closes it", () => {
    expect(
      withoutSalesPitch(
        "Your last payment for the Growth plan failed, so its monthly credits are paused — update your payment method in Settings, or top up credits to keep going.",
      ),
    ).toBe("Your last payment for the Growth plan failed, so its monthly credits are paused.");
  });

  it("leaves a text with nothing to sell exactly as it was", () => {
    for (const plain of [
      "Your account is suspended. Contact support if you think this is a mistake.",
      "You've used all 140 credits included in your Growth plan this month.",
      "Insufficient credits for that request.",
    ]) {
      expect(withoutSalesPitch(plain)).toBe(plain);
    }
  });

  it("says something plain when nothing but the pitch was there", () => {
    expect(withoutSalesPitch("Top up credits or pick a plan to keep going.")).toBe(PLAIN_NO_CREDITS);
    expect(withoutSalesPitch("")).toBe(PLAIN_NO_CREDITS);
  });

  it("CONTRACT: every sales text the allowance check can produce comes out plain", () => {
    // Read from the source, so a pitch added to generations/core.ts later is
    // held to this too. Concatenated pieces are joined first, the way
    // truth-contracts.test.ts reads server text, and each ${…} gets a value.
    const source = readFileSync(join(__dirname, "../generations/core.ts"), "utf8").replace(
      /["'`]\s*\+\s*["'`]/g,
      "",
    );
    const texts = source
      .split("\n")
      .filter((line) => PITCH.test(line) && /[`"]/.test(line) && !/^\s*\/\//.test(line))
      .map((line) => {
        const quote = line.includes("`") ? "`" : '"';
        return line
          .slice(line.indexOf(quote) + 1, line.lastIndexOf(quote))
          .replace(/\$\{[^}]*\}/g, "3");
      });
    expect(texts.length).toBeGreaterThanOrEqual(6);
    for (const text of texts) {
      const plain = withoutSalesPitch(text);
      expect(plain, text).not.toMatch(PITCH);
      expect(plain, text).toMatch(/[.!?]$/);
      // What happened is kept: the text still opens the way it did.
      expect(text.startsWith(plain.slice(0, 20)), `${text}\n→ ${plain}`).toBe(true);
    }
  });

  it("the free-generation race's own text is plain", () => {
    expect(PLAIN_FREE_USED_TODAY).not.toMatch(PITCH);
    expect(PLAIN_NO_CREDITS).not.toMatch(PITCH);
  });
});
