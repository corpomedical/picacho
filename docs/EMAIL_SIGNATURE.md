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

## Fill these in first

Four values are not in this repo and were not guessed:

`[SURNAME]` · `[CIF]` · `[REGISTERED ADDRESS]` · `[REGISTRO MERCANTIL]`

Edit them in `email-signature.html` before copying. The registered-entity line
is not decoration: a Spanish S.A. owes that identification on its business
correspondence, and the first use of this signature is an enquiry asking a
vendor to admit you to a gated programme, where a verifiable entity is the
part that makes the ask credible.

## Plain text, for clients that strip HTML

```
Ahmad [SURNAME]
Founder, Picacho
picacho.ai · hello@picacho.ai
The same character, in every single frame.

Picacho is a trading name of Jeartecnica S.A. · CIF [CIF]
[REGISTERED ADDRESS] · [REGISTRO MERCANTIL]
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
