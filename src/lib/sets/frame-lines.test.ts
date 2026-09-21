import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STAND_IN_EYE_M } from "./build-scene";

// The frame lines and the eyes on the set page ("This is a mess",
// 2026-09-17), read as source: the insets come from the chips and the
// strip that are really there, never from panels the studio frame retired;
// the eyes are the pose's.

const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
const actions = readFileSync(join(__dirname, "actions.ts"), "utf8");

describe("the frame lines", () => {
  it("are fitted below the setup chips and above the filmstrip, measured, and follow their size", () => {
    expect(view).toContain("const top = chips ? chips.offsetTop + chips.offsetHeight + 26 : 14;");
    expect(view).toContain("const bottom = strip && hostH ? hostH - strip.offsetTop + 10 :");
    expect(view).toContain("const ro = new ResizeObserver(measure);");
    expect(view).toContain("if (chipsRef.current) ro.observe(chipsRef.current);");
    expect(view).toContain("if (stripRef.current) ro.observe(stripRef.current);");
    // One swiping row in a phone's Film, wrapped everywhere else (film-phone-layout.test.ts).
    expect(view).toContain('<div ref={chipsRef} data-setup-chips className={`absolute left-3.5 right-3.5 top-3.5 z-20 ${chipsInRow ? "" : "flex flex-wrap items-center gap-2"}`}>');
    expect(view).toContain("ref={stripRef}");
  });

  it("no longer make room for the chat panel or the rig panel the frame retired", () => {
    expect(view).not.toContain("md:right-[404px]");
    expect(view).not.toContain("md:right-24");
    expect(view).not.toContain("chatOpen ? 406 : 96");
    // Nor for the rig: it is the dock's, beside the viewport, so the lines
    // no longer jump 342 px aside when the Rig chip is pressed (2026-09-17).
    expect(view).toContain("insetsRef.current = { left: 14, right: 14, top, bottom };");
    expect(view).not.toContain("wideNow && rigOpen ? 356");
  });
});

describe("the eyes", () => {
  it("are the pose's on the page — the readout, the bracket, the eye-line and the rays — and on the server's focus distance", () => {
    expect(view).not.toContain("FRAME_EYE_Y");
    expect(view).toContain("const eyeY = () => STAND_IN_EYE_M[standPose];");
    expect(view).toContain("standIn.setPose(p);\n            standPose = p;");
    expect(view).toContain("eyeHud.set(p.x, eyeY(), p.z);");
    expect(actions).not.toContain("RIG_EYE_Y");
    expect(actions).toContain("layout.camera.position[1] - STAND_IN_EYE_M[layout.pose],");
    // A standing figure's eyes are near the top of a 1.75 m figure; a seated one's well below.
    expect(STAND_IN_EYE_M.stand).toBeGreaterThan(1.6);
    expect(STAND_IN_EYE_M.sit).toBeLessThan(1.3);
  });
});
