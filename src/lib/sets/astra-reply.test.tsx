import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import raceTrack from "./fixtures-race-track.json";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import it_ from "../i18n/messages/it";
import type { Messages } from "../i18n/messages/en";
import { fovForLens } from "./build-scene";
import { NEW_SET_RIG } from "./rig";
import { normaliseSetSpec, type SetSpec } from "./set-spec";
import type { ShotReading } from "./shot-reading";
import { takesCredits } from "./take";
import { planTurn, shootDecision, type PageState, type PlanShot } from "./turn-plan";
import { composeReply, creditsLabel, plannedFacts, replyThingsOf, replyWordsOf, type ReplyAction, type ReplyFacts, type ReplyModel, type ReplyWords } from "./turn-reply";

// Astra's reply on the page (Helios Cut 2, step 11b, 2026-09-25 — operator:
// "Run, keep going."): the reply drawn as the spec's §5.1 lays it out, in
// the layout the owner picks, and every button that spends showing its
// price (money rule 7, pin #8), in every layout and every language.
//
// The components import through "@/", which this suite does not resolve:
// those modules are the real ones, forwarded.

vi.mock("@/lib/sets/turn-reply", async () => await import("./turn-reply"));
vi.mock("@/lib/i18n/format", async () => await import("../i18n/format"));
vi.mock("@/lib/sets/astra-card", async () => await import("./astra-card"));
vi.mock("@/lib/sets/set-config", async () => await import("./set-config"));

const { AstraReply, ASTRA_REPLY_LAYOUT, REPLY_LAYOUTS, buttonCredits, replySections, saysItsPrice, shownLines } = await import("../../components/sets/astra-reply");
const { AstraChangeCard } = await import("../../components/sets/astra-change-card");

const specOf = (json: unknown): SetSpec => {
  const n = normaliseSetSpec(json);
  if (!n.ok) throw new Error("fixture");
  return n.spec;
};
const race = specOf(raceTrack);
const MARK = race.marks[0];
const EVA = "0b0f7c1e-3a44-4c2a-9d1e-6a1f2b3c4d5e";
const MARCO = "7d1e2f3a-4b5c-4d6e-8f70-819203a4b5c6";
const CREDITS = {
  still: takesCredits("omni", { clips: 0, stills: 1 }),
  take: { omni: takesCredits("omni", { clips: 1, stills: 1 }), veo: takesCredits("veo", { clips: 1, stills: 1 }) },
};
const SHOTS: PlanShot[] = [
  { generationId: "g-2", kind: "still", status: "succeeded", format: "wide", characterId: MARCO },
  { generationId: "g-1", kind: "still", status: "succeeded", format: "wide", characterId: EVA },
];
const CATALOGS: Record<string, Messages> = { en, es, pt, it: it_ };
const LOCALES = Object.keys(CATALOGS);
const WORDS: Record<string, ReplyWords> = Object.fromEntries(LOCALES.map((l) => [l, replyWordsOf(CATALOGS[l])]));

/** The race set as the spec's exchanges start: Marco on the chip, 4 Astra changes left of 4, 16:9. */
function stateOf(over: Partial<PageState> = {}): PageState {
  return {
    mode: "ask",
    source: "message",
    origin: null,
    why: "ok",
    dropped: [],
    messageCut: false,
    characterId: MARCO,
    characters: [
      { id: EVA, name: "Eva", hasPhoto: true, hasOutfit: false },
      { id: MARCO, name: "Marco", hasPhoto: true, hasOutfit: true },
    ],
    markId: "m1",
    pose: "stand",
    cameraId: "c2",
    frameX: "centre",
    rig: { ...NEW_SET_RIG },
    cameraBearingDeg: 35,
    direction: "",
    takeStart: null,
    takeMove: null,
    takeEngine: "omni",
    shots: SHOTS,
    filmOpen: false,
    editsLeft: 4,
    editsCap: 4,
    tooBig: false,
    credits: CREDITS,
    ...over,
  };
}

function factsOf(over: Partial<ReplyFacts>, words: ReplyWords): ReplyFacts {
  return {
    locale: "en",
    mode: "ask",
    characters: [
      { id: EVA, name: "Eva" },
      { id: MARCO, name: "Marco" },
    ],
    characterId: MARCO,
    marks: race.marks.map((m) => ({ id: m.id, label: m.label })),
    cameras: race.cameras.map((c) => ({ id: c.id, label: c.label })),
    things: replyThingsOf(race, MARK, words),
    markId: "m1",
    pose: "stand",
    facing: "camera",
    cameraId: "c2",
    frameX: "centre",
    rig: { ...NEW_SET_RIG },
    direction: "",
    lensMm: 50,
    distanceM: 2.4,
    spot: { spot: { bearingDeg: 35, distanceM: 2.4, heightM: 0.7, pitchDeg: 0, fovDeg: fovForLens(50) }, facingDeg: 0, sensorHeightMm: 24 },
    credits: CREDITS,
    takeEngine: "omni",
    takeFrom: 2,
    newestStill: 2,
    lastStill: { n: 2, status: "succeeded", score: 88 },
    editsLeft: 4,
    editsCap: 4,
    tooBig: false,
    producerOn: true,
    shot: null,
    ...over,
  };
}

/** A reading through the plan and the reply, said as planned, with the shot the plan decides. */
function modelOf(reading: ShotReading | null, state: Partial<PageState> = {}, locale = "en"): ReplyModel {
  const s = stateOf(state);
  const plan = planTurn(reading, s);
  const shot = shootDecision(plan, s);
  return composeReply(plan, null, plannedFacts(plan, factsOf({ mode: s.mode, shot, locale }, WORDS[locale])), WORDS[locale]);
}

/** Replies with every kind of button: priced presses, Do it rows, which-one, the card, not-yet buttons, the down line. */
const READINGS: [ShotReading | null, Partial<PageState>][] = [
  [{ size: "close_up", move: "push-in", textures: ["slow-motion"] }, {}],
  [{ shoot: true, cant: [{ code: "roll", said: "Dutch" }, { code: "film_beats", said: "then she drives off" }] }, {}],
  [{ idea: "A low sun behind him.", suggest: [{ size: "wide", rig: ["time:night"] }, { move: "orbit-90" }] }, {}],
  [{ suggest: [{ size: "wide" }] }, { takeStart: { id: "g-2", n: 2, armedBy: "person" } }],
  [{ rig: ["time:night"], pose: "sit", setChange: { said: "add a row of flags along the pit wall", gloss: null, cut: false } }, {}],
  [{ rig: ["time:night"] }, { mode: "talk" }],
  [{ steps: ["closer"] }, { mode: "auto", takeStart: { id: "g-2", n: 2, armedBy: "chat" } }],
  [{ ask: ["elsewhere", "lens", "cost"] }, {}],
  [null, { why: "down" }],
];

const noop = () => {};
type Props = Parameters<typeof AstraReply>[0];
const draw = (model: ReplyModel, over: Partial<Props> = {}, copy = en.sets.reply) =>
  renderToStaticMarkup(<AstraReply model={model} copy={copy} live settled={false} busy={false} onAction={noop} {...over} />);
/** The text a person reads: tags out, entities back. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
/** Every button drawn: its kind, its price attribute, and the words on it. */
const buttonsIn = (html: string) =>
  [...html.matchAll(/<button[^>]*data-reply-button="(\w+)"(?:[^>]*data-credits="(\d+)")?[^>]*>([^<]*)<\/button>/g)].map((m) => ({
    kind: m[1],
    credits: m[2] === undefined ? null : Number(m[2]),
    label: text(m[3]),
  }));
const PAID = new Set(["doItShoot", "doItTake", "take", "shootAsIs", "astraGoShoot"]);

describe("every button that spends shows its price, in every layout and language (rule 7, pin #8)", () => {
  it("draws each paid button with its credits in its words, and no free one with any", () => {
    let paid = 0;
    let free = 0;
    for (const l of LOCALES) {
      const copy = CATALOGS[l].sets.reply;
      for (const [reading, state] of READINGS) {
        const model = modelOf(reading, state, l);
        for (const layout of REPLY_LAYOUTS) {
          const html = draw(model, { layout }, copy);
          const drawn = buttonsIn(html);
          // Every button the reply carries (bar the card's, drawn by the card itself) is drawn.
          const carried = model.lines.filter((x) => x.kind !== "astra").flatMap((x) => x.buttons);
          expect(drawn.length, `${l} ${layout}`).toBe(carried.length);
          for (const b of drawn) {
            if (PAID.has(b.kind)) {
              paid += 1;
              expect(b.credits, `${l} ${layout} ${b.kind}`).not.toBeNull();
              expect(b.label, `${l} ${layout} ${b.kind}`).toContain(creditsLabel(copy, b.credits ?? -1));
            } else {
              free += 1;
              expect(b.credits, `${l} ${layout} ${b.kind}`).toBeNull();
              expect(b.label.includes(copy.creditOne), `${l} ${layout} ${b.kind}`).toBe(false);
            }
          }
        }
      }
    }
    expect(paid).toBeGreaterThan(40);
    expect(free).toBeGreaterThan(40);
  });

  it("never draws a paid button whose words don't say its price", () => {
    const model: ReplyModel = {
      lines: [
        {
          kind: "planned",
          text: "Here's what I'd do: Wide shot. Nothing moves until you press.",
          buttons: [
            { kind: "doIt", row: "plan", label: "Do it" },
            { kind: "doItShoot", row: "plan", credits: 1, label: "Do it and shoot" },
            { kind: "doItTake", row: "plan", credits: 4, label: "Do it and shoot the take · 1 credit" },
          ],
        },
      ],
      astra: null,
    };
    for (const layout of REPLY_LAYOUTS) expect(buttonsIn(draw(model, { layout })).map((b) => b.kind), layout).toEqual(["doIt"]);
    expect(saysItsPrice({ kind: "take", credits: 4, label: "Take · 4 credits" }, en.sets.reply)).toBe(true);
    expect(saysItsPrice({ kind: "take", credits: 4, label: "Take · 1 credit" }, en.sets.reply)).toBe(false);
    expect(saysItsPrice({ kind: "undo", label: "Undo" }, en.sets.reply)).toBe(true);
    // A price inside another is not the price (review of Cut 2, N2): "11 credits" never passes for 1 credit.
    expect(saysItsPrice({ kind: "shootAsIs", press: "still", credits: 1, label: "Shoot as it is · 11 credits" }, en.sets.reply)).toBe(false);
    expect(saysItsPrice({ kind: "shootAsIs", press: "still", credits: 1, label: "Shoot as it is · 1 credits" }, en.sets.reply)).toBe(false);
    expect(saysItsPrice({ kind: "shootAsIs", press: "still", credits: 1, label: "Shoot as it is · 1 credit" }, en.sets.reply)).toBe(true);
    expect(saysItsPrice({ kind: "take", credits: 4, label: "Take · 14 credits" }, en.sets.reply)).toBe(false);
    expect(buttonCredits({ kind: "astraGo" } as ReplyAction)).toBeNull();
  });

  it("presses a change to the set only on its card: the reply draws no Astra button of its own", () => {
    const model = modelOf({ setChange: { said: "add a row of flags along the pit wall", gloss: null, cut: false } });
    expect(model.astra).not.toBeNull();
    for (const layout of REPLY_LAYOUTS) {
      const bare = draw(model, { layout });
      expect(bare, layout).not.toContain('data-reply-button="astraGo');
      expect(bare, layout).not.toContain("data-astra-go");
      const card = (
        <AstraChangeCard words={model.astra?.said ?? ""} editsLeft={4} editsCap={4} tooBig={false} busy={false} shootCredits={1} onGo={noop} onGoShoot={noop} onNotNow={noop} copy={en.sets.reply} buildLabel={en.sets.editorOpen} />
      );
      const html = draw(model, { layout, astraCard: card });
      // The card says the month's changes beside its press, and its second button its price.
      expect(text(html), layout).toContain("It uses 1 of your 4 changes left this month, only if it saves");
      expect(html, layout).toContain("data-astra-go");
      expect(text(html), layout).toContain("Change it, then shoot · 1 credit");
    }
  });

  it("the source: one button, drawn only past the price check; the card's paid button says its credits", () => {
    const reply = readFileSync(join(__dirname, "../../components/sets/astra-reply.tsx"), "utf8");
    expect(reply.match(/<button\b/g)).toHaveLength(1);
    expect(reply).toContain("act ? line.buttons.filter((b) => (!settled || b.kind === \"undo\") && saysItsPrice(b, copy)) : []");
    const card = readFileSync(join(__dirname, "../../components/sets/astra-change-card.tsx"), "utf8");
    const goShoot = card.slice(card.indexOf("data-astra-go-shoot"), card.indexOf("</button>", card.indexOf("data-astra-go-shoot")));
    expect(goShoot).toContain("creditsWord(copy, shootCredits)");
    // "Change the set" only beside the sentence that says what it uses of the month.
    expect(card).toContain("{canGo && (");
    expect(card.indexOf("{line}")).toBeLessThan(card.indexOf("data-astra-go"));
  });
});

describe("what the reply shows, and when", () => {
  it("draws Done as ⌘K's own pills, then Undo", () => {
    const model = modelOf({ characterId: EVA, pose: "lean", rig: ["time:golden", "character:anamorphic"] });
    const html = draw(model);
    expect(html).toContain('data-astra-reply="stack"');
    const chips = [...html.matchAll(/data-reply-chip="true">([^<]*)</g)].map((m) => text(m[1]));
    expect(chips).toEqual(model.lines.find((l) => l.kind === "done")?.items?.chips);
    expect(chips).toContain("Time of day · Golden hour · 17:30");
    expect(text(html)).toContain("Done");
    expect(buttonsIn(html).map((b) => b.kind)).toEqual(["undo"]);
  });

  it("an answered turn keeps what it did and Undo; what waited for a press goes", () => {
    const model = modelOf({ steps: ["closer"] }, { mode: "auto", takeStart: { id: "g-2", n: 2, armedBy: "chat" } });
    const open = draw(model);
    expect(open).toContain('data-reply-section="needs"');
    const answered = draw(model, { settled: true });
    expect(answered).not.toContain('data-reply-section="needs"');
    expect(buttonsIn(answered).map((b) => b.kind)).toEqual(["undo"]);
    expect(shownLines(model, { compact: false, open: false }).some((l) => l.kind === "needs")).toBe(false);
  });

  it("an earlier turn keeps only what it did, with no buttons", () => {
    const model = modelOf({ size: "wide", cant: [{ code: "roll", said: "Dutch" }] });
    for (const layout of REPLY_LAYOUTS) {
      const html = draw(model, { compact: true, live: false, layout });
      expect(buttonsIn(html), layout).toEqual([]);
      expect(text(html), layout).toContain("Wide shot");
      expect(text(html), layout).not.toContain("Not yet");
    }
  });

  it("an earlier turn that did nothing keeps its answer in words, with no buttons", () => {
    const idea = modelOf({ idea: "Low and close lets the car loom behind her.", suggest: [{ size: "medium", height: "low" }] });
    const notYet = modelOf({ cant: [{ code: "camera_inside", said: "from inside the car" }] });
    for (const layout of REPLY_LAYOUTS) {
      const a = draw(idea, { compact: true, live: false, layout });
      expect(buttonsIn(a), layout).toEqual([]);
      expect(text(a), layout).toContain("Low and close lets the car loom behind her.");
      // The ways to try it waited for a press: they go.
      expect(text(a), layout).not.toContain("Medium shot");
      const b = draw(notYet, { compact: true, live: false, layout });
      expect(text(b), layout).toContain("Not yet");
      expect(buttonsIn(b), layout).toEqual([]);
    }
  });

  it("while a press is followed, says Cut 1's line in place of the shot line", () => {
    const model = modelOf({ shoot: true });
    expect(text(draw(model))).toContain("Shooting this frame · 1 credit.");
    const html = draw(model, { following: en.sets.pressFollowing });
    expect(text(html)).toContain(text(en.sets.pressFollowing));
    expect(text(html)).not.toContain("Shooting this frame");
  });

  it("holds every button while something else is out", () => {
    const html = draw(modelOf({ suggest: [{ size: "wide" }] }), { busy: true });
    const buttons = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(b).toContain("disabled");
  });

  it("gathers what a Needs line waits on under it, in the reply's own order", () => {
    const model = modelOf({ rig: ["time:night"], setChange: { said: "add flags", gloss: null, cut: false }, cant: [{ code: "roll", said: "Dutch" }] });
    const sections = replySections(model.lines);
    const kinds = sections.map((sec) => sec.kind);
    expect(kinds).toEqual(["said", "notYet", "needs"]);
    expect(sections[2].lines.map((l) => l.kind)).toEqual(["needs", "astra"]);
    // Nothing lost or moved: the sections read back as the reply.
    expect(sections.flatMap((sec) => sec.lines)).toEqual(model.lines);
  });

  it("draws the spec's §5.1 layout for everyone until the owner picks", () => {
    expect(ASTRA_REPLY_LAYOUT).toBe("stack");
    expect(REPLY_LAYOUTS).toContain(ASTRA_REPLY_LAYOUT);
  });
});
