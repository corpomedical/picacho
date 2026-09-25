// Export: the Edit Bay's working copy rendered into a finished video (pro
// editor, operator 2026-09-25). No Opus involved — the timeline IS the edit —
// so it goes to HeyGen's HyperFrames cloud renderer (heygen.ts) as one zip:
// the working page as index.html, the project's own files, and the
// customer's clips the page plays (footage/clip-N.<ext>). The render is read
// back by the page (checkExport) and lands in History as a new video.

import type { ProjectManifest } from "./project";

export type ExportRecord = {
  id: string;
  /** The video being edited (its generation id). */
  source: string;
  renderId: string;
  status: "rendering" | "done" | "failed";
  startedAt: number;
  error?: string | null;
  /** The finished video's generation id. */
  resultId?: string | null;
};

/** Project files a render has no use for: the pages we replace and the agent's own notes. */
const LEAVE_OUT = new Set(["index.html", "draft.html", "CLAUDE.md", "AGENTS.md"]);

/** The customer's clips a page plays, as it names them and where we keep them. */
export function footageInPage(html: string, clips: readonly { path: string }[]): { name: string; path: string }[] {
  const seen = new Map<string, string>();
  for (const m of html.matchAll(/footage\/clip-(\d{1,2})\.([a-z0-9]{2,5})/gi)) {
    const clip = clips[Number(m[1])];
    if (clip && !seen.has(m[0])) seen.set(m[0], clip.path);
  }
  return [...seen].map(([name, path]) => ({ name, path }));
}

/** What goes in the render bundle besides the page itself. */
export function bundlePlan(html: string, manifest: ProjectManifest, clips: readonly { path: string }[]) {
  return {
    project: manifest.files.map((f) => f.path).filter((p) => !LEAVE_OUT.has(p)),
    footage: footageInPage(html, clips),
  };
}
