import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The composer does not change under a send (found reviewing Helios, fixed
// 2026-09-18). Where a message went was read from a render closure while the
// Where chip, the Who chip, Ask first and Recreate all stayed live through a
// paid read of the message and a build — so a message could go to a place
// the chip no longer showed, Recreate's words were cleared unsent, and two
// Enters before the composer painted as busy started two builds.
// Read as source: the page needs a browser.

const home = readFileSync(join(__dirname, "../../components/sets/sets-home.tsx"), "utf8");
const send = home.slice(home.indexOf("  async function send() {"), home.indexOf("\n  }\n", home.indexOf("  async function send() {")));

describe("sending a message from the Sets home", () => {
  it("reads where it goes once, and holds a ref the moment it starts", () => {
    expect(home).toContain("const sendingRef = useRef(false);");
    expect(send).toContain("if (!canSend || sendingRef.current) return;");
    expect(send).toContain("const toSet = setPick;");
    expect(send).toContain("router.push(threadHref(toSet, message));");
    // Held before the first await, and let go in the same finally.
    const held = send.indexOf("sendingRef.current = true;");
    expect(held).toBeGreaterThan(-1);
    expect(held).toBeLessThan(send.indexOf("await "));
    expect(send).toMatch(/finally \{\s*sendingRef\.current = false;\s*setStarting\(false\);\s*\}/);
  });

  it("holds every choice that decides where the message goes while it is out", () => {
    for (const chip of [
      'onClick={() => setMenu((m) => (m === "character" ? null : "character"))}',
      'onClick={() => setMenu((m) => (m === "set" ? null : "set"))}',
      "onClick={() => setAskFirst((v) => !v)}",
      "onClick={() => recreate(ex.prompt)}",
    ]) {
      const at = home.indexOf(chip);
      expect(at, chip).toBeGreaterThan(-1);
      expect(home.slice(at, at + 260), chip).toContain("disabled={submitting}");
    }
  });

  it("Recreate stands down rather than writing past the disabled composer", () => {
    const recreate = home.slice(home.indexOf("  function recreate(prompt: string) {"), home.indexOf("\n  }\n", home.indexOf("  function recreate(prompt: string) {")));
    expect(recreate).toContain("if (submitting) return;");
  });

  it("reloads a stale tab through the one shared guard, never on its own", () => {
    expect(home).not.toContain("window.location.reload()");
    expect(home).toContain("reloadForNewDeploy({ delayMs: 1800 })");
    expect(home).toContain('import { isStaleDeployError, reloadForNewDeploy } from "@/lib/stale-deploy";');
  });
});
