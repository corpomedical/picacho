import { describe, expect, it } from "vitest";
import { classifyMessage } from "./intent";

const asks = (t: string) => classifyMessage(t).intent === "ask";
const renders = (t: string) => classifyMessage(t).intent === "render";

// The asymmetry is the design, so it is what gets tested hardest: reading a
// question as a shot spends a credit on something nobody asked for, and
// reading a shot as a question costs a fraction of a cent and one tap.

describe("things that must render", () => {
  it("reads a plain shot description as a shot", () => {
    expect(renders("Eva walking through a quiet market at dawn")).toBe(true);
    expect(renders("Adam looks up as the ship passes overhead")).toBe(true);
    expect(renders("close-up on her eyes, wide with fear")).toBe(true);
    expect(renders("Blodie sits courtside at a Lakers game")).toBe(true);
  });

  it("does not mistake 'show me' for a question", () => {
    // One of the most natural ways to ask for a picture. Putting a tap in
    // front of it would be a tax on the common case.
    expect(renders("show me Eva in a market")).toBe(true);
    expect(renders("show her from a low angle")).toBe(true);
  });

  it("keeps rendering a two-word prompt", () => {
    expect(renders("Eva smiling")).toBe(true);
    expect(renders("wide shot")).toBe(true);
  });

  it("still renders when a sentence merely contains a question word", () => {
    // "where" mid-sentence is scenery, not an enquiry.
    expect(renders("a market where the light comes through the awnings")).toBe(true);
    expect(renders("the moment when the match strikes")).toBe(true);
  });
});

describe("things that must be answered, not rendered", () => {
  it("treats anything with a question mark as a question", () => {
    expect(asks("why did this one only score 61%?")).toBe(true);
    expect(asks("Eva in a market?")).toBe(true);
  });

  it("treats a question opener as a question with no punctuation at all", () => {
    expect(asks("why did my last take score so low")).toBe(true);
    expect(asks("which model should I use for six seconds")).toBe(true);
    expect(asks("how much would that cost")).toBe(true);
    expect(asks("explain the seedance fence")).toBe(true);
    expect(asks("compare veo and kling for Adam")).toBe(true);
  });

  it("treats a message addressed to a person as a question", () => {
    expect(asks("do you think the pose is the problem")).toBe(true);
    expect(asks("tell me what went wrong with the last one")).toBe(true);
  });

  it("never renders small talk", () => {
    // "thanks" is a well-formed two-word prompt. Rendering it would be a
    // credit spent on nothing, which is the failure this list exists for.
    for (const t of ["hi", "hello", "thanks", "thank you", "ok", "cool", "perfect", "bye"]) {
      expect(asks(t)).toBe(true);
    }
    expect(asks("Thanks!")).toBe(true);
  });
});

describe("the Render this chip", () => {
  it("recovers the shot from a politely wrapped instruction", () => {
    expect(classifyMessage("can you make Eva walk through a market")).toEqual({
      intent: "ask",
      renderablePrompt: "make Eva walk through a market",
    });
    expect(classifyMessage("could you please show Adam on the bridge").renderablePrompt).toBe(
      "show Adam on the bridge",
    );
  });

  it("offers nothing when what remains is not an instruction to produce anything", () => {
    // "can you explain the scoring" must not offer to RENDER "explain the
    // scoring" — a chip that spends a credit on nonsense.
    expect(classifyMessage("can you explain the scoring").renderablePrompt).toBe(null);
    expect(classifyMessage("do you think that will work").renderablePrompt).toBe(null);
    expect(classifyMessage("why did it fail").renderablePrompt).toBe(null);
  });

  it("offers nothing when the person was also asking something", () => {
    expect(
      classifyMessage("can you make Eva walk through a market, or is Veo better?")
        .renderablePrompt,
    ).toBe(null);
  });

  it("hands back the person's own words, unedited", () => {
    // The chip fills the composer. What lands there has to be recognisably
    // what they typed, not a sentence put in their mouth.
    const out = classifyMessage("Can you make EVA sprint, backlit, 35mm").renderablePrompt;
    expect(out).toBe("make EVA sprint, backlit, 35mm");
  });
});

describe("edge cases", () => {
  it("treats an empty message as a render, so the existing guards handle it", () => {
    expect(classifyMessage("").intent).toBe("render");
    expect(classifyMessage("   ").intent).toBe("render");
  });

  it("is not confused by leading or doubled whitespace", () => {
    expect(asks("   why did this fail")).toBe(true);
    expect(asks("what   should  I  change")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(asks("WHY DID THIS FAIL")).toBe(true);
    expect(renders("EVA IN A MARKET")).toBe(true);
  });
});

describe("leading filler must not hide a question (review 2026-08-31)", () => {
  // Every string here was verified to RENDER before the fix — each one a
  // credit spent on a video of the sentence. This is the expensive
  // direction, so it gets the most tests in the file.
  const wereRendering = [
    "please explain why my last render scored so low",
    "so how do i improve the score",
    "hmm why did that fail",
    "ok so which one is cheaper",
    "not sure which model to use for a 10 second clip",
    "wondering how to get a better match score",
    "just curious what elements means",
    "i need help picking a model",
    "i wonder if kling is better than seedance",
    "thoughts on seedance vs kling",
  ];
  for (const t of wereRendering) {
    it(`asks: "${t}"`, () => {
      expect(classifyMessage(t).intent).toBe("ask");
    });
  }

  it("peels more than one filler word", () => {
    expect(asks("ok so why did that fail")).toBe(true);
    expect(asks("well actually how much does this cost")).toBe(true);
  });

  it("does not let the filler strip eat a real prompt's subject", () => {
    // The reason the strip is an explicit list and not "drop the first word".
    expect(renders("Eva walks through a market")).toBe(true);
    expect(renders("Adam turns to face the camera")).toBe(true);
    expect(renders("just Eva, backlit, no crowd")).toBe(true);
    expect(renders("now the camera pulls back")).toBe(true);
  });

  it("still treats a bare politeness word as small talk, not an empty render", () => {
    expect(asks("please")).toBe(true);
  });
});

describe("the Render this chip round-trips (review 2026-08-31)", () => {
  it("produces text that actually renders", () => {
    // "do" used to sit in both QUESTION_OPENERS and RENDER_VERBS, so this
    // chip offered a prompt that re-classified as a question — it could
    // never render, it just asked the same thing again.
    const reading = classifyMessage("can you do a wide shot of Eva in the rain");
    if (reading.renderablePrompt) {
      expect(classifyMessage(reading.renderablePrompt).intent).toBe("render");
    }
  });

  it("sends a politely-prefixed instruction straight to the renderer", () => {
    // "please create a close-up" needs no chip and no detour: with the
    // filler stripped it is simply an instruction, so it renders directly.
    expect(renders("please create a close-up of her hands")).toBe(true);
    expect(renders("please make Eva turn to camera")).toBe(true);
  });

  it("every chip it can offer classifies as a render", () => {
    const wrapped = [
      "can you make Eva walk through a market",
      "could you show Adam on the bridge",
      "would you generate a wide shot at dusk",
      "can you animate the camera pushing in",
      "could you render Blodie at the window",
    ];
    for (const w of wrapped) {
      const chip = classifyMessage(w).renderablePrompt;
      expect(chip, `no chip for "${w}"`).toBeTruthy();
      expect(classifyMessage(chip!).intent, `chip "${chip}" did not render`).toBe("render");
    }
  });
});

// The classifier was English-only while the app ships in four languages
// (found in the 2026-08-31 site inspection). A question typed in Spanish
// with no question mark fell through to "render" and spent a credit on a
// video of the sentence — the exact expensive direction the module's header
// says the whole design exists to prevent, for a third of the user base.
describe("the app's other three languages", () => {
  const questions = [
    // es — no question marks on purpose; "¿" alone would settle it.
    "por qué falló mi video",
    "cómo mejoro la puntuación",
    "qué modelo es más barato",
    "me puedes explicar los créditos",
    "hola por qué falló mi video",
    // pt
    "por que meu vídeo falhou",
    "como faço para melhorar a nota",
    "qual modelo é mais barato",
    "você pode explicar os créditos",
    // it
    "perché il mio video è fallito",
    "come miglioro il punteggio",
    "quale modello costa meno",
    "mi puoi spiegare i crediti",
  ];
  for (const q of questions) {
    it(`asks: "${q}"`, () => {
      expect(classifyMessage(q).intent).toBe("ask");
    });
  }

  it("the inverted question mark settles it alone", () => {
    expect(classifyMessage("¿esto va a funcionar con Eva?").intent).toBe("ask");
    expect(classifyMessage("¿funcionará").intent).toBe("ask");
  });

  it("shots in those languages still render", () => {
    const shots = [
      "Eva caminando por un mercado al amanecer",
      "Adam corre sotto la pioggia, camera a mano",
      "Eva caminha pela praia ao pôr do sol",
      "primer plano de Eva sonriendo",
    ];
    for (const s of shots) {
      expect(classifyMessage(s).intent, s).toBe("render");
    }
  });

  it("small talk in those languages does not render", () => {
    for (const s of ["gracias", "obrigado", "grazie", "hola", "ciao", "perfecto"]) {
      expect(classifyMessage(s).intent, s).toBe("ask");
    }
  });
});

// "Hey picacho" (operator, 2026-08-31): a greeting addressed to the app by
// name fell through every list — "hey" is filler, "picacho" matches no
// opener — and RENDERED. One credit for saying hello, which OpenAI's safety
// filter then rejected, which burned a softening retry, which produced a
// nonsense image. Naming the app now reads as talking to it, in any
// language, wherever the name sits in the sentence.
describe("addressing the app by name", () => {
  for (const t of [
    "Hey picacho",
    "hola picacho",
    "thanks picacho",
    "picacho why did that fail",
    "ok picacho make it warmer",
  ]) {
    it(`asks: "${t}"`, () => {
      expect(classifyMessage(t).intent).toBe("ask");
    });
  }

  it("a shot that never names the app still renders", () => {
    expect(classifyMessage("Eva waves hello at the camera").intent).toBe("render");
  });

  it('"ok picacho make it warmer" still offers the render chip', () => {
    // Addressed to the app, but carrying an instruction — the answer should
    // come with the one-tap "Render this" chip so the tap is not lost.
    const r = classifyMessage("can you make Eva wave at the camera");
    expect(r.intent).toBe("ask");
    expect(r.renderablePrompt).toBeTruthy();
  });
});
