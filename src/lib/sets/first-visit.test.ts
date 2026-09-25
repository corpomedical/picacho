import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import en from "../i18n/messages/en";
import { FirstVisit, HELIOS_TOUR_KEY } from "../../components/sets/first-visit";

// The first visit (Helios Cut 3, step 9, 2026-09-26): three tips on a set
// with no stills — the grey figure, the blocks, the bright box — once per
// browser, ?tour=1 again. A card beside the stage, never a modal: it takes
// no focus and blocks nothing. Read as source like the page's other tests,
// and the card itself drawn to markup.

const dir = join(__dirname, "../../components/sets");
const view = readFileSync(join(dir, "set-view.tsx"), "utf8");
const card = readFileSync(join(dir, "first-visit.tsx"), "utf8");
const between = (from: string, to: string) => {
  const at = view.indexOf(from);
  expect(at, from).toBeGreaterThan(-1);
  const end = view.indexOf(to, at + from.length);
  expect(end, to).toBeGreaterThan(at);
  return view.slice(at, end);
};

const words = { stepsLabel: en.onboarding.stepsLabel, next: en.common.next, close: en.common.close, dismiss: en.common.dismiss };
const tips = [en.sets.standInNote, en.sets.tipBlocks, en.sets.frameHint];
const draw = (step: number) => renderToStaticMarkup(createElement(FirstVisit, { tips, step, onNext: () => {}, onClose: () => {}, words, surface: "GLASS" }));

describe("the first-visit card", () => {
  it("is kept per browser under its own key", () => {
    expect(HELIOS_TOUR_KEY).toBe("picacho.heliosTour.v1");
  });

  it("says one tip at a time, counts them and turns Next into Close on the last", () => {
    const first = draw(0);
    expect(first).toContain(en.sets.standInNote);
    expect(first).not.toContain(en.sets.tipBlocks);
    expect(first).toContain(`<span class="sr-only">${en.onboarding.stepsLabel} </span>1/3</p>`);
    expect(first).toContain(`>${en.common.next}</button>`);
    expect(first).not.toContain(`>${en.common.close}</button>`);
    expect(first).toContain(`aria-label="${en.common.dismiss}"`);
    const last = draw(2);
    expect(last).toContain(en.sets.frameHint);
    expect(last).toContain(`>${en.common.close}</button>`);
    expect(last).not.toContain(`>${en.common.next}</button>`);
    // A step past the end is the last tip, never an empty card.
    expect(draw(7)).toContain(en.sets.frameHint);
  });

  it("is not a modal: it announces politely and takes no focus", () => {
    const html = draw(0);
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain("aria-modal");
    expect(html).not.toContain('role="dialog"');
    expect(card).not.toMatch(/aria-modal|autoFocus|\.focus\(/);
  });

  it("is the studio's glass with its small prose, and still under reduced motion", () => {
    expect(draw(0)).toContain('class="GLASS relative rounded-[14px]');
    expect(card).toContain("text-[12.5px] leading-[1.55] text-[#c6c9d1]");
    expect(card).toContain('text-[12px] tabular-nums');
    // Every transition it has stops when the person asks for less motion.
    const transitions = card.match(/\btransition-(?!none)/g)?.length ?? 0;
    expect(transitions).toBeGreaterThan(0);
    expect(card.match(/motion-reduce:transition-none/g)).toHaveLength(transitions);
  });
});

describe("when the page shows it", () => {
  it("reads the three tips in order: the figure, the blocks, the box", () => {
    expect(view).toContain("const tipWords = [s.standInNote, s.tipBlocks, s.frameHint] as const;");
  });

  it("shows once, on a set with no stills, and blocked storage counts as seen", () => {
    const show = between("const tipsCheckedRef = useRef(false);", "\n  }, [ready, initialShots.length]);");
    expect(show).toContain("if (!ready || tipsCheckedRef.current) return;");
    expect(show).toMatch(/let seen = false;\s*try \{\s*seen = window\.localStorage\.getItem\(HELIOS_TOUR_KEY\) === "1";\s*\} catch \{[^}]*seen = true;\s*\}/);
    expect(show).toContain('if (tourAskedRef.current || (!seen && initialShots.length === 0)) setTips(0);');
  });

  it("× and Close put it away for good, in a try", () => {
    const close = between("function closeTips() {", "\n  }\n");
    expect(close).toContain("setTips(null);");
    expect(close).toMatch(/try \{\s*window\.localStorage\.setItem\(HELIOS_TOUR_KEY, "1"\);\s*\} catch \{/);
    expect(view).toContain("onClose={closeTips}");
    // The tips stay out of the Escape chain: closeTips is declared and handed to the card, nothing else.
    expect(view.match(/closeTips/g)).toHaveLength(2);
  });

  it("?tour=1 shows it again, and the address forgets it in its own effect", () => {
    const tour = between("  useEffect(() => {\n    const url = new URL(window.location.href);\n    if (!url.searchParams.has(\"tour\")) return;", "\n  }, []);");
    expect(tour).toContain('tourAskedRef.current = url.searchParams.get("tour") === "1";');
    expect(tour).toContain('url.searchParams.delete("tour");');
    expect(tour).toContain("window.history.replaceState(");
    // Not the ?ask= effect, which clears the address only when a message came.
    expect(tour).not.toContain("initialAsk");
  });

  it("stays off a still, a failed stage, Film and Cut, and a phone's sheets", () => {
    expect(view).toContain(
      'const tipsShown = tips !== null && ready && !loadFailed && !viewingShot && studioMode === "shoot" && !(!wide && (rigOpen || elementCard));',
    );
  });
});

describe("where it sits", () => {
  it("Classic on a computer, and a folded phone: the stage foot's first child, the foot unchanged", () => {
    const foot = between("data-stage-foot>", "{figureMoved ? s.figureMovedOut : s.dragHint}");
    const tip = foot.indexOf('{tipsShown && (wide || !chatOpen) && firstVisitView("pointer-events-auto w-full max-w-[340px]")}');
    expect(tip).toBeGreaterThan(-1);
    expect(tip).toBeLessThan(foot.indexOf("{simplePhoneSet ? ("));
    expect(view).toContain('className="pointer-events-none absolute bottom-[104px] left-3.5 right-3.5 z-20 flex flex-col items-start gap-2 md:right-[190px]" data-stage-foot');
  });

  it("the new layout on a computer: its own corner, since that layout draws no stage foot", () => {
    expect(view).toContain('{simpleOn && tipsShown && <div className="absolute bottom-[104px] left-3.5 z-20');
    expect(view).toContain("{!viewingShot && !loadFailed && !filmOpen && !simpleOn && (");
  });

  it("a phone with its conversation open: between the header and the thread", () => {
    const aside = between("{!wide && (\n          <aside", "</aside>");
    const header = aside.indexOf("{chatHeader}");
    const tip = aside.indexOf('{chatOpen && tipsShown && <div className="flex-none px-3.5 pt-3">{firstVisitView("w-full")}</div>}');
    expect(tip).toBeGreaterThan(header);
    expect(tip).toBeLessThan(aside.indexOf("{chatOpen && chatThread}"));
  });

  it("is one drawing for all three", () => {
    expect(view.match(/<FirstVisit\b/g)).toHaveLength(1);
    expect(view.match(/firstVisitView\(/g)).toHaveLength(3);
  });
});
