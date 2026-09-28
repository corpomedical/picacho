import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ADMIN_ACTIONS,
  ADMIN_ACTION_GROUPS,
  actionLabel,
  actionsInGroup,
  auditValue,
  csvCell,
  isMissingAuditTable,
  logAdminAction,
} from "./audit";

function fakeAdmin(insert: (row: unknown) => Promise<{ error: { message: string } | null }>) {
  const rows: unknown[] = [];
  const client = {
    from: (table: string) => ({
      insert: (row: unknown) => {
        rows.push({ table, row });
        return insert(row);
      },
    }),
  } as unknown as SupabaseClient;
  return { client, rows };
}

afterEach(() => vi.restoreAllMocks());

describe("logAdminAction", () => {
  it("writes one line with before/after as short text", async () => {
    const { client, rows } = fakeAdmin(async () => ({ error: null }));
    const ok = await logAdminAction(client, "admin-1", {
      action: "credits.give",
      targetType: "user",
      targetId: "user-1",
      subjectUserId: "user-1",
      before: 10,
      after: 34,
      reason: "Face mismatch",
      amount: 24,
    });
    expect(ok).toBe(true);
    expect(rows).toEqual([
      {
        table: "admin_actions",
        row: {
          admin_id: "admin-1",
          action: "credits.give",
          target_type: "user",
          target_id: "user-1",
          subject_user_id: "user-1",
          before_value: "10",
          after_value: "34",
          reason: "Face mismatch",
          amount: 24,
        },
      },
    ]);
  });

  it("never throws: a missing table or a thrown client only logs", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const missing = fakeAdmin(async () => ({ error: { message: 'relation "admin_actions" does not exist' } }));
    await expect(logAdminAction(missing.client, "a", { action: "flag.toggle", targetType: "flag" })).resolves.toBe(false);
    const throwing = fakeAdmin(async () => {
      throw new Error("network");
    });
    await expect(logAdminAction(throwing.client, "a", { action: "flag.toggle", targetType: "flag" })).resolves.toBe(false);
    expect(error).toHaveBeenCalledTimes(2);
    expect(error.mock.calls[0][0]).toBe("admin audit: write failed");
  });
});

describe("the log's words", () => {
  it("every action sits in a group the page has a chip for", () => {
    const groups = new Set(ADMIN_ACTION_GROUPS.map((g) => g.id));
    for (const [action, meta] of Object.entries(ADMIN_ACTIONS)) {
      expect(groups.has(meta.group), action).toBe(true);
    }
    expect(actionsInGroup("credits")).toContain("render.refund");
    expect(actionLabel("user.plan")).toBe("Changed plan");
    expect(actionLabel("something.new")).toBe("something.new");
  });

  it("keeps values short and plain", () => {
    expect(auditValue(null)).toBeNull();
    expect(auditValue("fal")).toBe("fal");
    expect(auditValue({ a: 1 })).toBe('{"a":1}');
    expect(auditValue("x".repeat(600))).toHaveLength(500);
  });
});

describe("csvCell", () => {
  it("quotes what needs quoting and defuses spreadsheet formulas", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell(null)).toBe("");
    expect(csvCell(24)).toBe("24");
  });
});

describe("isMissingAuditTable", () => {
  it("recognises the not-yet-run SQL, and nothing else", () => {
    expect(isMissingAuditTable({ code: "PGRST205", message: "Could not find the table" })).toBe(true);
    expect(isMissingAuditTable({ code: "PGRST202", message: "Could not find the function" })).toBe(true);
    expect(isMissingAuditTable({ message: 'relation "public.admin_user_notes" does not exist' })).toBe(true);
    expect(isMissingAuditTable({ code: "23505", message: "duplicate key value" })).toBe(false);
    expect(isMissingAuditTable(null)).toBe(false);
  });
});
