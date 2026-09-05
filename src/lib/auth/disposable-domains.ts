// Disposable-email screening for signup (2026-09-05 flaw hunt: a daily free
// render costs an attacker nothing but a throwaway address — the recorded
// abuse wave's only remedy was closing signups for everyone). This is the
// deliberately small, high-confidence list: the major disposable providers
// and their known alias domains, matched exactly or as a suffix (mailinator
// serves per-user subdomains). It will never catch everything — the signup
// velocity limit is the backstop — but it prices the lazy version of the
// attack out. A real person on one of these has an address that will not
// receive their confirmation email anyway.
//
// Fail-open rule, same as every other signup guard: anything not clearly on
// the list passes. Never add a real mail host here.
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "mailinator.net",
  "mailinator.org",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamail.biz",
  "guerrillamail.de",
  "guerrillamailblock.com",
  "sharklasers.com",
  "grr.la",
  "spam4.me",
  "pokemail.net",
  "10minutemail.com",
  "10minutemail.net",
  "10minemail.com",
  "temp-mail.org",
  "temp-mail.io",
  "tempmail.com",
  "tempmail.dev",
  "tempmailo.com",
  "tempail.com",
  "tempr.email",
  "discard.email",
  "discardmail.com",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
  "cool.fr.nf",
  "jetable.fr.nf",
  "throwawaymail.com",
  "trashmail.com",
  "trashmail.de",
  "trashmail.me",
  "kurzepost.de",
  "wegwerfmail.de",
  "wegwerfmail.net",
  "getnada.com",
  "nada.email",
  "dispostable.com",
  "maildrop.cc",
  "mintemail.com",
  "mohmal.com",
  "fakeinbox.com",
  "spamgourmet.com",
  "mytemp.email",
  "moakt.com",
  "moakt.cc",
  "tmpmail.org",
  "tmpmail.net",
  "tmails.net",
  "emailondeck.com",
  "mail-temp.com",
  "burnermail.io",
  "mailsac.com",
  "inboxkitten.com",
  "33mail.com",
  "mailnesia.com",
  "mail7.io",
  "harakirimail.com",
  "tempinbox.com",
  "cs.email",
  "mailcatch.com",
  "mailexpire.com",
  "spamex.com",
  "mailnull.com",
  "incognitomail.com",
  "anonbox.net",
  "deadaddress.com",
  "emailsensei.com",
  "spambog.com",
  "spambog.de",
  "spambog.ru",
  "0-mail.com",
  "byom.de",
  "dropmail.me",
  "10mail.org",
  "emltmp.com",
  "yomail.info",
  "vomoto.com",
  "fexbox.org",
  "mailbox.in.ua",
  "rover.info",
  "inboxbear.com",
  "spamherelots.com",
  "binkmail.com",
  "safetymail.info",
  "suremail.info",
]);

/**
 * True when the address's domain is a known disposable provider — exact
 * match, or a subdomain of one (mailinator hands out per-user subdomains).
 * Anything unparsable returns false: Supabase's own email validation is the
 * authority on format, this is only the throwaway screen.
 */
export function isDisposableEmail(email: string): boolean {
  const at = String(email ?? "").trim().toLowerCase().lastIndexOf("@");
  if (at < 0) return false;
  const domain = String(email).trim().toLowerCase().slice(at + 1);
  if (!domain) return false;
  if (DISPOSABLE_DOMAINS.has(domain)) return true;
  for (const d of DISPOSABLE_DOMAINS) {
    if (domain.endsWith("." + d)) return true;
  }
  return false;
}
