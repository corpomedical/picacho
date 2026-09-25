import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Nothing on the set page spends twice, and every button says what it
// spends (found reviewing Helios, 2026-09-17):
// - A message sent and then Shoot pressed while Astra read the words took
//   two stills: `send` shoots after its await, from a closure whose
//   `shooting` was false when it started. A ref, held the moment a call is
//   on its way, is what the second call reads.
// - The bar's "Shoot · 1 credit" submitted the composer, so with a take
//   armed it spent 3 or 13 credits under that label, and with a draft
//   typed it only read the words.
// - A word the reader had nothing to take from ("go") became the still's
//   direction, while the frame card still showed the one it replaced.
//
// Read as source: the page needs a browser to run.

const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
const bodyOf = (signature: string, end = "\n  }\n") => {
  const at = view.indexOf(signature);
  expect(at, signature).toBeGreaterThan(-1);
  return view.slice(at, view.indexOf(end, at));
};

describe("what the set page spends", () => {
  it("every paid call reads the busy ref, holds it as it goes and lets it go in its finally", () => {
    expect(view).toContain("const busyRef = useRef({ shooting: false, taking: false, editing: false, matching: false });");
    for (const [signature, flag] of [
      ["  async function shoot(", "shooting"],
      ["  async function take(", "taking"],
      ["  async function retryClip(", "taking"],
    ] as const) {
      const body = bodyOf(signature);
      expect(body, signature).toContain("const busy = busyRef.current;");
      expect(body, signature).toMatch(/if \([^)]*busy\.shooting \|\| busy\.taking \|\| busy\.editing \|\| busy\.matching/);
      // Held where nothing can return between it and the call…
      const held = body.indexOf(`busy.${flag} = true;`);
      expect(held, signature).toBeGreaterThan(-1);
      expect(body.slice(held, body.indexOf("setShooting(true);", held))).not.toContain("return;");
      // …and let go wherever the call ends.
      expect(body, signature).toContain(`busyRef.current.${flag} = false;`);
    }
    // An Astra change holds it too, so a shot cannot start under one.
    const edit = bodyOf("  async function editSet(");
    expect(edit).toContain("busyRef.current.editing = true;");
    expect(edit).toMatch(/finally \{\s*busyRef\.current\.editing = false;/);
  });

  it("nothing that spends is offered while Astra is reading or changing the set", () => {
    expect(view).toContain("const canShootNow = !(shooting || matching || reading || editingSet || !characterId || loadFailed || !ready);");
    // Every button that spends asks the same question.
    expect(view).toContain("disabled={!canShootNow}");
    expect(view).toContain("disabled={!canShootNow || Boolean(takeStart)}");
    expect(view).toContain("canShoot: canShootNow,");
    // And none of them asks the old one, which let a press through mid-read.
    expect(view).not.toMatch(/disabled=\{shooting \|\| matching \|\| !characterId/);
  });

  it("the bar's button does what the frame card's does, and says what it charges", () => {
    const bar = view.slice(view.indexOf("        primary={"), view.indexOf("        }\n      >"));
    expect(bar).toContain("onClick={() => void (takeStart ? take() : shoot())}");
    // While a take is out it says what it is doing, as Shoot does (review, 2026-09-25).
    expect(bar).toContain("{takeStart && !shooting ? formatMsg(s.takeButton, { n: takeCredits }) : shootLabel}");
    expect(bar).toContain("disabled={!canShootNow}");
    // The palette takes the take too, rather than shooting a still over it.
    expect(view).toContain("shoot: () => void (takeStart ? take() : shoot()),");
  });

  it("a word with nothing to frame keeps the direction the card shows", () => {
    const send = bodyOf("  async function send(");
    expect(send).toContain("take(words.direction || direction) : shoot(words.direction || direction)");
    expect(send).not.toContain("shoot(words.direction || message)");
    // The reader being down is the one case the message itself is the direction.
    expect(send).toMatch(/setDirection\(message\);[\s\S]*?take\(message\) : shoot\(message\)/);
  });
});
