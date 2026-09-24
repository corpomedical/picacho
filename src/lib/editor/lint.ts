// HyperFrames' own linter, run on every composition before a render is paid
// for. It caught what our tests had not — a silent fill video without
// `muted`, two identical media nodes (2026-09-24) — so it stands between the
// compiler and HeyGen: an error here is OUR bug, and the edit stops at the
// bundle step (counted as a failed attempt) instead of spending a render.
//
// @hyperframes/lint is pure JavaScript (HTML/CSS/JS parsers, no browser),
// Apache-2.0, pinned to the version whose rules this was proven against.

import { lintHyperframeHtml, type HyperframeLintFinding } from "@hyperframes/lint";

export type LintVerdict = { errors: HyperframeLintFinding[]; warnings: HyperframeLintFinding[] };

export async function lintComposition(html: string): Promise<LintVerdict> {
  const result = await lintHyperframeHtml(html, { filePath: "index.html", host: "cli" });
  return {
    errors: result.findings.filter((f) => f.severity === "error"),
    warnings: result.findings.filter((f) => f.severity === "warning"),
  };
}

export class CompositionLintError extends Error {}

export function describeFindings(findings: HyperframeLintFinding[]): string {
  return findings.map((f) => `${f.code}${f.elementId ? ` [${f.elementId}]` : ""}: ${f.message}`).join("; ");
}
