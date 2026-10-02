// The hello@picacho.ai signature, for emails the admin writes from the site
// (2026-10-03, operator: "Make a pop up window that has hello@picacho.ai to
// write to them from the website. Add the signature we did.").
//
// The design is docs/email-signature.html (option C, picked 2026-09-21): the
// real wordmark, an ochre rule, picacho.ai · hello@picacho.ai, the tagline,
// and the company line from legal-entity.ts so it can't drift from the site.
// One change: the name line says "The Picacho team" instead of a person with
// a Founder title — the operator doesn't send as the founder (2026-09-26).
//
// Tables and inline styles only, as in that file: email clients strip
// <style> and rewrite layout CSS. Its own marks are entities (&middot;) and
// the note declares UTF-8, so nothing turns into "Â·" in a client that
// guesses the encoding. Pure and alias-free (tested).
import { LEGAL_ENTITY } from "../legal-entity";

export const SIGNATURE_NAME = "The Picacho team";
export const SIGNATURE_TAGLINE = "The same character, in every single frame.";

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

export function entityLine(sep = " · "): string {
  return `Picacho is operated by ${LEGAL_ENTITY.name}${sep}NIF ${LEGAL_ENTITY.nif}${sep}${LEGAL_ENTITY.addressLines.join(", ")}`;
}

export function signatureHtml(): string {
  const email = `${LEGAL_ENTITY.emailUser}@${LEGAL_ENTITY.emailDomain}`;
  return `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:${FONT};font-size:14px;line-height:1.5;color:#404040;">
  <tr>
    <td valign="top" style="padding:2px 20px 0 0;">
      <img src="https://picacho.ai/logo.png" alt="Picacho" width="130" height="40" style="display:block;width:130px;height:40px;border:0;outline:none;text-decoration:none;">
    </td>
    <td valign="top" style="padding:0 0 0 20px;border-left:2px solid #a84e24;">
      <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:${FONT};font-size:14px;line-height:1.5;color:#404040;">
        <tr><td><span style="color:#171717;">${SIGNATURE_NAME}</span></td></tr>
        <tr>
          <td style="padding:10px 0 0;">
            <a href="https://picacho.ai" style="color:#a84e24;text-decoration:none;">picacho.ai</a>
            <span style="color:#d4d4d4;">&nbsp;&middot;&nbsp;</span>
            <a href="mailto:${email}" style="color:#a84e24;text-decoration:none;">${email}</a>
          </td>
        </tr>
        <tr><td style="padding:8px 0 0;font-size:13px;color:#737373;">${SIGNATURE_TAGLINE}</td></tr>
      </table>
    </td>
  </tr>
  <tr>
    <td colspan="2" style="padding:16px 0 0;font-size:11px;line-height:1.5;color:#a3a3a3;">${entityLine(" &middot; ")}</td>
  </tr>
</table>`;
}

export function signatureText(): string {
  const email = `${LEGAL_ENTITY.emailUser}@${LEGAL_ENTITY.emailDomain}`;
  return [SIGNATURE_NAME, `picacho.ai · ${email}`, SIGNATURE_TAGLINE, "", entityLine()].join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * A personal note: what the admin typed (escaped, blank lines → paragraphs),
 * the signature, and one small unsubscribe line — it reads like an email
 * from a person, not a newsletter, but never goes out without an opt-out.
 */
export function renderNote(message: string, unsubscribeUrl: string): { html: string; text: string } {
  const paragraphs = message
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 14px;">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background-color:#ffffff;">
  <div style="max-width:600px;padding:20px 16px 28px;font-family:${FONT};font-size:15px;line-height:1.6;color:#262626;">
${paragraphs}
    <div style="padding:14px 0 0;">
${signatureHtml()}
    </div>
    <p style="margin:22px 0 0;font-size:11px;line-height:1.5;color:#a3a3a3;">Don&#39;t want emails like this? <a href="${escapeHtml(unsubscribeUrl)}" style="color:#a3a3a3;">Unsubscribe</a>.</p>
  </div>
</body>
</html>`;
  const text = `${message.trim()}\n\n--\n${signatureText()}\n\nUnsubscribe: ${unsubscribeUrl}\n`;
  return { html, text };
}
