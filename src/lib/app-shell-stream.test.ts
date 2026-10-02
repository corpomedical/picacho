import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { serverTimer } from "./server-timing";

// The /app frame sends at once (2026-09-30, operator: "Speed up the loading" · "measure it"): the layout awaits
// only who this is and which frame they use; the chrome's reads (profile, jobs, flags, counts, the lamp)
// stream in their own Suspense, so a page's first paint — the Studio's "Opening the set…" — never waits on them.

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");
const layout = read("src/app/app/layout.tsx");
const body = layout.slice(layout.indexOf("export default async function AppLayout("));
// The studio frame, inside the account menu's provider (2026-10-02).
const frame = body.slice(body.lastIndexOf("  return (\n    <AccountMenuProvider>\n    <div className=\"frost-ground"));

describe("the /app layout streams its frame", () => {
  it("awaits only the session, the two-step check and the frame's mode before sending the frame", () => {
    const beforeFrame = body.slice(0, body.indexOf("if (appMode === \"light\" || needsChoice) {"));
    const awaited = [...beforeFrame.matchAll(/await ([^\n;]+)/g)].map((m) => m[1]);
    expect(awaited).toHaveLength(3);
    expect(awaited[0]).toContain("createClient()");
    expect(awaited[1]).toContain('tm.step("auth", () => verifiedClaims(supabase))');
    expect(awaited[2]).toContain("Promise.all([");
    expect(beforeFrame).toContain('tm.step("aal"');
    expect(beforeFrame).toContain('tm.step("mode"');
    // Nothing from the chrome is awaited on the way to the frame.
    for (const late of ["loadChrome(", "readToolGates(", "isVoiceModeEnabled(", "producerVisible(", "isAlyChatEnabled(", "readProducerGrant(", "count: \"exact\""]) {
      expect(beforeFrame, late).not.toContain(late);
    }
    expect(frame).not.toContain("await ");
    expect(frame).toContain("<Suspense fallback={<ChromeSpace />}>\n        <AppChrome userId={userId} email={email} />\n      </Suspense>");
    expect(frame.indexOf("<AppChrome")).toBeLessThan(frame.indexOf("{children}"));
  });

  it("never asks the auth server on the way (the proxy's own locally verified claims), and redirects a missing session before anything is sent", () => {
    expect(body).not.toContain("auth.getUser(");
    const redirectAt = body.indexOf('redirect("/login")');
    expect(redirectAt).toBeGreaterThan(body.indexOf("verifiedClaims(supabase)"));
    expect(redirectAt).toBeLessThan(body.indexOf("return ("));
    expect(body).toContain('const userId = typeof claims?.sub === "string" ? claims.sub : null;\n  if (!userId) {\n    redirect("/login");');
    // The two-step gate still stands before the frame.
    expect(body.indexOf('redirect("/verify-2fa")')).toBeLessThan(body.indexOf("return ("));
    // And the proxy still checks the session and the suspension on every /app request.
    const proxy = read("src/lib/supabase/middleware.ts");
    expect(proxy).toContain("await supabase.auth.getClaims()");
    expect(proxy).toContain('if (profile?.status === "suspended")');
  });

  it("the app's chrome is read in one place, for both frames", () => {
    expect(layout.match(/async function loadChrome\(/g)).toHaveLength(1);
    expect(layout).toContain("const c = await loadChrome(supabase, userId, tm);");
  });
});

describe("server timings, for our own measurement", () => {
  it("say step names and milliseconds only, in the Server-Timing format", async () => {
    const tm = serverTimer("layout");
    await tm.step("auth", async () => 1);
    await tm.step("mode", () => 2);
    await expect(tm.step("fails", async () => { throw new Error("x"); })).rejects.toThrow("x");
    await tm.step("not a name!", async () => 3);
    expect(tm.value()).toMatch(/^layout\.auth;dur=\d+, layout\.mode;dur=\d+, layout\.fails;dur=\d+, layout\.step;dur=\d+, layout\.total;dur=\d+$/);
  });
  it("are written where each timed part renders, and the proxy's ride the real header", () => {
    expect(layout).toContain("<ServerTimingMark value={tm.value()} />");
    expect(read("src/app/app/sets/[id]/page.tsx")).toContain("<ServerTimingMark value={tm.value()} />");
    expect(read("src/lib/supabase/middleware.ts")).toContain('supabaseResponse.headers.set("Server-Timing", timing.join(", "));');
    expect(read("src/components/server-timing-mark.tsx")).toContain("<template data-server-timing={value} />");
  });
});
