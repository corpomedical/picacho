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

  it("the only take() calls are the priced Take buttons, a generic Shoot's person's take and the due shot (pin #9)", () => {
    const calls = view.match(/[^\n]*\btake\([^\n]*/g) ?? [];
    const callers = calls.filter((line) => !line.includes("async function take(") && !line.trim().startsWith("//") && !line.trim().startsWith("*"));
    expect(callers.map((line) => line.trim())).toEqual([
      // The due shot: a decision the plan made (a take only when the PERSON set it up), or a priced "Do it and take".
      'void (due.kind === "take" ? take(undefined, opts) : shoot(undefined, [], opts)).then((sent) => {',
      // The reply's [Take · n] and [Shoot as it is · n], each spending exactly what its label says.
      "void take();",
      'void (action.press === "take" ? take() : shoot());',
      // A generic Shoot: the person's own take only (pressFor "shoot").
      'return pressFor("shoot", { takeStart, takeEngine, credits: pageCredits }).kind === "take" ? take(directionNow) : shoot(directionNow);',
      // The frame card's and the bar's buttons, labelled with the take's own price.
      "onClick={() => void (takeStart ? take() : shoot())}",
      "onClick={() => void (takeStart ? take() : shoot())}",
    ]);
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

// The turn engine (Helios Cut 2, step 11a): one reading, one plan, run with
// the page's own handlers in the plan's order, said from what it reached.
describe("the chat's turn engine", () => {
  const sendTurn = bodyOf('  async function sendTurn(message: string, opts?: { origin?: "build"; source?: "message" | "retry" }) {');
  const runTurn = bodyOf("  function runTurn(reading: ShotReading | null, ctx: TurnContext): number | null {");
  const undoTurn = bodyOf("  async function undoTurn(ctx: TurnContext, plan: TurnPlan | null) {");
  const replyAction = bodyOf("  function replyAction(turn: ChatTurn, action: ReplyAction) {");
  const goAstra = bodyOf("  function goAstra(turn: ChatTurn, thenShoot: boolean) {");
  const restore = bodyOf("  function restoreTurnState(st: TurnState) {");
  const notStarted = bodyOf("  function dueNotStarted(due: ShootDue) {");

  it("runs for reader v2's accounts only, and hands back to v1 when the server says off", () => {
    const send = bodyOf('  async function send(text: string, opts?: { origin?: "build" }) {');
    const v2 = send.indexOf("if (readerV2 && !readerOffRef.current) return sendTurn(message, opts);");
    expect(v2).toBeGreaterThan(send.indexOf("if (!message || reading || shooting || editingSet || !ready) return;"));
    expect(v2).toBeLessThan(send.indexOf("await readShotWords("));
    expect(sendTurn).toContain('if (res?.why === "off") {');
    expect(sendTurn).toContain("readerOffRef.current = true;");
    const page = readFileSync(join(__dirname, "../../app/app/sets/[id]/page.tsx"), "utf8");
    expect(page).toContain("readerV2={data.readerV2}");
  });

  it("sends nothing while anything else is out, and reads once", () => {
    expect(sendTurn).toContain("if (reading || shooting || editingSet || following !== null || !ready || !api) return;");
    expect(sendTurn.match(/readShotTurn\(/g)).toHaveLength(1);
    expect(sendTurn).toContain("res = await readShotTurn(setId, { text: message, now, turns: lastTurns, ...(opts?.origin ? { origin: opts.origin } : {}) });");
    // A read that throws is a reading that failed: nothing changes (decision 2).
    expect(sendTurn).toContain('why: res ? res.why : "down",');
    // The page's NOW: the set's camera only while the view is still it; the third the page keeps.
    expect(sendTurn).toContain("cameraId,");
    expect(sendTurn).toContain("frameX: frameXRef.current,");
    expect(sendTurn).toContain(".slice(-READER_CONTEXT_MAX.turns)");
  });

  it("never shoots or takes from inside a turn: one decision, one id, through shootDue (pin #9)", () => {
    for (const [name, body] of [
      ["sendTurn", sendTurn],
      ["runTurn", runTurn],
      ["undoTurn", undoTurn],
      ["restoreTurnState", restore],
      ["goAstra", goAstra],
      ["dueNotStarted", notStarted],
    ] as const) {
      expect(body, name).not.toMatch(/\bshoot\(|\btake\(|pressShoot\(/);
    }
    const decided = runTurn.indexOf("const shot = shootDecision(shown, { mode: state.mode, source: ctx.source }, { changed, cant: extraCant.length > 0 });");
    const due = runTurn.indexOf('if (shot.kind !== "none") setShootDue({ pressId: newPressId(), kind: shot.kind, turnId: id });');
    expect(decided).toBeGreaterThan(-1);
    expect(due).toBeGreaterThan(decided);
    expect(runTurn.match(/newPressId\(\)/g)).toHaveLength(1);
    expect(runTurn.match(/setShootDue\(/g)).toHaveLength(1);
  });

  it("runs the plan's steps with the page's handlers, the stage written at once", () => {
    expect(runTurn).toContain("const plan = planTurn(reading, state);");
    expect(runTurn).toContain("for (const step of plan.steps) {");
    // The rig this turn set is read at once by the size solve, the thirds and a lens.
    expect(runTurn).toContain("rigRef.current = { ...rigRef.current, ...patch };");
    // The figure first: the camera's solve and matchTo read where it stands.
    expect(runTurn).toContain("api.placeMark(m);");
    // The light is aimed from where the camera ENDED (step 11 after step 8).
    expect(runTurn).toContain("const { patch } = lookPatch(step, now.rig, bearingDeg(now.mark, { x: camXz()[0], z: camXz()[1] }));");
    // The thirds through the Match solver: the band only when off centre, the words' own frame otherwise.
    expect(runTurn).toContain("const framed = framedMatch(match, frameX, { bandAspect: band.bandAspect, heightShare: band.heightShare });");
    expect(runTurn).toContain("...(framed.frame ? { frame: framed.frame } : {}),");
    expect(runTurn).toContain("referenceAspect: 1,");
    // A take the chat sets up is the chat's: only a priced Take renders it.
    expect(runTurn).toContain('const start: TakeStart = { id: step.still.id, n: step.still.n, armedBy: "chat" };');
    // Chips are what the stage reached.
    expect(runTurn).toContain("const reached = cameraSpotOf(now.camera, now.mark);");
    // The reply is said from what the steps reached (turn-reply.ts), never as planned.
    expect(runTurn).toContain("reply: composeReply(shown, outcomes, facts, replyWords)");
  });

  it("keeps each turn to undo, and Undo never asks Astra or the reader, and never refunds (rule 5)", () => {
    expect(runTurn).toContain("turnUndoRef.current = [...turnUndoRef.current, { turnId: id, before, after: { ...now }, stillShot: shot.kind !== \"none\" }].slice(-TURN_UNDO_MAX);");
    expect(undoTurn).toContain("const u = undoPlan(stack, current, top?.astra ? specBeforeEditRef.current === top.astra.before : false);");
    expect(undoTurn).toContain("const back = await undoSetEdit(true);");
    for (const call of ["editSetWithAstra(", "editSet(", "rebuildThingFromPhotos(", "readShotTurn(", "readShotWords("]) expect(undoTurn, call).not.toContain(call);
    // A landed Astra change joins its turn, with the seal its Undo sends.
    expect(goAstra).toContain('const astra = { before: r.before, undo: r.undo, kind: "edit" as const, landed: true };');
  });

  it("runs Do it, a which-one and Use the hour as button turns: no reading, no shot (rule 6)", () => {
    expect(view).toContain('const TURN_BUTTON: TurnContext = { source: "button", why: "ok", dropped: [], messageCut: false, origin: null, aliases: NO_ALIASES, asked: null };');
    expect(replyAction).not.toContain("readShotTurn(");
    expect(replyAction).toContain("if (r) runTurn(r, button);");
    expect(replyAction).toContain("if (need && turn.plan.reading) runTurn(resolveWhich(turn.plan.reading, need, action.key), button);");
    expect(replyAction).toContain("runTurn(USE_HOUR_READING, button);");
    // Try again is a message turn read again that never shoots; "Use my words" only sets the words.
    expect(replyAction).toContain('if (turn.asked !== null) void sendTurn(turn.asked, { source: "retry" });');
    expect(replyAction).toContain("if (turn.asked !== null) wordsAsHappens(turn.asked);");
    // Only the newest turn's buttons act, and none while anything is out.
    expect(replyAction).toContain("if (reading || shooting || editingSet || matching || following !== null || !ready) return;");
    expect(replyAction).toContain('if (!newest || newest.id !== turn.id || (turn.settled && action.kind !== "undo")) return;');
  });

  it("spends on a reply's paid button exactly what its label says, or nothing (rule 7)", () => {
    for (const [kind, check] of [
      ["doItShoot", "if (price !== action.credits) {"],
      ["take", "if (pageCredits.take[takeEngine] !== action.credits) {"],
      ["shootAsIs", 'if (price !== action.credits || (action.press === "take" && !takeStart)) {'],
      // "Change it, then shoot" on the card says the still's price (step 11b).
      ["astraGoShoot", 'if (action.kind === "astraGoShoot" && action.credits !== pageCredits.still) {'],
    ] as const) {
      const at = replyAction.indexOf(`case "${kind}"`);
      expect(at, kind).toBeGreaterThan(-1);
      const branch = replyAction.slice(at);
      // The price is checked first; a price that moved says it again and spends nothing.
      const checked = branch.indexOf(check);
      expect(checked, kind).toBeGreaterThan(-1);
      expect(branch.indexOf("repriceTurn(turn);"), kind).toBeGreaterThan(checked);
      const spent = Math.min(...["take()", "shoot()", "setShootDue(", "goAstra("].map((c) => branch.indexOf(c)).filter((i) => i > -1));
      expect(branch.indexOf("repriceTurn(turn);"), kind).toBeLessThan(spent);
    }
    // "Do it and shoot/take": the row runs as a button turn, then its own id is minted for the shot.
    expect(replyAction).toContain("if (at !== null) setShootDue({ pressId: newPressId(), kind, turnId: at });");
  });

  it("presses an Astra change only on its card: the words, the reading, where things stand (rule 1, pin #1)", () => {
    // The definition, v1's card, and the chat's card through goAstra.
    expect(view.match(/\beditSet\(/g)).toHaveLength(3);
    // The gloss rides with the server's seal on it, or the server drops it (review of Cut 2, R1).
    expect(goAstra).toContain("void editSet({ said: need.said, gloss: need.gloss, seal: need.seal }, frame, then).then((r) => {");
    expect(goAstra).toContain("const then = thenShoot ? { pressId: newPressId(), turnId: turn.id } : undefined;");
    expect(goAstra).toContain("if (!need || !need.canGo || editingSet) return;");
    expect(view.match(/\bgoAstra\(/g)).toHaveLength(2);
    expect(replyAction).toContain('goAstra(turn, action.kind === "astraGoShoot");');
    // The card on a turn presses through the reply's own actions (drawn inside the reply since step 11b).
    const card = between(view, "astraCard={", "/>");
    expect(card).toContain('onGo={() => replyAction(tn, { kind: "astraGo" })}');
    expect(card).toContain('onNotNow={() => replyAction(tn, { kind: "notNow" })}');
    expect(card).toContain("shootCredits={card.shootCredits}");
  });

  it("says a decided shot that could not start, with Shoot as it is at its price, and never a card again", () => {
    expect(view).toContain("if (!sent) dueNotStarted(due);");
    expect(notStarted).toContain('needs: x.plan.needs.filter((n) => n.kind === "take" || n.kind === "takeFormat")');
    expect(notStarted).toContain('{ kind: "shootAsIs", press: due.kind, credits: n, label }');
  });
});

// The reply and the composer (Helios Cut 2, step 11b): each turn drawn by
// astra-reply.tsx (its own test holds the prices on every button), the "/"
// menu built from ⌘K's own context, the counter, the placeholder, the
// empty send saying what it charges, and the frame card's dot and hour.
describe("the reply and the composer (step 11b)", () => {
  it("draws every turn through AstraReply, its buttons pressed through replyAction", () => {
    const turnsJsx = between(view, "{v2On &&\n                turns.map((tn) => {", "{/* An Astra edit of the set, landed: how much of it changed. */}");
    expect(turnsJsx).toContain("<AstraReply");
    expect(turnsJsx).toContain("onAction={(action) => replyAction(tn, action)}");
    expect(turnsJsx).toContain("compact={!newest}");
    expect(turnsJsx).toContain("following={following ? followingLine : null}");
    // The page asks the reply's own question before it draws a turn at all.
    expect(turnsJsx).toContain("const said = shownLines(tn.reply, { compact: !newest, open: newest && !tn.settled }).length > 0;");
    // No button of the page's own inside a turn: the reply and the card draw them.
    expect(turnsJsx).not.toMatch(/<button\b/);
    // On reader v2 the reply says what v1's lead line said.
    expect(view).toContain("const frameLead = v2On\n    ? \"\"");
  });

  it("lists ⌘K's own commands under \"/\", from one shared context: the Shoot row at its price, through pressShoot", () => {
    const ctx = between(view, "const commandContext = (): ShootCommandContext => ({", "\n  });\n");
    expect(ctx).toContain("shootNow: pressLabel,");
    expect(ctx).toContain("shoot: () => void pressShoot(),");
    expect(view).toContain("const paletteCommands = paletteOpen ? shootCommands(commandContext()) : [];");
    expect(view).toContain('const slashQuery = v2On && !slashOff && draft.startsWith("/") && !draft.includes("\\n") ? draft.slice(1) : null;');
    expect(view).toContain("filterCommands(slashQuery, shootCommands(commandContext()), s.palette.groups).slice(0, SLASH_ROWS)");
    // A pick runs the command: free, never read, never sent as words.
    const run = bodyOf("  function runSlash(i: number) {");
    expect(run).toContain("c.run();");
    for (const call of ["readShotTurn(", "readShotWords(", "send(", "sendTurn(", "shoot(", "take("]) expect(run, call).not.toContain(call);
    // Enter and the send button pick the row while the menu is open.
    expect(view.match(/else if \(slashQuery !== null\) runSlash\(slashPick\);/g)).toHaveLength(2);
  });

  it("counts past 500 of the 600 the reader reads, and says what to write on reader v2", () => {
    expect(view).toContain("{v2On && draft.length > COMPOSER_COUNT_FROM && (");
    expect(view).toContain("formatMsg(s.reply.composerCount, { n: draft.length, max: SHOT_WORDS_MAX_CHARS })");
    expect(view).toContain("placeholder={reading ? s.threadReading : v2On ? s.reply.composerPlaceholder : s.threadPlaceholder}");
  });

  it("an empty send shoots, and says what and at what price, not only an arrow (rule 7)", () => {
    expect(view).toContain("const sendSaysPrice = v2On && !draft.trim() && !justTalk;");
    const send = between(view, "data-send-shoots={sendSaysPrice || undefined}", "</button>");
    expect(send).toContain(") : sendSaysPrice ? (");
    expect(send).toContain("pressLabel");
  });

  it("dots the frame card's rows the last message moved, and says the hour it set", () => {
    expect(view).toContain("frameRowsChanged(lastTurn.plan, lastTurn.outcomes)");
    for (const row of ['rowLabel(s.rowWho, "who")', 'rowLabel(s.rowWhere, "where")', 'rowLabel(s.rowCamera, "camera")', 'rowLabel(s.rig.rowLight, "light")', 'rowLabel(s.rig.rowTime, "time")', 'rowLabel(s.rowHappens, "happens")']) {
      expect(view, row).toContain(row);
    }
    expect(view).toContain("{v2On && rig.time !== null && (");
  });
});
