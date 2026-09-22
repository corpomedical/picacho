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

// THE SHEET (phones, below md — operator, 2026-09-22: "Its your call, the
// point of this is to have less clutter and keep it neat and clean"). The
// composer docks above the tab bar with each value its own one-tap key, and
// the rarer controls rise in a pulled-up sheet. Layout only: these pin what
// must not drift.
const css = readFileSync(join(root, "app", "globals.css"), "utf8");
const page = readFileSync(join(root, "app", "app", "generate", "page.tsx"), "utf8");
const sheetCss = css.slice(css.indexOf("THE SHEET — the Generate composer on phones"));

describe("the phone sheet", () => {
  it("scopes every sheet rule below md, so desktop and tablet stay the approved slate", () => {
    expect(sheetCss).toContain("@media (max-width: 767.98px)");
    // Every [data-dock] rule lives inside the phone media blocks: strip
    // EVERY phone media block (balanced braces) and nothing may remain.
    let outside = "";
    let i = 0;
    const open = /@media \(max-width: 767\.98px\)[^{]*\{/g;
    for (let m = open.exec(sheetCss); m; m = open.exec(sheetCss)) {
      outside += sheetCss.slice(i, m.index);
      let depth = 1;
      let j = m.index + m[0].length;
      while (depth > 0 && j < sheetCss.length) {
        if (sheetCss[j] === "{") depth++;
        else if (sheetCss[j] === "}") depth--;
        j++;
      }
      i = j;
      open.lastIndex = j;
    }
    outside += sheetCss.slice(i);
    // (Comments may name the hooks; keyframes sit outside and select nothing.)
    const rules = outside.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(rules).not.toMatch(/\[data-dock|\.dock-grabber|\.dock-scrim|\[data-sheet/);
    // The new phone-only controls are hidden from md up in the markup too.
    expect(form).toMatch(/data-dock-pull[\s\S]{0,900}md:hidden/);
    expect(form).toContain('className="dock-scrim fixed inset-0 z-[36] bg-[#070605]/60 md:hidden"');
    // The scrim is a pointer affordance only: the pull key is the one
    // accessible toggle, so the scrim never announces a second "All settings".
    const scrim = form.slice(form.indexOf("{!isHero && sheetRaised && ("), form.indexOf('className="dock-scrim'));
    expect(scrim).toContain("aria-hidden");
    expect(scrim).not.toContain("aria-label");
  });

  it("makes each resting value its own one-tap key into its existing menu", () => {
    // CAST / ENGINE / LENGTH keep their real buttons; the labels hide at rest.
    expect(sheetCss).toContain('[data-dock][data-sheet="rest"] [data-cell-label]');
    for (const key of ["slateCast", "slateEngine", "slateLength"]) {
      expect(form).toMatch(new RegExp(`data-cell-label>\\s*\\{g\\.${key}\\}`));
    }
    // FRAME at rest: one key with the glyph + the real state word, opening
    // the same two toggles (same setter, same pressed state, same titles).
    const frameKey = form.slice(form.indexOf("data-dock-frame>"), form.indexOf("{/* The receipt half of the slate"));
    expect(frameKey).toContain("{videoAspectRatio ?? t.settings.aspectAuto}");
    expect(frameKey).toContain("setVideoAspectRatio((prev) => (ar === null || prev === ar ? null : ar))");
    // Automatic is a row of its own; the footnote no longer repeats its name.
    expect(frameKey).toContain('([null, "16:9", "9:16"] as const)');
    expect(frameKey).not.toContain("{t.settings.aspectAuto} · ");
    expect(frameKey).toContain("aria-pressed={videoAspectRatio === ar}");
    expect(frameKey).toContain("t.settings.aspectHelp");
  });

  it("keeps the price and the fan-out on the Render key, and the blockers at rest", () => {
    const key = form.slice(form.indexOf('data-tour-id="tour-send"'), form.indexOf("{/* Typed a question with the assistant switched off."));
    // The price chip rides the key, with the fan-out (×n) inside it on a phone.
    expect(key).toContain("formatMsg(g.durationCredits, { n: sendCreditCost })");
    expect(key).toContain("data-send-fan");
    expect(key).toContain("×{selectedAngles.length}");
    expect(sheetCss).toContain("[data-dock] [data-send-fan]");
    // Nothing in the sheet block hides a plan issue (warn/block rows).
    expect(sheetCss).not.toMatch(/\[data-plan-issues\][^{]*\{[^}]*display:\s*none/);
    expect(form).toContain('<div className="mt-2" data-plan-issues>');
    // No orphan asterisk at rest; the footnote waits in the sheet.
    expect(sheetCss).toMatch(/data-sheet="rest"\] \[data-slate-foot\],\s*\[data-dock\]\[data-sheet="rest"\] \[data-foot-mark\]/);
  });

  it("lights a chip at rest for every armed state the sheet holds", () => {
    const chips = form.slice(form.indexOf("const litChips"), form.indexOf("].filter((c): c is"));
    for (const state of [
      "multiAngleMode",
      "storyboardActive",
      "sceneMode",
      'videoAdvancedMode !== "none"',
      "cinemaPresetIds.move",
      "cinemaPresetIds.look",
      "assistantOn",
      // A picked resolution changes the price, so it lights a chip too.
      "videoResolution !== null",
    ]) {
      expect(chips, state).toContain(state);
    }
    expect(sheetCss).toContain('[data-dock][data-sheet="rest"] [data-dock-lit]');
  });

  it("keeps the modes' tour anchor findable while they rest in the sheet", () => {
    expect(form).toContain('data-tour-id={contentType === "video" ? "tour-advanced-toggle" : undefined}');
    // Raised, the modes' group box dissolves into the one wrap (so the pull
    // key, laid out first, stays the anchor on a phone).
    expect(sheetCss).toContain('[data-keys-modes] > [data-tour-id="tour-advanced-toggle"] {\n    display: contents;');
  });

  it("closes on Android back, and a send lowers it", () => {
    expect(form).toContain("useBackCloser(sheetShown, closeSheet);");
    expect(form).toContain("useBackCloser(frameSheetOpen, () => setFrameSheetOpen(false));");
    expect(form).toMatch(/setComposerFolded\(true\);\s*setSheetOpen\(false\);/);
  });

  it("moves the phone header into one line with icon keys, stats to the takes caption", () => {
    expect(form).toContain("aria-label={g.sessionTranscript}");
    expect(form).toContain("aria-label={g.newChat}");
    expect(form).toContain("title={g.firstTrySuccess}");
    expect(form).toContain("{g.firstTryShort}");
    expect(form).toContain("{g.avgAttemptsShort}");
    expect(page).toContain("phoneStats={stats}");
    expect(page).not.toContain("<TranscriptToggle label={g.sessionTranscript} />");
  });

  it("speaks the pull key and the caption's short stats in all four languages", () => {
    for (const lang of ["en", "es", "pt", "it"]) {
      expect(catalog(lang), lang).toMatch(/composerMore: "[^"]+"/);
      expect(catalog(lang), lang).toMatch(/firstTryShort: "[^"]+"/);
      expect(catalog(lang), lang).toMatch(/avgAttemptsShort: "[^"]+"/);
    }
  });

  it("never lets the dock outgrow the screen, and opens the raised sheet's menus downward", () => {
    // Capped in BOTH states (the keyboard inset included), scrolling inside.
    expect(sheetCss).toContain("max-height: calc(100dvh - var(--dock-bottom) - 56px);");
    expect(sheetCss).toContain("--dock-bottom: max(calc(var(--native-tab-bar, 18px) - 18px), var(--kb-inset, 0px));");
    expect(sheetCss).not.toContain("@media (max-height: 700px)");
    expect(sheetCss).toContain('[data-dock][data-sheet="open"] [data-slate-box] [role="listbox"] {\n    top: 100%;');
  });

  it("keeps every resting touch target at 44 px without stealing a neighbour's", () => {
    expect(sheetCss).toMatch(/\[data-slate-controls\] button \{\s*min-height: 44px;\s*min-width: 44px;/);
    // The OUTFIT toggle's extender reaches DOWN only (never into LENGTH/FRAME).
    expect(sheetCss).toContain("inset: 0 0 -8px 0;");
    expect(sheetCss).not.toContain("inset: -7px 0;");
    expect(sheetCss).toMatch(/\[data-dialogue-row\] input \{\s*height: 44px;/);
    expect(sheetCss).toMatch(/\[data-keys-session\] button:not\(\[role="switch"\]\) \{\s*min-height: 44px;/);
  });
});
