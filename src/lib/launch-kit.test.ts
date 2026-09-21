import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PRICING_TIERS } from "./pricing";
import { PLAY_LISTING_LIVE, PLAY_STORE_URL } from "./play-listing";

// docs/LAUNCH_KIT.md is what gets pasted into Product Hunt, Reddit, X and the
// directories. The kit before it (PRODUCT_HUNT_KIT.md) went stale in three
// weeks: it waited for a Google Play approval, and it still said "failed
// generations never cost credits" and "a second model reviews" after the site
// had retracted both. Found 2026-09-20.
//
// This holds only the fenced blocks (the exact bytes that get pasted, never
// the notes around them) to the things that must stay true: the length limit
// each heading names, the prices in the pricing table, the canonical domain,
// and none of the claims the site has retracted or never made.

const kit = readFileSync(new URL("../../docs/LAUNCH_KIT.md", import.meta.url), "utf8");

type Block = { heading: string; max: number | null; text: string; line: number };

function blocks(md: string): Block[] {
  const out: Block[] = [];
  const lines = md.split("\n");
  let heading = "";
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^#{2,4} (.*)$/);
    if (h) {
      heading = h[1];
      continue;
    }
    if (lines[i].startsWith("```")) {
      const start = i;
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      const m = heading.match(/\(max (\d+)\)\s*$/);
      out.push({ heading, max: m ? Number(m[1]) : null, text: body.join("\n"), line: start + 1 });
    }
  }
  return out;
}

const all = blocks(kit);

describe("launch kit", () => {
  it("has its paste blocks, and every fence is closed", () => {
    expect(all.length).toBeGreaterThan(40);
    expect((kit.match(/^```/gm) ?? []).length % 2).toBe(0);
  });

  it("says when it was read from source", () => {
    expect(kit).toMatch(/read from source on 2026-\d{2}-\d{2}/);
  });

  it("keeps every block inside the length limit its heading names", () => {
    const limited = all.filter((b) => b.max !== null);
    expect(limited.length).toBeGreaterThan(20);
    for (const b of limited) {
      // Code points, not UTF-16 units, and every character counted: a link
      // is 23 on X, so this is the conservative reading.
      const length = [...b.text].length;
      expect(length, `"${b.heading}" (line ${b.line}) is ${length} characters, over ${b.max}`).toBeLessThanOrEqual(b.max as number);
    }
  });

  it("only quotes monthly prices the pricing table has", () => {
    const monthly = new Set<number>(PRICING_TIERS.map((t) => t.price));
    const annual = new Set<number>(PRICING_TIERS.map((t) => t.annualPrice));
    for (const b of all) {
      for (const m of b.text.matchAll(/\$(\d[\d,]*)(?:\/mo(?:nth)?| a month)/gi)) {
        const n = Number(m[1].replace(/,/g, ""));
        expect(monthly.has(n) || annual.has(n), `"${b.heading}" quotes $${n}/month, which is not a plan price`).toBe(true);
      }
    }
  });

  it("never brings back a claim the site retracted or never made", () => {
    const banned: [RegExp, string][] = [
      [/failed generations? (never|don'?t|do not)/i, "retracted 2026-08-30: say that refused requests never use credits"],
      [/second (model|ai)\b[^.]*\breview|two-model/i, "the two-model review was deleted"],
      [/solo founder|one-person|one person shop/i, "the operator objected to this framing"],
      [/up-?vote/i, "never ask for votes: Product Hunt and Hacker News penalize it"],
      [/identity[- ]verified|verified identity|guaranteed (match|identity|face|consistency)/i, "the score is scored, not guaranteed or verified"],
      [/every video (is )?scored/i, "the site promises images"],
      [/verify (your|their) (own )?face/i, "face verification is admin-only and not open"],
      [/picacho\.io|www\.picacho\.ai/i, "the canonical domain is https://picacho.ai"],
      [/mystique|recce/i, "not public, not proven"],
    ];
    for (const b of all) {
      for (const [re, why] of banned) {
        expect(re.test(b.text), `"${b.heading}" (line ${b.line}) matches ${re}: ${why}`).toBe(false);
      }
    }
  });

  // The Play listing was down 2026-09-09 to 09-21 and the kit could not
  // mention it; it came back with version 17. The kit now follows the same
  // switch the site does, so if the listing goes down again this fails until
  // the kit stops pointing at it.
  it("points at Google Play only while the listing is live, and only at our listing", () => {
    for (const b of all) {
      if (!PLAY_LISTING_LIVE) {
        expect(/google play|play store|play\.google\.com/i.test(b.text), `"${b.heading}" (line ${b.line}) mentions Play while the listing is down`).toBe(false);
      }
      for (const m of b.text.matchAll(/https:\/\/play\.google\.com\/[^\s"<)]*/g)) {
        const link = new URL(m[0]);
        const ours = new URL(PLAY_STORE_URL);
        const same = link.origin + link.pathname === ours.origin + ours.pathname && link.searchParams.get("id") === ours.searchParams.get("id");
        expect(same, `"${b.heading}" (line ${b.line}) links ${m[0]}, not ${PLAY_STORE_URL}`).toBe(true);
      }
    }
  });

  it("gives the same figures the pricing table gives", () => {
    const basic = PRICING_TIERS.find((t) => t.id === "basic");
    const elite = PRICING_TIERS.find((t) => t.id === "elite");
    expect(basic?.price).toBe(9);
    expect(basic?.credits).toBe(12);
    expect(elite?.price).toBe(499);
    expect(elite?.credits).toBe(750);
    // The Q&A section states the whole ladder in prose; it must agree.
    for (const t of PRICING_TIERS) {
      expect(kit, `the Q&A does not state ${t.name} at $${t.price} (${t.credits} credits)`).toMatch(
        new RegExp(`${t.name} \\$${t.price}[^.]*\\(${t.credits}\\)|${t.name} \\$${t.price}/month \\(${t.credits} credits\\)`),
      );
    }
  });
});
