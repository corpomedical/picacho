import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Reports and Moderation, checked at the operator's request (2026-09-18,
// "Check reports and moderation" → "Fix"). Three faults, read as source:
// the pages are server components over the production database.

const root = join(__dirname, "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const reports = read("app/admin/reports/page.tsx");
const moderation = read("app/admin/moderation/page.tsx");
const badges = read("lib/admin/badges.ts");
const bar = read("components/admin-command-bar.tsx");

describe("Reports", () => {
  it("reads the open reports on their own, with an exact count, so none can fall off the page", () => {
    // It was one read of the newest 200 reports of any status, split on the
    // page: an older open report vanished while the badge still counted it.
    expect(reports).toMatch(/\.select\(REPORT_COLUMNS, \{ count: "exact" \}\)\s*\.eq\("status", "open"\)/);
    expect(reports).toMatch(/\.select\(REPORT_COLUMNS\)\s*\.neq\("status", "open"\)/);
    expect(reports).not.toMatch(/\.filter\(\(r\) => r\.status === "open"\)/);
    // The heading is the count the badge is, and says when it shows fewer.
    expect(reports).toContain("Open ({openTotal})");
    expect(reports).toContain("Showing the newest {openReports.length} of {openTotal}.");
    // The badge counts exactly the open reports.
    expect(badges).toMatch(/\.from\("generation_reports"\)\s*\.select\("\*", \{ count: "exact", head: true \}\)\s*\.eq\("status", "open"\)/);
  });

  it("looks up what it shows in slices", () => {
    expect(reports).toContain('import { fetchIn } from "@/lib/admin/fetch-all";');
    expect(reports).not.toContain('.in("id", generationIds)');
    expect(reports).not.toContain('.in("id", userIds)');
  });
});

describe("Moderation", () => {
  it("counts and lists failed renders, never the ones someone stopped", () => {
    const stop = '.not("cancel_requested", "is", true)';
    const badgeRead = badges.slice(badges.indexOf('.eq("status", "failed")'), badges.indexOf('.gte("created_at", last24h)'));
    expect(badgeRead).toContain(stop);
    const listRead = moderation.slice(moderation.indexOf('.eq("status", "failed")'), moderation.indexOf(".limit(30)"));
    expect(listRead).toContain(stop);
  });

  it("calls them what they are: failed renders, not flagged content", () => {
    const notice = bar.slice(bar.indexOf('"/admin/moderation": (n) =>'), bar.indexOf("\n", bar.indexOf('"/admin/moderation": (n) =>')));
    expect(notice).toContain("render");
    expect(notice.toLowerCase()).not.toContain("flag");
    expect(moderation).not.toContain("Nothing flagged");
    expect(moderation).not.toContain("failed to pass validation after every retry");
  });

  it("says why each one failed", () => {
    expect(moderation).toContain('.select("id, user_id, prompt_input, status, attempts, created_at, pipeline_log")');
    expect(moderation).toContain("failureReasonFromLog(g.pipeline_log)");
  });
});
