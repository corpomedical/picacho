import Stripe from "stripe";

// Server-only — never import this from a Client Component.
// STRIPE_SECRET_KEY is a test-mode (sandbox) key until Stripe finishes
// approving the account. Swap it for the live secret key in the production
// environment when ready to go live — no code changes needed here.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
