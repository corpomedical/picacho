import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A phone's conversation folds (Helios Cut 3, step 2, 2026-09-26). Its fold
// button was `hidden … md:flex` inside a header drawn only below md, so a
// phone's chat could never be closed and the "Astra" chip that reopened it
// could never be reached. Now the button shows, folds the thread away and
// keeps the words box with its priced send on screen; a message unfolds it.
// Read as source, like the page's other tests.

const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
const between = (from: string, to: string) => {
  const at = view.indexOf(from);
  expect(at, from).toBeGreaterThan(-1);
  const end = view.indexOf(to, at);
  expect(end, to).toBeGreaterThan(at);
  return view.slice(at, end);
};
const header = between("\n  const chatHeader = (", "\n  const chatThread = (");
const phone = between("{!wide && (\n          <aside", "</aside>");

describe("the phone's conversation folds", () => {
  it("shows its fold button at every width the header is drawn", () => {
    const button = header.slice(header.indexOf("<button"), header.indexOf("</button>"));
    const cls = button.match(/className="([^"]*)"/)?.[1] ?? "";
    expect(cls).toContain("flex h-9 w-9");
    expect(cls.split(/\s+/)).not.toContain("hidden");
    expect(cls).not.toContain("md:flex");
  });

  it("folds and unfolds, and says which it will do", () => {
    expect(header).toContain("onClick={() => setChatOpen((v) => !v)}");
    expect(header).toContain("aria-expanded={chatOpen}");
    expect(header).toContain("title={chatOpen ? s.chatHide : s.palette.chatShow}");
    expect(header).toContain("aria-label={chatOpen ? s.chatHide : s.palette.chatShow}");
    expect(header).toContain('${chatOpen ? "rotate-90" : "-rotate-90"}');
  });

  it("folds the thread and keeps the header and the composer", () => {
    expect(phone).toContain("{chatHeader}");
    expect(phone).toContain("{chatOpen && chatThread}");
    expect(phone).toContain("{chatComposer}");
    // The composer is its own child, after the thread, never inside the condition.
    expect(phone.indexOf("{chatComposer}")).toBeGreaterThan(phone.indexOf("{chatOpen && chatThread}"));
  });

  it("keeps its designed height open and does not clip the composer's menus folded", () => {
    expect(phone).toContain('${chatOpen ? "h-[42%] overflow-hidden" : "overflow-visible"}');
  });

  it("drops the floating Astra chip only a phone could never reach", () => {
    expect(view).not.toContain("onClick={() => setChatOpen(true)} className={`absolute bottom-3.5 right-3.5 z-30");
  });

  it("says a refused or failed press while folded, where the frame card's error line is away", () => {
    // The one priced Shoot is the composer's empty send (pressShoot), which does not unfold:
    // folded, its errors lived only in the thread (review of Cut 3).
    expect(phone).toContain("{!chatOpen && (error || rigError) && (");
    expect(phone).toContain("{localizeServerText(error || rigError, t)}");
    expect(phone.indexOf("{!chatOpen && (error || rigError) && (")).toBeLessThan(phone.indexOf("{chatComposer}"));
  });

  it("unfolds when a message goes, so its answer shows", () => {
    const send = between("async function send(text: string", "\n  }\n");
    const guard = send.indexOf("if (!message || reading || shooting || editingSet || !ready) return;");
    const unfold = send.indexOf("if (!wide) setChatOpen(true);");
    expect(guard).toBeGreaterThan(-1);
    expect(unfold).toBeGreaterThan(guard);
    // Before reader v2's own turn, so both readers unfold.
    expect(unfold).toBeLessThan(send.indexOf("return sendTurn(message, opts);"));
  });
});
