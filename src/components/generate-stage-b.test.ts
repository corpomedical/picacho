import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Direction B (operator-picked, 2026-09-18): the take kept shrinking to a
// sliver when the composer opened. These guard the three moves that fixed it
// and the two collisions found while rendering it — source-text checks, the
// same pattern the other composer wiring tests use.

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const form = read("generate-form.tsx");

describe("the reference-photo row left the composer", () => {
  it("is no longer drawn inside the composer", () => {
    expect(form).not.toContain("{g.anchorPhotoLabel}");
    expect(form).not.toContain("onClick={() => setAnchorPhotoPath(p.path)}");
  });

  it("opens from the character's pill as a menu, only where one photo is chosen", () => {
    expect(form).toContain("const anchorPickerShown =");
    expect(form).toContain('aria-haspopup={anchorPickerShown ? "dialog" : "listbox"}');
    expect(form).toContain("{photoMenuOpen && anchorPickerShown && currentCharacter && (");
    // Picking a photo closes the menu; Switch character hands over to the cast.
    expect(form).toContain("setAnchorPhotoPath(ph.path);\n                      setPhotoMenuOpen(false);");
    expect(form).toContain("setPhotoMenuOpen(false);\n                  setCharacterMenuOpen(true);");
  });

  it("closes on an outside click and on Escape, like every sheet in the row", () => {
    expect(form).toContain("if (!characterMenuOpen && !photoMenuOpen) return;");
    expect(form).toContain("setPhotoMenuOpen(false);\n      setPlusMenuOpen(false);");
  });
});

describe("the receipt's FACE names the photo", () => {
  const strip = read("receipt-strip.tsx");

  it("only for the character's own saved photos", () => {
    expect(strip).toContain('(e.source === "character-default" || e.source === "gallery-pick")');
  });

  it("read-only on the slate — the tap target is the CAST cell's real button", () => {
    // The slate (2026-09-22): FACE carries the count as plain text; the
    // photo menu opens from the CAST cell, a real <button> with the dialog
    // popup announced.
    expect(strip).toContain("facePhotoText");
    expect(form).toContain('aria-haspopup={anchorPickerShown ? "dialog" : "listbox"}');
  });

  it("is handed the photo count by the composer", () => {
    expect(form).toContain("facePhotoText: anchorPickerShown");
  });
});

describe("the Takes strip goes where the take comes out bigger", () => {
  it("compares both layouts and keeps a margin against flip-flopping", () => {
    expect(form).toContain("return beside > inBand + 24;");
  });

  it("never moves for a still or while a take is still rendering", () => {
    expect(form).toContain("if (!stagePane.md || !stageTakeUrl || !stageTakeIsVideo || stageInFlightPrompt !== null) return false;");
  });

  it("mounts the band only when it is used, so no tile loads twice", () => {
    expect(form).toContain("{!stripBeside && !premiereShown && (\n      <div");
  });
});

describe("a small take's overlays step back", () => {
  it("hides the take label on a narrow frame and shrinks the identity plate on a short one", () => {
    expect(form).toContain('stageFrameNarrow && "md:hidden"');
    expect(form).toContain('(stageFrameShort || stagePlateLabelFit === "none") && "sr-only"');
  });
});

// The identity plate under a phone's frame hangs by its bottom edge, so a
// label that wrapped pushed the 93% up onto the lock bracket (Portuguese on a
// 405px phone, the Play listing's stage shot, 2026-09-22).
describe("the identity plate keeps to one line", () => {
  it("never wraps, and is held to the frame's width", () => {
    expect(form).toContain("flex max-w-full items-baseline gap-2 whitespace-nowrap md:right-3 md:max-w-[calc(100%-24px)]");
  });

  it("eases the label's tracking, then its size, then shows the number alone", () => {
    expect(form).toContain("{ spacing: (room - bare) / chars, size: 10 }");
    expect(form).toContain("bare * 0.8 <= room");
    expect(form).toContain(': "none";');
  });

  it("measures only when the label is shown — a short frame already hides it", () => {
    expect(form).toContain("const stagePlateLabelFit = stageFrameShort ? null : stagePlateFit;");
  });
});

describe("the Upscale receipt", () => {
  it("is portalled to <body>, outside the stage's size container", () => {
    const upscale = read("upscale-button.tsx");
    expect(upscale).toContain('import { createPortal } from "react-dom";');
    expect(upscale).toContain("document.body,");
  });
});
