import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import itMsgs from "../i18n/messages/it";
import { quoteSend } from "../generations/quote";
import { stillQuoteInput } from "./take";

// A message sent from the Sets home never spends on arrival unless the
// person chose "Shoot without asking" there (Helios Cut 3, money fix,
// 2026-09-26). The home opens on the latest set now (step 6), so its round
// arrow is every returning person's way into a set, and the set's page runs
// the message the moment it arrives, with no press on that page. Until this
// fix a message whose words asked to shoot spent a still on arrival even in
// "Ask before shooting", behind a button that said no price. Now:
// - "Ask before shooting": the message frames the shot and stops; the frame
//   card's Shoot (v1), or the reply's [Shoot as it is · n] (reader v2), is
//   the priced press that spends;
// - "Shoot without asking": it may shoot a still on arrival, and the home's
//   button says "Shoot · 1 credit" before it is pressed, the set page's own
//   price for that still.
// Read as source where the page needs a browser; the plan's rule is unit
// tested in turn-plan.test.ts and its words in turn-reply.test.ts.

const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
const home = readFileSync(join(__dirname, "../../components/sets/sets-home.tsx"), "utf8");
const bodyOf = (source: string, signature: string, end = "\n  }\n") => {
  const at = source.indexOf(signature);
  expect(at, signature).toBeGreaterThan(-1);
  return source.slice(at, source.indexOf(end, at));
};

describe("the set's page: a home message spends on arrival only in Shoot without asking", () => {
  const send = bodyOf(view, '  async function send(text: string, opts?: { origin?: "build"; home?: boolean }) {');

  it("the arrival is sent as the home's, the build turn included", () => {
    const effect = view.slice(view.indexOf("if (!ready || !initialAsk || askedRef.current) return;"), view.indexOf("}, [ready, initialAsk]);"));
    expect(effect).toContain('void send(initialAsk, initialAskBuilt ? { origin: "build", home: true } : { home: true });');
  });

  it("reader v1: the home's message shoots only when Ask before shooting is off, whatever its words say", () => {
    expect(send).toContain('const held = opts?.home === true && askFirst && words.intent === "shoot";');
    expect(send).toContain(
      'if (opts?.home === true ? !askFirst : words.intent === "shoot" || !askFirst) await pressShoot(words.direction || direction);',
    );
    // One shot in send, and no other way to spend from it.
    expect(send.match(/pressShoot\(/g)).toHaveLength(1);
    expect(send).not.toMatch(/\bshoot\(|\btake\(|editSet\(/);
    // And the frame card says why nothing was shot.
    expect(view).toContain("note?.held ? s.reply.replyHomeHeld : null,");
  });

  it("reader v2: the turn carries `home` to the plan's decision, and a fall back to v1 keeps it", () => {
    const sendTurn = bodyOf(view, '  async function sendTurn(message: string, opts?: { origin?: "build"; source?: "message" | "retry"; home?: boolean }) {');
    expect(send).toContain("if (readerV2 && !readerOffRef.current) return sendTurn(message, opts);");
    expect(sendTurn).toContain("home: opts?.home === true,");
    expect(sendTurn).toContain('if (source === "message") void send(message, opts);');
    expect(view).toContain("const shot = ctx.paid\n      ? paidDecision(shown, ctx.paid)\n      : shootDecision(shown, { mode: state.mode, source: ctx.source }, { changed, cant: extraCant.length > 0, home: ctx.home === true });");
  });

  it("the plan holds it in Ask before shooting, and only there", () => {
    const plan = readFileSync(join(__dirname, "turn-plan.ts"), "utf8");
    expect(plan).toContain('if (after?.home && state.mode === "ask") held.push("home");');
  });

  it("the reason is said in every language", () => {
    for (const t of [en, es, pt, itMsgs]) expect(t.sets.reply.replyHomeHeld.trim().length).toBeGreaterThan(0);
    expect(en.sets.reply.replyHomeHeld).toContain("shot nothing");
  });
});

describe("the Sets home: the send to a set says its price whenever it can spend on arrival", () => {
  it("in Shoot without asking a picked set's button shows the still's price, the set page's own quote", () => {
    expect(home).toContain("const shootsOnArrival = setPick !== null && !askFirst;");
    expect(home).toContain("const stillCredits = quoteSend(stillQuoteInput()).totalCredits;");
    expect(home).toContain("const shootPrice = stillCredits === 1 ? s.shootButtonOne : formatMsg(s.shootButton, { n: stillCredits });");
    // The set page prices a still the same way, so the two can never say different numbers.
    expect(view).toContain("const quote = quoteSend(stillQuoteInput());");
    expect(view).toMatch(/quote\.totalCredits === 1\s*\?\s*s\.shootButtonOne\s*:\s*formatMsg\(s\.shootButton, \{ n: quote\.totalCredits \}\)/);
    expect(quoteSend(stillQuoteInput()).totalCredits).toBeGreaterThan(0);
  });

  // Review of Cut 3 (money lens): a new place built in "Shoot without
  // asking" is shot on arrival too (the arrival runs as the home's), so the
  // build button names that still after the build.
  it("names the still a new place is shot with on arrival in Shoot without asking", () => {
    expect(home).toContain("const buildShoots = setPick === null && !askFirst && !starting && !atCap;");
    // The build's own message goes to the new set with the mode it was sent in.
    expect(home).toContain("router.push(threadHref(res.id, message, true));");
    expect(home).toContain('if (!askFirst) q.set("askFirst", "0");');
    // And the set's page shoots it on arrival only then.
    expect(view).toContain('void send(initialAsk, initialAskBuilt ? { origin: "build", home: true } : { home: true });');
    expect(view).toContain("if (opts?.home === true ? !askFirst : words.intent === \"shoot\" || !askFirst) await pressShoot(words.direction || direction);");
  });

  it("shows it as words beside the arrow, and names the button by it", () => {
    // Step 6a draws the button's words beside the arrow at every width: the build's, or this price.
    expect(home).toContain(
      "const sendWords = setPick === null ? (buildShoots ? `${buildLabel} · ${shootPrice}` : buildLabel) : shootsOnArrival ? shootPrice : null;",
    );
    // With nothing to spend, the arrow is named for what it does (review of Cut 3): it frames, and shoots nothing.
    expect(home).toContain("const sendLabel = sendWords ?? s.frameInSet;");
    expect(home).not.toContain("sendWords ?? s.shootHere");
    for (const t of [en, es, pt, itMsgs]) expect(t.sets.frameInSet.trim().length).toBeGreaterThan(0);
    expect(en.sets.frameInSet).toContain("nothing is shot until you press Shoot");
    const button = home.slice(home.indexOf("{sendWords !== null && ("), home.indexOf("<SendIcon", home.indexOf("{sendWords !== null && (")));
    expect(button).toContain("{sendWords}");
    expect(button).toContain("title={sendLabel}");
    expect(button).toContain("aria-label={sendLabel}");
  });
});
