// Template rendering for the admin announcement emails (see
// lib/admin/email-actions.ts for the only two paths that ever send one).
//
// Deliberately pure — no env vars, no Supabase, no async. Everything
// request-specific (the per-recipient unsubscribe URL, which needs the
// request origin) is passed IN, so this module can be exercised against any
// input without a server context, and the admin preview pane renders with
// exactly the code path a real send uses.
//
// The security model, in one line: template BODIES are written by admins in
// a tiny HTML-ish dialect and sanitized to an allowlist; variable VALUES are
// user-controlled data (usernames, emails) and are always HTML-escaped. An
// email is the one output of this app that renders outside our CSP, so
// nothing user-shaped may ever land in it as markup.

export type TemplateVars = {
  username: string;
  email: string;
  /** Plan label, e.g. "Starter" — not the id. */
  plan: string;
  /** The plan's monthly credit allowance, already stringified. */
  credits: string;
};

// One place the admin UI's variables legend and the substitution agree on
// what exists — add a variable here and both stay in step.
export const TEMPLATE_VARIABLES = [
  { token: "{{username}}", meaning: "their username" },
  { token: "{{email}}", meaning: "their email address" },
  { token: "{{plan}}", meaning: "their plan's name (Free accounts read “No active plan”)" },
  { token: "{{credits}}", meaning: "their plan's monthly credit allowance (0 for free accounts)" },
] as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// {{ username }} and {{username}} both work — people type both. Unknown
// tokens render as EMPTY, never literally: "Hi {{usrename}}," going out as
// "Hi ," is an authoring mistake the preview pane makes visible before a
// send, while "Hi {{usrename}}," reaching 5,000 inboxes is not fixable at
// all.
const TOKEN_RE = /\{\{\s*([a-zA-Z_]+)\s*\}\}/g;

function substitute(text: string, vars: TemplateVars, escapeValues: boolean): string {
  return text.replace(TOKEN_RE, (_match, name: string) => {
    const value = (vars as Record<string, string | undefined>)[name];
    if (value === undefined) return "";
    return escapeValues ? escapeHtml(value) : value;
  });
}

// The body dialect's entire tag allowlist. Returns the normalized safe tag,
// or null for anything unrecognized (which the sanitizer then STRIPS — a
// pasted <div style=...> disappears rather than showing up as escaped
// gibberish in someone's inbox).
//
// <a> is the strict one: only a bare href, only http(s), no other attributes
// possible by construction — the pattern must match the whole tag, so
// there's no room for onclick/style/target smuggling. The URL is re-escaped
// on the way out (& → &amp; is correct inside an attribute).
function matchSafeTag(tag: string): string | null {
  const simple = tag.match(/^<(\/?)(b|i|p)>$/i);
  if (simple) return `<${simple[1]}${simple[2].toLowerCase()}>`;
  if (/^<br\s*\/?>$/i.test(tag)) return "<br>";
  const link = tag.match(/^<a\s+href="(https?:\/\/[^"\s]+)"\s*>$/i);
  if (link) return `<a href="${escapeHtml(link[1])}" style="color:#a84e24;">`;
  if (/^<\/a>$/i.test(tag)) return "</a>";
  return null;
}

// Escape-by-default sanitizer: the input is split into tags and text in a
// single pass; text is HTML-escaped, tags survive only if matchSafeTag
// recognizes them exactly. Only "<" followed by a letter or "/" can open a
// tag — a bare "<" (as in "5 < 10") is escaped as text instead of greedily
// swallowing everything up to the next ">" somewhere later in the body,
// which is exactly what a naive <[^>]*> alternative did in testing: it ate
// the innocent prose AND the real tag after it.
function sanitizeBody(body: string): string {
  return body.replace(/<\/?[a-zA-Z][^>]*>|<|[^<]+/g, (chunk) => {
    if (chunk === "<") return "&lt;";
    if (chunk.startsWith("<")) return matchSafeTag(chunk) ?? "";
    return escapeHtml(chunk);
  });
}

// Authoring convenience: a blank line starts a new paragraph, a single line
// break becomes <br> — so the textarea reads like the email will. Runs after
// sanitize + substitution, when the string is already safe HTML.
function paragraphize(html: string): string {
  return html
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p style="margin:0 0 16px;">${part.replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

// The branded shell every outgoing body is wrapped in.
//
// MUST STAY SELF-CONTAINED: email clients strip <style> blocks, <link>s and
// classes, and many (Outlook, Gmail clipping) mangle anything clever — so
// inline CSS only, no external images or fonts, and the Picacho wordmark is
// plain text rather than a hosted logo (a remote image is also a tracking
// signal many clients block by default, which would leave a broken-image box
// as our masthead). Table-free on purpose: this layout is a single centered
// column, which every client this side of 2010 renders fine from divs.
//
// The footer is appended automatically — sender identity plus the
// per-recipient unsubscribe link — so no template can ever go out without
// an opt-out path.
function shell(bodyHtml: string, unsubscribeUrl: string): string {
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background-color:#fafafa;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px 40px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <div style="padding:0 4px 14px;">
      <span style="font-size:17px;font-weight:700;letter-spacing:-0.02em;color:#171717;">Picacho</span>
    </div>
    <div style="background-color:#ffffff;border:1px solid #e5e5e5;border-radius:14px;padding:28px 28px 12px;font-size:15px;line-height:1.6;color:#404040;">
${bodyHtml}
    </div>
    <div style="padding:18px 4px 0;font-size:12px;line-height:1.6;color:#a3a3a3;">
      <p style="margin:0;">Sent by Picacho &mdash; the same character, in every single frame. <a href="https://picacho.io" style="color:#a3a3a3;">picacho.io</a></p>
      <p style="margin:4px 0 0;">Get the Android app on <a href="https://play.google.com/store/apps/details?id=ai.picacho.app" style="color:#a3a3a3;">Google Play</a>.</p>
      <p style="margin:4px 0 0;">Don&#39;t want these emails? <a href="${escapeHtml(unsubscribeUrl)}" style="color:#a3a3a3;">Unsubscribe</a>.</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Renders one template for one recipient: variables substituted (escaped in
 * the body, raw in the plain-text subject), body sanitized to the allowlist,
 * paragraphs applied, shell + unsubscribe footer wrapped around it.
 */
export function renderTemplate(
  subjectTpl: string,
  bodyTpl: string,
  vars: TemplateVars,
  unsubscribeUrl: string,
): { subject: string; html: string } {
  // Subject is a text context (no HTML there), so values go in raw —
  // escaping would show literal &amp; in inbox subject lines.
  const subject = substitute(subjectTpl, vars, false);
  const bodyHtml = paragraphize(substitute(sanitizeBody(bodyTpl), vars, true));
  return { subject, html: shell(bodyHtml, unsubscribeUrl) };
}
