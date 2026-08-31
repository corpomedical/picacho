// The legal identity behind Picacho — the single source of truth for every
// place the operator must be named (2026-09-01, LSSI-CE Art. 10 + GDPR
// controller naming; provided by the operator from the company records).
//
// The website and app are operated by the Spanish company below. Spain's
// LSSI requires a commercial website to identify its operator — legal name,
// NIF, registered address, and an effective means of contact — and the GDPR
// requires the privacy policy to name its data controller. Until today the
// site named nobody (found in the 2026-09-01 legal review).
export const LEGAL_ENTITY = {
  name: "JEAR TECNICA S.A.",
  nif: "A28847549",
  addressLines: ["Paseo de la Castellana 259", "28046 Madrid", "Spain"],
  // Registro Mercantil details (tomo/folio/hoja) intentionally EMPTY until
  // the operator digs them out of the escritura — rendered only when set,
  // so the live page never shows a placeholder.
  registryLine: "",
  // Split on purpose. The address is legally required on the site, but a
  // plain mailto in the HTML is harvested by every spam bot within days
  // (operator: "I hate putting email addresses because of spam"). The
  // ObfuscatedEmail component assembles these AFTER hydration, so the
  // server-rendered HTML that scrapers read never contains the joined
  // address. Determined bots that execute JS still get it — the law wants
  // the contact to be reachable, so invisible-to-everyone is not an option.
  emailUser: "hello",
  emailDomain: "picacho.ai",
} as const;
