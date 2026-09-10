// The provider refusals: what a person reads when an image model's own safety
// system turns a request away. The rule they follow is in refusal-messages.ts.
//
// Alias-free — every import is relative. The two throw sites and the
// pipeline's retry decision are pinned by SOURCE rather than imported, because
// all three reach "@/", which vitest cannot resolve (the style
// truth-contracts.test.ts and provider-url.test.ts already use).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { REFUSAL_COACHING, providerRefusalMessages } from "./refusal-messages";
import { isProviderFault } from "../provider-fault";
import en from "../../i18n/messages/en";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const messages = Object.entries(providerRefusalMessages);

// Verbatim as they shipped until 2026-09-10. Kept so the guard is proven to
// catch them: its first version, the one content-policy.test.ts used, passed
// all three.
const RETIRED = [
  "That description was flagged by OpenAI's safety filter and couldn't be generated. " +
    "Try simpler, unambiguous wording (for example, describing age and appearance " +
    "plainly rather than combining conflicting details), or upload a photo instead.",
  "Flux's safety checker flagged this image and blacked it out. " +
    "Try plainer wording for the outfit and pose.",
  "Safety filters are strict about photorealistic people. Plain, neutral wording passes best " +
    "— and when a filter still objects, Picacho automatically rewrites and retries before " +
    "falling back.",
];

describe("provider refusals", () => {
  it("never coach a way around the refusal", () => {
    for (const [name, msg] of messages) {
      expect(msg, name).not.toMatch(REFUSAL_COACHING);
    }
  });

  it("never invite the same request again", () => {
    // A provider refusal is final: the same request fails the same
    // classifier. "Try again" on one is the retry ladder, run by hand.
    for (const [name, msg] of messages) {
      expect(msg, name).not.toMatch(/\btry (?:it )?again\b|\bretry\b|\bresend\b/i);
    }
  });

  it("stay terminal: the pipeline stops on them and the model breaker ignores them", () => {
    const pipeline = src("../pipeline.ts");
    const literal = pipeline.match(/const SAFETY_REJECTION =\s*\/(.+)\/([a-z]*);/);
    if (!literal) throw new Error("SAFETY_REJECTION moved out of pipeline.ts — re-point this test at it.");
    const safetyRejection = new RegExp(literal[1], literal[2]);
    // And it is still what decides the retry, not just a regex left lying about.
    expect(pipeline).toContain("SAFETY_REJECTION.test(message)");
    for (const [name, msg] of messages) {
      expect(safetyRejection.test(msg), `${name} would be retried`).toBe(true);
      expect(isProviderFault(msg), `${name} would count toward the model breaker`).toBe(false);
    }
  });

  it("make no money claim", () => {
    // The true one differs by path — a character photo's allowance always
    // returns, a layer edit appends its own "Nothing was charged.", and a
    // render's credit waits on the automatic_refunds switch and the daily cap
    // (refusal-messages.ts, point 3). Make the render path's refund forced
    // before letting this sentence promise anything.
    for (const [name, msg] of messages) {
      expect(msg, name).not.toMatch(/\b(?:spent|charged|charge|credits?|refund\w*|free)\b/i);
    }
  });

  it("fit the shortest cut any surface makes", () => {
    // The layer-edit lane shows message.slice(0, 160); the composer's
    // failure summary cuts at 220 and 280.
    for (const [name, msg] of messages) {
      expect(msg.length, name).toBeLessThanOrEqual(160);
    }
  });

  it("are the sentences the providers actually throw", () => {
    expect(src("./openai-images.ts")).toContain("new ImageSafetyRejection(IMAGE_REQUEST_REFUSED)");
    expect(src("./fal-image.ts")).toContain("new FluxSafetyRejection(IMAGE_RESULT_REFUSED)");
  });
});

describe("the coaching guard", () => {
  it("catches the sentences it was widened for", () => {
    for (const msg of RETIRED) expect(msg).toMatch(REFUSAL_COACHING);
  });

  it("holds the tutorial's tip on refusals to the same line", () => {
    // The in-app guide's troubleshooting tip is the other place the product
    // talks about safety filters, and it was the third retired sentence
    // above. English only: es/pt/it translate this line, and the guard is an
    // English pattern.
    expect(en.tutorial.s7p1).not.toMatch(REFUSAL_COACHING);
  });
});
