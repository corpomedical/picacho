import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AdminErrorBanner } from "./admin-error-banner";

// ?error is a code, not copy: the banner shows a line we wrote for each
// notice it knows, and one generic line for anything else. A notice missing
// from its lists reads as "Something went wrong", however much it says.

/** The line the banner renders for a ?error code. */
const shown = (error: string): string => AdminErrorBanner({ error })?.props.children;

describe("a deletion from Admin that fails at the last step", () => {
  // By the auth delete, the promo-sale email is erased, Stripe billing is
  // cancelled and any verified face is withdrawn (2026-09-19).
  const actions = readFileSync(join(__dirname, "..", "lib", "admin", "actions.ts"), "utf8");
  const failed = actions.slice(actions.indexOf("const { error } = await admin.auth.admin.deleteUser(userId);"));

  it("tells the admin what had already happened, not the generic line", () => {
    // The notice as the action writes it, with the error that most likely
    // trips it: a table referencing the account without ON DELETE CASCADE.
    const notice = /encodeURIComponent\(\s*`([^`]*)`/
      .exec(failed)?.[1]
      ?.replace(/\$\{error\.message\}/, "Database error deleting user");
    expect(notice).toBeDefined();
    const line = shown(notice!);
    expect(line).not.toBe(shown("anything the banner doesn't know"));
    expect(line).toContain("NOT deleted");
    expect(line).toContain("Stripe billing WAS already cancelled");
    expect(line).toContain("verified face");
    expect(line).not.toContain("Database error");
  });

  it("logs the cause before redirecting, so \"details are in the server log\" is true", () => {
    expect(failed.slice(0, failed.indexOf("redirect("))).toContain(
      'console.error("deleteUser: auth delete failed after Stripe was cancelled", error);',
    );
  });
});
