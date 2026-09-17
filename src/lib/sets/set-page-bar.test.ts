import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The set page's bar (2026-09-16, then the studio's frame on 2026-09-17):
// since cut A both pages draw the same bar (studio-frame.tsx StudioBar).
// Shoot and Film show at every width, Build from 640 px (where the editor
// fits; below it the editor says so instead of drawing panels over its
// own canvas), and the words that fill the bar give way below 768 px,
// where the full bar overflowed in Spanish. Read as source: client
// components do not load here.

const frame = readFileSync(join(__dirname, "../../components/sets/studio-frame.tsx"), "utf8");
const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
const editor = readFileSync(join(__dirname, "../../components/sets/set-editor.tsx"), "utf8");
const bar = frame.slice(frame.indexOf("export function StudioBar("), frame.indexOf("export function StudioRail("));

describe("the studio's bar", () => {
  it("is the one bar of both pages, with the modes as the frame draws them", () => {
    expect(view).toContain("<StudioBar");
    expect(editor).toContain("<StudioBar");
    expect(view).toContain("<StudioRail");
    expect(editor).toContain("<StudioRail");
    expect(view).toContain("<StudioDock");
    expect(editor).toContain("<StudioDock");
    expect(view).toContain("<StudioStatus>");
    expect(editor).toContain("<StudioStatus>");
    for (const mode of ["build", "shoot", "film", "cut"]) expect(bar).toContain(`modeButton("${mode}")`);
  });

  it("keeps the switch at every width, and Build from 640 px", () => {
    expect(frame).toContain('const SEG = "flex h-7 flex-none items-center gap-0.5 rounded-[6px]');
    expect(bar).toContain('const width = id === "build" ? "hidden sm:flex" : "flex";');
    expect(bar).not.toMatch(/SEG_ON\.replace\("flex ", `hidden/);
  });

  it("lets the words go below 768 px, and keeps them for screen readers", () => {
    expect(bar).toContain("<Link href={back.href} aria-label={back.label}");
    expect(bar).toContain('←<span className="hidden md:inline"> {back.label}</span>');
    expect(bar).toContain('<h1 className="hidden min-w-[80px] max-w-[280px] shrink truncate font-display text-[14px] font-semibold text-[#ecedf1] md:block">{title}</h1>');
    expect(bar).toContain('<span className="sr-only md:hidden">{title}</span>');
    // Find anything and the rendering count wait for a wide bar, the view modes for 1440 px (Spanish fills the bar below it); the primary action shows from a tablet's width.
    expect(bar).toContain("hidden min-[1440px]:flex");
    expect(bar).toContain('<span className="hidden md:contents">{primary}</span>');
    expect(bar).toMatch(/className="hidden h-8 min-w-\[96px\] basis-\[200px\] shrink-\[4\] grow-0[^"]*xl:flex"/);
    expect(bar).toMatch(/className="hidden h-8 items-center gap-2[^"]*md:flex"/);
    // The shoot's history menu keeps its words for wide screens and its label for readers.
    expect(view).toContain('<span className="hidden xl:inline">{s.historyLabel} · </span>');
    expect(view).toContain("aria-label={`${s.historyLabel} · ${formatMsg(s.revisionN, { n: frameNumber })}`}");
  });
});

describe("the editor below 640 px", () => {
  it("says it needs a wider one, above everything, with the way back to shooting", () => {
    const notice = editor.slice(editor.indexOf("A phone held upright has no room"), editor.indexOf("{/* The studio's frame"));
    expect(notice).toContain("sm:hidden");
    expect(notice).toContain("{s.editorNarrow}");
    expect(notice).toContain("onClick={() => void done()}");
    expect(notice).toContain("{s.editorDone}");
  });
});
