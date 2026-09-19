import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AdminErrorBanner } from "./admin-error-banner";
import { MAX_IDENTITY_THRESHOLD, MIN_IDENTITY_THRESHOLD } from "../lib/generations/identity-gate";

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

// Every admin action file that sends notices to the banner, read as source:
// the actions need a session, Stripe and the database to run.
const ACTION_FILES = ["actions.ts", "promo-actions.ts", "email-actions.ts"];
const read = (file: string) => readFileSync(join(__dirname, "..", "lib", "admin", file), "utf8");
/** The source with its whole-line comments blanked, so what they mention doesn't count. */
const code = (file: string) => read(file).replace(/^\s*\/\/.*$/gm, (m) => " ".repeat(m.length));
const GENERIC = shown("anything the banner doesn't know");

/** The index of the bracket that closes the one opened at `open`. */
function closing(source: string, open: number): number {
  const pairs: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
  const stack: string[] = [];
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === ")" || c === "}" || c === "]") {
      if (stack.pop() !== c) throw new Error(`unbalanced at ${i}`);
      if (stack.length === 0) return i;
    }
  }
  throw new Error("unclosed");
}

type Notice = { line: number; at: number; expression: string };

/**
 * Every ?error an action writes: what it encodes into a ?error redirect, and
 * what it hands a fail() helper (promo-actions and email-actions redirect
 * through one).
 */
function notices(source: string): Notice[] {
  return [...source.matchAll(/\?error=\$\{encodeURIComponent\(|\bfail\(/g)]
    .map((m) => {
      const open = m.index + m[0].length - 1;
      return {
        line: source.slice(0, m.index).split("\n").length,
        at: m.index,
        expression: source.slice(open + 1, closing(source, open)).trim(),
      };
    })
    .filter((n) => n.expression !== "msg"); // the fail() helpers themselves
}

/** The if or catch block around `at`, from its opening brace up to `at`; null if the block is anything else. */
function ifOrCatchBlock(source: string, at: number): string | null {
  let depth = 0;
  for (let i = at; i >= 0; i--) {
    const c = source[i];
    if (c === "}") depth++;
    else if (c === "{") {
      if (depth > 0) {
        depth--;
        continue;
      }
      let j = i - 1;
      while (/\s/.test(source[j])) j--;
      if (source[j] !== ")") return null;
      for (let parens = 0; j >= 0; j--) {
        if (source[j] === ")") parens++;
        else if (source[j] === "(" && --parens === 0) break;
      }
      return /\b(?:if|catch)\s*$/.test(source.slice(0, j)) ? source.slice(i, at) : null;
    }
  }
  return null;
}

/** The texts an expression can put in ?error: its string literals, and its templates with each ${…} filled in. */
function textsIn(expression: string): string[] {
  const texts: string[] = [];
  for (let i = 0; i < expression.length; i++) {
    if (expression[i] === '"') {
      let j = i + 1;
      while (expression[j] !== '"') j += expression[j] === "\\" ? 2 : 1;
      texts.push(expression.slice(i + 1, j));
      i = j;
    } else if (expression[i] === "`") {
      let text = "";
      let j = i + 1;
      for (; expression[j] !== "`"; j++) {
        if (expression[j] === "$" && expression[j + 1] === "{") {
          j = closing(expression, j + 1);
          text += "x";
        } else text += expression[j];
      }
      texts.push(text);
      i = j;
    }
  }
  // Sentences only, not a code compared against (createPromoCode's "23505").
  return texts.filter((t) => /^[A-Za-z].{7}/.test(t));
}

describe("the generic line's promise, \"Details are in the server log\"", () => {
  // A notice that carries a caught error's text shows as the generic line,
  // or as a summary that also points to the server log. That is only true if
  // the action logged the error first, inside the same if or catch block: a
  // log above the if would fire when nothing failed, one after the redirect
  // never runs. Found 2026-09-19: of these thirty, only deleteUser's logged.
  it.each(ACTION_FILES)("holds for every notice built from an error in lib/admin/%s", (file) => {
    const source = code(file);
    // `message` outside a string literal: error.message, rowError.message, or
    // the message of a caught Stripe error.
    const carried = notices(source).filter((n) =>
      /\bmessage\b/.test(n.expression.replace(/"(?:[^"\\]|\\.)*"/g, '""')),
    );
    expect(carried.length).toBeGreaterThan(0);
    const unlogged = carried
      .filter((n) => !ifOrCatchBlock(source, n.at)?.includes("console.error("))
      .map((n) => `${file}:${n.line}`);
    expect(unlogged).toEqual([]);
  });
});

describe("a promo code deletion that fails after Stripe let go of the code", () => {
  // By the row delete, the promotion code is switched off in Stripe and its
  // coupon deleted (2026-09-19). Deleting again gets past both:
  // lib/admin/promo-actions.test.ts.
  const promo = read("promo-actions.ts");
  const failed = promo.slice(promo.indexOf('const { error } = await supabase.from("promo_codes").delete().eq("id", id);'));

  it("says it can't be redeemed and deleting again clears it, not the generic line", () => {
    const notice = /encodeURIComponent\(\s*`([^`]*)`/
      .exec(failed)?.[1]
      ?.replace(/\$\{error\.message\}/, "canceling statement due to statement timeout");
    expect(notice).toBeDefined();
    const line = shown(notice!);
    expect(line).not.toBe(GENERIC);
    expect(line).toContain("switched off in Stripe and its coupon deleted");
    expect(line).toContain("can't be redeemed");
    expect(line).toContain("Delete it again");
    expect(line).not.toContain("statement timeout");
  });
});

describe("every notice an admin action writes reaches the page", () => {
  // A fixed notice missing from the banner's lists shows as the generic
  // line, "try again", with nothing in the server log. Found 2026-09-19:
  // thirteen, among them the Google Play guards on deleting and on comping
  // an account, the bonus credits that changed under the page and the blast
  // already in flight.
  it.each(ACTION_FILES)("holds for every fixed notice in lib/admin/%s", (file) => {
    const source = code(file);
    const texts = [
      ...notices(source).flatMap((n) => textsIn(n.expression)),
      // Built before the redirect: createPromoCode's rollbacks and
      // updateAppSetting's checks.
      ...[...source.matchAll(/\bfailMessage = (`[^`]*`)/g)].flatMap((m) => textsIn(m[1])),
      ...[...source.matchAll(/\?\s*null\s*:\s*("(?:[^"\\]|\\.)*"|`[^`]*`)/g)].flatMap((m) => textsIn(m[1])),
      // Spelled into the URL: ?error=Missing+model.
      ...[...source.matchAll(/\?error=([A-Za-z+]+)"/g)].map((m) => m[1].replaceAll("+", " ")),
    ];
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.filter((t) => shown(t) === GENERIC)).toEqual([]);
  });

  it("gives the identity threshold's range as identity-gate.ts sets it", () => {
    expect(read("actions.ts")).toContain(
      "`identity_gate_threshold must be a whole number from ${MIN_IDENTITY_THRESHOLD} to ${MAX_IDENTITY_THRESHOLD} (0 turns the gate off).`",
    );
    const message = `identity_gate_threshold must be a whole number from ${MIN_IDENTITY_THRESHOLD} to ${MAX_IDENTITY_THRESHOLD} (0 turns the gate off).`;
    expect(shown(message)).toBe(message);
  });
});
