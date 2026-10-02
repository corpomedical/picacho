import { describe, expect, it } from "vitest";
import { LEGAL_ENTITY } from "../legal-entity";
import { renderNote, signatureHtml, signatureText, SIGNATURE_NAME } from "./signature";

describe("the hello@ signature", () => {
  it("is the picked design, signed by the team, with the company line from legal-entity", () => {
    const html = signatureHtml();
    expect(html).toContain('src="https://picacho.ai/logo.png"');
    expect(html).toContain("border-left:2px solid #a84e24");
    expect(html).toContain(SIGNATURE_NAME);
    expect(html).toContain("mailto:hello@picacho.ai");
    expect(html).toContain(`${LEGAL_ENTITY.name} &middot; NIF ${LEGAL_ENTITY.nif}`);
    expect(html).not.toContain("·"); // marks as entities: no mojibake in a client that guesses the encoding
    expect(html).not.toMatch(/founder|\[SURNAME\]/i);
    expect(signatureText()).toContain("The Picacho team\npicacho.ai · hello@picacho.ai");
  });
});

describe("renderNote", () => {
  it("escapes what was typed, keeps its paragraphs, and signs it", () => {
    const { html, text } = renderNote("Hi <b>Nadia</b>,\n\nLine one\nline two", "https://picacho.ai/unsubscribe?u=1&s=x");
    expect(html).toContain("Hi &lt;b&gt;Nadia&lt;/b&gt;,");
    expect(html).toContain("Line one<br>line two");
    expect(html).toContain('<meta charset="utf-8">');
    expect(html.indexOf("Line one")).toBeLessThan(html.indexOf(SIGNATURE_NAME));
    expect(html).toContain('href="https://picacho.ai/unsubscribe?u=1&amp;s=x"');
    expect(text).toContain("Hi <b>Nadia</b>,\n\nLine one\nline two\n\n--\nThe Picacho team");
    expect(text).toContain("Unsubscribe: https://picacho.ai/unsubscribe?u=1&s=x");
  });
});
