import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The set page's turn engine and its presses (Helios Cut 2, step 11a,
// 2026-09-25 — operator: "Run, keep going."), held as source because the
// page needs a browser and a stage. The money rules of spec §3.8 that live
// on the page:
// - rule 8: a shot the chat decides gets ONE press id, minted once, carried
//   in shootDue; the effect records the id and clears the due shot before it
//   calls; shoot() and take() mint an id only without one handed in, and
//   never send an id twice (pins #7 and #10);
// - rule 3: a take the chat set up renders only from a press priced as a
//   take — never from a message, a mode, an effect of the chat's own, or a
//   generic Shoot (pin #9, and the check of the spec, item 1);
// - rule 1: editSet only from an Astra card's press (pin #1).

const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
const bodyOf = (signature: string, end = "\n  }\n") => {
  const at = view.indexOf(signature);
  expect(at, signature).toBeGreaterThan(-1);
  return view.slice(at, view.indexOf(end, at));
};
const between = (source: string, from: string, to: string) => {
  const start = source.indexOf(from);
  expect(start, from).toBeGreaterThan(-1);
  const end = source.indexOf(to, start + from.length);
  expect(end, to).toBeGreaterThan(start);
  return source.slice(start, end);
};

describe("one decision, one press id (spec §3.8 rule 8)", () => {
  const effect = between(view, "const [shootDue, setShootDue] = useState<ShootDue | null>(null);", "}, [shootDue]);");

  it("fires a due shot from a timeout, never a frame, once per id, clearing it before the call (pin #7)", () => {
    expect(effect).toContain("const timer = setTimeout(() => {");
    expect(effect).toContain("}, SHOOT_DUE_MS);");
    expect(effect).toContain("return () => clearTimeout(timer);");
    expect(effect).not.toContain("requestAnimationFrame");
    const fired = effect.indexOf("if (firedRef.current.has(due.pressId)) return;");
    const recorded = effect.indexOf("firedRef.current.add(due.pressId);");
    const cleared = effect.indexOf("setShootDue(null);");
    const call = Math.min(effect.indexOf("take(undefined, opts)"), effect.indexOf("shoot(undefined, [], opts)"));
    expect(fired).toBeGreaterThan(-1);
    expect(recorded).toBeGreaterThan(fired);
    expect(cleared).toBeGreaterThan(recorded);
    expect(call).toBeGreaterThan(cleared);
    // The call carries the decision's own id.
    expect(effect).toContain("const opts = { pressId: due.pressId };");
    // Longer than the light's 60 ms rebuild, so the sketch is the lit frame.
    expect(view).toContain("const SHOOT_DUE_MS = 150;");
  });

  it("is declared after shoot() and take(), whose closures it calls", () => {
    expect(view.indexOf("const [shootDue, setShootDue] = useState<ShootDue | null>(null);")).toBeGreaterThan(view.indexOf("  async function take("));
    expect(view.indexOf("  async function take(")).toBeGreaterThan(view.indexOf("  async function shoot("));
  });

  it("shoot() and take() mint an id only without one handed in, and never send an id twice (pin #10)", () => {
    for (const [signature, flag] of [
      ["  async function shoot(directionNow?: string, push: RigCheckItem[] = [], opts?: { pressId?: string; outfit?: false }): Promise<boolean> {", "shooting"],
      [
        "  async function take(directionNow?: string, opts?: { pressId?: string; move?: FilmMove | null; textures?: FilmTexture[]; outfit?: false }): Promise<boolean> {",
        "taking",
      ],
    ] as const) {
      const body = bodyOf(signature);
      expect(body.match(/newPressId\(\)/g), signature).toHaveLength(1);
      const minted = body.indexOf("const pressId = opts?.pressId ?? newPressId();");
      const refused = body.indexOf("if (sentPressIdsRef.current.has(pressId)) return false;");
      const kept = body.indexOf("sentPressIdsRef.current.add(pressId);");
      expect(minted, signature).toBeGreaterThan(-1);
      expect(refused, signature).toBeGreaterThan(minted);
      expect(kept, signature).toBeGreaterThan(refused);
      // Recorded before the press is held, and held before anything is sent.
      expect(body.indexOf(`busy.${flag} = true;`), signature).toBeGreaterThan(kept);
      // Nothing can return between the record and the hold.
      expect(body.slice(kept, body.indexOf(`busy.${flag} = true;`)), signature).not.toContain("return");
    }
    expect(view).toContain("const sentPressIdsRef = useRef<Set<string>>(new Set());");
  });

  it("says whether a press was sent, so a decided shot that could not start is said", () => {
    const shoot = bodyOf("  async function shoot(");
    const take = bodyOf("  async function take(");
    for (const body of [shoot, take]) {
      // Every early way out says false; a press that was sent says true.
      expect(body).not.toMatch(/return;/);
      expect(body).toContain("return true;");
      expect(body).toContain("return sentAt !== null;");
    }
  });
});

describe("a take the chat set up renders only from a press priced as a take (rule 3, check item 1)", () => {
  it("knows who set a take up: the person's own button says so", () => {
    expect(view).toContain("const [takeStart, setTakeStart] = useState<TakeStart | null>(null);");
    expect(view).toContain('setTakeStart({ id: viewingShot.generationId, n: stillNumber(viewingShot), armedBy: "person" });');
  });

  it("every generic Shoot does what its label says, and never the chat's take", () => {
    // One answer for the label and the press (turn-plan.ts pressFor "shoot").
    expect(view).toContain('const genericPress = pressFor("shoot", { takeStart, takeEngine, credits: pageCredits });');
    const press = bodyOf("  function pressShoot(directionNow?: string): Promise<boolean> {");
    expect(press).toContain('pressFor("shoot", { takeStart, takeEngine, credits: pageCredits }).kind === "take" ? take(directionNow) : shoot(directionNow)');
    // ⌘K's row and label, the composer's empty Enter and its label, and v1's own shot.
    expect(view).toContain("shoot: () => void pressShoot(),");
    expect(view).toContain("shootNow: pressLabel,");
    expect(view).toContain("else if (!justTalk) void pressShoot();");
    expect(view).toContain("title={draft.trim() || justTalk ? s.threadPlaceholder : pressLabel}");
    expect(bodyOf('  async function send(text: string, opts?: { origin?: "build" }) {')).toContain("await pressShoot(words.direction || direction);");
  });

  it("the only take() calls are the priced Take buttons, the take's own retry and the due shot", () => {
    const calls = view.match(/[^\n]*\btake\((?!directionNow)[^\n]*/g) ?? [];
    const callers = calls.filter((line) => !line.includes("async function take(") && !line.trim().startsWith("//") && !line.trim().startsWith("*"));
    for (const line of callers) {
      const priced = line.includes("takeStart ? take() : shoot()") || line.includes('due.kind === "take" ? take(undefined, opts)');
      expect(priced, line).toBe(true);
    }
    // The two buttons that pick take() themselves are labelled with the take's own price.
    expect(view.split("takeStart ? take() : shoot()").length - 1).toBe(2);
    expect(view.split("{takeStart && !shooting ? formatMsg(s.takeButton, { n: takeCredits }) : shootLabel}").length - 1).toBe(2);
  });
});

describe("the camera and the thirds", () => {
  it("a lens is read against the rig as it is now, not this render's (critic item 11)", () => {
    const lens = bodyOf("  function pickLens(mm: number) {");
    expect(lens).toContain("fovForLens(mm, sensorHeightMm(rigRef.current.sensor, rigRef.current.format))");
    expect(lens).not.toContain("rig.sensor, rig.format");
  });

  it("a move by hand ends a third the chat set; a turn of the figure keeps it (check item 6)", () => {
    const keep = bodyOf("  function keepStage(gesture = false, movesFrame = true) {");
    expect(keep).toContain('if (movesFrame) frameXRef.current = frameXAfter(frameXRef.current, { kind: "hand" });');
    expect(view).toContain('stageTouchRef.current = () => keepStage(true, stageToolRef.current !== "turn");');
    expect(bodyOf("  function turn(delta: number) {")).toContain("keepStage(true, false);");
    // ⌘Z moves the stage by hand too.
    expect(bodyOf("  function stepStage(")).toContain('frameXRef.current = frameXAfter(frameXRef.current, { kind: "hand" });');
  });
});

describe("an Astra change is pressed on its card (rule 1)", () => {
  it("sends the words, the reading and the frame only when there are any, and shoots only once it saved", () => {
    const edit = bodyOf("  async function editSet(\n");
    expect(edit).toContain("then?: { pressId: string; turnId: number },");
    expect(edit).toContain("res = more ? await editSetWithAstra(setId, change.said, pressId, more) : await editSetWithAstra(setId, change.said, pressId);");
    // "Change it, then shoot": the still's id is the click's, set due inside apply — only on a saved change.
    const apply = between(edit, "const apply = (next: SetSpec, changed: number, undo: EditUndo | null = null) => {", "return { landed: true, before, undo };");
    expect(apply).toContain('if (then) setShootDue({ pressId: then.pressId, kind: "still", turnId: then.turnId });');
    expect(edit.match(/setShootDue\(/g)).toHaveLength(1);
    expect(edit).not.toMatch(/\bshoot\(|\btake\(/);
  });
});
