import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The slate composer + the premiere opening (operator-approved pick,
// 2026-09-22): the receipt band and the loadout fused into one ruled row of
// cells, the price on the Render key alone, and the empty stage opening on
// the character's saved photo. These pin the decisions that must survive
// later edits — source-text checks, the same pattern generate-stage-b uses.

const root = join(__dirname, "..");
const form = readFileSync(join(root, "components", "generate-form.tsx"), "utf8");
const strip = readFileSync(join(root, "components", "receipt-strip.tsx"), "utf8");
const catalog = (lang: string) =>
  readFileSync(join(root, "lib", "i18n", "messages", `${lang}.ts`), "utf8");

describe("the slate row", () => {
  it("keeps every tour anchor the first-run walkthrough points at", () => {
    for (const id of [
      "tour-character-select",
      "tour-video-model",
      "tour-prompt",
      "tour-advanced-toggle",
      "tour-send",
    ]) {
      expect(form).toContain(`data-tour-id="${id}"`);
    }
  });

  it("has no TOTAL cell — the price sits on the Render key, same sendCreditCost, same strings", () => {
    expect(form).not.toContain("{g.totalLabel}");
    expect(form).toContain(
      '{!isHero && !willAsk && sendCreditCost > 0 && !freeTierClient && (',
    );
    // The chip quotes through the exact strings the Total cell used.
    const chip = form.slice(form.indexOf("The price, on the key alone"));
    expect(chip).toContain("g.durationCreditsOne");
    expect(chip).toContain("formatMsg(g.durationCredits, { n: sendCreditCost })");
  });

  it("renders the receipt through the same resolver machinery, not a fork", () => {
    expect(form).toContain("planReceiptParts(sendPlanNow, g,");
    expect(form).toContain("<PlanIssueRows");
    expect(form).toContain("hasAttachmentRiding={planHasAttachmentRiding(sendPlanNow)}");
    // The submit-time soft-block still quotes the same issueMessage.
    expect(form).toContain("issueMessage(block, g, sendPlanModelName(), photoRiding)");
    expect(strip).toContain("export function planReceiptParts");
    expect(strip).toContain("export function PlanIssueRows");
  });

  it("keeps the dialogue line always visible for voiced characters in video mode", () => {
    expect(form).toContain('{contentType === "video" && currentCharacter?.voiceId && (');
  });

  it("keeps the FRAME toggle's real semantics (aria-pressed, titles, clear-on-second-tap)", () => {
    expect(form).toContain(
      "onClick={() => setVideoAspectRatio((prev) => (prev === ar ? null : ar))}",
    );
    expect(form).toContain("aria-pressed={videoAspectRatio === ar}");
  });

  it("keeps the OUTFIT cell pressable with the chip's own state", () => {
    expect(form).toContain("onClick={() => setUseOutfit((v) => !v)}");
    expect(form).toContain("aria-pressed={useOutfit}");
  });

  it("never puts a semibold on slate text (DM Mono loads at 400/500 only)", () => {
    // Every mono microlabel in the slate is font-medium; a semibold would
    // silently faux-bold (the 2026-09-18 dimming saga).
    const labels = form.match(/text-\[9\.5px\][^"]*"/g) ?? [];
    expect(labels.length).toBeGreaterThan(4);
    for (const l of labels) expect(l).not.toContain("font-semibold");
  });
});

describe("the premiere opening", () => {
  it("stands only when a character with a saved photo exists, and the plain hint stays as fallback", () => {
    expect(form).toContain("premiereShown && premiereCharacter && premiereCenterUrl ? (");
    expect(form).toContain("g.noMessages}");
  });

  it("speaks its two lines in all four languages", () => {
    for (const lang of ["en", "es", "pt", "it"]) {
      const text = catalog(lang);
      for (const key of [
        "premiereTitle",
        "premiereSub",
        "slateCast",
        "slateEngine",
        "slateLength",
        "slateFrame",
        "slateAction",
      ]) {
        expect(text, `${lang}: ${key}`).toContain(`${key}: "`);
      }
      // The sub styles the name separately, so the catalogs must keep the
      // placeholder the split relies on.
      expect(text.match(/premiereSub: "([^"]+)"/)?.[1], `${lang}: premiereSub`).toContain("{name}");
    }
  });
});
