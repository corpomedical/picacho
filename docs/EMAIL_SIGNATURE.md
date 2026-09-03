# Email signature — hello@picacho.ai

**Open `docs/email-signature.html` in a browser and press Copy.** That is the
whole procedure. The markup lives in that file and nowhere else, so the two
cannot drift.

## Why the first version did not work in Gmail

Two reasons, both now fixed in the HTML file:

1. **Gmail's signature box is a rich-text field, not an HTML editor.** Pasting
   markup into it gets you the markup, rendered as text. It has to receive
   *formatted* content from the clipboard — which is what the Copy button in
   the HTML file puts there.
2. **Gmail's sanitizer drops empty elements.** The ochre rule under the
   wordmark was an empty `<div>` with a background colour and a fixed height,
   which is exactly the shape that gets stripped. It is now a `border-bottom`
   on a table cell that has real content, nested in its own table so the rule
   is as wide as the word "Picacho" rather than the widest line in the block.

Tables rather than divs throughout, for the same reason every email client
guide says so: they survive sanitizers that rewrite layout CSS.

## Fill this in first

One value: `[SURNAME]`. Edit it in `email-signature.html` before copying.

Everything else in the entity line comes from `src/lib/legal-entity.ts` — the
same constant the site footer and the privacy policy render in all four
languages — so the signature cannot drift from what a recipient sees if they
check picacho.ai. That line is not decoration: a Spanish S.A. owes that
identification on its business correspondence, and the first use of this
signature is an enquiry asking a vendor to admit you to a gated programme,
where a verifiable entity is the part that makes the ask credible.

Two corrections were needed to get there, both found by cross-checking the
draft emails against the code on 2026-09-03:

- **The legal name is `JEAR TECNICA S.A.`**, as stored and as rendered on the
  live site — not "Jeartecnica S.A.", which this file and the BytePlus enquiry
  draft both used.
- **The label is NIF, not CIF.** `legal-entity.ts` stores it as `nif` and the
  footer renders "NIF A28847549"; CIF was replaced by NIF for Spanish entities
  in 2008. A recipient cross-checking the site would have found two labels for
  one number.

The Registro Mercantil line stays absent, exactly as on the site: `registryLine`
is empty until the tomo/folio/hoja surfaces from the escritura.

## Plain text, for clients that strip HTML

```
Ahmad [SURNAME]
Founder, Picacho
picacho.ai · hello@picacho.ai
The same character, in every single frame.

Picacho is operated by JEAR TECNICA S.A. · NIF A28847549
Paseo de la Castellana 259, 28046 Madrid, Spain
```

## Notes

- **Attach it to the hello@picacho.ai identity**, not the personal one, or
  mail sent from the alias carries the wrong footer or none.
- **Use the short version for replies.** Gmail holds more than one signature;
  a full block repeated down a thread reads as a mail-merge.
- **No phone number** unless you want inbound calls — an unanswered number on
  a signature is worse than no number.
- **No social links** until the handles are settled. A dead link on a
  signature gets clicked more than you would think.
- **No confidentiality disclaimer.** It binds nobody who never agreed to it,
  it lengthens every message, and on a first contact it reads as boilerplate.
- Design follows `src/lib/email/render.ts` so typed mail matches sent mail:
  wordmark as text rather than a hosted image (a remote image is a tracking
  signal many clients block, leaving a broken-image box as the masthead),
  ochre `#a84e24` links, muted `#a3a3a3` legal line, system font stack.
