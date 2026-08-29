import { describe, expect, it } from "vitest";
import { renderTemplate, type TemplateVars } from "./render";

// The renderer's contract in executable form. The security model under test:
// template BODIES are admin-authored and sanitized to a tiny allowlist;
// variable VALUES are user data and always escaped — an email renders
// outside our CSP, so nothing user-shaped may ever land in it as markup.

const VARS: TemplateVars = {
  username: "Eva",
  email: "eva@example.com",
  plan: "Basic",
  credits: "36",
};

const UNSUB = "https://picacho.ai/api/email/unsubscribe?token=abc";

function render(body: string, vars: TemplateVars = VARS) {
  return renderTemplate("Hello {{username}}", body, vars, UNSUB);
}

describe("variables", () => {
  it("substitutes raw in the subject, escaped in the body", () => {
    const evil = { ...VARS, username: '<script>alert(1)</script>' };
    const { subject, html } = render("Hi {{username}},", evil);
    // Subject is a text context — raw value, no entities.
    expect(subject).toBe("Hello <script>alert(1)</script>");
    // Body is HTML — the value must arrive inert.
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("renders unknown variables as nothing, never literally", () => {
    const { html } = render("Hi {{usrename}},");
    expect(html).toContain("Hi ,");
    expect(html).not.toContain("{{");
  });
});

describe("body dialect", () => {
  it("keeps the allowlisted tags and strips everything else", () => {
    // The shell wrapper legitimately contains <div>s of its own, so the
    // assertion targets the template div's distinctive attribute instead of
    // the tag name.
    const { html } = render('<b>bold</b> and <div style="x">plain</div>');
    expect(html).toContain("<b>bold</b>");
    expect(html).not.toContain('style="x"');
    // The div's TEXT survives even though its tags die.
    expect(html).toContain("and plain");
  });

  it("allows only bare http(s) hrefs on links", () => {
    const good = render('<a href="https://picacho.ai/pricing">See the plans</a>').html;
    expect(good).toContain('href="https://picacho.ai/pricing"');
    const bad = render('<a href="javascript:alert(1)">x</a>').html;
    expect(bad).not.toContain("javascript:");
  });

  it("turns blank lines into paragraphs", () => {
    const { html } = render("one\n\ntwo");
    expect(html.match(/<p style="margin:0 0 16px;">/g)).toHaveLength(2);
  });
});

describe("<playbadge>", () => {
  it("emits the official badge image linked to the Play listing", () => {
    const { html } = render("<playbadge>");
    expect(html).toContain('href="https://play.google.com/store/apps/details?id=ai.picacho.app"');
    expect(html).toContain('src="https://picacho.ai/google-play-badge.png"');
    // The CTA survives blocked remote images as the anchor's alt text.
    expect(html).toContain('alt="Get it on Google Play"');
  });

  it("accepts the self-closing spelling too", () => {
    expect(render("<playbadge />").html).toContain("google-play-badge.png");
  });

  it("strips the tag entirely once it carries attributes", () => {
    const { html } = render('<playbadge onclick="steal()">');
    expect(html).not.toContain("google-play-badge.png");
    expect(html).not.toContain("onclick");
  });
});

describe("shell", () => {
  it("appends the per-recipient unsubscribe link", () => {
    expect(render("Hi").html).toContain(UNSUB);
  });
});
