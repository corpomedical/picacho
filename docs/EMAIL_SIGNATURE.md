# Email signature — hello@picacho.ai

Built in the same idiom as the app's own outgoing mail (src/lib/email/render.ts):
plain-text wordmark rather than a hosted image, ochre `#a84e24` links, muted
`#a3a3a3` legal line, system font stack, inline CSS only. No image logo is
deliberate — a remote image is a tracking signal many clients block, which
would leave a broken-image box where the masthead should be.

## FILL THESE IN FIRST

Three values are not in the repo and must not be guessed:

- `[SURNAME]` — your surname as it should appear
- `[CIF]` — Jeartecnica S.A.'s CIF
- `[REGISTERED ADDRESS]` — the registered office as filed
- `[REGISTRO MERCANTIL]` — e.g. "Registro Mercantil de Madrid, Tomo X, Folio Y, Hoja Z"

The last three are not decoration. A Spanish S.A. is required to identify
itself on business correspondence, and for an enquiry that asks a vendor to
admit you to a gated programme, a verifiable registered entity is the part
that makes the request credible.

---

## 1. Full signature (first message in a thread)

Paste into Gmail → Settings → See all settings → General → Signature. Gmail
keeps inline styles; paste as rich text, not as HTML source.

```html
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#404040;">
  <div style="font-size:17px;font-weight:700;letter-spacing:-0.02em;color:#171717;">Picacho</div>
  <div style="height:1px;width:34px;background-color:#a84e24;margin:6px 0 10px;"></div>
  <div style="color:#171717;">Ahmad [SURNAME]</div>
  <div style="color:#737373;">Founder</div>
  <div style="margin-top:10px;">
    <a href="https://picacho.ai" style="color:#a84e24;text-decoration:none;">picacho.ai</a>
    <span style="color:#d4d4d4;">&nbsp;·&nbsp;</span>
    <a href="mailto:hello@picacho.ai" style="color:#a84e24;text-decoration:none;">hello@picacho.ai</a>
  </div>
  <div style="margin-top:10px;font-size:13px;color:#737373;">The same character, in every single frame.</div>
  <div style="margin-top:14px;font-size:11px;line-height:1.5;color:#a3a3a3;">
    Picacho is a trading name of Jeartecnica S.A. · CIF [CIF] · [REGISTERED ADDRESS] · [REGISTRO MERCANTIL]
  </div>
</div>
```

## 2. Short signature (replies within a thread)

A full block on every reply reads as a mail-merge. Gmail supports more than
one signature — set this as the default for replies.

```html
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#404040;">
  <div style="color:#171717;">Ahmad [SURNAME]</div>
  <div style="color:#737373;">Picacho · <a href="https://picacho.ai" style="color:#a84e24;text-decoration:none;">picacho.ai</a></div>
</div>
```

## 3. Plain text (for clients that strip HTML)

```
Ahmad [SURNAME]
Founder, Picacho
picacho.ai · hello@picacho.ai
The same character, in every single frame.

Picacho is a trading name of Jeartecnica S.A. · CIF [CIF]
[REGISTERED ADDRESS] · [REGISTRO MERCANTIL]
```

---

## Notes

- **Set it per-address.** The signature must be attached to the
  hello@picacho.ai identity in Gmail, not to the personal one, or replies from
  the alias will carry the wrong footer or none.
- **No phone number** is included on purpose. Add one only if you want
  inbound calls; an unanswered number on a signature is worse than no number.
- **No social links** until the handles are settled — a dead link on a
  signature is checked more often than you would think.
- **Do not add a "this email is confidential" disclaimer.** It has no legal
  effect on an unsolicited recipient, it lengthens every message, and on a
  first-contact partnership enquiry it reads as boilerplate from a company
  that copies rather than writes.
- The ochre rule under the wordmark is the one brand flourish. It echoes the
  underline in the logo without needing an image.
