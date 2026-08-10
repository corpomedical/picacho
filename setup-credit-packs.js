// One-off local script — run this yourself. The sandbox Picacho is built in
// can't reach api.stripe.com (same reason setup-live-stripe.js and
// setup-eur-pricing.js had to be run locally).
//
// Creates one Stripe Product per credit pack, each with a USD Price and a
// EUR Price, then prints the price ids to paste into
// src/lib/stripe/credit-packs.ts. Pack sizes and amounts are read from that
// same file, so the two can't drift.
//
// Usage:
//   node setup-credit-packs.js
//
// Safe to re-run: it looks for an existing product with the same
// picacho_credit_pack metadata before creating a new one, so a second run
// reuses what's there instead of littering your dashboard with duplicates.
//
// Reads .env.local for STRIPE_SECRET_KEY. Use your LIVE key if you want
// these purchasable in production.

const fs = require("fs");
const Stripe = require("stripe");

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  const value = trimmed.slice(eq + 1).trim();
  if (!(key in process.env)) process.env[key] = value;
}

if (!process.env.STRIPE_SECRET_KEY) {
  console.error("STRIPE_SECRET_KEY is missing from .env.local.");
  process.exit(1);
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Kept in sync with src/lib/stripe/credit-packs.ts by hand — that file is
// TypeScript, which plain node can't import. If you change the packs there,
// change them here too.
const PACKS = [
  { id: "small", credits: 20, price: 45 },
  { id: "medium", credits: 60, price: 119 },
  { id: "large", credits: 150, price: 279 },
];

async function findExistingProduct(packId) {
  const existing = await stripe.products.search({
    query: `metadata['picacho_credit_pack']:'${packId}'`,
  });
  return existing.data[0] ?? null;
}

async function main() {
  const usd = {};
  const eur = {};

  for (const pack of PACKS) {
    let product = await findExistingProduct(pack.id);

    if (product) {
      console.log(`Reusing existing product for "${pack.id}" (${product.id})`);
    } else {
      product = await stripe.products.create({
        name: `Picacho — ${pack.credits} credits`,
        description: `A one-time top-up of ${pack.credits} generation credits.`,
        metadata: { picacho_credit_pack: pack.id, credits: String(pack.credits) },
      });
      console.log(`Created product for "${pack.id}" (${product.id})`);
    }

    const prices = await stripe.prices.list({ product: product.id, limit: 100 });

    for (const currency of ["usd", "eur"]) {
      const amount = pack.price * 100;
      let price = prices.data.find(
        (p) => p.currency === currency && p.unit_amount === amount && p.active && !p.recurring,
      );

      if (price) {
        console.log(`  reusing ${currency.toUpperCase()} price ${price.id}`);
      } else {
        price = await stripe.prices.create({
          product: product.id,
          currency,
          unit_amount: amount,
          // No `recurring` block at all — that's what makes this a one-time
          // charge rather than a subscription.
          metadata: { picacho_credit_pack: pack.id },
        });
        console.log(`  created ${currency.toUpperCase()} price ${price.id}`);
      }

      (currency === "usd" ? usd : eur)[pack.id] = price.id;
    }
  }

  console.log("\n\nPaste these into src/lib/stripe/credit-packs.ts:\n");
  console.log("export const CREDIT_PACK_PRICE_IDS: Record<string, string | null> = {");
  for (const pack of PACKS) console.log(`  ${pack.id}: "${usd[pack.id]}",`);
  console.log("};\n");
  console.log("export const CREDIT_PACK_PRICE_IDS_EUR: Record<string, string | null> = {");
  for (const pack of PACKS) console.log(`  ${pack.id}: "${eur[pack.id]}",`);
  console.log("};");
}

main().catch((err) => {
  console.error("\nFailed:", err.message);
  process.exit(1);
});
