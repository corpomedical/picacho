import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The set page's bar on a phone (2026-09-16): the Build · Shoot · Film
// switch was `hidden sm:flex`, so below 640 px Film — a whole mode — could
// be reached only by typing ?film=1. Shoot and Film now show at every width,
// Build from 640 px (where the editor fits; below it the editor says so
// instead of drawing panels over its own canvas), and the words that fill
// the bar give way below 768 px, where the full bar overflowed in Spanish.
// Read as source: client components do not load here.

const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
const editor = readFileSync(join(__dirname, "../../components/sets/set-editor.tsx"), "utf8");
const bar = view.slice(view.indexOf('<div className="flex h-12 flex-none items-center gap-2'), view.indexOf("onClick={downloadFrame}"));

describe("the set page's bar", () => {
  it("keeps the switch at every width, and Build from 640 px", () => {
    expect(bar).toContain('<span className="flex h-7 flex-none items-center gap-0.5 rounded-[6px]');
    expect(bar).not.toMatch(/hidden h-7[^"]*sm:flex/);
    const build = bar.slice(bar.indexOf("href={`/app/sets/${setId}?build=1`}"), bar.indexOf("{s.editorBuildTab}"));
    expect(build).toMatch(/className="hidden [^"]*sm:flex/);
    for (const tab of ["{s.editorShootTab}", "{s.filmTab}"]) {
      const at = bar.indexOf(tab);
      expect(at, tab).toBeGreaterThan(-1);
      expect(bar.slice(bar.lastIndexOf("className={", at), at)).not.toContain("hidden");
    }
  });

  it("lets the words go below 768 px, and keeps them for screen readers", () => {
    expect(bar).toContain('<Link href="/app/sets" aria-label={s.back}');
    expect(bar).toContain('←<span className="hidden md:inline"> {s.back}</span>');
    expect(bar).toContain('<h1 className="sr-only min-w-0 truncate');
    expect(bar).toContain("md:not-sr-only");
    expect(bar).toContain('<span className="hidden md:inline">{s.historyLabel} · </span>');
    expect(bar).toContain("aria-label={`${s.historyLabel} · ${formatMsg(s.revisionN, { n: frameNumber })}`}");
    // The frame download keeps its size in a tight row.
    expect(view).toContain('className="flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-[6px]');
  });
});

describe("the Build editor on a narrow screen", () => {
  it("says it needs a wider one, above everything, with the way back to shooting", () => {
    const notice = editor.slice(editor.indexOf('<div className="absolute inset-0 z-[90]'), editor.indexOf("{/* app bar */}"));
    expect(notice).toContain("sm:hidden");
    expect(notice).toContain("{s.editorNarrow}");
    expect(notice).toContain("onClick={() => void done()}");
    expect(notice).toContain("{s.editorDone}");
  });
});
