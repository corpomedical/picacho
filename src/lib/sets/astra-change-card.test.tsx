import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import it_ from "../i18n/messages/it";
import { formatMsg } from "../i18n/format";
import raceTrack from "./fixtures-race-track.json";
import { astraCardKind, astraCardWords, astraTooBig } from "./astra-card";
import { SET_EDIT_MAX_CHARS, SET_EDIT_MAX_SPEC_CHARS } from "./set-config";
import { normaliseSetSpec } from "./set-spec";

// The Astra card (Helios Cut 2, step 1, 2026-09-25 — operator: "Run, keep
// going."): a change to the set itself waits on it for a press, in every
// mode, for every account (the owner's decision 1). It says what the press
// uses of the month in one of five sentences (§3.2 of the spec), and has no
// button when nothing could come of it. It quotes only what Astra will read.
//
// The component imports through "@/", which this suite does not resolve:
// those modules are the real ones, forwarded.

vi.mock("@/lib/i18n/format", async () => await import("../i18n/format"));
vi.mock("@/lib/sets/astra-card", async () => await import("./astra-card"));
vi.mock("@/lib/sets/set-config", async () => await import("./set-config"));

const { AstraChangeCard, creditsWord } = await import("../../components/sets/astra-change-card");

const WORDS = "add a row of flags along the pit wall";
const noop = () => {};
type Props = Parameters<typeof AstraChangeCard>[0];
const draw = (over: Partial<Props> = {}, copy = en.sets.reply, buildLabel = en.sets.editorOpen) =>
  renderToStaticMarkup(
    <AstraChangeCard
      words={WORDS}
      editsLeft={4}
      editsCap={4}
      tooBig={false}
      busy={false}
      shootCredits={null}
      onGo={noop}
      onNotNow={noop}
      copy={copy}
      buildLabel={buildLabel}
      {...over}
    />,
  );
/** The text a person reads: tags out, entities back. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const hasGo = (html: string) => html.includes("data-astra-go=");

describe("what the card says, and whether it offers the press", () => {
  const r = en.sets.reply;

  it("n changes left: the count, only if it saves", () => {
    const html = draw({ editsLeft: 4, editsCap: 4 });
    expect(text(html)).toContain(formatMsg(r.astraAsk, { n: 4, words: WORDS }));
    expect(text(html)).toContain("It uses 1 of your 4 changes left this month, only if it saves");
    expect(hasGo(html)).toBe(true);
    expect(html).toContain('data-astra-card="ask"');
  });

  it("the last one says so", () => {
    const html = draw({ editsLeft: 1, editsCap: 4 });
    expect(text(html)).toContain(formatMsg(r.astraAskLast, { words: WORDS }));
    expect(hasGo(html)).toBe(true);
  });

  it("an account with no monthly cap (an admin) says so — and only then", () => {
    const html = draw({ editsLeft: null, editsCap: -1 });
    expect(text(html)).toContain(formatMsg(r.astraAskOpen, { words: WORDS }));
    expect(hasGo(html)).toBe(true);
  });

  it("a count that could not be read never reads as 'no cap' (critic item 6)", () => {
    const html = draw({ editsLeft: null, editsCap: 4 });
    expect(text(html)).toContain(formatMsg(r.astraAskUnknown, { cap: 4, words: WORDS }));
    expect(text(html)).not.toContain("no monthly cap");
    expect(hasGo(html)).toBe(true);
  });

  it("none left, or a plan with none: no button, and the free tools named", () => {
    for (const [editsLeft, editsCap] of [
      [0, 4],
      [null, 0],
      [0, 0],
    ] as const) {
      const html = draw({ editsLeft, editsCap });
      expect(text(html), `${editsLeft}/${editsCap}`).toContain(formatMsg(r.astraNone, { build: en.sets.editorOpen, words: WORDS }));
      expect(hasGo(html), `${editsLeft}/${editsCap}`).toBe(false);
      expect(html).toContain("data-astra-not-now");
    }
  });

  it("a set too big for Astra to answer whole: no button", () => {
    for (const [editsLeft, editsCap] of [
      [4, 4],
      [null, -1],
    ] as const) {
      const html = draw({ editsLeft, editsCap, tooBig: true });
      expect(text(html)).toContain(formatMsg(r.astraTooBig, { build: en.sets.editorOpen, words: WORDS }));
      expect(hasGo(html)).toBe(false);
    }
  });

  it("waits while something else is out, but Not now never does", () => {
    const html = draw({ busy: true });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-astra-go="true"/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*data-astra-not-now="true"/);
  });

  it("offers 'Change it, then shoot' only with a price and a handler, and names the price", () => {
    expect(draw({ shootCredits: 1 })).not.toContain("data-astra-go-shoot");
    expect(draw({ onGoShoot: noop, shootCredits: null })).not.toContain("data-astra-go-shoot");
    expect(text(draw({ onGoShoot: noop, shootCredits: 1 }))).toContain("Change it, then shoot · 1 credit");
    expect(text(draw({ onGoShoot: noop, shootCredits: 3 }))).toContain("Change it, then shoot · 3 credits");
    // Never where the change itself cannot be pressed.
    expect(draw({ onGoShoot: noop, shootCredits: 1, editsLeft: 0 })).not.toContain("data-astra-go-shoot");
    expect(creditsWord(r, 1)).toBe("1 credit");
    expect(creditsWord(es.sets.reply, 2)).toBe("2 créditos");
  });

  it("the kind follows the same rules the component uses", () => {
    expect(astraCardKind({ editsLeft: 3, editsCap: 4, tooBig: false })).toBe("ask");
    expect(astraCardKind({ editsLeft: 1, editsCap: 4, tooBig: false })).toBe("askLast");
    expect(astraCardKind({ editsLeft: null, editsCap: -1, tooBig: false })).toBe("askOpen");
    expect(astraCardKind({ editsLeft: null, editsCap: 2, tooBig: false })).toBe("askUnknown");
    expect(astraCardKind({ editsLeft: 0, editsCap: 2, tooBig: true })).toBe("none");
    expect(astraCardKind({ editsLeft: 2, editsCap: 2, tooBig: true })).toBe("tooBig");
  });
});

describe("the card quotes only what Astra will read (check of the spec, item 9)", () => {
  it("cuts a long message to Astra's 300 characters and says it did", () => {
    const long = `${"make the barriers brick red and ".repeat(15)}and the end`;
    expect(long.length).toBeGreaterThan(SET_EDIT_MAX_CHARS);
    const { quoted, cut } = astraCardWords(long);
    expect(Array.from(quoted).length).toBeLessThanOrEqual(SET_EDIT_MAX_CHARS);
    expect(cut).toBe(true);
    const html = text(draw({ words: long }));
    expect(html).toContain(`“${quoted}”`);
    expect(html).not.toContain("and the end");
    expect(html).toContain(formatMsg(en.sets.reply.replyCutMessage, { n: SET_EDIT_MAX_CHARS }));
  });

  it("a message that fits is quoted whole, as editSetWithAstra cleans it, with no cut line", () => {
    expect(astraCardWords("  add   a lamp \n by the door ")).toEqual({ quoted: "add a lamp by the door", cut: false });
    expect(text(draw())).not.toContain(formatMsg(en.sets.reply.replyCutMessage, { n: SET_EDIT_MAX_CHARS }));
  });

  it("a person's own braces are never taken for a number", () => {
    expect(text(draw({ words: "call it {n} flags" }))).toContain("“call it {n} flags”");
  });
});

describe("the size test is editSetWithAstra's own", () => {
  it("is past the limit exactly when the action would refuse", () => {
    const n = normaliseSetSpec(raceTrack);
    if (!n.ok) throw new Error("fixture");
    expect(astraTooBig(n.spec)).toBe(JSON.stringify(n.spec).length > SET_EDIT_MAX_SPEC_CHARS);
    expect(astraTooBig(n.spec)).toBe(false);
    const big = { ...n.spec, description: "x".repeat(SET_EDIT_MAX_SPEC_CHARS) };
    expect(astraTooBig(big)).toBe(true);
  });
});

describe("every reply sentence in all four languages", () => {
  const catalogs = { en, es, pt, it: it_ };
  const holes = (v: string) => [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  it("the same keys and the same placeholders", () => {
    const keys = Object.keys(en.sets.reply).sort();
    for (const [locale, cat] of Object.entries(catalogs)) {
      expect(Object.keys(cat.sets.reply).sort(), locale).toEqual(keys);
      for (const key of keys) {
        const got = (cat.sets.reply as Record<string, string>)[key];
        const want = (en.sets.reply as Record<string, string>)[key];
        expect(got.trim().length, `${locale} ${key}`).toBeGreaterThan(0);
        expect(holes(got), `${locale} ${key}`).toEqual(holes(want));
      }
    }
  });

  it("each language's card leaves no placeholder unfilled", () => {
    for (const [locale, cat] of Object.entries(catalogs)) {
      for (const over of [
        { editsLeft: 4, editsCap: 4 },
        { editsLeft: 1, editsCap: 4 },
        { editsLeft: null, editsCap: -1 },
        { editsLeft: null, editsCap: 4 },
        { editsLeft: 0, editsCap: 4 },
        { editsLeft: 4, editsCap: 4, tooBig: true },
        { editsLeft: 4, editsCap: 4, onGoShoot: noop, shootCredits: 2 },
        { words: "x ".repeat(400) },
      ] as Partial<Props>[]) {
        const html = text(draw(over, cat.sets.reply, cat.sets.editorOpen));
        expect(html, `${locale} ${JSON.stringify(over)}`).not.toMatch(/\{\w+\}/);
      }
    }
  });
});
