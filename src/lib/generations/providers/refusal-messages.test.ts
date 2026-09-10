// The provider refusals: what a person reads when an image model's own safety
// system turns a request away. The rule they follow is in refusal-messages.ts.
//
// Alias-free — every import is relative. The two throw sites and the
// pipeline's retry decision are pinned by SOURCE rather than imported, because
// all three reach "@/", which vitest cannot resolve (the style
// truth-contracts.test.ts and provider-url.test.ts already use).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  IMAGE_REQUEST_REFUSED,
  IMAGE_RESULT_REFUSED,
  REFUSAL_COACHING,
  REFUSAL_GUARDS,
  providerRefusalMessages,
  readOpenAiRefusal,
} from "./refusal-messages";
import { forceRefundEligible, REFUSED_BEFORE_RENDER_ISSUE } from "../refund-rules";
import { isProviderFault } from "../provider-fault";
import en from "../../i18n/messages/en";
import es from "../../i18n/messages/es";
import pt from "../../i18n/messages/pt";
import italian from "../../i18n/messages/it";
import { localizeServerText, NOTHING_CHARGED_TAIL } from "../../i18n/server-text";

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
      expect(msg, name).not.toMatch(REFUSAL_GUARDS.en.again);
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

  const MONEY = REFUSAL_GUARDS.en.money;

  it("the refused-image sentence makes no money claim: a picture was made and billed", () => {
    // Flux's blacked-out 200 and OpenAI's output stage. On a render its
    // credit waits on the automatic_refunds switch and the daily cap
    // (refusal-messages.ts, point 3), so any promise here could be false.
    expect(IMAGE_RESULT_REFUSED).not.toMatch(MONEY);
  });

  it("the refused-request sentence says nothing was charged, and only where a forced refund makes it true", () => {
    // Until 2026-09-10 this sentence had to stay silent about money: the
    // render path did not force its refund. It may promise now only because
    // each link below holds; break one and the promise is a lie.
    expect(IMAGE_REQUEST_REFUSED).toMatch(/nothing was charged/);
    // 1. The reader hands out this sentence only with beforeRender — and
    //    never for a picture that was made.
    for (const stage of ["input", "unknown", undefined]) {
      expect(readOpenAiRefusal(openAiRefusalBody(stage))).toMatchObject({
        message: IMAGE_REQUEST_REFUSED,
        beforeRender: true,
      });
    }
    expect(readOpenAiRefusal(openAiRefusalBody("output"))?.message).toBe(IMAGE_RESULT_REFUSED);
    // 2. The throw carries beforeRender, and the pipeline turns it into the
    //    marker on the attempt.
    expect(src("./openai-images.ts")).toContain(
      "new ImageSafetyRejection(refusal.message, refusal.beforeRender)",
    );
    const pipeline = src("../pipeline.ts");
    expect(pipeline).toContain("err instanceof ImageSafetyRejection && err.beforeRender");
    expect(pipeline).toContain('["provider_error", REFUSED_BEFORE_RENDER_ISSUE]');
    // 3. The marker forces the refund, past the switch and the cap.
    expect(
      forceRefundEligible([
        {
          steps: [{ step: "generate", detail: IMAGE_REQUEST_REFUSED }],
          issues: ["provider_error", REFUSED_BEFORE_RENDER_ISSUE],
        },
      ]),
    ).toBe(true);
  });

  it("fit the shortest cut any surface makes", () => {
    // The layer-edit lane shows message.slice(0, 160); the composer's
    // failure summary cuts at 220 and 280.
    for (const [name, msg] of messages) {
      expect(msg.length, name).toBeLessThanOrEqual(160);
    }
  });

  it("are the sentences the providers actually throw", () => {
    const openai = src("./openai-images.ts");
    expect(openai).toContain("const refusal = readOpenAiRefusal(text);");
    expect(openai).toContain("new ImageSafetyRejection(refusal.message, refusal.beforeRender)");
    expect(src("./fal-image.ts")).toContain("new FluxSafetyRejection(IMAGE_RESULT_REFUSED)");
  });
});

// The same sentences as es/pt/it readers get them: the wire stays English
// (SAFETY_REJECTION and the model breaker read its "safety"), and
// lib/i18n/server-text.ts swaps in the catalog's words at display. Each rule
// above, in each language. The English guards cannot read Spanish, so every
// language gets its own, shaped like the English one: advice on phrasing,
// another input, another model; an invitation to send it again; money.
// Those live in refusal-messages.ts (REFUSAL_GUARDS), shared with
// content-policy.test.ts, which holds our own gates' refusals to the same.
const LOCALES = [
  { name: "es", t: es, ...REFUSAL_GUARDS.es, nothingCharged: /\bse cobró nada\b/i },
  { name: "pt", t: pt, ...REFUSAL_GUARDS.pt, nothingCharged: /\bnada foi cobrado\b/i },
  { name: "it", t: italian, ...REFUSAL_GUARDS.it, nothingCharged: /\baddebitato nulla\b/i },
] as const;

describe("provider refusals in every language", () => {
  it("English readers get the wire sentence itself", () => {
    expect(en.serverText.imageRequestRefused).toBe(IMAGE_REQUEST_REFUSED);
    expect(en.serverText.imageResultRefused).toBe(IMAGE_RESULT_REFUSED);
    expect(localizeServerText(IMAGE_REQUEST_REFUSED, en)).toBe(IMAGE_REQUEST_REFUSED);
  });

  for (const { name, t, coaching, again, money, nothingCharged } of LOCALES) {
    const request = t.serverText.imageRequestRefused;
    const result = t.serverText.imageResultRefused;

    it(`${name}: the wire sentences reach the reader translated`, () => {
      expect(localizeServerText(IMAGE_REQUEST_REFUSED, t)).toBe(request);
      expect(localizeServerText(IMAGE_RESULT_REFUSED, t)).toBe(result);
      expect(request).not.toBe(IMAGE_REQUEST_REFUSED);
      expect(result).not.toBe(IMAGE_RESULT_REFUSED);
    });

    it(`${name}: no coaching and no invitation to send it again`, () => {
      for (const msg of [request, result]) {
        expect(msg).not.toMatch(coaching);
        expect(msg).not.toMatch(REFUSAL_COACHING);
        expect(msg).not.toMatch(again);
      }
    });

    it(`${name}: the request keeps "nothing was charged"; the refused image makes no money claim`, () => {
      // Point 3 in refusal-messages.ts: true for the request only because the
      // render path force-refunds it, and never promised for a picture that
      // was made and billed.
      expect(request).toMatch(nothingCharged);
      expect(result).not.toMatch(money);
    });

    it(`${name}: fit the shortest cut any surface makes`, () => {
      expect(request.length).toBeLessThanOrEqual(160);
      expect(result.length).toBeLessThanOrEqual(160);
    });

    it(`${name}: the layer-edit lane's refusal is translated whole, its refund sentence with it`, () => {
      // editLayer force-refunds every failure and appends the fact (actions.ts);
      // truth-contracts pins that tail. An unmapped reason stays all English.
      expect(localizeServerText(`${IMAGE_RESULT_REFUSED}${NOTHING_CHARGED_TAIL}`, t)).toBe(
        `${result} ${t.serverText.nothingCharged}`,
      );
      expect(t.serverText.nothingCharged).toMatch(nothingCharged);
      const unmapped = `The edit failed.${NOTHING_CHARGED_TAIL}`;
      expect(localizeServerText(unmapped, t)).toBe(unmapped);
    });
  }
});

// The shape OpenAI's image-generation guide documents for a refusal. The
// message is the wording production has recorded; the request id is not real.
function openAiRefusalBody(stage?: string): string {
  return JSON.stringify({
    error: {
      message:
        "Your request was rejected by the safety system. If you believe this is an error, contact us at help.openai.com and include the request ID req_0000. safety_violations=[sexual].",
      type: "image_generation_user_error",
      param: null,
      code: "moderation_blocked",
      ...(stage ? { moderation_details: { moderation_stage: stage, categories: ["sexual"] } } : {}),
    },
  });
}

describe("reading OpenAI's refusal", () => {
  it("an input-stage block was refused before rendering", () => {
    expect(readOpenAiRefusal(openAiRefusalBody("input"))).toEqual({
      message: IMAGE_REQUEST_REFUSED,
      beforeRender: true,
      stage: "input",
    });
  });

  it("an output-stage block refused a picture that was made — the Flux case, not forced", () => {
    // OpenAI documents this stage as a block on "a generated image".
    expect(readOpenAiRefusal(openAiRefusalBody("output"))).toEqual({
      message: IMAGE_RESULT_REFUSED,
      beforeRender: false,
      stage: "output",
    });
  });

  it("no stage, or 'unknown', counts as before rendering — the kind the ledger measured", () => {
    // moderation_details is optional ("may also include"). The 2026-09-10
    // refusal in OpenAI's ledger billed nothing, and we had not kept its
    // body, so to us it was exactly this case.
    expect(readOpenAiRefusal(openAiRefusalBody())?.beforeRender).toBe(true);
    expect(readOpenAiRefusal(openAiRefusalBody("unknown"))?.beforeRender).toBe(true);
  });

  it("recognises the bodies production actually recorded, cut off before the code", () => {
    // pipeline_log kept the first 300 characters of the 2026-08-07 refusals:
    // not parseable, so the wording is what has to match.
    const recorded =
      '{\n  "error": {\n    "message": "Your request was rejected by the safety system. If you believe this is an error, contact us at help.openai.com and include the request ID req_0000. safety_violations=[sexual].",\n    "type": "image_generation_user_error",\n    "param": null,';
    expect(readOpenAiRefusal(recorded)).toMatchObject({ message: IMAGE_REQUEST_REFUSED, beforeRender: true });
  });

  it("recognises the refusal by its documented code even if the wording changes", () => {
    const reworded = JSON.stringify({
      error: { message: "Request blocked.", type: "image_generation_user_error", code: "moderation_blocked" },
    });
    expect(readOpenAiRefusal(reworded)?.message).toBe(IMAGE_REQUEST_REFUSED);
  });

  it("leaves every other error alone", () => {
    // These stay "OpenAI image API error (4xx): …" in the log, which the 4xx
    // rule already refunds, or a 5xx that it rightly does not.
    const unreadable = JSON.stringify({
      error: { message: "Invalid image file or mode for image 1", type: "invalid_request_error", code: null },
    });
    const rateLimited = JSON.stringify({
      error: { message: "Rate limit reached for gpt-image-2", type: "requests", code: "rate_limit_exceeded" },
    });
    expect(readOpenAiRefusal(unreadable)).toBeNull();
    expect(readOpenAiRefusal(rateLimited)).toBeNull();
    expect(readOpenAiRefusal("upstream connect error")).toBeNull();
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
